import { db, uid } from "./db";
import { dayKey } from "@/lib/format";
import { methodOf } from "./money";
import type { CashCategory, CashEntry, User } from "./types";

export { sumCash, methodOf, METHOD_LABEL } from "./money";

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
