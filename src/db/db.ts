import { usernameSlug } from "@/lib/username";
import type { Permission } from "@/auth/roles";
import Dexie, { type DBCoreTransaction, type Table, type Transaction } from "dexie";
import { isCloud } from "./supabase";
import type {
  AuditEntry,
  CashEntry,
  Correction,
  Customer,
  DayClose,
  Part,
  Photo,
  Setting,
  Ticket,
  Unit,
  User,
} from "./types";

/** Antrean perubahan lokal yang belum terdorong ke cloud (buffer offline). */
export interface OutboxEntry {
  seq?: number;
  table: string; // nama tabel Dexie
  key: string; // primary key baris
  at: number;
  batchId?: string;
  before?: Record<string, unknown> | null;
  payload?: Record<string, unknown> | null;
  /** Keep the whole transaction local while its snackbar offers Undo. */
  notBefore?: number;
  inFlight?: boolean;
}

export interface UndoChange {
  table: string;
  key: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}
export interface UndoReceipt {
  id: string;
  actorId: string;
  actorRole: User["role"];
  label: string;
  expiresAt: number;
  changes: UndoChange[];
  permissions: Permission[];
  seqs: number[];
  draftPhotoIds?: string[];
}
export interface UndoCapture {
  changes: Map<string, UndoChange>;
  permissions: Set<Permission>;
  batchIds: Set<string>;
}

export const SYNC_TABLES = ["settings", "customers", "parts", "units", "tickets", "cash", "dayCloses", "corrections", "audit", "photos"];
export const isSharedSetting = (key: string) => /^(storeName|storeTagline|storeAddress|storePhone|storeHours|notaFooter|waTemplates)$/.test(key);
type SyncTransaction = Transaction & { remoteWrite?: boolean; undoCapture?: UndoCapture; };

export function currentUndoCapture() {
  let tx = Dexie.currentTransaction as SyncTransaction | null;
  while (tx) {
    if (tx.undoCapture) return tx.undoCapture;
    tx = tx.parent as SyncTransaction | null;
  }
  return undefined;
}
export function captureUndo(capture: UndoCapture) {
  const tx = Dexie.currentTransaction as SyncTransaction | null;
  if (!tx) throw new Error("Undo harus di dalam transaksi");
  tx.undoCapture = capture;
}

/** Suppression belongs to this transaction, never to unrelated local writers. */
export function markRemoteWrite(value = true) {
  const tx = Dexie.currentTransaction as SyncTransaction | null;
  if (!tx) throw new Error("Penerapan cloud harus di dalam transaksi");
  tx.remoteWrite = value;
}

export class LumenDB extends Dexie {
  users!: Table<User, string>;
  customers!: Table<Customer, string>;
  settings!: Table<Setting, string>;
  tickets!: Table<Ticket, string>;
  photos!: Table<Photo, string>;
  units!: Table<Unit, string>;
  parts!: Table<Part, string>;
  cash!: Table<CashEntry, string>;
  dayCloses!: Table<DayClose, string>;
  corrections!: Table<Correction, string>;
  audit!: Table<AuditEntry, string>;
  outbox!: Table<OutboxEntry, number>;
  snapshots!: Table<{ id: string; at: number; state: Record<string, unknown[]>; }, string>;
  undoReceipts!: Table<UndoReceipt, string>;
  syncCapture: boolean;

  constructor(name = "lumen-service", capture = isCloud) {
    super(name);
    this.syncCapture = capture;
    this.version(1).stores({
      users: "id, role, active",
      settings: "key",
      tickets: "id, &noNota, status, createdAt, phone",
      photos: "id, [refType+refId]",
      units: "id, &kode, imei, status, boughtAt, soldAt",
      parts: "id, nama, kategori",
      cash: "id, dayKey, at, category, refId",
      dayCloses: "dayKey, closedAt",
      corrections: "id, status, at",
      audit: "id, at, userId, entity",
    });
    // v2: login pakai username (akun lama diisi otomatis dari nama).
    this.version(2)
      .stores({ users: "id, &username, role, active" })
      .upgrade(async (tx) => {
        const users = await tx.table("users").toArray();
        const taken = new Set<string>();
        for (const u of users) {
          const base = usernameSlug(u.name) || "user";
          let uname = base;
          let i = 1;
          while (taken.has(uname)) uname = `${base}${++i}`;
          taken.add(uname);
          await tx.table("users").update(u.id, { username: uname });
        }
      });
    // v3: antrean sinkronisasi cloud.
    this.version(3).stores({ outbox: "++seq, table" });
    this.version(4).stores({ outbox: "++seq, table, batchId", snapshots: "id, at" });
    this.version(5).stores({ photos: "id, [refType+refId], refType, refId" });
    this.version(6).stores({ customers: "id, name, phoneNormalized, isRegular", tickets: "id, &noNota, status, createdAt, phone, customerId" });
    this.version(7).stores({ undoReceipts: "id, expiresAt" });
    this.on("ready", () => this.undoReceipts.where("expiresAt").belowOrEqual(Date.now()).delete().then(() => {}));

    // Include the durable outbox in the SAME native transaction as each write.
    // A tab closing, an aborted transaction or a failed queue write cannot leave
    // a committed business record without its corresponding change.
    const batches = new WeakMap<DBCoreTransaction, string>();
    this.use({
      stack: "dbcore",
      name: "durable-outbox",
      create: (down) => ({
        ...down,
        transaction: (stores, mode, options) => down.transaction(
          this.syncCapture && mode === "readwrite" && stores.some((s) => SYNC_TABLES.includes(s))
            ? [...new Set([...stores, "outbox"])] : stores,
          mode, options,
        ),
        table: (name) => {
          const table = down.table(name);
          if (!SYNC_TABLES.includes(name)) return table;
          return {
            ...table, mutate: async (req) => {
              const tx = Dexie.currentTransaction as SyncTransaction | null;
              const capture = currentUndoCapture();
              if ((!this.syncCapture && !capture) || tx?.remoteWrite) return table.mutate(req);
              if (req.type === "deleteRange") {
                throw new Error("Penghapusan massal data cloud tidak diizinkan");
              }
              const keys = req.keys ?? (req.type === "add" || req.type === "put"
                ? req.values.map((v) => table.schema.primaryKey.extractKey!(v)) : []);
              const before = await table.getMany({ trans: req.trans, keys });
              const result = await table.mutate(req);
              const after = await table.getMany({ trans: req.trans, keys });
              if (capture) {
                for (let i = 0; i < keys.length; i++) {
                  const key = keys[i];
                  if (result.failures[i] || key == null || name === "audit") continue;
                  if (name === "settings" && key !== "draftServisBaru") throw new Error("Undo nota tidak dapat mengubah pengaturan toko");
                  if (!["settings", "customers", "tickets", "parts", "cash", "photos"].includes(name)) throw new Error("Tindakan ini tidak dapat dibatalkan dari nota servis");
                  const identity = `${name}:${key}`;
                  const previous = capture.changes.get(identity);
                  capture.changes.set(identity, { table: name, key: String(key), before: previous ? previous.before : before[i] ?? null, after: after[i] ?? null });
                }
              }
              if (!this.syncCapture) return result;
              let batchId = batches.get(req.trans);
              if (!batchId) { batchId = crypto.randomUUID(); batches.set(req.trans, batchId); }
              capture?.batchIds.add(batchId);
              const entries = keys.flatMap((key, i) => {
                if (result.failures[i] || key == null) return [];
                if (name === "settings" && !isSharedSetting(String(key))) return [];
                if (name === "photos" && (after[i] ?? before[i])?.refType === "draft") return [];
                return [{ table: name, key: String(key), batchId, at: Date.now(), before: before[i] ?? null, payload: after[i] ?? null, ...(capture ? { notBefore: Number.MAX_SAFE_INTEGER } : {}) }];
              });
              if (entries.length) {
                const queued = await down.table("outbox").mutate({ type: "add", trans: req.trans, values: entries });
                if (queued.numFailures) { req.trans.abort(); throw new Error("Gagal menyimpan antrean cloud; transaksi dibatalkan"); }
              }
              return result;
            }
          };
        },
      }),
    });
  }
}

export const db = new LumenDB();

export const uid = () => crypto.randomUUID();
