import "../setup";
import { mock } from "bun:test";
import { strict as assert } from "node:assert";

let account = "cashier";
let rejectPush = false;
let rejectPull = false;
let delayPull: (() => Promise<void>) | undefined;
const pushed: string[] = [];
const pulled: string[] = [];
mock.module("@/db/supabase", () => ({ isCloud: true, supabase: {
  auth: { getSession: async () => ({ data: { session: { user: { id: account, email: `${account}@lumen.local` } } } }) },
  rpc: async (name: string, args: Record<string, unknown>) => {
    if (name === "apply_changes") {
      if (rejectPush) return { data: null, error: { message: "simulated conflict" } };
      pushed.push(String(args.p_batch_id));
      return { data: (args.p_changes as { table: string; key: string; expected_version: number }[]).map((row) => ({ table: row.table, key: row.key, revision: row.expected_version + 1 })), error: null };
    }
    pulled.push(String(args.p_table));
    await delayPull?.();
    if (rejectPull) return { data: null, error: { message: "simulated read failure" } };
    return { data: { rows: args.p_table === "parts" ? [{ id: "remote", nama: "Fresh remote", kategori: "sparepart", stok: 1, harga_modal: 0, harga_jual: 10, min_stok: 1, revision: 1 }] : [] }, error: null };
  },
} }));
Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true });
Object.defineProperty(globalThis, "window", { value: new EventTarget(), configurable: true });
const { db } = await import("@/db/db");
const { startSync, stopSync, syncNow, getSyncStatus, refreshReceiptData } = await import("@/db/sync");
db.syncCapture = false;
await db.open();
for (const table of db.tables) await table.clear();
for (const id of ["owner", "cashier"]) await db.users.add({ id, username: id, name: id, role: id === "owner" ? "owner" : "kasir", active: 1, pinHash: "", salt: "", createdAt: 1 });
await db.outbox.bulkAdd([
  { actorId: "owner", batchId: "owner-batch", table: "settings", key: "storeName", at: 1, before: null, payload: { key: "storeName", value: "Store" } },
  { actorId: "cashier", batchId: "cashier-batch", table: "customers", key: "customer", at: 2, before: null, payload: { id: "customer", name: "Customer", phone: "", phoneNormalized: "", notes: "", isRegular: false, createdAt: 1, updatedAt: 1, createdBy: "cashier" } },
]);
startSync("cashier");
await syncNow();
assert.deepEqual(pushed, ["cashier-batch"]);
assert.equal(await db.outbox.count(), 1);
assert.equal(getSyncStatus().blocked, 1);
assert.equal(getSyncStatus().state, "idle");
assert.equal((await db.parts.get("remote"))?.nama, "Fresh remote");
const successfulSync = getSyncStatus().lastSync;
assert.ok(successfulSync > 0);

await db.outbox.add({ actorId: "cashier", batchId: "conflicting", table: "customers", key: "conflict", at: 3, before: null, payload: { id: "conflict", name: "Conflict", phone: "", phoneNormalized: "", notes: "", isRegular: false, createdAt: 1, updatedAt: 1, createdBy: "cashier" } });
rejectPush = true;
const previousPulls = pulled.length;
await syncNow();
assert.ok(pulled.length > previousPulls, "push failure must not prevent pull");
assert.equal(getSyncStatus().state, "error");
assert.equal(getSyncStatus().lastSync, successfulSync);
assert.equal(await db.outbox.count(), 2);
rejectPull = true;
await syncNow();
assert.equal(getSyncStatus().lastSync, successfulSync, "failed reads cannot claim a newer successful timestamp");

rejectPull = false;
const receiptStart = pulled.length;
await refreshReceiptData("servis", "cashier");
assert.deepEqual(pulled.slice(receiptStart), ["settings", "tickets"], "store identity must be available before a direct receipt becomes printable");
let release!: () => void;
const deferred = new Promise<void>((resolve) => { release = resolve; });
delayPull = () => deferred;
const stale = refreshReceiptData("unit", "cashier");
await new Promise((resolve) => setTimeout(resolve, 0));
stopSync(); account = "owner"; startSync("owner");
release();
await assert.rejects(stale, "a prior account's response must be rejected");
delayPull = undefined;
stopSync();
db.close();
console.log("session-sync scenarios passed");
