import { blobToDataUrl, dataUrlToBlob } from "@/lib/backup";
import { BACKUP_TABLES, validateBackup, type BackupPayload } from "@/lib/backup-schema";
import { usernameSlug } from "@/lib/username";
import { db, markRemoteWrite, uid } from "./db";
import { isCloud } from "./supabase";
import type { Photo, User } from "./types";

async function snapshot() {
  const state: Record<string, unknown[]> = {};
  for (const name of BACKUP_TABLES) state[name] = await db.table(name).toArray();
  return state;
}
async function encode(state: Record<string, unknown[]>, includePhotos: boolean): Promise<BackupPayload> {
  const photos = includePhotos ? await Promise.all((state.photos as Photo[]).map(async ({ blob, ...p }) => ({ ...p, dataUrl: await blobToDataUrl(blob) }))) : [];
  return { app: "lumen-service", version: 4, exportedAt: new Date().toISOString(), source: isCloud ? "cloud" : "local", ...state, customers: state.customers ?? [], settings: (state.settings as { key: string; }[]).filter((s) => s.key !== "deviceId"), photos } as BackupPayload;
}
export async function exportBackup(includePhotos = true) {
  const state = await db.transaction("r", BACKUP_TABLES.map((n) => db.table(n)), snapshot);
  return encode(state, includePhotos);
}
export async function exportSafetyBackup() {
  const last = await db.snapshots.orderBy("at").last();
  if (!last) throw new Error("Belum ada salinan pengaman");
  return encode(last.state, true);
}
export async function restoreBackup(input: unknown) {
  const data = validateBackup(input);
  if (isCloud || data.source === "cloud") throw new Error("Backup cloud tidak dapat menimpa data perangkat. Pulihkan database cloud melalui prosedur administrator.");
  if (await db.outbox.count()) throw new Error("Masih ada perubahan cloud tertunda. Simpan backup dan selesaikan sinkronisasi dahulu.");
  const usernames = new Set<string>();
  const users: User[] = data.users.map((u) => {
    if (!u.pinHash || !u.salt) throw new Error("Backup lokal tidak memiliki kredensial login lengkap");
    const base = u.username || usernameSlug(u.name) || "user";
    let username = base; let i = 1;
    while (usernames.has(username)) username = `${base}${++i}`;
    usernames.add(username);
    return { ...u, username };
  });
  const photos = await Promise.all(data.photos.map(async ({ dataUrl, ...p }) => ({ ...p, blob: await dataUrlToBlob(dataUrl) })));
  await db.transaction("rw", [...BACKUP_TABLES.map((n) => db.table(n)), db.snapshots, db.undoReceipts], async () => {
    markRemoteWrite();
    await db.snapshots.add({ id: uid(), at: Date.now(), state: await snapshot() });
    await db.undoReceipts.clear();
    for (const name of BACKUP_TABLES) await db.table(name).clear();
    for (const name of BACKUP_TABLES) {
      const rows = name === "users" ? users : name === "photos" ? photos : data[name];
      await db.table(name).bulkAdd(rows);
    }
    await db.settings.put({ key: "deviceId", value: uid().replaceAll("-", "").slice(0, 12).toUpperCase() });
  });
  return { photos: photos.length };
}
