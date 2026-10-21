import { canSeeMoney } from "@/auth/roles";
import { logAudit } from "./audit";
import { db, uid } from "./db";
import { operation } from "./operations";
import type { Photo, User } from "./types";
export async function addPhoto(user: User, refType: Photo["refType"], refId: string, blob: Blob) {
  return operation(user, "photo", async (actor) => {
    if (refType === "unit-ktp" && !canSeeMoney(actor.role)) throw new Error("Foto KTP khusus Owner/Head Ops");
    if (!blob.type.startsWith("image/") || blob.size > 5 * 1024 * 1024) throw new Error("Foto harus gambar dengan ukuran maksimal 5 MB");
    const id = uid();
    await db.photos.add({ id, refType, refId, blob, createdAt: Date.now() });
    if (refType !== "draft") await logAudit(actor, "foto", refType, refId, "Foto bukti ditambahkan");
    return id;
  });
}
export async function deletePhoto(user: User, id: string) {
  return operation(user, "photo", async (actor) => {
    const photo = await db.photos.get(id); if (!photo) return;
    if (photo.refType !== "draft" && !canSeeMoney(actor.role)) throw new Error("Penghapusan foto bukti khusus Owner/Head Ops");
    await db.photos.delete(id);
    if (photo.refType !== "draft") await logAudit(actor, "hapus-foto", photo.refType, photo.refId, "Foto dihapus dari tampilan; perubahan tercatat");
  });
}
