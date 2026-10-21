import { addCash, methodOf } from "./cash";
import { logAudit } from "./audit";
import { db, uid } from "./db";
import { amount, operation } from "./operations";
import type { CashEntry, CashMethod, Part, PurchaseCorrectionDetail, PurchaseSnapshot, User } from "./types";

export interface PurchaseContext {
  entry: CashEntry;
  part: Part;
  snapshot: PurchaseSnapshot;
  refunded: number;
  legacy: boolean;
}

export interface PurchaseCorrectionInput {
  qty: number;
  totalCost: number;
  kind: "record" | "refund";
  method: CashMethod;
  reason: string;
}

export async function purchaseContext(id: string): Promise<PurchaseContext> {
  const entry = await db.cash.get(id);
  if (!entry || entry.category !== "restok_part" || entry.type !== "out" || entry.refType !== "part" || !entry.refId || entry.voided) throw new Error("Transaksi pembelian sparepart tidak ditemukan atau sudah dibatalkan");
  const part = await db.parts.get(entry.refId);
  if (!part) throw new Error("Barang pembelian tidak ditemukan");
  if (entry.locked || await db.dayCloses.get(entry.dayKey)) throw new Error("Kas pembelian sudah ditutup. Pembelian ini memerlukan rekonsiliasi terpisah.");
  if (await db.outbox.filter((row) => (row.table === "parts" && row.key === part.id) || (row.table === "cash" && row.key === id)).count()) throw new Error("Tunggu sinkronisasi pembelian dan stok selesai sebelum melakukan koreksi");
  const related = await db.cash.where("refId").equals(part.id).toArray();
  const refunded = related.filter((row) => !row.voided && row.type === "in" && row.meta?.purchaseRefundFor === id).reduce((sum, row) => sum + row.amount, 0);
  const snapshot = entry.meta?.purchase;
  if (snapshot) {
    if (part._version === undefined && (related.some((row) => row.category === "jual_aksesoris") || await db.tickets.filter((ticket) => ticket.partsUsed.some((used) => used.partId === part.id)).count())) throw new Error("Pemakaian atau penjualan barang ini memerlukan rekonsiliasi agar modal historis tetap benar");
    if (part.stok !== snapshot.stockAfter || part.hargaModal !== snapshot.costAfter || (part._version !== undefined && part._version !== snapshot.partVersion)) throw new Error("Stok atau rincian barang sudah berubah setelah pembelian. Lakukan rekonsiliasi agar modal historis tidak berubah.");
    if (snapshot.totalCost !== entry.amount - refunded) throw new Error("Nominal pembelian pernah dikoreksi terpisah dari stok. Lakukan rekonsiliasi terlebih dahulu.");
  } else {
    // Older purchases have no reliable quantity snapshot. Only an unused item
    // with one purchase can be reconciled as a whole, after checking its receipt.
    if (related.filter((row) => row.type === "out" && row.category === "restok_part").length !== 1 || related.some((row) => row.category === "jual_aksesoris") || await db.tickets.filter((ticket) => ticket.partsUsed.some((used) => used.partId === part.id)).count()) throw new Error("Pembelian lama dengan pemakaian atau beberapa pembelian memerlukan rekonsiliasi terpisah");
    if (part.stok <= 0 || refunded > entry.amount) throw new Error("Stok atau pembayaran pembelian lama tidak cukup untuk dikoreksi");
  }
  return { entry, part, refunded, legacy: !snapshot, snapshot: snapshot ?? { qty: part.stok, stockBefore: 0, costBefore: 0, stockAfter: part.stok, costAfter: part.hargaModal, totalCost: entry.amount - refunded, partVersion: part._version ?? 0 } };
}

export function previewPurchaseCorrection(context: PurchaseContext, input: PurchaseCorrectionInput) {
  amount(input.qty, "Jumlah pembelian", true);
  amount(input.totalCost, "Total pembelian");
  if (!["record", "refund"].includes(input.kind) || !["tunai", "qris", "transfer"].includes(input.method)) throw new Error("Jenis koreksi atau metode pembayaran tidak valid");
  if (input.kind === "refund" && (input.qty !== context.snapshot.qty || input.totalCost >= context.snapshot.totalCost)) throw new Error("Pengembalian uang harus mengurangi total biaya tanpa mengubah jumlah barang");
  const stock = context.snapshot.stockBefore + input.qty;
  const value = context.snapshot.stockBefore * context.snapshot.costBefore + input.totalCost;
  amount(stock, "Stok akhir", true); amount(value, "Nilai stok");
  return { stock, unitCost: Math.round(value / stock), cashAmount: input.kind === "record" ? input.totalCost + context.refunded : context.entry.amount, refund: input.kind === "refund" ? context.snapshot.totalCost - input.totalCost : 0 };
}

export async function correctPurchase(user: User, displayed: PurchaseContext, input: PurchaseCorrectionInput) {
  return operation(user, "stock", async (actor) => {
    if (!input.reason.trim()) throw new Error("Alasan koreksi wajib diisi");
    const context = await purchaseContext(displayed.entry.id);
    if (JSON.stringify(context) !== JSON.stringify(displayed)) throw new Error("Pembelian atau stok sudah berubah. Buka kembali koreksi dan periksa nilai terbaru.");
    const preview = previewPurchaseCorrection(context, input);
    if (input.qty === context.snapshot.qty && input.totalCost === context.snapshot.totalCost && preview.unitCost === context.part.hargaModal) throw new Error("Tidak ada perubahan pembelian");
    const detail = (qty: number, stock: number, unitCost: number, totalCost: number): PurchaseCorrectionDetail => ({ partId: context.part.id, qty, stock, unitCost, totalCost, kind: input.kind });
    const before = { amount: context.entry.amount, note: context.entry.note, voided: 0 as const, purchase: detail(context.snapshot.qty, context.part.stok, context.part.hargaModal, context.snapshot.totalCost) };
    const after = { amount: preview.cashAmount, note: context.entry.note, voided: 0 as const, purchase: detail(input.qty, preview.stock, preview.unitCost, input.totalCost) };
    // Pending cash-only proposals are superseded explicitly; no approval wait
    // remains, and their original request is retained in the correction journal.
    const pending = await db.corrections.where("status").equals("pending").and((row) => row.entityId === context.entry.id).toArray();
    for (const row of pending) await db.corrections.update(row.id, { status: "rejected", decidedBy: actor.id, decidedByName: actor.name, decidedAt: Date.now() });
    await db.parts.update(context.part.id, { stok: preview.stock, hargaModal: preview.unitCost });
    await db.cash.update(context.entry.id, { amount: preview.cashAmount, meta: { ...context.entry.meta, purchase: { ...context.snapshot, qty: input.qty, stockAfter: preview.stock, costAfter: preview.unitCost, totalCost: input.totalCost, partVersion: (context.part._version ?? 0) + 1 } } });
    if (preview.refund) await addCash(actor, { type: "in", category: "restok_part", amount: preview.refund, method: input.method ?? methodOf(context.entry), note: `Pengembalian supplier — ${context.part.nama}`, refType: "part", refId: context.part.id, meta: { purchaseRefundFor: context.entry.id } });
    await db.corrections.add({ id: uid(), at: Date.now(), entity: "cash", entityId: context.entry.id, reason: input.reason.trim(), before, after, requestedBy: actor.id, requestedByName: actor.name, status: "approved", decidedBy: actor.id, decidedByName: actor.name, decidedAt: Date.now() });
    await logAudit(actor, "koreksi-pembelian", "part", context.part.id, `${input.kind === "refund" ? "Pengembalian supplier" : "Koreksi pembelian"}: ${context.snapshot.qty} → ${input.qty} pcs, total ${context.snapshot.totalCost} → ${input.totalCost}, stok ${context.part.stok} → ${preview.stock}, modal ${context.part.hargaModal} → ${preview.unitCost}. ${input.reason.trim()}`);
  });
}
