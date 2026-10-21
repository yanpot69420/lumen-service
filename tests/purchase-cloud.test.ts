import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { db, markRemoteWrite } from "@/db/db";
import { savePart, adjustPart, restockPart } from "@/db/parts";
import { correctPurchase, purchaseContext } from "@/db/purchases";
import { requestCorrection, recordManualCash, closeCash, expectedCashToday, decideCorrection } from "@/db/cash";
import { coalesceChanges, applyRemoteRows, claimSyncBatch, acknowledgeSyncBatch } from "@/db/sync";
import { M } from "@/db/sync-mappers";
import { dayKey } from "@/lib/format";
import type { User } from "@/db/types";

const pg = new PGlite();
const ho: User = { id: "00000000-0000-4000-a000-000000000001", name: "HO", username: "ho", role: "headops", pinHash: "hash", salt: "salt", active: 1, createdAt: 1 };
const owner: User = { ...ho, id: "00000000-0000-4000-a000-000000000002", name: "Owner", username: "owner", role: "owner" };
const sessions = ["00000000-0000-4000-a000-000000000003", "00000000-0000-4000-a000-000000000004"];
const input = { nama: "LCD server test", brand: "Samsung", kategori: "sparepart" as const, stok: 4, hargaModal: 138000, hargaJual: 200000, minStok: 1 };
const correction = { qty: 4, totalCost: 408000, kind: "record" as const, method: "tunai" as const, reason: "Salah input pembelian" };

beforeAll(async () => {
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); create table storage.objects(id uuid,bucket_id text,name text); alter table storage.objects enable row level security;
    create schema auth; create table auth.users(id uuid primary key,email text); create table auth.sessions(id uuid primary key,user_id uuid);
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql as $$select jsonb_build_object('session_id',current_setting('request.jwt.claim.session_id',true))$$;`);
  await pg.exec(await readFile(new URL("../docs/supabase/schema.sql", import.meta.url), "utf8"));
  for (const [i, user] of [ho, owner].entries()) {
    await pg.query("insert into auth.users values($1,$2)", [user.id, `${user.username}@lumen.local`]);
    await pg.query("insert into auth.sessions values($1,$2)", [sessions[i], user.id]);
    await pg.query("insert into users(id,auth_id,name,username,role) values($1,$1,$2,$3,$4)", [user.id, user.name, user.username, user.role]);
  }
}, 30000);
afterAll(() => { db.syncCapture = false; return pg.close(); }, 30000);
beforeEach(async () => {
  db.syncCapture = false; await db.open();
  for (const table of db.tables) await table.clear();
  await db.users.bulkAdd([ho, owner]);
  await pg.exec("truncate public.audit_log,public.corrections,public.cash_entries,public.parts,public.tickets,public.photos,public.customers,public.day_closes,public.units,private.applied_batches cascade");
  db.syncCapture = true;
});
async function asActor<T>(actor: User, sql: string, params: unknown[] = []) {
  return pg.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.session_id',$2,true)", [actor.id, actor.id === ho.id ? sessions[0] : sessions[1]]);
    await tx.exec("set local role authenticated");
    return tx.query<T>(sql, params);
  });
}
async function graph() {
  const { batch: queued } = await claimSyncBatch();
  expect(new Set(queued.map((row) => row.batchId)).size).toBe(1);
  return coalesceChanges(queued).map((row) => ({ table: M[row.table].remote, key: row.key, expected_version: row.before?._version ?? 0, row: M[row.table].toRemote(row.payload) }));
}
async function commit(changes: unknown[], batch = crypto.randomUUID(), actor = ho) {
  return asActor<{ result: unknown }>(actor, "select apply_changes($1,$2::jsonb) as result", [batch, JSON.stringify(changes)]);
}
async function flush(actor = ho) {
  const changes = await graph(); const queued = await db.outbox.toArray(); const batch = queued[0].batchId!; const result = await commit(changes, batch, actor);
  await acknowledgeSyncBatch(queued, result.rows[0].result);
  for (const table of ["parts", "cash", "corrections"]) {
    const page = await asActor<{ result: { rows: Record<string, unknown>[] } }>(actor, "select sync_page($1,null,200) as result", [M[table].remote]);
    await applyRemoteRows(table, page.rows[0].result.rows);
  }
  return { changes, batch, result };
}
async function purchase() {
  const id = await savePart(ho, input); await flush();
  return { id, entry: (await db.cash.where("refId").equals(id).first())! };
}

test("real HO client graph atomically corrects purchase and remains idempotent on cloud", async () => {
  const { id, entry } = await purchase();
  await correctPurchase(ho, await purchaseContext(entry.id), correction);
  const sent = await flush();
  expect((await commit(sent.changes, sent.batch)).rows).toEqual(sent.result.rows);
  expect(await db.parts.get(id)).toMatchObject({ stok: 4, hargaModal: 102000, _version: 2 });
  expect((await db.cash.get(entry.id))?.meta?.purchase).toMatchObject({ costAfter: 102000, totalCost: 408000, partVersion: 2 });
  expect((await db.cash.get(entry.id))?.amount).toBe(408000);
  expect((await db.corrections.toArray())[0]).toMatchObject({ status: "approved", decidedBy: ho.id });
});

test("a one-rupiah purchase correction syncs even when rounded inventory cost does not change", async () => {
  const { id, entry } = await purchase();
  await correctPurchase(ho, await purchaseContext(entry.id), { ...correction, totalCost: 551999 });
  await flush();
  expect(await db.parts.get(id)).toMatchObject({ stok: 4, hargaModal: 138000, _version: 2 });
  expect((await db.cash.get(entry.id))?.amount).toBe(551999);
});

test("retry repairs an old rejected rounded-cost batch without changing its cash or correction payloads", async () => {
  const { id, entry } = await purchase();
  await correctPurchase(ho, await purchaseContext(entry.id), { ...correction, totalCost: 551999 });
  // Reproduce the durable queue written by the old Dexie.update implementation.
  await db.outbox.where("table").equals("parts").delete();
  const original = await db.outbox.toArray();
  const oldGraph = coalesceChanges(original).map((row) => ({ table: M[row.table].remote, key: row.key, expected_version: row.before?._version ?? 0, row: M[row.table].toRemote(row.payload) }));
  await expect(commit(oldGraph, original[0].batchId)).rejects.toThrow("Koreksi pembelian harus menyertakan stok dan modal barang yang sama");
  const first = await claimSyncBatch(); const second = await claimSyncBatch();
  expect(first.batch.filter((row) => row.table === "parts")).toHaveLength(1);
  expect(second.batch).toHaveLength(original.length + 1);
  for (const row of original) expect((await db.outbox.get(row.seq!))?.payload).toEqual(row.payload);
  const sent = await flush(); await commit(sent.changes, sent.batch);
  expect(await db.outbox.count()).toBe(0);
  expect(await db.parts.get(id)).toMatchObject({ stok: 4, hargaModal: 138000, _version: 2 });
  expect((await db.cash.get(entry.id))?.amount).toBe(551999);
  expect((await pg.query<{ count: number }>("select count(*)::int as count from corrections")).rows[0].count).toBe(1);
});

test("a rounded supplier refund syncs once and can be followed by another correction", async () => {
  const { id, entry } = await purchase();
  await correctPurchase(ho, await purchaseContext(entry.id), { ...correction, totalCost: 551999, kind: "refund" });
  await db.outbox.where("table").equals("parts").delete();
  const sent = await flush(); await commit(sent.changes, sent.batch);
  expect(await db.parts.get(id)).toMatchObject({ hargaModal: 138000, _version: 2 });
  expect((await db.cash.toArray()).filter((row) => row.type === "in").map((row) => row.amount)).toEqual([1]);
  await correctPurchase(ho, await purchaseContext(entry.id), correction); await flush();
  expect((await db.cash.get(entry.id))?.amount).toBe(408001);
});

test("an old rounded-cost queue repair still rejects a concurrent cloud stock change", async () => {
  const { id, entry } = await purchase();
  await correctPurchase(ho, await purchaseContext(entry.id), { ...correction, totalCost: 551999 });
  await db.outbox.where("table").equals("parts").delete();
  await pg.query("update parts set stok=5, revision=revision+1 where id=$1", [id]);
  const changes = await graph();
  await expect(commit(changes)).rejects.toThrow("Konflik");
  expect(await db.outbox.count()).toBeGreaterThan(0);
  expect((await pg.query<{ amount: number }>("select amount::int from cash_entries where id=$1", [entry.id])).rows[0].amount).toBe(552000);
  expect((await pg.query<{ count: number }>("select count(*)::int as count from corrections")).rows[0].count).toBe(0);
});

test("a legacy rounded-cost queue can recover when its original stock and revision remain intact", async () => {
  const { id, entry } = await purchase();
  await pg.query("update cash_entries set meta=null where id=$1", [entry.id]);
  await db.transaction("rw", db.cash, db.outbox, async () => { markRemoteWrite(); await db.cash.update(entry.id, { meta: undefined }); });
  await correctPurchase(ho, await purchaseContext(entry.id), { ...correction, totalCost: 552001 });
  await db.outbox.where("table").equals("parts").delete();
  await flush();
  expect(await db.parts.get(id)).toMatchObject({ stok: 4, hargaModal: 138000, _version: 2 });
  expect((await db.cash.get(entry.id))?.amount).toBe(552001);
});

test("unreconciled later stock edits are preserved instead of guessed into an old failed purchase batch", async () => {
  const { id, entry } = await purchase();
  await correctPurchase(ho, await purchaseContext(entry.id), { ...correction, totalCost: 551999 });
  await db.outbox.where("table").equals("parts").delete();
  await adjustPart(ho, id, 5, "Hitung fisik setelah koreksi", 4);
  const queued = await db.outbox.toArray();
  const { batch } = await claimSyncBatch();
  expect(batch.some((row) => row.table === "parts")).toBe(false);
  expect(await db.outbox.count()).toBe(queued.length);
  expect((await db.parts.get(id))?.stok).toBe(5);
});

test("cash closing still syncs after purchase corrections and supplier refunds", async () => {
  await recordManualCash(ho, { type: "in", category: "modal_masuk", amount: 1_000_000, method: "tunai", note: "Modal kas" }); await flush();
  const { entry } = await purchase();
  await correctPurchase(ho, await purchaseContext(entry.id), { ...correction, kind: "refund" }); await flush();
  const expected = await expectedCashToday();
  await closeCash(ho, expected, "Sesuai hitung fisik", expected); await flush();
  expect((await pg.query<{ counted: number }>("select counted::int from day_closes")).rows[0].counted).toBe(expected);
  expect((await pg.query<{ count: number }>("select count(*)::int as count from cash_entries where not locked")).rows[0].count).toBe(0);
});

test("ordinary expense corrections by Owner still sync and update both the row and cash balance", async () => {
  await recordManualCash(ho, { type: "out", category: "operasional", amount: 50000, method: "tunai", note: "Listrik" }); await flush();
  const expense = (await db.cash.toArray())[0];
  await requestCorrection(ho, expense.id, { amount: 45000, note: "Listrik sesuai struk", voided: 0 }, "Salah nominal", expense); await flush();
  await decideCorrection(owner, (await db.corrections.toArray())[0].id, true); await flush(owner);
  expect((await db.cash.get(expense.id))?.amount).toBe(45000);
  expect(await expectedCashToday()).toBe(-45000);
});

test("multiple offline restocks send in order with the cloud revision for each purchase snapshot", async () => {
  const { id } = await purchase();
  await restockPart(ho, id, 2, 220000, "tunai");
  await restockPart(ho, id, 2, 240000, "transfer");
  while (await db.outbox.count()) {
    const { batch } = await claimSyncBatch();
    const changes = coalesceChanges(batch).map((row) => ({ table: M[row.table].remote, key: row.key, expected_version: row.before?._version ?? 0, row: M[row.table].toRemote(row.payload) }));
    const result = await commit(changes, batch[0].batchId);
    await acknowledgeSyncBatch(batch, result.rows[0].result);
  }
  const page = await asActor<{ result: { rows: Record<string, unknown>[] } }>(ho, "select sync_page('cash_entries',null,200) as result");
  await applyRemoteRows("cash", page.rows[0].result.rows);
  const purchases = (await db.cash.where("refId").equals(id).toArray()).sort((a, b) => a.meta!.purchase!.partVersion - b.meta!.purchase!.partVersion);
  expect(purchases.map((row) => row.meta?.purchase?.partVersion)).toEqual([1, 2, 3]);
  expect(purchases.map((row) => row.amount)).toEqual([552000, 220000, 240000]);
});

test("legacy purchase and its pending request can be reconciled by HO without Owner approval", async () => {
  const { id, entry } = await purchase();
  await pg.query("update cash_entries set meta=null where id=$1", [entry.id]);
  await db.transaction("rw", db.cash, db.outbox, async () => { markRemoteWrite(); await db.cash.update(entry.id, { meta: undefined }); });
  await adjustPart(ho, id, 3, "Salah jumlah awal", 4); await flush();
  const source = (await db.cash.get(entry.id))!;
  await requestCorrection(ho, entry.id, { amount: 408000, note: source.note, voided: 0 }, "Salah jumlah", source); await flush();
  await correctPurchase(ho, await purchaseContext(entry.id), { ...correction, qty: 3 }); await flush();
  expect(await db.parts.get(id)).toMatchObject({ stok: 3, hargaModal: 136000 });
  expect((await db.corrections.toArray()).map((row) => row.status).sort()).toEqual(["approved", "rejected"]);
  expect((await db.cash.get(entry.id))?.amount).toBe(408000);
});

test("cloud reconciles legacy inventory even if the cash amount was corrected previously", async () => {
  const { id, entry } = await purchase();
  await pg.query("update cash_entries set meta=null,amount=408000 where id=$1", [entry.id]);
  await db.transaction("rw", db.cash, db.outbox, async () => { markRemoteWrite(); await db.cash.update(entry.id, { meta: undefined, amount: 408000 }); });
  await correctPurchase(ho, await purchaseContext(entry.id), correction); await flush();
  expect(await db.parts.get(id)).toMatchObject({ hargaModal: 102000 });
  expect((await db.cash.get(entry.id))?.amount).toBe(408000);
});

test("supplier refund graph preserves payment and cloud retry cannot duplicate money returned", async () => {
  const { id, entry } = await purchase();
  await correctPurchase(ho, await purchaseContext(entry.id), { ...correction, kind: "refund" });
  const sent = await flush(); await commit(sent.changes, sent.batch);
  expect((await db.cash.get(entry.id))?.amount).toBe(552000);
  expect((await pg.query<{ amount: number }>("select amount::int from cash_entries where type='in'")).rows).toEqual([{ amount: 144000 }]);
  expect(await db.parts.get(id)).toMatchObject({ hargaModal: 102000 });
  await correctPurchase(ho, await purchaseContext(entry.id), { ...correction, kind: "refund", totalCost: 400000 }); await flush();
  expect((await db.cash.toArray()).filter((row) => row.type === "in").reduce((sum, row) => sum + row.amount, 0)).toBe(152000);
});

test("tampered or incomplete purchase graphs cannot widen HO cash access or partially commit", async () => {
  const { id, entry } = await purchase(); await correctPurchase(ho, await purchaseContext(entry.id), correction);
  const changes = await graph();
  for (const table of ["parts", "cash_entries", "corrections"]) await expect(commit(changes.filter((row) => row.table !== table))).rejects.toThrow();
  const forged = structuredClone(changes); forged.find((row) => row.table === "parts")!.row.harga_modal = 1;
  await expect(commit(forged)).rejects.toThrow();
  const noPurchase = structuredClone(changes); delete noPurchase.find((row) => row.table === "corrections")!.row.after_data.purchase;
  await expect(commit(noPurchase)).rejects.toThrow();
  expect((await pg.query<{ harga_modal: number }>("select harga_modal::int from parts where id=$1", [id])).rows[0].harga_modal).toBe(138000);
  expect((await pg.query<{ amount: number }>("select amount::int from cash_entries where id=$1", [entry.id])).rows[0].amount).toBe(552000);
  await flush();
});

test("server rejects a refund of the wrong amount without changing stock or original cash", async () => {
  const { id, entry } = await purchase(); await correctPurchase(ho, await purchaseContext(entry.id), { ...correction, kind: "refund" });
  const changes = await graph(); const refund = changes.find((row) => row.table === "cash_entries" && row.row.type === "in")!;
  refund.row.amount = 144001;
  await expect(commit(changes)).rejects.toThrow("supplier");
  expect((await pg.query<{ amount: number }>("select amount::int from cash_entries where id=$1", [entry.id])).rows[0].amount).toBe(552000);
  expect((await pg.query<{ count: number }>("select count(*)::int as count from cash_entries where type='in'")).rows[0].count).toBe(0);
  expect((await pg.query<{ harga_modal: number }>("select harga_modal::int from parts where id=$1", [id])).rows[0].harga_modal).toBe(138000);
});

test("a concurrent cloud update or closed cash blocks the complete correction", async () => {
  const { id, entry } = await purchase(); await correctPurchase(ho, await purchaseContext(entry.id), correction);
  const changes = await graph();
  await pg.query("update parts set revision=revision+1 where id=$1", [id]);
  await expect(commit(changes)).rejects.toThrow("Konflik");
  await pg.query("update parts set revision=1 where id=$1", [id]);
  await pg.query("insert into day_closes(day_key,expected,counted,selisih,note,closed_by,closed_by_name,closed_at) values($1,0,0,0,'',$2,'Owner',now())", [dayKey(), owner.id]);
  await expect(commit(changes)).rejects.toThrow("ditutup");
  expect((await pg.query<{ amount: number }>("select amount::int from cash_entries where id=$1", [entry.id])).rows[0].amount).toBe(552000);
  expect((await pg.query<{ count: number }>("select count(*)::int as count from corrections")).rows[0].count).toBe(0);
});

test("a valid purchase exception does not allow HO to edit an unrelated expense", async () => {
  const { entry } = await purchase();
  await recordManualCash(ho, { type: "out", category: "operasional", amount: 50000, method: "tunai", note: "Listrik" }); await flush();
  const expense = (await db.cash.where("category").equals("operasional").first())!;
  await correctPurchase(ho, await purchaseContext(entry.id), correction);
  const changes = await graph();
  changes.push({ table: "cash_entries", key: expense.id, expected_version: expense._version!, row: M.cash.toRemote({ ...expense, amount: 1 }) });
  await expect(commit(changes)).rejects.toThrow("Owner");
  expect((await pg.query<{ amount: number }>("select amount::int from cash_entries where id=$1", [entry.id])).rows[0].amount).toBe(552000);
  expect((await pg.query<{ amount: number }>("select amount::int from cash_entries where id=$1", [expense.id])).rows[0].amount).toBe(50000);
});

test("server checks the actor's current role before accepting a direct correction", async () => {
  const { entry } = await purchase(); await correctPurchase(ho, await purchaseContext(entry.id), correction);
  const changes = await graph();
  await pg.query("update users set role='kasir' where id=$1", [ho.id]);
  try { await expect(commit(changes)).rejects.toThrow("Owner/HO"); }
  finally { await pg.query("update users set role='headops' where id=$1", [ho.id]); }
  expect((await pg.query<{ amount: number }>("select amount::int from cash_entries where id=$1", [entry.id])).rows[0].amount).toBe(552000);
});
