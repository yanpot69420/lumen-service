import { beforeEach, expect, test } from "bun:test";
import { db } from "@/db/db";
import { closeCash, decideCorrection, requestCorrection, expectedCashToday, recordManualCash } from "@/db/cash";
import { buyUnit, sellUnit, returUnit } from "@/db/units";
import { savePart, restockPart, sellPart } from "@/db/parts";
import { computeMonthlyReport } from "@/db/money";
import { monthKey } from "@/lib/format";
import type { CashEntry, User } from "@/db/types";

const owner: User = { id: "review-owner", name: "Owner", username: "owner", role: "owner", pinHash: "hash", salt: "salt", active: 1, createdAt: 1 };
const ho: User = { ...owner, id: "review-ho", username: "ho", role: "headops" };
const unitInput = { brand: "Samsung", model: "Test", varian: "", imei: "490154203237518", kondisi: "Baik", hargaBeli: 1000000, hargaJual: 1500000, sellerName: "Seller", sellerPhone: "", garansiHari: 7 };
const partInput = { nama: "LCD", brand: "Samsung", kategori: "sparepart" as const, stok: 5, hargaModal: 70000, hargaJual: 100000, minStok: 1 };
const photo = new Blob(["image"], { type: "image/jpeg" });
const sale = { soldPrice: 1500000, buyerName: "Buyer", buyerPhone: "", garansiHari: 7, method: "tunai" as const };
const fields = (entry: CashEntry, amount = entry.amount, voided = entry.voided) => ({ amount, note: entry.note, voided });
async function fails(action: () => Promise<unknown>, message: string) { let error: unknown; try { await action(); } catch (caught) { error = caught; } expect(error).toBeInstanceOf(Error); expect((error as Error).message).toContain(message); }
beforeEach(async () => { db.syncCapture = false; await db.open(); for (const table of db.tables) await table.clear(); await db.users.bulkAdd([owner, ho]); });

async function purchasedUnit() { const unit = await buyUnit(owner, unitInput, [photo], photo); return { unit, entry: (await db.cash.where("refId").equals(unit.id).first())! }; }
async function soldPart() { const id = await savePart(owner, partInput); await sellPart(owner, { partId: id, qty: 2, harga: 100000, method: "tunai" }); return { id, entry: (await db.cash.where("category").equals("jual_aksesoris").first())! }; }

test("unit purchase correction updates cost atomically and the following sale uses the corrected margin", async () => {
  const { unit, entry } = await purchasedUnit(); await requestCorrection(owner, entry.id, fields(entry, 800000), "Diskon supplier", entry);
  expect((await db.units.get(unit.id))?.hargaBeli).toBe(800000); expect((await db.cash.get(entry.id))?.amount).toBe(800000);
  await sellUnit(owner, unit, sale); expect((await db.cash.where("category").equals("jual_unit").first())?.meta?.modal).toBe(800000);
  expect(computeMonthlyReport(await db.cash.toArray(), [], monthKey()).unitMargin).toBe(700000);
});
test("pending purchase approval rechecks whether the unit was subsequently sold", async () => {
  const { unit, entry } = await purchasedUnit(); await requestCorrection(ho, entry.id, fields(entry, 800000), "Diskon supplier", entry);
  const correction = (await db.corrections.toArray())[0]; await sellUnit(owner, unit, sale);
  await fails(() => decideCorrection(owner, correction.id, true), "rekonsiliasi");
  expect((await db.corrections.get(correction.id))?.status).toBe("pending"); expect((await db.cash.get(entry.id))?.amount).toBe(1000000);
});
test("unit cost remains immutable after a return clears soldAt", async () => {
  const { unit, entry } = await purchasedUnit(); await sellUnit(owner, unit, sale); await returUnit(owner, unit, { refund: 1500000, method: "tunai", alasan: "Retur" });
  await fails(() => requestCorrection(owner, entry.id, fields(entry, 800000), "Diskon"), "rekonsiliasi");
  await fails(() => requestCorrection(owner, entry.id, fields(entry, entry.amount, 1), "Batal"), "tidak dapat dibatalkan");
  expect((await db.units.get(unit.id))?.hargaBeli).toBe(1000000);
});
test("void accessory sale restores stock once and remains void when another note correction is applied", async () => {
  const { id, entry } = await soldPart(); expect((await db.parts.get(id))?.stok).toBe(3);
  await requestCorrection(owner, entry.id, fields(entry, entry.amount, 1), "Barang kembali utuh", entry);
  expect((await db.parts.get(id))?.stok).toBe(5); expect(await expectedCashToday()).toBe(-350000);
  const voided = (await db.cash.get(entry.id))!;
  await requestCorrection(owner, entry.id, { ...fields(voided), note: "Retur diperiksa" }, "Perjelas alasan", voided);
  expect((await db.parts.get(id))?.stok).toBe(5);
  await fails(() => requestCorrection(owner, entry.id, { ...fields(voided), note: "Retur diperiksa", voided: 0 }, "Aktif lagi"), "penjualan baru");
  expect((await db.cash.get(entry.id))?.voided).toBe(1);
});
test("pending accessory cancellation restores stock only when approved", async () => {
  const { id, entry } = await soldPart(); await requestCorrection(ho, entry.id, fields(entry, entry.amount, 1), "Barang kembali", entry);
  expect((await db.parts.get(id))?.stok).toBe(3); const correction = (await db.corrections.toArray())[0];
  await decideCorrection(owner, correction.id, true); expect((await db.parts.get(id))?.stok).toBe(5);
  await fails(() => decideCorrection(owner, correction.id, true), "diputuskan"); expect((await db.parts.get(id))?.stok).toBe(5);
});
test("cancelling an accessory sale after restock restores its original cost into the weighted inventory", async () => {
  const { id, entry } = await soldPart();
  await restockPart(owner, id, 5, 510000, "tunai");
  expect(await db.parts.get(id)).toMatchObject({ stok: 8, hargaModal: 90000 });
  await requestCorrection(owner, entry.id, fields(entry, entry.amount, 1), "Barang kembali utuh", entry);
  expect(await db.parts.get(id)).toMatchObject({ stok: 10, hargaModal: 86000 });
  expect((await db.cash.get(entry.id))?.meta).toEqual({ modal: 140000, qty: 2 });
});
test("invalid legacy accessory sale cannot invent returned stock", async () => {
  const { id, entry } = await soldPart(); await db.cash.update(entry.id, { meta: undefined });
  await fails(() => requestCorrection(owner, entry.id, fields(entry, entry.amount, 1), "Barang kembali"), "Rekonsiliasi");
  expect((await db.parts.get(id))?.stok).toBe(3); expect((await db.cash.get(entry.id))?.voided).toBe(0);
});
test("stale catalog forms cannot overwrite another user's name or retail price", async () => {
  const id = await savePart(owner, partInput); const displayed = (await db.parts.get(id))!;
  await savePart(owner, { ...displayed, nama: "LCD AMOLED", hargaJual: 180000 }, id, { displayed });
  await fails(() => savePart(ho, { ...displayed, minStok: 2 }, id, { displayed }), "sudah berubah");
  expect(await db.parts.get(id)).toMatchObject({ nama: "LCD AMOLED", hargaJual: 180000, minStok: 1 });
});
test("catalog edit after restock preserves fresh quantity and weighted purchase cost", async () => {
  const id = await savePart(owner, partInput); const displayed = (await db.parts.get(id))!; await restockPart(ho, id, 5, 450000, "tunai");
  await savePart(owner, { ...displayed, minStok: 2 }, id, { displayed });
  expect(await db.parts.get(id)).toMatchObject({ stok: 10, hargaModal: 80000, minStok: 2 });
  await fails(() => savePart(owner, { ...displayed, minStok: 3 }, id), "sudah berubah");
});
test("initial stock paid by transfer records expenses without decreasing the cash drawer", async () => {
  const id = await savePart(ho, partInput, undefined, { initialPaymentMethod: "transfer" });
  expect((await db.cash.where("refId").equals(id).first())?.method).toBe("transfer"); expect(await expectedCashToday()).toBe(0);
});
test("closing cash blocks pending unit and accessory approvals but still allows rejecting the requests", async () => {
  await recordManualCash(owner, { type: "in", category: "modal_masuk", amount: 2000000, note: "Modal awal" });
  const { unit, entry: purchase } = await purchasedUnit(); const { id, entry: sold } = await soldPart();
  await requestCorrection(ho, purchase.id, fields(purchase, 800000), "Harga salah", purchase);
  await requestCorrection(ho, sold.id, fields(sold, sold.amount, 1), "Barang kembali", sold);
  const pending = await db.corrections.toArray(); const expected = await expectedCashToday();
  await closeCash(owner, expected, "", expected);
  for (const request of pending) {
    await fails(() => decideCorrection(owner, request.id, true), "sudah ditutup");
    expect((await db.corrections.get(request.id))?.status).toBe("pending");
    await decideCorrection(owner, request.id, false);
    expect((await db.corrections.get(request.id))?.status).toBe("rejected");
  }
  await fails(() => requestCorrection(owner, purchase.id, fields(purchase, 800000), "Harga salah"), "sudah ditutup");
  expect((await db.units.get(unit.id))?.hargaBeli).toBe(1000000);
  expect((await db.parts.get(id))?.stok).toBe(3);
  expect(await expectedCashToday()).toBe(expected);
  expect((await db.dayCloses.get(purchase.dayKey))?.expected).toBe(expected);
});
test("a day close still protects an old entry whose locked flag is missing", async () => {
  const { entry } = await purchasedUnit(); const expected = await expectedCashToday();
  await closeCash(owner, 0, "Saldo awal belum dicatat", expected);
  await db.cash.update(entry.id, { locked: 0 });
  await fails(() => requestCorrection(owner, entry.id, fields(entry, 800000), "Harga salah"), "sudah ditutup");
});
