import { beforeEach, expect, test } from "bun:test";
import { db } from "@/db/db";
import { saveCustomer } from "@/db/customers";
import { changeStatus, createGaransiClaim, createTicket, payPiutang, reviseJasa, submitServicePrice, ticketTotal, updateTicketInfo, usePart } from "@/db/tickets";
import { undoServiceChange, withServiceUndo } from "@/db/undo";
import type { Ticket, User } from "@/db/types";

const owner: User = { id: "preflight-owner", name: "Owner", username: "owner", role: "owner", pinHash: "hash", salt: "salt", active: 1, createdAt: 1 };
const technician: User = { ...owner, id: "preflight-tech", username: "tech", role: "teknisi" };
const intake = { customerName: "Pelanggan Uji", phone: "081234567890", brand: "Samsung", model: "A15", keluhan: "LCD rusak", kelengkapan: ["SIM Tray"], estimasi: 0, dp: 0 };
const photo = () => new Blob(["isolated-test-photo"], { type: "image/jpeg" });

beforeEach(async () => {
  db.syncCapture = false;
  await db.open();
  for (const table of db.tables) await table.clear();
  await db.users.bulkAdd([owner, technician]);
});

async function fresh(ticket: Ticket) { return (await db.tickets.get(ticket.id))!; }
async function fail(action: () => Promise<unknown>, message: string) {
  let error: unknown;
  try { await action(); } catch (caught) { error = caught; }
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toContain(message);
}
async function checked() {
  const ticket = await createTicket(owner, intake, [photo()]);
  await changeStatus(technician, ticket, "dicek");
  return fresh(ticket);
}
async function completed(jasa = 150000) {
  const ticket = await checked();
  await submitServicePrice(technician, ticket, jasa, true);
  await changeStatus(technician, await fresh(ticket), "selesai");
  return fresh(ticket);
}
const info = (ticket: Ticket) => ({ customerName: ticket.customerName, phone: ticket.phone, brand: ticket.brand, model: ticket.model, keluhan: ticket.keluhan, kelengkapan: ticket.kelengkapan });

test("preflight: normal service, parts, partial collection and receivable settlement balance exactly", async () => {
  let ticket = await checked();
  await db.parts.add({ id: "lcd", nama: "LCD A15", kategori: "sparepart", stok: 2, hargaModal: 60000, hargaJual: 100000, minStok: 1 });
  await usePart(technician, ticket, "lcd", 1);
  await submitServicePrice(technician, await fresh(ticket), 150000);
  expect((await fresh(ticket)).status).toBe("konfirmasi");
  await changeStatus(technician, await fresh(ticket), "dikerjakan");
  await changeStatus(technician, await fresh(ticket), "selesai");
  ticket = await fresh(ticket);
  expect(ticketTotal(ticket)).toBe(250000);
  await fail(() => changeStatus(technician, ticket, "diambil"), "Kasir");
  expect(await db.cash.count()).toBe(0);
  await changeStatus(owner, ticket, "diambil", { bayar: 200000, method: "qris" });
  ticket = await fresh(ticket);
  expect(ticket.piutang).toBe(50000);
  await payPiutang(owner, ticket, 60000, "transfer");
  expect((await fresh(ticket)).piutang).toBe(0);
  const cash = await db.cash.toArray();
  expect(cash.map((entry) => entry.amount).sort((a, b) => a - b)).toEqual([50000, 200000]);
  expect(cash.reduce((sum, entry) => sum + entry.amount, 0)).toBe(250000);
  expect((await db.parts.get("lcd"))?.stok).toBe(1);
  await fail(() => payPiutang(owner, ticket, 50000, "tunai"), "berubah");
  expect(await db.cash.count()).toBe(2);
});

test("preflight: stale collection cannot silently turn a changed bill into a receivable", async () => {
  const ticket = await completed();
  await reviseJasa(owner, ticket, 200000, "IC tambahan");
  db.syncCapture = true;
  await fail(() => changeStatus(owner, ticket, "diambil", { bayar: 150000 }), "berubah");
  expect((await fresh(ticket)).status).toBe("selesai");
  expect(await db.cash.count()).toBe(0);
  expect(await db.outbox.count()).toBe(0);
});

test("preflight: stale collection detects changed parts even when the grand total is equal", async () => {
  const ticket = await completed();
  await db.parts.add({ id: "replacement", nama: "Pengganti", kategori: "sparepart", stok: 1, hargaModal: 20000, hargaJual: 50000, minStok: 0 });
  await usePart(owner, ticket, "replacement", 1);
  await reviseJasa(owner, await fresh(ticket), 100000, "Rincian diganti");
  expect(ticketTotal(await fresh(ticket))).toBe(ticketTotal(ticket));
  await fail(() => changeStatus(owner, ticket, "diambil", { bayar: 150000 }), "berubah");
  expect(await db.cash.count()).toBe(0);
});

test("preflight: a cloud revision-only acknowledgment still permits collection", async () => {
  const ticket = await completed(0);
  await db.tickets.update(ticket.id, { _version: 42 });
  await changeStatus(owner, ticket, "diambil", { bayar: 0 });
  expect((await fresh(ticket)).status).toBe("diambil");
  expect((await fresh(ticket)).piutang).toBe(0);
  expect(await db.cash.count()).toBe(0);
});

test("preflight: simultaneous price revisions reject a stale overwrite", async () => {
  const ticket = await completed();
  const results = await Promise.allSettled([
    reviseJasa(owner, ticket, 200000, "IC"),
    reviseJasa(owner, ticket, 250000, "LCD"),
  ]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  expect((await fresh(ticket)).history.filter((entry) => entry.note?.startsWith("Revisi harga jasa"))).toHaveLength(1);
});

test("preflight: stale nota edits cannot erase another saved correction", async () => {
  const ticket = await checked();
  await updateTicketInfo(owner, ticket, { ...info(ticket), model: "A15 5G" });
  await fail(() => updateTicketInfo(owner, ticket, { ...info(ticket), keluhan: "Layar dan baterai" }), "berubah");
  expect((await fresh(ticket)).model).toBe("A15 5G");
  expect((await fresh(ticket)).keluhan).toBe(ticket.keluhan);
});

test("preflight: warranty cannot bypass intake photos with a missing, open or warranty source", async () => {
  await fail(() => createTicket(owner, intake, [], "tunai", "missing"), "garansi");
  expect(await db.customers.count()).toBe(0);
  const open = await checked();
  await fail(() => createGaransiClaim(owner, open, "Rusak lagi"), "diambil");
  const source = await completed();
  await changeStatus(owner, source, "diambil");
  const collected = await fresh(source);
  const claim = await createGaransiClaim(owner, collected, "Rusak lagi");
  expect(claim.garansiDari).toBe(source.id);
  expect(claim.customerId).toBe(source.customerId);
  expect(claim.hargaFinal).toBe(true);
  expect(ticketTotal(claim)).toBe(0);
  await fail(() => createTicket(owner, intake, [], "tunai", claim.id), "garansi");
});

test("preflight: warranty refreshes saved identity and preserves discretionary expired claims", async () => {
  const source = await completed();
  await changeStatus(owner, source, "diambil");
  const collected = await fresh(source);
  await updateTicketInfo(owner, collected, { ...info(collected), model: "A15 5G" });
  const saved = await fresh(source);
  await db.tickets.update(source.id, { history: saved.history.map((entry) => entry.status === "diambil" ? { ...entry, at: Date.now() - 30 * 86400000 } : entry) });
  const claim = await createGaransiClaim(owner, collected, "Kebijakan konter");
  expect(claim.model).toBe("A15 5G");
  await db.tickets.delete(source.id);
  await fail(() => createGaransiClaim(owner, collected, "Sumber sudah dihapus"), "garansi");
});

test("preflight: Undo restores a cancellation deposit refund atomically", async () => {
  const ticket = await createTicket(owner, { ...intake, estimasi: 100000, dp: 20000 }, [photo()]);
  const cashBefore = await db.cash.toArray();
  db.syncCapture = true;
  const result = await withServiceUndo(owner, "Batal servis", () => changeStatus(owner, ticket, "batal", { refundDp: true, note: "Tidak jadi" }));
  expect((await fresh(ticket)).status).toBe("batal");
  expect(await db.cash.count()).toBe(2);
  await undoServiceChange(owner, result.undo!.id);
  expect(await fresh(ticket)).toEqual(ticket);
  expect(await db.cash.toArray()).toEqual(cashBefore);
  expect((await db.outbox.toArray()).every((entry) => entry.table === "audit")).toBe(true);
});

test("preflight: Undo cannot reopen a collected source while a later warranty depends on it", async () => {
  const ticket = await completed(0);
  db.syncCapture = true;
  const collection = await withServiceUndo(owner, "Unit diambil", () => changeStatus(owner, ticket, "diambil"));
  const collected = await fresh(ticket);
  const warranty = await withServiceUndo(owner, "Klaim garansi", () => createGaransiClaim(owner, collected, "Keluhan kembali"));
  const cashCount = await db.cash.count();
  await fail(() => undoServiceChange(owner, collection.undo!.id), "garansi");
  expect((await fresh(ticket)).status).toBe("diambil");
  expect((await db.tickets.get(warranty.value.id))?.garansiDari).toBe(ticket.id);
  expect(await db.cash.count()).toBe(cashCount);
  await undoServiceChange(owner, warranty.undo!.id);
  await undoServiceChange(owner, collection.undo!.id);
  expect((await fresh(ticket)).status).toBe("selesai");
  expect(await db.tickets.get(warranty.value.id)).toBeUndefined();
});

test("preflight: a stale customer form cannot replace newer contact notes", async () => {
  const input = { name: intake.customerName, phone: intake.phone, notes: "Hubungi sore", isRegular: true };
  const customer = await saveCustomer(owner, input);
  await saveCustomer(owner, { ...input, notes: "Persetujuan lewat WA" }, customer.id, customer);
  await fail(() => saveCustomer(owner, { ...input, phone: "081299990000" }, customer.id, customer), "berubah");
  expect((await db.customers.get(customer.id))?.notes).toBe("Persetujuan lewat WA");
  expect((await db.customers.get(customer.id))?.phone).toBe(input.phone);
  const current = (await db.customers.get(customer.id))!;
  await db.customers.update(customer.id, { _version: 8 });
  const saved = await saveCustomer(owner, { ...input, notes: current.notes, phone: "081299990000" }, customer.id, current);
  expect(saved.phone).toBe("081299990000");
  expect(saved._version).toBe(8);
});
