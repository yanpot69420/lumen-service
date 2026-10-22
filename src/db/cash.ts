import { dayKey } from "@/lib/format";
import { logAudit } from "./audit";
import { db, uid } from "./db";
import { methodOf, ticketTotal } from "./money";
import { amount, operation } from "./operations";
import type { CashCategory, CashEntry, User } from "./types";

export { METHOD_LABEL, methodOf, sumCash } from "./money";

export const CASH_CATEGORY_LABEL: Record<CashCategory, string> = {
  servis: "Servis",
  jual_unit: "Jual HP",
  retur_unit: "Retur HP",
  jual_aksesoris: "Aksesoris/Part",
  beli_unit: "Beli HP",
  restok_part: "Restok Part",
  operasional: "Operasional",
  prive: "Prive",
  modal_masuk: "Modal Masuk",
  lainnya: "Lainnya",
};

export async function addCash(
  user: Pick<User, "id" | "name">,
  entry: Omit<
    CashEntry,
    "id" | "at" | "dayKey" | "by" | "byName" | "locked" | "voided"
  >,
): Promise<string> {
  const returnMarker = entry.type === "out" && entry.category === "retur_unit" && entry.refType === "unit" && !!entry.refId;
  amount(entry.amount, "Nominal", !returnMarker);
  if (await db.dayCloses.get(dayKey())) throw new Error("Kas hari ini sudah ditutup");
  const id = uid();
  await db.cash.add({
    method: "tunai",
    ...entry,
    id,
    at: Date.now(),
    dayKey: dayKey(),
    by: user.id,
    byName: user.name,
    locked: 0,
    voided: 0,
  });
  return id;
}

export async function recordManualCash(user: User, entry: Parameters<typeof addCash>[1]) {
  return operation(user, "cash", async (actor) => {
    const allowed = entry.type === "in" ? ["modal_masuk", "lainnya"] : ["operasional", "prive", "lainnya"];
    if (!allowed.includes(entry.category) || !entry.note.trim()) throw new Error("Kategori/alasan kas manual tidak valid. Restok dicatat dari halaman Stok.");
    const id = await addCash(actor, entry);
    await logAudit(actor, "kas", "kas", id, `${entry.type}: ${entry.amount}. ${entry.note}`);
  });
}
export async function closeCash(user: User, counted: number, note: string, displayedExpected: number) {
  return operation(user, "close", async (actor) => {
    amount(counted); const key = dayKey();
    if (await db.dayCloses.get(key)) throw new Error("Kas sudah ditutup");
    const expected = await expectedCashToday();
    if (expected !== displayedExpected) throw new Error("Saldo kas sudah berubah. Periksa jumlah terbaru sebelum menutup kas.");
    if (counted !== expected && !note.trim()) throw new Error("Penjelasan selisih wajib diisi");
    await db.cash.where("dayKey").equals(key).modify({ locked: 1 });
    await db.dayCloses.add({ dayKey: key, expected, counted, selisih: counted - expected, note, closedBy: actor.id, closedByName: actor.name, closedAt: Date.now() });
    await logAudit(actor, "tutup-kas", "kas", key, `Sistem ${expected}, fisik ${counted}, selisih ${counted - expected}`);
  });
}
async function validateUnitCorrection(entry: CashEntry, after: { amount: number; voided: 0 | 1 }) {
  if (entry.locked || await db.dayCloses.get(entry.dayKey)) throw new Error("Kas tanggal transaksi sudah ditutup. Koreksi tidak dapat diterapkan; lakukan rekonsiliasi pada periode yang masih terbuka.");
  if (entry.category === "restok_part" && (entry.meta?.purchase || entry.meta?.purchaseRefundFor)) throw new Error("Gunakan Koreksi Pembelian agar stok, modal, dan kas diperbarui bersama");
  if (entry.category === "jual_unit" && after.voided) throw new Error("Pembatalan penjualan unit harus melalui Retur Unit");
  if (entry.category === "retur_unit" && after.voided) throw new Error("Jurnal retur unit tidak dapat dibatalkan karena unit sudah kembali ke stok. Koreksi nominal refund bila diperlukan.");
  if (entry.category === "beli_unit") {
    if (after.voided || entry.voided) throw new Error("Pembelian unit tidak dapat dibatalkan melalui kas. Rekonsiliasi unit dan pembayaran diperlukan.");
    if (after.amount !== entry.amount) {
      const unit = entry.refType === "unit" && entry.refId ? await db.units.get(entry.refId) : undefined;
      const history = entry.refId ? await db.cash.where("refId").equals(entry.refId).and((row) => row.category === "jual_unit" || row.category === "retur_unit").count() : 0;
      const purchases = entry.refId ? await db.cash.where("refId").equals(entry.refId).and((row) => row.category === "beli_unit").count() : 0;
      if (!unit || unit.status !== "stok" || unit.soldAt !== undefined || history || purchases !== 1 || after.amount <= 0) throw new Error("Modal unit yang sudah pernah terjual/retur atau sumber pembeliannya tidak lengkap memerlukan rekonsiliasi.");
    }
  }
  if (entry.category === "jual_aksesoris" && after.voided !== entry.voided) {
    if (entry.voided) throw new Error("Penjualan yang sudah dibatalkan tidak dapat diaktifkan kembali. Buat penjualan baru agar stok diperiksa ulang.");
    const part = entry.refType === "part" && entry.refId ? await db.parts.get(entry.refId) : undefined;
    if (!part || !Number.isSafeInteger(entry.meta?.qty) || (entry.meta?.qty ?? 0) <= 0 || !Number.isSafeInteger(entry.meta?.modal) || (entry.meta?.modal ?? -1) < 0) throw new Error("Pembatalan memerlukan stok, jumlah, dan modal barang yang valid. Rekonsiliasi transaksi lama diperlukan.");
  }
}
async function applyCorrection(entry: CashEntry, after: { amount: number; note: string; voided: 0 | 1; }) {
  await validateUnitCorrection(entry, after);
  if (entry.category === "beli_unit" && after.amount !== entry.amount) await db.units.update(entry.refId!, { hargaBeli: after.amount });
  if (entry.category === "jual_aksesoris" && !entry.voided && after.voided) {
    const part = (await db.parts.get(entry.refId!))!;
    const stok = part.stok + entry.meta!.qty!;
    const inventoryCost = part.stok * part.hargaModal + entry.meta!.modal!;
    amount(stok, "Stok"); amount(inventoryCost, "Nilai modal stok");
    await db.parts.update(part.id, { stok, hargaModal: Math.round(inventoryCost / stok) });
  }
  const wasDp = entry.category === "servis" && entry.type === "in" && (entry.meta?.paymentKind ? entry.meta.paymentKind === "dp" : entry.note.startsWith("DP servis "));
  await db.cash.update(entry.id, { ...after, ...(wasDp ? { meta: { ...entry.meta, paymentKind: "dp" } } : {}) });
  if (entry.refType === "ticket" && entry.refId) {
    const ticket = await db.tickets.get(entry.refId);
    if (ticket) {
      const entries = await db.cash.where("refId").equals(ticket.id).and((c) => c.category === "servis" && !c.voided).toArray();
      const net = entries.reduce((s, c) => s + (c.type === "in" ? c.amount : -c.amount), 0);
      const dp = entries.filter((c) => c.type === "in" && (c.meta?.paymentKind ? c.meta.paymentKind === "dp" : c.note.startsWith("DP servis "))).reduce((s, c) => s + c.amount, 0);
      await db.tickets.update(ticket.id, { dp, ...(ticket.status === "diambil" ? { piutang: Math.max(0, ticketTotal(ticket) - net) } : {}), updatedAt: Date.now() });
    }
  }
  if (entry.category === "jual_unit" && entry.refId) {
    const unit = await db.units.get(entry.refId);
    const latest = await db.cash.where("refId").equals(entry.refId).and((c) => c.category === "jual_unit").sortBy("at");
    if (unit?.status === "terjual" && latest.at(-1)?.id === entry.id) await db.units.update(unit.id, { soldPrice: after.amount });
  }
}
export async function requestCorrection(user: User, id: string, after: { amount: number; note: string; voided: 0 | 1; }, reason: string, displayed?: Pick<CashEntry, "amount" | "note" | "voided">) {
  return operation(user, "correction", async (actor) => {
    amount(after.amount); if (!reason.trim()) throw new Error("Alasan wajib diisi");
    const entry = await db.cash.get(id); if (!entry) throw new Error("Transaksi tidak ditemukan");
    if (displayed && (entry.amount !== displayed.amount || entry.note !== displayed.note || entry.voided !== displayed.voided)) throw new Error("Transaksi sudah berubah. Buka kembali koreksi dan periksa nilai terbaru.");
    if (actor.role === "kasir" && entry.by !== actor.id) throw new Error("Koreksi hanya untuk transaksi Anda sendiri");
    await validateUnitCorrection(entry, after);
    if (await db.corrections.where("status").equals("pending").and((c) => c.entityId === id).count()) throw new Error("Sudah ada koreksi yang menunggu");
    const approved = actor.role === "owner";
    await db.corrections.add({ id: uid(), at: Date.now(), entity: "cash", entityId: id, reason: reason.trim(), before: { amount: entry.amount, note: entry.note, voided: entry.voided }, after, requestedBy: actor.id, requestedByName: actor.name, status: approved ? "approved" : "pending", ...(approved ? { decidedBy: actor.id, decidedByName: actor.name, decidedAt: Date.now() } : {}) });
    if (approved) await applyCorrection(entry, after);
    await logAudit(actor, "koreksi", "kas", id, `${approved ? "Terapkan" : "Ajukan"}: ${reason}`);
  });
}
export async function decideCorrection(user: User, id: string, approved: boolean) {
  return operation(user, "approve", async (actor) => {
    const correction = await db.corrections.get(id);
    if (!correction || correction.status !== "pending") throw new Error("Koreksi sudah diputuskan");
    const entry = await db.cash.get(correction.entityId);
    if (!entry || entry.amount !== correction.before.amount || entry.note !== correction.before.note || entry.voided !== correction.before.voided) throw new Error("Transaksi sumber sudah berubah");
    if (approved) await applyCorrection(entry, correction.after);
    await db.corrections.update(id, { status: approved ? "approved" : "rejected", decidedBy: actor.id, decidedByName: actor.name, decidedAt: Date.now() });
    await logAudit(actor, "koreksi", "kas", entry.id, `${approved ? "Setujui" : "Tolak"}: ${correction.reason}`);
  });
}

/**
 * Uang TUNAI yang seharusnya ada di laci = hitungan fisik tutup kas terakhir
 * + net entri tunai setelahnya. QRIS/transfer tidak pernah menyentuh laci.
 */
export async function expectedCashToday(): Promise<number> {
  const lastClose = await db.dayCloses.orderBy("closedAt").last();
  const since = lastClose
    ? await db.cash.where("at").above(lastClose.closedAt).toArray()
    : await db.cash.toArray();
  let net = 0;
  for (const e of since) {
    if (e.voided || methodOf(e) !== "tunai") continue;
    net += e.type === "in" ? e.amount : -e.amount;
  }
  return (lastClose?.counted ?? 0) + net;
}
