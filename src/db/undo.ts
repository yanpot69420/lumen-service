import { can } from "@/auth/roles";
import Dexie from "dexie";
import { logAudit } from "./audit";
import { captureUndo, currentUndoCapture, db, markRemoteWrite, uid, type UndoCapture, type UndoReceipt } from "./db";
import { businessTables } from "./operations";
import type { User } from "./types";

export const UNDO_WINDOW_MS = 8000;
export interface UndoToken { id: string; label: string; expiresAt: number; }

/** Versions may advance when an earlier offline transaction is acknowledged.
 * Compare the actual content, including image bytes, rather than that metadata. */
async function sameContent(a: unknown, b: unknown): Promise<boolean> {
  if (Object.is(a, b)) return true;
  if (a instanceof Blob && b instanceof Blob) {
    if (a.type !== b.type || a.size !== b.size) return false;
    const [left, right] = await Promise.all([a.arrayBuffer(), b.arrayBuffer()]);
    const bytes = new Uint8Array(left), other = new Uint8Array(right);
    return bytes.every((byte, i) => byte === other[i]);
  }
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  const keys = Object.keys(left).filter((key) => key !== "_version" && left[key] !== undefined).sort();
  const other = Object.keys(right).filter((key) => key !== "_version" && right[key] !== undefined).sort();
  if (keys.length !== other.length || keys.some((key, i) => key !== other[i])) return false;
  for (const key of keys) if (!await sameContent(left[key], right[key])) return false;
  return true;
}

/** The original action still uses its normal permission and business checks.
 * Its rows and outbox journal commit in one transaction with the Undo receipt. */
export async function withServiceUndo<T>(user: User, label: string, action: () => Promise<T>): Promise<{ value: T; undo: UndoToken | null; }> {
  if (currentUndoCapture()) throw new Error("Tindakan nota sedang diproses");
  const result = await db.transaction("rw", [...businessTables(), db.undoReceipts], async () => {
    const actor = await db.users.get(user.id);
    if (!actor?.active || !can(actor.role, "service")) throw new Error("Anda tidak memiliki akses untuk tindakan ini");
    await db.undoReceipts.where("expiresAt").belowOrEqual(Date.now()).delete();
    const capture: UndoCapture = { changes: new Map(), permissions: new Set(["service"]), batchIds: new Set() };
    captureUndo(capture);
    const value = await action();
    const changes = [];
    for (const change of capture.changes.values()) {
      if (!await Dexie.waitFor(sameContent(change.before, change.after))) changes.push(change);
    }
    const expiresAt = changes.length ? Date.now() + UNDO_WINDOW_MS : Date.now();
    const entries = (await Promise.all([...capture.batchIds].map((batchId) => db.outbox.where("batchId").equals(batchId).toArray()))).flat();
    for (const entry of entries) await db.outbox.update(entry.seq!, { notBefore: expiresAt });
    if (!changes.length) return { value, undo: null };
    const receipt: UndoReceipt = { id: uid(), actorId: actor.id, actorRole: actor.role, label, expiresAt, changes, permissions: [...capture.permissions], seqs: entries.map((entry) => entry.seq!) };
    if (changes.some((change) => (change.table === "settings" && change.key === "draftServisBaru") || (change.table === "photos" && [change.before?.refType, change.after?.refType].includes("draft")))) {
      receipt.draftPhotoIds = (await db.photos.where({ refType: "draft", refId: "servis-baru" }).primaryKeys()).sort();
    }
    await db.undoReceipts.add(receipt);
    return { value, undo: { id: receipt.id, label, expiresAt } };
  });
  if (result.undo && typeof window !== "undefined") {
    window.setTimeout(() => {
      if (db.isOpen()) void db.undoReceipts.where("expiresAt").belowOrEqual(Date.now()).delete().catch(() => {});
    }, Math.max(1, result.undo.expiresAt - Date.now() + 10));
  }
  return result;
}

async function undoInsideTransaction(user: User, id: string, beforeUndo?: () => void | Promise<void>) {
  await db.transaction("rw", [...businessTables(), db.undoReceipts], async () => {
    const receipt = await db.undoReceipts.get(id);
    if (!receipt || Date.now() >= receipt.expiresAt) throw new Error("Waktu Undo sudah habis. Perubahan tetap tersimpan.");
    const actor = await db.users.get(user.id);
    if (receipt.actorId !== user.id || !actor?.active || receipt.actorRole !== actor.role || receipt.permissions.some((permission) => !can(actor.role, permission))) throw new Error("Anda tidak memiliki akses untuk membatalkan tindakan ini");
    if (receipt.draftPhotoIds) {
      const ids = (await db.photos.where({ refType: "draft", refId: "servis-baru" }).primaryKeys()).sort();
      if (ids.length !== receipt.draftPhotoIds.length || ids.some((key, i) => key !== receipt.draftPhotoIds![i])) throw new Error("Foto draft sudah berubah. Batalkan perubahan terbaru terlebih dahulu.");
    }
    const current = new Map<string, Record<string, unknown> | undefined>();
    for (const change of receipt.changes) {
      const row = await db.table(change.table).get(change.key) as Record<string, unknown> | undefined;
      current.set(`${change.table}:${change.key}`, row);
      if (!await Dexie.waitFor(sameContent(row ?? null, change.after))) throw new Error("Data sudah berubah lagi. Undo tidak dapat diterapkan; perubahan terbaru tetap aman.");
      if (change.table === "cash") {
        const cash = row ?? change.before;
        if (!can(actor.role, "sell") || cash?.locked || (cash?.dayKey && await db.dayCloses.get(String(cash.dayKey)))) throw new Error("Kas sudah dikunci atau akses pembayaran berubah. Undo tidak dapat diterapkan.");
      }
    }
    // A newly created profile/ticket may already be used by a later action.
    // Never leave a service, cash entry, photo or warranty without its parent.
    const removed = (table: string, key: string) => receipt.changes.some((change) => change.table === table && change.key === key && change.before === null);
    for (const change of receipt.changes.filter((change) => !change.before && change.after)) {
      if (change.table === "customers") {
        const dependents = await db.tickets.where("customerId").equals(change.key).toArray();
        if (dependents.some((ticket) => !removed("tickets", ticket.id))) throw new Error("Pelanggan sudah dipakai nota lain. Undo tidak dapat diterapkan.");
      }
      if (change.table === "tickets") {
        const [photos, cash, claims] = await Promise.all([
          db.photos.where({ refType: "ticket", refId: change.key }).toArray(),
          db.cash.where("refId").equals(change.key).toArray(),
          db.tickets.filter((ticket) => ticket.garansiDari === change.key).toArray(),
        ]);
        if (photos.some((photo) => !receipt.changes.some((row) => row.table === "photos" && row.key === photo.id)) || cash.some((entry) => !removed("cash", entry.id)) || claims.some((ticket) => !removed("tickets", ticket.id))) throw new Error("Nota sudah dipakai tindakan lain. Undo tidak dapat diterapkan.");
      }
    }
    const queued = await db.outbox.bulkGet(receipt.seqs);
    if (queued.some((entry) => !entry || entry.inFlight)) throw new Error("Perubahan sudah dikirim ke server. Undo tidak dapat diterapkan.");
    // The view may have changed while waiting for a sync lock or photo checks.
    await beforeUndo?.();
    // Undo cancels an unsent journal, rather than sending reverse financial or
    // workflow transitions to the server. Original audit records are retained.
    markRemoteWrite();
    for (const change of [...receipt.changes].reverse()) {
      if (!change.before) await db.table(change.table).delete(change.key);
      else {
        const version = current.get(`${change.table}:${change.key}`)?._version
          ?? queued.find((entry) => entry?.table === change.table && entry.key === change.key)?.before?._version;
        await db.table(change.table).put({ ...change.before, ...(version !== undefined ? { _version: version } : {}) });
      }
    }
    for (const entry of queued) {
      if (entry!.table === "audit") await db.outbox.update(entry!.seq!, { notBefore: Date.now() });
      else await db.outbox.delete(entry!.seq!);
    }
    await db.undoReceipts.delete(id);
    markRemoteWrite(false);
    const ticket = receipt.changes.find((change) => change.table === "tickets");
    await logAudit(actor, "undo", "servis", ticket?.key ?? id, `Dibatalkan: ${receipt.label}`);
  });
}

export async function undoServiceChange(user: User, id: string, beforeUndo?: () => void | Promise<void>): Promise<void> {
  // Sync uses this same cross-tab lock. A queued batch cannot start uploading
  // between the receipt check and the local rollback.
  if (typeof navigator !== "undefined" && navigator.locks) {
    await navigator.locks.request("lumen-cloud-sync", () => undoInsideTransaction(user, id, beforeUndo));
  } else await undoInsideTransaction(user, id, beforeUndo);
}
