import { db, type OutboxEntry } from "./db";
import type { CashEntry, Correction } from "./types";

/** Recover only the old rounded-cost bug: an unchanged part was omitted from
 * an otherwise atomic correction. Never infer changes to stock or money, and
 * leave ambiguous queues intact. The server still validates every version. */
export async function repairRoundedPurchaseBatch(batch: OutboxEntry[]): Promise<void> {
  const proposals = batch.filter((row) => row.table === "corrections" && row.before === null && (row.payload as unknown as Correction | null)?.after?.purchase);
  for (const proposal of proposals) {
    const correction = proposal.payload as unknown as Correction;
    const before = correction.before?.purchase;
    const after = correction.after.purchase!;
    if (!before || correction.status !== "approved" || correction.entity !== "cash" || !proposal.batchId ||
      before.partId !== after.partId || before.qty !== after.qty || before.stock !== after.stock || before.unitCost !== after.unitCost ||
      before.totalCost === after.totalCost || batch.some((row) => row.table === "parts" && row.key === after.partId) ||
      proposals.filter((row) => (row.payload as unknown as Correction).after.purchase?.partId === after.partId).length !== 1) continue;
    const sourceChanges = batch.filter((row) => row.table === "cash" && row.key === correction.entityId);
    if (sourceChanges.length !== 1) continue;
    const source = sourceChanges[0].before as unknown as CashEntry | null;
    const target = sourceChanges[0].payload as unknown as CashEntry | null;
    const snapshot = target?.meta?.purchase;
    if (!source || !target || source.refType !== "part" || source.refId !== after.partId || source.category !== "restok_part" || source.type !== "out" ||
      source.voided || source.locked || !snapshot || target.refId !== source.refId || target.refType !== source.refType ||
      snapshot.qty !== after.qty || snapshot.stockAfter !== after.stock || snapshot.costAfter !== after.unitCost || snapshot.totalCost !== after.totalCost ||
      source.amount !== correction.before.amount || target.amount !== correction.after.amount || target.note !== source.note) continue;
    const part = await db.parts.get(after.partId);
    if (!part || !Number.isSafeInteger(part._version) || !part._version || part.stok !== before.stock || part.hargaModal !== before.unitCost ||
      snapshot.partVersion !== part._version + 1 || (source.meta?.purchase && source.meta.purchase.partVersion !== part._version)) continue;
    // A later local stock/catalog edit could hide the original row. Require a
    // clean item rather than guessing or merging another transaction into it.
    if (await db.outbox.where("table").equals("parts").and((row) => row.key === part.id).count()) continue;
    const stock: OutboxEntry = { table: "parts", key: part.id, at: proposal.at, batchId: proposal.batchId, before: { ...part }, payload: { ...part } };
    stock.seq = await db.outbox.add(stock);
    batch.push(stock);
  }
}
