import { beforeEach, expect, test } from "bun:test";
import { db } from "@/db/db";
import { adjustPart, restockPart, savePart, sellPart } from "@/db/parts";
import { buyUnit, returUnit, sellUnit } from "@/db/units";
import { changeStatus, createTicket, removePart, usePart } from "@/db/tickets";
import { closeCash, expectedCashToday, recordManualCash, requestCorrection } from "@/db/cash";
import { computeMonthlyReport, sumCash } from "@/db/money";
import { monthKey } from "@/lib/format";
import type { User } from "@/db/types";

const owner: User = { id: "preflight-owner", name: "Owner", username: "owner", role: "owner", pinHash: "hash", salt: "salt", active: 1, createdAt: 1 };
const cashier: User = { ...owner, id: "preflight-cashier", username: "cashier", role: "kasir" };
const technician: User = { ...owner, id: "preflight-technician", username: "technician", role: "teknisi" };
const photo = new Blob(["preflight image"], { type: "image/jpeg" });
const sale = { soldPrice: 1_500_000, buyerName: "Buyer", buyerPhone: "", garansiHari: 7, method: "transfer" as const };
const unitInput = { brand: "Samsung", model: "Test", varian: "", imei: "490154203237518", kondisi: "Baik", hargaBeli: 1_000_000, hargaJual: 1_500_000, sellerName: "Seller", sellerPhone: "", garansiHari: 7 };
const partInput = { nama: "LCD", brand: "Samsung", kategori: "sparepart" as const, stok: 5, hargaModal: 70_000, hargaJual: 100_000, minStok: 1 };

beforeEach(async () => {
  db.syncCapture = false;
  await db.open();
  for (const table of db.tables) await table.clear();
  await db.users.bulkAdd([owner, cashier, technician]);
});

test("unit purchase, sale, refund and resale preserve stock and cumulative margin", async () => {
  const unit = await buyUnit(owner, unitInput, [photo], photo);
  await sellUnit(cashier, unit, sale);
  await returUnit(owner, (await db.units.get(unit.id))!, { refund: 1_400_000, method: "transfer", alasan: "Retur dengan potongan" });
  expect((await db.units.get(unit.id))?.status).toBe("stok");
  expect(computeMonthlyReport(await db.cash.toArray(), [], monthKey()).unitMargin).toBe(100_000);
  await sellUnit(cashier, unit, { ...sale, soldPrice: 1_450_000 });
  expect((await db.units.get(unit.id))?.status).toBe("terjual");
  const report = computeMonthlyReport(await db.cash.toArray(), [], monthKey());
  expect(report.unitSoldCount).toBe(2);
  expect(report.returCount).toBe(1);
  expect(report.unitMargin).toBe(550_000);
  expect(sumCash(await db.cash.toArray()).net).toBe(550_000);
});

test("return cannot create a duplicate IMEI in available stock", async () => {
  const first = await buyUnit(owner, unitInput, [photo], photo);
  await sellUnit(cashier, first, sale);
  const second = await buyUnit(owner, unitInput, [photo], photo);
  const cashCount = await db.cash.count();
  await expect(returUnit(owner, first, { refund: sale.soldPrice, method: "transfer", alasan: "IMEI tercatat ulang" })).rejects.toThrow("IMEI");
  expect((await db.units.get(first.id))?.status).toBe("terjual");
  expect((await db.units.get(second.id))?.status).toBe("stok");
  expect(await db.cash.count()).toBe(cashCount);
});

test("a zero-refund return restores stock cost in the ledger before resale", async () => {
  const unit = await buyUnit(owner, unitInput, [photo], photo);
  await sellUnit(cashier, unit, sale);
  await returUnit(owner, unit, { refund: 0, method: "tunai", alasan: "Seluruh pembayaran disepakati sebagai potongan" });
  const returnedReport = computeMonthlyReport(await db.cash.toArray(), [], monthKey());
  expect(returnedReport.returCount).toBe(1);
  expect(returnedReport.returTotal).toBe(0);
  expect(returnedReport.unitMargin).toBe(1_500_000);
  await sellUnit(cashier, unit, { ...sale, soldPrice: 1_400_000 });
  const report = computeMonthlyReport(await db.cash.toArray(), [], monthKey());
  expect(report.unitMargin).toBe(1_900_000);
  expect(sumCash(await db.cash.toArray()).net).toBe(1_900_000);
});

test("cash correction cannot void a return marker and lose restored unit cost", async () => {
  const unit = await buyUnit(owner, unitInput, [photo], photo);
  await sellUnit(cashier, unit, sale);
  await returUnit(owner, unit, { refund: 1_400_000, method: "transfer", alasan: "Retur" });
  const marker = (await db.cash.where("category").equals("retur_unit").first())!;
  const auditCount = await db.audit.count();
  await expect(requestCorrection(owner, marker.id, { amount: marker.amount, note: marker.note, voided: 1 }, "Pembatalan salah arah")).rejects.toThrow("retur");
  expect((await db.cash.get(marker.id))?.voided).toBe(0);
  expect((await db.units.get(unit.id))?.status).toBe("stok");
  expect(await db.corrections.count()).toBe(0);
  expect(await db.audit.count()).toBe(auditCount);
  expect(computeMonthlyReport(await db.cash.toArray(), [], monthKey()).unitMargin).toBe(100_000);
  // Correcting the refund itself remains possible, including a full deduction.
  await requestCorrection(owner, marker.id, { amount: 0, note: "Retur, refund dikoreksi nol", voided: 0 }, "Refund belum dibayarkan");
  expect((await db.cash.get(marker.id))?.amount).toBe(0);
  expect(computeMonthlyReport(await db.cash.toArray(), [], monthKey()).unitMargin).toBe(1_500_000);
});

test("a cancelled repair expenses consumed parts in its closing month", async () => {
  const id = await savePart(owner, partInput);
  const ticket = await createTicket(owner, { customerName: "Customer", phone: "", brand: "Samsung", model: "Test", keluhan: "LCD", kelengkapan: [], estimasi: 0, dp: 0 }, [photo]);
  await usePart(owner, ticket, id, 1);
  await changeStatus(owner, (await db.tickets.get(ticket.id))!, "batal", { note: "Part rusak setelah pemasangan, tidak bisa digunakan lagi" });
  expect((await db.parts.get(id))?.stok).toBe(4);
  const report = computeMonthlyReport(await db.cash.toArray(), await db.tickets.toArray(), monthKey());
  expect(report.servisIn).toBe(0);
  expect(report.partModal).toBe(70_000);
  expect(report.laba).toBe(-70_000);
  expect(computeMonthlyReport(await db.cash.toArray(), await db.tickets.toArray(), "2000-01").partModal).toBe(0);
});

test("cancellation refunds its deposit but expenses only the parts still consumed", async () => {
  const id = await savePart(owner, partInput);
  const ticket = await createTicket(owner, { customerName: "Customer", phone: "", brand: "Samsung", model: "Test", keluhan: "LCD", kelengkapan: [], estimasi: 0, dp: 100_000 }, [photo]);
  await usePart(owner, ticket, id, 1);
  await usePart(owner, ticket, id, 1);
  await removePart(owner, (await db.tickets.get(ticket.id))!, 0);
  await changeStatus(owner, (await db.tickets.get(ticket.id))!, "batal", { refundDp: true, note: "Satu part dikembalikan, satu tidak dapat digunakan lagi" });
  const closed = (await db.tickets.get(ticket.id))!;
  expect((await db.parts.get(id))?.stok).toBe(4);
  const report = computeMonthlyReport(await db.cash.toArray(), [closed], monthKey());
  expect(report.servisIn).toBe(0);
  expect(report.partModal).toBe(70_000);
  expect(report.laba).toBe(-70_000);
  // Later metadata edits must not move the expense out of the closing month.
  const historical = { ...closed, updatedAt: Date.now(), history: closed.history.map((entry) => ({ ...entry, at: new Date(2020, 0, 15).getTime() })) };
  expect(computeMonthlyReport([], [historical], "2020-01").partModal).toBe(70_000);
  expect(computeMonthlyReport([], [historical], monthKey()).partModal).toBe(0);
});

test("restock uses weighted cost, sale snapshots that cost and simultaneous sales cannot oversell", async () => {
  const id = await savePart(owner, partInput);
  await restockPart(owner, id, 5, 450_000, "qris");
  expect((await db.parts.get(id))?.hargaModal).toBe(80_000);
  const results = await Promise.allSettled([
    sellPart(cashier, { partId: id, qty: 6, harga: 100_000, method: "qris" }),
    sellPart(cashier, { partId: id, qty: 6, harga: 100_000, method: "qris" }),
  ]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect((await db.parts.get(id))?.stok).toBe(4);
  const entry = await db.cash.where("category").equals("jual_aksesoris").first();
  expect(entry?.meta?.modal).toBe(480_000);
  expect(computeMonthlyReport(await db.cash.toArray(), [], monthKey()).aksesorisMargin).toBe(120_000);
});

test("zero-cost restock keeps the current cost for stock already paid outside this cash journal", async () => {
  const id = await savePart(owner, partInput);
  const cashCount = await db.cash.count();
  await restockPart(owner, id, 5, 0, "tunai");
  expect((await db.parts.get(id))?.stok).toBe(10);
  expect((await db.parts.get(id))?.hargaModal).toBe(70_000);
  expect(await db.cash.count()).toBe(cashCount);
});

test("stock and cash are rolled back together if accessory payment recording fails", async () => {
  const id = await savePart(owner, partInput);
  const before = { cash: await db.cash.count(), audit: await db.audit.count() };
  const fail = () => { throw new Error("Simulated payment failure"); };
  db.cash.hook("creating", fail);
  try {
    await expect(sellPart(cashier, { partId: id, qty: 1, harga: 100_000, method: "tunai" })).rejects.toThrow("Simulated");
  } finally {
    db.cash.hook("creating").unsubscribe(fail);
  }
  expect((await db.parts.get(id))?.stok).toBe(5);
  expect(await db.cash.count()).toBe(before.cash);
  expect(await db.audit.count()).toBe(before.audit);
});

test("an old physical-stock form cannot overwrite a sale made while it was open", async () => {
  const id = await savePart(owner, partInput);
  const displayed = (await db.parts.get(id))!;
  await sellPart(cashier, { partId: id, qty: 1, harga: 100_000, method: "tunai" });
  await expect(adjustPart(owner, id, 6, "Hitungan fisik sebelum penjualan", displayed.stok)).rejects.toThrow("berubah");
  expect((await db.parts.get(id))?.stok).toBe(4);
  await adjustPart(owner, id, 3, "Satu LCD pecah", 4);
  expect((await db.parts.get(id))?.stok).toBe(3);
});

test("an old correction form cannot silently replace a newer correction", async () => {
  await recordManualCash(owner, { type: "in", category: "modal_masuk", amount: 500_000, note: "Modal" });
  const displayed = (await db.cash.toArray())[0];
  await requestCorrection(owner, displayed.id, { amount: 400_000, note: "Modal revisi", voided: 0 }, "Hitung ulang");
  await expect(requestCorrection(owner, displayed.id, { amount: 300_000, note: "Form lama", voided: 0 }, "Form terbuka bersamaan", displayed)).rejects.toThrow("berubah");
  expect((await db.cash.get(displayed.id))?.amount).toBe(400_000);
  expect(await db.corrections.count()).toBe(1);
});

test("cash closing counts only cash and prevents later stock transactions with cash entries", async () => {
  const id = await savePart(owner, { ...partInput, stok: 0 });
  await recordManualCash(owner, { type: "in", category: "modal_masuk", amount: 500_000, method: "tunai", note: "Modal laci" });
  await recordManualCash(owner, { type: "in", category: "modal_masuk", amount: 900_000, method: "qris", note: "Modal rekening" });
  await restockPart(owner, id, 2, 140_000, "tunai");
  expect(await expectedCashToday()).toBe(360_000);
  await closeCash(owner, 360_000, "", 360_000);
  await expect(sellPart(cashier, { partId: id, qty: 1, harga: 100_000, method: "qris" })).rejects.toThrow("ditutup");
  expect((await db.parts.get(id))?.stok).toBe(2);
});

test("stock, purchase, manual cash and correction checks use the fresh active role", async () => {
  const id = await savePart(owner, partInput);
  await expect(restockPart(cashier, id, 1, 70_000, "tunai")).rejects.toThrow("akses");
  await expect(adjustPart(technician, id, 4, "Opname")).rejects.toThrow("akses");
  await expect(buyUnit(cashier, unitInput, [photo], photo)).rejects.toThrow("akses");
  await expect(recordManualCash(cashier, { type: "in", category: "modal_masuk", amount: 100, note: "Kas" })).rejects.toThrow("akses");
  const entry = (await db.cash.toArray())[0];
  await expect(requestCorrection(cashier, entry.id, { amount: 100, note: entry.note, voided: 0 }, "Milik orang lain")).rejects.toThrow("sendiri");
  await db.users.update(owner.id, { active: 0 });
  await expect(sellPart(owner, { partId: id, qty: 1, harga: 100_000, method: "tunai" })).rejects.toThrow("akses");
  expect((await db.parts.get(id))?.stok).toBe(5);
});
