import { db, uid } from "@/db/db";
import type { CashMethod, Unit } from "@/db/types";

export type UnitPurchaseFields = Pick<Unit, "brand" | "model" | "varian" | "imei" | "kondisi" | "hargaBeli" | "hargaJual" | "sellerName" | "sellerPhone" | "garansiHari">;
export interface UnitPurchaseDraft { f: UnitPurchaseFields; method: CashMethod; photos: Blob[]; ktp: Blob[]; }

// A quick leave/reopen must wait for the previous form's final draft write.
let writes = Promise.resolve();
export function writeUnitPurchaseDraft(draft: UnitPurchaseDraft) {
  const write = writes.catch(() => {}).then(() => db.transaction("rw", [db.settings, db.photos], async () => {
    const { f, method, photos, ktp } = draft;
    const hasDraft = f.brand || f.model || f.varian || f.imei || f.kondisi || f.sellerName || f.sellerPhone || f.hargaBeli || f.hargaJual || photos.length || ktp.length;
    await db.settings.put({ key: "draftBeliBaru", value: hasDraft ? JSON.stringify({ f, method }) : "" });
    const keys = await db.photos.where("refId").anyOf(["beli-baru", "beli-baru-ktp"]).and((p) => p.refType === "draft").primaryKeys();
    await db.photos.bulkDelete(keys);
    for (const [refId, blobs] of [["beli-baru", photos], ["beli-baru-ktp", ktp]] as const) {
      for (const blob of blobs) await db.photos.add({ id: uid(), refType: "draft", refId, blob, createdAt: Date.now() });
    }
  }));
  writes = write;
  return write;
}
export async function readUnitPurchaseDraft() {
  await writes.catch(() => {});
  return db.transaction("r", [db.settings, db.photos], async () => ({
    raw: await db.settings.get("draftBeliBaru"),
    images: await db.photos.where("refId").anyOf(["beli-baru", "beli-baru-ktp"]).and((p) => p.refType === "draft").toArray(),
  }));
}
