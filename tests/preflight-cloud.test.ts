import { afterAll, beforeAll, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { M } from "@/db/sync-mappers";
import { dayKey } from "@/lib/format";
import { validateBackup } from "@/lib/backup-schema";
import { db } from "@/db/db";
import { restoreBackup } from "@/db/backup";
import { forgetOfflineLogin, offlineLogin, offlineSessionValid } from "@/db/cloud";
import { hashPin } from "@/auth/pin";

const pg = new PGlite();
const owner = "00000000-0000-4000-9000-000000000001";
const session = "00000000-0000-4000-9000-000000000002";
const at = Date.now();
async function bootstrap(database: PGlite) {
  await database.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); create table storage.objects(id uuid,bucket_id text,name text); alter table storage.objects enable row level security;
    create schema auth; create table auth.users(id uuid primary key,email text); create table auth.sessions(id uuid primary key,user_id uuid);
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql as $$select jsonb_build_object('session_id',current_setting('request.jwt.claim.session_id',true))$$;`);
}
beforeAll(async () => {
  await bootstrap(pg);
  await pg.exec(await readFile(new URL("../docs/supabase/schema.sql", import.meta.url), "utf8"));
  await pg.query("insert into auth.users values($1,'owner@lumen.local')", [owner]);
  await pg.query("insert into auth.sessions values($1,$2)", [session, owner]);
  await pg.query("insert into users(id,auth_id,name,username,role) values($1,$1,'Owner','owner','owner')", [owner]);
}, 30000);
afterAll(() => pg.close(), 30000);
async function commit(changes: unknown[], batch = crypto.randomUUID()) {
  return pg.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.session_id',$2,true)", [owner, session]);
    await tx.exec("set local role authenticated");
    return tx.query("select apply_changes($1,$2::jsonb) as result", [batch, JSON.stringify(changes)]);
  });
}
function ticket(extra: Record<string, unknown> = {}) {
  const id = crypto.randomUUID();
  return { id, noNota: `LS-${id}`, customerName: "Customer", phone: "081234567890", brand: "Test", model: "Phone", keluhan: "LCD", kelengkapan: [], estimasi: 0, biayaJasa: 0, dp: 0, status: "masuk", history: [], partsUsed: [], createdAt: at, updatedAt: at, createdBy: owner, ...extra };
}
function unit(extra: Record<string, unknown> = {}) {
  const id = crypto.randomUUID();
  return { id, kode: `LU-${id}`, brand: "Test", model: "Phone", varian: "", imei: "490154203237518", kondisi: "Baik", hargaBeli: 1000000, hargaJual: 1500000, status: "terjual", sellerName: "Seller", sellerPhone: "", garansiHari: 7, boughtAt: at, soldAt: at, soldPrice: 1500000, createdBy: owner, ...extra };
}
function change(table: string, row: Record<string, unknown>, revision = 0) {
  return { table: M[table].remote, key: row.id, expected_version: revision, row: M[table].toRemote(row) };
}
async function seedUnit(row: Record<string, unknown>) {
  await pg.query("insert into units select * from jsonb_populate_record(null::units,$1::jsonb)", [JSON.stringify({ ...M.units.toRemote(row), revision: 1 })]);
}
function returnGraph(sold: Record<string, unknown>, refund: number) {
  const stocked = { ...sold, status: "stok", soldAt: undefined, soldPrice: undefined, buyerName: undefined, buyerPhone: undefined };
  const cash = { id: crypto.randomUUID(), at, dayKey: dayKey(new Date(at)), type: "out", category: "retur_unit", amount: refund, note: "Retur unit", refType: "unit", refId: sold.id, meta: { modal: 999 }, by: owner, byName: "Owner", locked: 0, voided: 0 };
  return { stocked, cash, changes: [change("units", stocked, 1), change("cash", cash)] };
}

test("cloud warranty claims require an existing collected non-warranty source", async () => {
  const source = ticket();
  await commit([change("tickets", source)]);
  await expect(commit([change("tickets", ticket({ garansiDari: source.id }))])).rejects.toThrow("Garansi");
  await pg.query("update tickets set status='diambil' where id=$1", [source.id]);
  const claim = ticket({ garansiDari: source.id });
  await commit([change("tickets", claim)]);
  await pg.query("update tickets set status='diambil' where id=$1", [claim.id]);
  await expect(commit([change("tickets", ticket({ garansiDari: claim.id }))])).rejects.toThrow("Garansi");
  await expect(commit([change("tickets", ticket({ garansiDari: crypto.randomUUID() }))])).rejects.toThrow();
});

test("cloud prevents returning an older record while the same IMEI is already in stock atomically", async () => {
  const sold = unit();
  await seedUnit(sold);
  const boughtAgain = unit({ status: "stok" });
  await seedUnit(boughtAgain);
  const returned = returnGraph(sold, 1000000);
  await expect(commit(returned.changes)).rejects.toThrow();
  expect((await pg.query<{ status: string }>("select status from units where id=$1", [sold.id])).rows[0].status).toBe("terjual");
  expect((await pg.query<{ count: number }>("select count(*)::int as count from cash_entries where id=$1", [returned.cash.id])).rows[0].count).toBe(0);
  await pg.query("delete from units where id=any($1::uuid[])", [[sold.id, boughtAgain.id]]);
});

test("zero-refund returns preserve a canonical cost ledger and retries do not duplicate it", async () => {
  const sold = unit({ imei: "356938035643809" });
  await seedUnit(sold);
  const returned = returnGraph(sold, 0);
  const batch = crypto.randomUUID();
  const first = await commit(returned.changes, batch);
  expect((await commit(returned.changes, batch)).rows).toEqual(first.rows);
  const saved = (await pg.query<{ amount: number; meta: { modal: number } }>("select amount::int,meta from cash_entries where id=$1", [returned.cash.id])).rows[0];
  expect(saved).toEqual({ amount: 0, meta: { modal: 1000000 } });
  await expect(commit([change("cash", { ...returned.cash, id: crypto.randomUUID(), category: "operasional" })])).rejects.toThrow();
  await expect(commit([change("cash", { ...returned.cash, id: crypto.randomUUID() })])).rejects.toThrow();
});

test("cloud rejects unrecorded returns and refunds above the original sale price", async () => {
  const sold = unit({ imei: "352099001761481" });
  await seedUnit(sold);
  const returned = returnGraph(sold, 1500001);
  await expect(commit(returned.changes)).rejects.toThrow("Refund");
  await expect(commit([change("units", returned.stocked, 1)])).rejects.toThrow("Retur");
  expect((await pg.query<{ status: string }>("select status from units where id=$1", [sold.id])).rows[0].status).toBe("terjual");
});

test("approved corrections cannot erase a return marker but can adjust its refund to zero", async () => {
  const sold = unit(); await seedUnit(sold);
  const returned = returnGraph(sold, 500000);
  await commit(returned.changes);
  const cash = { ...returned.cash, meta: { modal: 1000000 } };
  const correctionGraph = (amount: number, voided: 0 | 1, revision: number) => {
    const after = { amount, note: "Refund retur dikoreksi", voided };
    const correction = { id: crypto.randomUUID(), at, entity: "cash", entityId: cash.id, reason: "Rekonsiliasi refund", before: { amount: cash.amount, note: cash.note, voided: 0 }, after, requestedBy: owner, requestedByName: "Owner", status: "approved", decidedBy: owner, decidedByName: "Owner", decidedAt: at };
    return { correction, changes: [change("cash", { ...cash, ...after }, revision), change("corrections", correction)] };
  };
  const rejected = correctionGraph(500000, 1, 1);
  await expect(commit(rejected.changes)).rejects.toThrow("Retur");
  expect((await pg.query<{ voided: boolean; meta: { modal: number } }>("select voided,meta from cash_entries where id=$1", [cash.id])).rows[0]).toEqual({ voided: false, meta: { modal: 1000000 } });
  expect((await pg.query<{ count: number }>("select count(*)::int as count from corrections where id=$1", [rejected.correction.id])).rows[0].count).toBe(0);
  expect((await pg.query<{ status: string }>("select status from units where id=$1", [sold.id])).rows[0].status).toBe("stok");
  await commit(correctionGraph(0, 0, 1).changes);
  expect((await pg.query<{ amount: number; voided: boolean; meta: { modal: number } }>("select amount::int,voided,meta from cash_entries where id=$1", [cash.id])).rows[0]).toEqual({ amount: 0, voided: false, meta: { modal: 1000000 } });
  await expect(commit(correctionGraph(0, 1, 2).changes)).rejects.toThrow("Retur");
});

test("upgrade preserves legacy duplicates for reconciliation, then matches the fresh schema", async () => {
  const upgraded = new PGlite();
  try {
    await bootstrap(upgraded);
    const schema = await readFile(new URL("../docs/supabase/schema.sql", import.meta.url), "utf8");
    const migration = await readFile(new URL("../supabase/migrations/202610210001_preflight_integrity.sql", import.meta.url), "utf8");
    const boundary = schema.lastIndexOf("\n-- Pre-deployment integrity fixes");
    expect(boundary).toBeGreaterThan(0);
    await upgraded.exec(schema.slice(0, boundary));
    await upgraded.query("insert into users(id,name,username,role) values($1,'Owner','owner','owner')", [owner]);
    const first = unit({ status: "stok" }); const second = unit({ status: "stok" });
    for (const row of [first, second]) await upgraded.query("insert into units select * from jsonb_populate_record(null::units,$1::jsonb)", [JSON.stringify({ ...M.units.toRemote(row), revision: 1 })]);
    await expect(upgraded.exec(migration)).rejects.toThrow("IMEI ganda");
    await upgraded.exec("rollback");
    expect((await upgraded.query<{ count: number }>("select count(*)::int as count from units")).rows[0].count).toBe(2);
    await upgraded.query("delete from units where id=$1", [second.id]);
    await upgraded.exec(migration);
    await upgraded.exec(migration);
    const sql = "select pg_get_functiondef('public.apply_changes(uuid,jsonb)'::regprocedure) as definition";
    expect((await upgraded.query(sql)).rows).toEqual((await pg.query(sql)).rows);
    await expect(upgraded.query("insert into units select * from jsonb_populate_record(null::units,$1::jsonb)", [JSON.stringify({ ...M.units.toRemote(second), revision: 1 })])).rejects.toThrow("units_active_imei_unique");
  } finally { await upgraded.close(); }
}, 30000);

function backup() {
  return { app: "lumen-service", version: 4, exportedAt: new Date(at).toISOString(), source: "local", users: [{ id: owner, name: "Owner", username: "owner", role: "owner", active: 1, createdAt: at, pinHash: "hash", salt: "salt" }], settings: [], customers: [], tickets: [], units: [], parts: [], cash: [], dayCloses: [], corrections: [], audit: [], photos: [] };
}
test("backup validation rejects malformed optional financial snapshots before destructive restore", () => {
  const base = backup();
  expect(validateBackup(base).version).toBe(4);
  for (const hargaFinal of ["false", 0, {}, null]) expect(() => validateBackup({ ...base, tickets: [ticket({ hargaFinal })] })).toThrow();
  for (const soldPrice of ["1500000", -1, {}, null]) expect(() => validateBackup({ ...base, units: [unit({ soldPrice })] })).toThrow();
  const cash = returnGraph(unit(), 0).cash;
  for (const meta of [{ modal: "1000000" }, { modal: -1 }, { qty: 0 }, { paymentKind: "other" }, "snapshot"]) expect(() => validateBackup({ ...base, cash: [{ ...cash, meta }] })).toThrow();
  expect(() => validateBackup({ ...base, tickets: [ticket({ garansiDari: crypto.randomUUID() })] })).toThrow("garansi");
  expect(() => validateBackup({ ...base, units: [unit({ status: "stok" }), unit({ status: "stok" })] })).toThrow("IMEI");
});

test("restoring non-text login credentials leaves the current owner and safety snapshots untouched", async () => {
  db.syncCapture = false;
  await db.open(); for (const table of db.tables) await table.clear();
  const current = backup().users[0];
  await db.users.put(current as never);
  await expect(restoreBackup({ ...backup(), users: [{ ...current, pinHash: 1234 }] })).rejects.toThrow("kredensial");
  expect((await db.users.get(owner))?.pinHash).toBe("hash");
  expect(await db.snapshots.count()).toBe(0);
});

test("offline login rejects damaged credentials and account-specific invalidation preserves another staff login", async () => {
  db.syncCapture = false;
  await db.open(); for (const table of db.tables) await table.clear();
  await db.users.put(backup().users[0] as never);
  for (const value of ["not json", "null", JSON.stringify({ userId: owner, username: "owner", pinHash: "hash", salt: "salt", expires: "tomorrow" })]) {
    await db.settings.put({ key: "offline.login", value });
    expect(await offlineLogin("owner", "1234")).toBeNull();
    expect(await offlineSessionValid(owner)).toBe(false);
  }
  const record = { userId: owner, username: "owner", pinHash: await hashPin("1234", "salt"), salt: "salt", expires: Date.now() + 3600000 };
  await db.settings.put({ key: "offline.login", value: JSON.stringify(record) });
  expect(await offlineLogin(" OWNER ", "1234")).toBe(owner);
  expect(await offlineSessionValid(owner)).toBe(true);
  await forgetOfflineLogin("another-user");
  expect(await offlineSessionValid(owner)).toBe(true);
  await db.users.update(owner, { active: 0 });
  expect(await offlineSessionValid(owner)).toBe(false);
  expect(await offlineLogin("owner", "1234")).toBeNull();
  await forgetOfflineLogin(owner);
  expect(await db.settings.get("offline.login")).toBeUndefined();
});
