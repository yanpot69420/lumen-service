import { liveQuery } from "dexie";
import { useSyncExternalStore } from "react";
import { db, markRemoteWrite, type OutboxEntry } from "./db";
import { isCloud, supabase } from "./supabase";
import { M } from "./sync-mappers";
import { repairRoundedPurchaseBatch } from "./sync-purchase-repair";

export type SyncState = "off" | "idle" | "syncing" | "error" | "offline";
interface Status { state: SyncState; pending: number; lastSync: number; error?: string; }
let status: Status = { state: "off", pending: 0, lastSync: 0 };
const listeners = new Set<() => void>();
function setStatus(patch: Partial<Status>) { status = { ...status, ...patch }; listeners.forEach((fn) => fn()); }
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export function useSyncStatus() { return useSyncExternalStore(subscribe, () => status); }
export const getSyncStatus = () => status;
const ORDER = ["users", "settings", "customers", "parts", "units", "tickets", "cash", "dayCloses", "corrections", "audit", "photos"];
function cloudError(message: string) {
  if (/Staf tidak aktif|Sesi telah berakhir|JWT expired/i.test(message) && typeof window !== "undefined") window.dispatchEvent(new Event("lumen:session-expired"));
  return new Error(message);
}

export function coalesceChanges(entries: OutboxEntry[]) {
  const rows = new Map<string, OutboxEntry>();
  for (const e of entries) {
    const key = `${e.table}:${e.key}`;
    const prior = rows.get(key);
    rows.set(key, prior ? { ...e, before: prior.before } : e);
  }
  return [...rows.values()];
}

export async function applyRemoteRows(name: string, remote: Record<string, unknown>[]) {
  const records: Record<string, unknown>[] = [];
  for (const row of remote) {
    if (name === "photos" && !row.deleted) {
      const local = await db.photos.get(String(row.id));
      if (local && local.remotePath === row.path && local.blob) { records.push({ ...row, blob: local.blob }); continue; }
      const { data, error } = await supabase!.storage.from("photos").download(String(row.path));
      if (error || !data) throw new Error(`Foto belum terunduh: ${error?.message}`);
      records.push({ ...row, blob: data });
    } else records.push(row);
  }
  await db.transaction("rw", [db.table(name), db.outbox], async () => {
    markRemoteWrite();
    const pending = new Set((await db.outbox.where("table").equals(name).toArray()).map((r) => r.key));
    for (const record of records) {
      const local = { ...M[name].toLocal(record), _version: record.revision ?? 1 };
      const key = String(local.id ?? local.key ?? local.dayKey);
      if (pending.has(key)) continue;
      if (name === "photos" && record.deleted) await db.photos.delete(key);
      else await db.table(name).put(name === "photos" ? { ...local, blob: record.blob } : local);
    }
  });
}

async function pullOne(name: string) {
  if (!supabase) return;
  let after: string | null = null;
  do {
    const result: { data: unknown; error: { message: string; } | null; } = await supabase.rpc("sync_page", { p_table: M[name].remote, p_after: after, p_limit: 200 });
    const data = result.data as { rows: Record<string, unknown>[]; next?: string | null; } | null;
    const error = result.error;
    if (error) throw cloudError(`Gagal mengambil ${name}: ${error.message}`);
    if (!data || !Array.isArray(data.rows)) throw new Error("Versi server belum cocok. Jalankan migrasi keamanan cloud.");
    await applyRemoteRows(name, data.rows);
    if (data.next && data.next === after) throw new Error("Cursor sinkronisasi tidak bergerak");
    after = data.next ?? null;
  } while (after);
}
export async function pullCore() { for (const name of ["users", "settings"]) await pullOne(name); }

/** Claim before copying work out of IndexedDB. This also serializes with Undo
 * in browsers without cross-tab Web Locks; a stale copy can never be sent. */
export async function claimSyncBatch(): Promise<{ batch: OutboxEntry[]; retryAt?: number; }> {
  return db.transaction("rw", [db.outbox, db.parts], async () => {
    const first = await db.outbox.orderBy("seq").first();
    if (!first) return { batch: [] };
    if (!first.batchId) throw new Error("Ada antrean dari versi lama. Unduh backup sebelum migrasi antrean; data lokal tetap disimpan.");
    const batch = await db.outbox.where("batchId").equals(first.batchId).sortBy("seq");
    const notBefore = Math.max(...batch.map((entry) => entry.notBefore ?? 0));
    if (notBefore > Date.now()) return { batch: [], retryAt: notBefore };
    await repairRoundedPurchaseBatch(batch);
    for (const entry of batch) await db.outbox.update(entry.seq!, { inFlight: true });
    return { batch };
  });
}

async function pushBatch() {
  if (!supabase) return false;
  const { batch, retryAt } = await claimSyncBatch();
  if (retryAt) scheduleSync(retryAt - Date.now());
  if (!batch.length) return false;
  const first = batch[0];
  const rows = coalesceChanges(batch);
  const changes = [];
  for (const e of rows) {
    if (!M[e.table] || e.before === undefined || e.payload === undefined) throw new Error("Antrean lama perlu diperiksa; data tidak dihapus.");
    if (e.table === "photos" && e.payload) {
      const photo = e.payload;
      const session = await supabase.auth.getSession();
      const path = `${session.data.session!.user.id}/${e.key}.jpg`;
      e.payload = { ...photo, remotePath: path };
      const { error } = await supabase.storage.from("photos").upload(path, photo.blob as Blob, { contentType: "image/jpeg", upsert: false });
      if (error && !["409", "Duplicate"].includes(String((error as { statusCode?: string; }).statusCode)) && !error.message.toLowerCase().includes("already exists")) throw new Error(`Unggah foto gagal: ${error.message}`);
    }
    changes.push({ table: M[e.table].remote, key: e.key, expected_version: e.before?._version ?? 0, row: e.payload ? M[e.table].toRemote(e.payload) : null });
  }
  const { data, error } = await supabase.rpc("apply_changes", { p_batch_id: first.batchId, p_changes: changes });
  if (error) throw cloudError(`Perubahan belum terkirim: ${error.message}`);
  await acknowledgeSyncBatch(batch, data);
  return true;
}

/** Only discard durable changes after every sent row has an exact receipt.
 * Empty/partial responses and duplicate acknowledgments must never lose work. */
export async function acknowledgeSyncBatch(batch: OutboxEntry[], data: unknown): Promise<void> {
  const expected = new Map(coalesceChanges(batch).map((entry) => [`${M[entry.table]?.remote}:${entry.key}`, entry]));
  const invalid = () => new Error("Konfirmasi server tidak lengkap atau tidak sesuai; antrean tetap disimpan untuk dicoba kembali");
  if (!batch.length || !Array.isArray(data) || data.length !== expected.size) throw invalid();
  const seen = new Set<string>();
  const receipts: { table: string; key: string; revision: number; }[] = [];
  for (const ack of data) {
    if (!ack || typeof ack !== "object" || typeof ack.table !== "string" || typeof ack.key !== "string") throw invalid();
    const identity = `${ack.table}:${ack.key}`;
    const entry = expected.get(identity);
    if (!entry || seen.has(identity) || !Number.isSafeInteger(ack.revision) || ack.revision !== Number(entry.before?._version ?? 0) + 1) throw invalid();
    seen.add(identity);
    receipts.push({ table: entry.table, key: ack.key, revision: ack.revision });
  }
  await db.transaction("rw", [db.outbox, ...ORDER.map((n) => db.table(n))], async () => {
    markRemoteWrite();
    const queued = await db.outbox.bulkGet(batch.map((entry) => entry.seq!));
    // Another tab can finish the same idempotent RPC first. Do not apply its
    // old receipt a second time and downgrade revisions of later edits.
    if (queued.every((entry) => !entry)) return;
    if (queued.some((entry, index) => !entry || entry.batchId !== batch[index].batchId || entry.table !== batch[index].table || entry.key !== batch[index].key)) throw invalid();
    await db.outbox.bulkDelete(batch.map((e) => e.seq!));
    for (const ack of receipts) {
      const table = ack.table;
      const remaining = await db.outbox.where("table").equals(table).filter((e) => e.key === ack.key).toArray();
      for (const entry of remaining) {
        await db.outbox.update(entry.seq!, { before: entry.before ? { ...entry.before, _version: ack.revision } : entry.before });
      }
      await db.table(table).update(ack.key, { _version: ack.revision });
    }
  });
}

/** Older releases stored photos only on the device. Queue them without
 * replacing any pending work or claiming that they are already backed up. */
export async function queueLegacyPhotos() {
  await db.transaction("rw", [db.photos, db.outbox], async () => {
    const pending = new Set((await db.outbox.where("table").equals("photos").toArray()).map((e) => e.key));
    for (const photo of await db.photos.toArray()) {
      if (photo.refType === "draft" || photo._version || pending.has(photo.id)) continue;
      await db.outbox.add({ table: "photos", key: photo.id, at: Date.now(), batchId: crypto.randomUUID(), before: null, payload: { ...photo } });
    }
  });
}

let syncing = false;
let started = false;
async function tick() {
  if (syncing || !supabase) return;
  syncing = true;
  try {
    setStatus({ pending: await db.outbox.count() });
    if (!navigator.onLine) { setStatus({ state: "offline" }); return; }
    const { data } = await supabase.auth.getSession();
    if (!data.session) { setStatus({ state: "off" }); return; }
    setStatus({ state: "syncing", error: undefined });
    await queueLegacyPhotos();
    // One RPC per native transaction: cash, stock, ticket and audit commit together.
    let guard = 0;
    while (guard++ < 100 && await pushBatch()) { /* bounded work, never discard */ }
    for (const name of ORDER) await pullOne(name);
    const pending = await db.outbox.count();
    setStatus({ state: pending ? "syncing" : "idle", pending, lastSync: Date.now() });
    if (pending) scheduleSync();
  } catch (e) {
    setStatus({ state: "error", pending: await db.outbox.count(), error: e instanceof Error ? e.message : "Sinkronisasi gagal" });
  } finally { syncing = false; }
}

export async function syncNow() {
  if (typeof navigator !== "undefined" && navigator.locks) {
    await navigator.locks.request("lumen-cloud-sync", { ifAvailable: true }, async (lock) => { if (lock) await tick(); });
  } else await tick();
}
let timer: ReturnType<typeof setTimeout> | null = null;
let timerAt = 0;
let interval: ReturnType<typeof setInterval> | null = null;
let observer: { unsubscribe(): void; } | null = null;
export function scheduleSync(delayOrEvent: number | Event = 2000) {
  if (!started) return;
  const delay = typeof delayOrEvent === "number" ? delayOrEvent : 2000;
  const deadline = Date.now() + delay;
  if (timer && timerAt <= deadline) return;
  if (timer) clearTimeout(timer);
  timerAt = deadline;
  timer = setTimeout(() => { timer = null; timerAt = 0; void syncNow(); }, Math.max(1, delay));
}
export function startSync() {
  if (started || !isCloud) return;
  started = true;
  observer = liveQuery(() => db.outbox.count()).subscribe(() => scheduleSync());
  interval = setInterval(scheduleSync, 30_000);
  window.addEventListener("focus", scheduleSync); window.addEventListener("online", scheduleSync);
  scheduleSync();
}
export function stopSync() {
  started = false;
  if (timer) clearTimeout(timer); if (interval) clearInterval(interval);
  timer = null; interval = null; observer?.unsubscribe(); observer = null;
  window.removeEventListener("focus", scheduleSync); window.removeEventListener("online", scheduleSync);
  setStatus({ state: "off" });
}
