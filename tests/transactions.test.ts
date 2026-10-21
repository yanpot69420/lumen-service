import { beforeEach, expect, spyOn, test } from "bun:test";
import { db } from "@/db/db";
import { buyUnit, sellUnit } from "@/db/units";
import { createTicket, usePart, changeStatus, submitServicePrice } from "@/db/tickets";
import { ticketTotal, ticketSisa, computeMonthlyReport } from "@/db/money";
import { dayKey, monthKey } from "@/lib/format";
import { closeCash, requestCorrection } from "@/db/cash";
import { coalesceChanges } from "@/db/sync";

const user = { id: "u", name: "Owner", username: "owner", role: "owner" as const, pinHash: "hash", salt: "salt", active: 1 as const, createdAt: 1 };
const input = { customerName: "Budi", phone: "", brand: "Test", model: "Phone", keluhan: "LCD", kelengkapan: [], estimasi: 100000, dp: 20000 };
beforeEach(async () => { db.syncCapture = false; await db.open(); for (const t of db.tables) await t.clear(); await db.users.add(user); });
async function unit() { return buyUnit(user, { brand: "Test", model: "Phone", varian: "", imei: "490154203237518", kondisi: "Baik", hargaBeli: 1000000, hargaJual: 1500000, sellerName: "Penjual", sellerPhone: "", garansiHari: 7 }, [new Blob(["photo"], { type: "image/jpeg" })], new Blob(["ktp"], { type: "image/jpeg" })); }
const sale = { soldPrice: 1500000, buyerName: "Pembeli", buyerPhone: "", garansiHari: 7, method: "tunai" as const };

test("failure to record cash rolls back unit, audit and durable queue", async () => {
  const u = await unit(); db.syncCapture = true;
  const fail = () => { throw new Error("Simulated cash failure"); };
  db.cash.hook("creating", fail);
  try { await expect(sellUnit(user, u, sale)).rejects.toThrow("Simulated"); }
  finally { db.cash.hook("creating").unsubscribe(fail); }
  expect((await db.units.get(u.id))?.status).toBe("stok");
  expect(await db.cash.filter((c) => c.category === "jual_unit").count()).toBe(0);
  expect(await db.outbox.count()).toBe(0);
});
test("concurrent sale attempts commit only one sale", async () => {
  const u = await unit();
  const result = await Promise.allSettled([sellUnit(user, u, sale), sellUnit(user, u, sale)]);
  expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(await db.cash.filter((c) => c.category === "jual_unit").count()).toBe(1);
});
test("stale ticket snapshots merge part usage without losing stock detail", async () => {
  const t = await createTicket(user, input, [new Blob(["photo"], {type:"image/jpeg"})]);
  await db.parts.add({ id: "p", nama: "LCD", kategori: "sparepart", stok: 5, hargaModal: 70, hargaJual: 100, minStok: 1 });
  await Promise.all([usePart(user, t, "p", 1), usePart(user, t, "p", 1)]);
  expect((await db.parts.get("p"))?.stok).toBe(3);
  expect((await db.tickets.get(t.id))?.partsUsed.reduce((s, p) => s + p.qty, 0)).toBe(2);
});
test("repeating ticket request cannot duplicate deposit", async () => {
  await createTicket(user, input, [new Blob(["photo"], {type:"image/jpeg"})], "tunai", undefined, undefined, "request");
  await createTicket(user, input, [new Blob(["photo"], {type:"image/jpeg"})], "tunai", undefined, undefined, "request");
  expect(await db.tickets.count()).toBe(1);
  expect(await db.cash.count()).toBe(1);
});
test("simple intake keeps accessories and transfers draft photos without creating a cash entry", async () => {
  await db.settings.put({ key: "draftServisBaru", value: "draft" });
  await db.photos.add({ id: "intake-photo", refType: "draft", refId: "servis-baru", blob: new Blob(["photo"], { type: "image/jpeg" }), createdAt: 1 });
  const data = { ...input, estimasi: 0, dp: 0, kelengkapan: ["Charger", "SIM Tray"] };
  const t = await createTicket(user, data, [], "tunai", undefined, "servis-baru", "simple-intake");
  expect(t.kelengkapan).toEqual(["Charger", "SIM Tray"]);
  expect(t.estimasi).toBe(0);
  expect(t.dp).toBe(0);
  expect(await db.cash.count()).toBe(0);
  expect((await db.photos.get("intake-photo"))?.refId).toBe(t.id);
  expect((await db.photos.get("intake-photo"))?.refType).toBe("ticket");
  expect((await db.settings.get("draftServisBaru"))?.value).toBe("");
  await expect(createTicket(user, data, [], "tunai", undefined, "servis-baru")).rejects.toThrow("Foto");
});
test("short service codes retry a local collision without replacing an existing ticket", async () => {
  let calls = 0;
  const random = spyOn(crypto, "getRandomValues").mockImplementation((array) => {
    new Uint8Array(array!.buffer, array!.byteOffset, array!.byteLength).fill(++calls <= 2 ? 0 : 1);
    return array;
  });
  try {
    const photo = new Blob(["photo"], { type: "image/jpeg" });
    const first = await createTicket(user, input, [photo]);
    const second = await createTicket(user, input, [photo]);
    expect(first.noNota).toMatch(/^LS-[2-9A-HJ-NP-Z]{12}$/);
    expect(first.noNota.length).toBe(15);
    expect(second.noNota).not.toBe(first.noNota);
    expect(calls).toBe(3);
    expect(await db.tickets.count()).toBe(2);
    expect((await db.tickets.get(first.id))?.noNota).toBe(first.noNota);
  } finally {
    random.mockRestore();
  }
});
test("creating a short service code leaves historical ticket numbers intact", async () => {
  const photo = new Blob(["photo"], { type: "image/jpeg" });
  const old = await createTicket(user, input, [photo]);
  const legacy = "LS-2610-123456789ABC-0001";
  await db.tickets.update(old.id, { noNota: legacy });
  const current = await createTicket(user, input, [photo]);
  expect(current.noNota.length).toBe(15);
  expect((await db.tickets.where("noNota").equals(legacy).first())?.id).toBe(old.id);
});
async function checkedTicket() {
  const ticket = await createTicket(user, { ...input, dp: 0, estimasi: 0 }, [new Blob(["photo"], { type: "image/jpeg" })]);
  await changeStatus(user, ticket, "dicek");
  return (await db.tickets.get(ticket.id))!;
}
test("price proposal normally waits for confirmation but can start work atomically", async () => {
  const waiting = await checkedTicket();
  await submitServicePrice(user, waiting, 0);
  expect((await db.tickets.get(waiting.id))?.status).toBe("konfirmasi");
  expect((await db.tickets.get(waiting.id))?.hargaFinal).toBe(true);
  const immediate = await checkedTicket();
  db.syncCapture = true;
  await submitServicePrice(user, immediate, 150000, true, "Pelanggan di konter");
  const updated = (await db.tickets.get(immediate.id))!;
  expect(updated.status).toBe("dikerjakan");
  expect(updated.biayaJasa).toBe(150000);
  expect(updated.history.slice(-2).map((h) => h.status)).toEqual(["konfirmasi", "dikerjakan"]);
  expect(await db.cash.count()).toBe(0);
  const queue = await db.outbox.toArray();
  expect(new Set(queue.map((row) => row.batchId)).size).toBe(1);
  const synced = coalesceChanges(queue).find((row) => row.table === "tickets");
  expect(synced?.before?.status).toBe("dicek");
  expect(synced?.payload?.status).toBe("dikerjakan");
  let staleError: unknown;
  try { await submitServicePrice(user, immediate, 200000, true); }
  catch (error) { staleError = error; }
  expect(staleError).toBeInstanceOf(Error);
  expect((staleError as Error).message).toContain("berubah");
});
test("failure while starting work rolls back the price proposal and its queued writes", async () => {
  const ticket = await checkedTicket();
  const auditCount = await db.audit.count();
  db.syncCapture = true;
  let writes = 0;
  const failSecondAudit = () => { if (++writes === 2) throw new Error("Simulated workflow failure"); };
  db.audit.hook("creating", failSecondAudit);
  let workflowError: unknown;
  try { await submitServicePrice(user, ticket, 150000, true); }
  catch (error) { workflowError = error; }
  finally { db.audit.hook("creating").unsubscribe(failSecondAudit); }
  expect(workflowError).toBeInstanceOf(Error);
  expect((workflowError as Error).message).toContain("Simulated");
  const unchanged = (await db.tickets.get(ticket.id))!;
  expect(unchanged.status).toBe("dicek");
  expect(unchanged.biayaJasa).toBe(0);
  expect(unchanged.history).toEqual(ticket.history);
  expect(await db.audit.count()).toBe(auditCount);
  expect(await db.outbox.count()).toBe(0);
});
test("refund reduces monthly income and status cannot be refunded twice", async () => {
  const t = await createTicket(user, input, [new Blob(["photo"], {type:"image/jpeg"})]);
  await changeStatus(user, t, "batal", { refundDp: true });
  await expect(changeStatus(user, t, "batal", { refundDp: true })).rejects.toThrow();
  expect(computeMonthlyReport(await db.cash.toArray(), await db.tickets.toArray(), monthKey()).servisIn).toBe(0);
});
test("final zero price and paid balance use explicit final price and receivable", () => {
  const t = { ...input, id: "t", noNota: "LS", biayaJasa: 0, hargaFinal: true, partsUsed: [], status: "diambil" as const, piutang: 0, history: [], createdAt: 1, updatedAt: 1, createdBy: "u" };
  expect(ticketTotal(t)).toBe(0); expect(ticketSisa(t)).toBe(0);
});
test("closing cash rejects stale balance and never overwrites an existing close", async () => {
  await createTicket(user, input, [new Blob(["photo"], {type:"image/jpeg"})]);
  await expect(closeCash(user, 0, "test", 0)).rejects.toThrow("berubah");
  await closeCash(user, 20000, "", 20000);
  await expect(closeCash(user, 20000, "", 20000)).rejects.toThrow("sudah ditutup");
  expect((await db.dayCloses.get(dayKey()))?.counted).toBe(20000);
});
test("deposit correction updates the source balance even when its description changes", async () => {
  const ticket = await createTicket(user,input,[new Blob(["photo"],{type:"image/jpeg"})]);
  const entry = (await db.cash.toArray())[0];
  await requestCorrection(user,entry.id,{amount:30000,note:"DP direvisi",voided:0},"Salah nominal");
  expect((await db.tickets.get(ticket.id))?.dp).toBe(30000);
  expect((await db.cash.get(entry.id))?.meta?.paymentKind).toBe("dp");
});
