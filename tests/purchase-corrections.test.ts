import { beforeEach, expect, test } from "bun:test";
import { db } from "@/db/db";
import { savePart, restockPart, sellPart, adjustPart } from "@/db/parts";
import { correctPurchase, previewPurchaseCorrection, purchaseContext, type PurchaseCorrectionInput } from "@/db/purchases";
import { expectedCashToday, requestCorrection } from "@/db/cash";
import { exportBackup, restoreBackup } from "@/db/backup";
import { validateBackup } from "@/lib/backup-schema";
import type { User } from "@/db/types";

const ho: User = { id: "purchase-ho", name: "HO", username: "purchase-ho", role: "headops", pinHash: "hash", salt: "salt", active: 1, createdAt: 1 };
const owner: User = { ...ho, id: "purchase-owner", username: "purchase-owner", role: "owner" };
const cashier: User = { ...ho, id: "purchase-cashier", username: "purchase-cashier", role: "kasir" };
const input = { nama: "LCD test", brand: "Samsung", kategori: "sparepart" as const, stok: 4, hargaModal: 138000, hargaJual: 200000, minStok: 1 };
const correction: PurchaseCorrectionInput = { qty: 4, totalCost: 408000, kind: "record", reason: "Salah ketik nota supplier", method: "tunai" };
beforeEach(async () => {
  db.syncCapture = false; await db.open();
  for (const table of db.tables) await table.clear();
  await db.users.bulkAdd([owner, ho, cashier]);
});
async function purchase() {
  const partId = await savePart(ho, input);
  return { partId, entry: (await db.cash.where("refId").equals(partId).first())! };
}
async function expectFailure(action: () => Promise<unknown>, message: string) {
  let error: unknown;
  try { await action(); } catch (failure) { error = failure; }
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toContain(message);
}

test("HO corrects stock cost and cash immediately in one audited operation", async () => {
  const { partId, entry } = await purchase();
  await correctPurchase(ho, await purchaseContext(entry.id), correction);
  expect(await db.parts.get(partId)).toMatchObject({ stok: 4, hargaModal: 102000 });
  expect((await db.cash.get(entry.id))?.amount).toBe(408000);
  expect(await expectedCashToday()).toBe(-408000);
  expect((await db.corrections.toArray())[0]).toMatchObject({ status: "approved", requestedBy: ho.id, decidedBy: ho.id, before: { amount: 552000 }, after: { amount: 408000, purchase: { stock: 4, unitCost: 102000 } } });
  expect((await db.audit.toArray()).some((row) => row.action === "koreksi-pembelian")).toBe(true);
});

test("quantity correction updates stock once; stale submission cannot repeat it", async () => {
  const { partId, entry } = await purchase(); const displayed = await purchaseContext(entry.id);
  await correctPurchase(ho, displayed, { ...correction, qty: 3 });
  expect(await db.parts.get(partId)).toMatchObject({ stok: 3, hargaModal: 136000 });
  await expectFailure(() => correctPurchase(ho, displayed, { ...correction, qty: 3 }), "berubah");
  expect(await db.corrections.count()).toBe(1);
});

test("correcting a latest restock preserves the earlier inventory's weighted value", async () => {
  const id = await savePart(ho, { ...input, stok: 5, hargaModal: 70000 });
  await restockPart(ho, id, 5, 450000, "qris");
  const entry = (await db.cash.where("refId").equals(id).toArray()).find((row) => row.meta?.purchase?.stockBefore === 5)!;
  await correctPurchase(ho, await purchaseContext(entry.id), { ...correction, qty: 5, totalCost: 350000 });
  expect(await db.parts.get(id)).toMatchObject({ stok: 10, hargaModal: 70000 });
  expect((await db.cash.get(entry.id))?.method).toBe("qris");
});

test("supplier refund creates new cash in and preserves original cash out", async () => {
  const { partId, entry } = await purchase();
  await correctPurchase(ho, await purchaseContext(entry.id), { ...correction, kind: "refund" });
  expect((await db.cash.get(entry.id))?.amount).toBe(552000);
  const refund = (await db.cash.toArray()).find((row) => row.type === "in")!;
  expect(refund).toMatchObject({ amount: 144000, category: "restok_part", meta: { purchaseRefundFor: entry.id } });
  expect(await db.parts.get(partId)).toMatchObject({ stok: 4, hargaModal: 102000 });
  expect(await expectedCashToday()).toBe(-408000);
  await expectFailure(() => requestCorrection(owner, refund.id, { amount: 1, note: refund.note, voided: 0 }, "Salah"), "Koreksi Pembelian");
});

test("refund uses its actual method and repeated refunds cannot exceed the remaining purchase cost", async () => {
  const { entry } = await purchase();
  await correctPurchase(ho, await purchaseContext(entry.id), { ...correction, kind: "refund", method: "transfer" });
  expect(await expectedCashToday()).toBe(-552000);
  const context = await purchaseContext(entry.id);
  expect(context.snapshot.totalCost).toBe(408000);
  expect(() => previewPurchaseCorrection(context, { ...correction, kind: "refund", totalCost: 500000 })).toThrow("mengurangi");
  await correctPurchase(ho, context, { ...correction, kind: "refund", totalCost: 0 });
  expect((await db.parts.toArray())[0].hargaModal).toBe(0);
  expect((await db.cash.toArray()).filter((row) => row.type === "in").reduce((total, row) => total + row.amount, 0)).toBe(552000);
});

test("legacy unused single purchase reconciles current stock and supersedes pending cash-only request", async () => {
  const { partId, entry } = await purchase();
  await db.cash.update(entry.id, { meta: undefined });
  await adjustPart(ho, partId, 3, "Jumlah awal salah", 4);
  await requestCorrection(ho, entry.id, { amount: 408000, note: entry.note, voided: 0 }, "Salah jumlah", entry);
  await correctPurchase(ho, await purchaseContext(entry.id), { ...correction, qty: 3 });
  expect(await db.parts.get(partId)).toMatchObject({ stok: 3, hargaModal: 136000 });
  expect((await db.corrections.toArray()).map((row) => row.status).sort()).toEqual(["approved", "rejected"]);
});

test("legacy purchase with previously corrected cash can repair its remaining inventory cost", async () => {
  const { partId, entry } = await purchase();
  await db.cash.update(entry.id, { meta: undefined, amount: 408000 });
  await correctPurchase(ho, await purchaseContext(entry.id), correction);
  expect(await db.parts.get(partId)).toMatchObject({ stok: 4, hargaModal: 102000 });
  expect((await db.cash.get(entry.id))?.amount).toBe(408000);
});

test("used, altered, multiple legacy purchases and closed cash are blocked without changing data", async () => {
  const { partId, entry } = await purchase();
  await sellPart(cashier, { partId, qty: 1, harga: 200000, method: "tunai" });
  await expectFailure(() => purchaseContext(entry.id), "rekonsiliasi");
  await db.cash.update(entry.id, { meta: undefined });
  await expectFailure(() => purchaseContext(entry.id), "pemakaian");
  expect((await db.cash.get(entry.id))?.amount).toBe(552000);
  await db.cash.where("category").equals("jual_aksesoris").delete();
  await db.dayCloses.add({ dayKey: entry.dayKey, expected: 0, counted: 0, selisih: 0, note: "", closedBy: owner.id, closedByName: owner.name, closedAt: Date.now() });
  await expectFailure(() => purchaseContext(entry.id), "ditutup");
});

test("cashier and inactive HO cannot apply a purchase correction", async () => {
  const { entry } = await purchase(); const context = await purchaseContext(entry.id);
  await expectFailure(() => correctPurchase(cashier, context, correction), "akses");
  await db.users.update(ho.id, { active: 0 });
  await expectFailure(() => correctPurchase(ho, context, correction), "akses");
  expect(await db.corrections.count()).toBe(0);
});

test("local stock restored after a sale and ambiguous legacy batches still require reconciliation", async () => {
  const { partId, entry } = await purchase();
  await sellPart(cashier, { partId, qty: 1, harga: 200000, method: "tunai" });
  await restockPart(ho, partId, 1, 0, "tunai");
  expect((await db.parts.get(partId))?.stok).toBe(4);
  await expectFailure(() => purchaseContext(entry.id), "rekonsiliasi");
  await db.cash.where("category").equals("jual_aksesoris").delete();
  await db.cash.update(entry.id, { meta: undefined });
  await restockPart(ho, partId, 1, 138000, "tunai");
  await expectFailure(() => purchaseContext(entry.id), "beberapa pembelian");
});

test("audit failure rolls back stock, cash, refunds, pending decisions and the durable outbox", async () => {
  const { entry, partId } = await purchase(); const context = await purchaseContext(entry.id);
  const before = await db.cash.toArray(); db.syncCapture = true;
  const fail = () => { throw new Error("Audit unavailable"); }; db.audit.hook("creating", fail);
  try { await expectFailure(() => correctPurchase(ho, context, { ...correction, kind: "refund" }), "Audit unavailable"); }
  finally { db.audit.hook("creating").unsubscribe(fail); db.syncCapture = false; }
  expect(await db.cash.toArray()).toEqual(before);
  expect((await db.parts.get(partId))?.hargaModal).toBe(138000);
  expect(await db.corrections.count()).toBe(0); expect(await db.outbox.count()).toBe(0);
});

test("successful correction queues a single complete batch and dirty source rows wait for sync", async () => {
  const { entry, partId } = await purchase(); const context = await purchaseContext(entry.id);
  db.syncCapture = true;
  try {
    await correctPurchase(ho, context, correction);
    const queue = await db.outbox.toArray();
    expect(new Set(queue.map((row) => row.batchId)).size).toBe(1);
    expect(new Set(queue.map((row) => row.table))).toEqual(new Set(["parts", "cash", "corrections", "audit"]));
    await expectFailure(() => purchaseContext(entry.id), "sinkronisasi");
  } finally { db.syncCapture = false; }
  expect((await db.parts.get(partId))?.hargaModal).toBe(102000);
});

test("purchase correction snapshots roundtrip through backup and reject malformed snapshots", async () => {
  const { entry } = await purchase(); await correctPurchase(ho, await purchaseContext(entry.id), correction);
  const backup = await exportBackup(); expect(validateBackup(backup).corrections[0].after.purchase?.unitCost).toBe(102000);
  await restoreBackup(backup); expect((await db.cash.get(entry.id))?.meta?.purchase?.totalCost).toBe(408000);
  const damaged = structuredClone(backup); damaged.cash[0].meta!.purchase!.qty = 0;
  expect(() => validateBackup(damaged)).toThrow("pembelian");
  const damagedCorrection = structuredClone(backup); damagedCorrection.corrections[0].after.purchase!.totalCost = -1;
  expect(() => validateBackup(damagedCorrection)).toThrow("pembelian");
  const orphan = structuredClone(backup); orphan.corrections[0].after.purchase!.partId = "missing";
  expect(() => validateBackup(orphan)).toThrow("referensi koreksi");
});
