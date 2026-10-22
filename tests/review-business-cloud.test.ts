import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { db } from "@/db/db";
import { requestCorrection } from "@/db/cash";
import { sellPart } from "@/db/parts";
import { usePart } from "@/db/tickets";
import { sellUnit } from "@/db/units";
import { coalesceChanges } from "@/db/sync";
import { M } from "@/db/sync-mappers";
import { dayKey } from "@/lib/format";
import type { CashEntry, Part, Ticket, Unit, User } from "@/db/types";
const pg = new PGlite();
const owner: User = { id: "00000000-0000-4000-b000-000000000001", name: "Owner", username: "owner", role: "owner", pinHash: "hash", salt: "salt", active: 1, createdAt: 1 };
const session = "00000000-0000-4000-b000-000000000002";
const cashier: User = { ...owner, id: "00000000-0000-4000-b000-000000000003", name: "Kasir", username: "cashier", role: "kasir" };
const technician: User = { ...owner, id: "00000000-0000-4000-b000-000000000005", name: "Teknisi", username: "technician", role: "teknisi" };
const sessions = new Map([[owner.id, session], [cashier.id, "00000000-0000-4000-b000-000000000004"], [technician.id, "00000000-0000-4000-b000-000000000006"]]);
const at = Date.now();
beforeAll(async () => {
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); create table storage.objects(id uuid,bucket_id text,name text); alter table storage.objects enable row level security;
    create schema auth; create table auth.users(id uuid primary key,email text); create table auth.sessions(id uuid primary key,user_id uuid);
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql as $$select jsonb_build_object('session_id',current_setting('request.jwt.claim.session_id',true))$$;`);
  await pg.exec(await readFile(new URL("../docs/supabase/schema.sql", import.meta.url), "utf8"));
  for (const actor of [owner, cashier, technician]) {
    await pg.query("insert into auth.users values($1,$2)", [actor.id, `${actor.id}@lumen.local`]);
    await pg.query("insert into auth.sessions values($1,$2)", [sessions.get(actor.id), actor.id]);
    await pg.query("insert into users(id,auth_id,name,username,role) values($1,$1,$2,$3,$4)", [actor.id, actor.name, actor.username, actor.role]);
  }
}, 30000);
afterAll(() => { db.syncCapture = false; return pg.close(); }, 30000);
beforeEach(async () => {
  db.syncCapture = false; await db.open(); for (const table of db.tables) await table.clear(); await db.users.bulkAdd([owner, cashier, technician]);
  await pg.exec("truncate public.audit_log,public.corrections,public.cash_entries,public.parts,public.tickets,public.photos,public.customers,public.day_closes,public.units,private.applied_batches cascade");
});
async function seed(table: string, row: Record<string, unknown>) {
  await pg.query(`insert into ${M[table].remote} select * from jsonb_populate_record(null::${M[table].remote},$1::jsonb)`, [JSON.stringify({ ...M[table].toRemote(row), revision: 1 })]);
  await db.table(table).put({ ...row, _version: 1 });
}
function cash(extra: Partial<CashEntry>): CashEntry { return { id: crypto.randomUUID(), at, dayKey: dayKey(new Date(at)), type: "out", category: "beli_unit", method: "tunai", amount: 1000000, note: "Beli HP", by: owner.id, byName: owner.name, locked: 0, voided: 0, ...extra }; }
async function purchase() {
  const unit: Unit = { id: crypto.randomUUID(), kode: `U-${crypto.randomUUID()}`, brand: "Samsung", model: "Test", varian: "", imei: "490154203237518", kondisi: "Baik", hargaBeli: 1000000, hargaJual: 1500000, status: "stok", sellerName: "Seller", sellerPhone: "", garansiHari: 7, boughtAt: at, createdBy: owner.id };
  const entry = cash({ refType: "unit", refId: unit.id }); await seed("units", unit as unknown as Record<string, unknown>); await seed("cash", entry as unknown as Record<string, unknown>); db.syncCapture = true;
  return { unit, entry };
}
async function accessorySale(extra: Partial<Part> = {}) {
  const part: Part = { id: crypto.randomUUID(), nama: "LCD", kategori: "sparepart", brand: "Samsung", stok: 3, hargaModal: 70000, hargaJual: 100000, minStok: 1, ...extra };
  const entry = cash({ refType: "part", refId: part.id, category: "jual_aksesoris", type: "in", amount: 200000, meta: { modal: 140000, qty: 2 }, note: "Jual 2× LCD" });
  await seed("parts", part as unknown as Record<string, unknown>); await seed("cash", entry as unknown as Record<string, unknown>); db.syncCapture = true; return { part, entry };
}
async function graph() { return coalesceChanges(await db.outbox.toArray()).map((row) => ({ table: M[row.table].remote, key: row.key, expected_version: row.before?._version ?? 0, row: M[row.table].toRemote(row.payload) })); }
async function commit(changes: unknown[], batch = crypto.randomUUID(), actor = owner) { return pg.transaction(async (tx) => { await tx.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.session_id',$2,true)", [actor.id, sessions.get(actor.id)]); await tx.exec("set local role authenticated"); return tx.query("select apply_changes($1,$2::jsonb) as result", [batch, JSON.stringify(changes)]); }); }
async function cacheVisible(table: string, actor: User) {
  const rows = await pg.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.session_id',$2,true)", [actor.id, sessions.get(actor.id)]);
    await tx.exec("set local role authenticated");
    const result = await tx.query<{ page: { rows: Record<string, unknown>[] } }>("select sync_page($1) as page", [M[table].remote]);
    return result.rows[0].page.rows;
  });
  db.syncCapture = false;
  for (const row of rows) await db.table(table).put({ ...M[table].toLocal(row), _version: row.revision });
  db.syncCapture = true;
}
const correction = (entry: CashEntry, amount: number, voided: 0 | 1 = 0) => requestCorrection(owner, entry.id, { amount, note: entry.note, voided }, "Periksa nota sumber", entry);

test("cloud accepts the real cost correction graph once, and future unit sale snapshots the new cost", async () => {
  const { unit, entry } = await purchase(); await correction(entry, 800000); const changes = await graph(); const batch = crypto.randomUUID();
  const result = await commit(changes, batch); expect((await commit(changes, batch)).rows).toEqual(result.rows);
  expect((await pg.query<{ cost: number }>("select harga_beli::int as cost from units where id=$1", [unit.id])).rows[0].cost).toBe(800000);
  const sold = { ...unit, hargaBeli: 800000, status: "terjual", soldAt: at, soldPrice: 1500000, buyerName: "Buyer", buyerPhone: "" };
  const receipt = cash({ refId: unit.id, refType: "unit", category: "jual_unit", type: "in", amount: 1500000, meta: { modal: 999 } });
  await commit([{ table: "units", key: unit.id, expected_version: 2, row: M.units.toRemote(sold) }, { table: "cash_entries", key: receipt.id, expected_version: 0, row: M.cash.toRemote(receipt) }]);
  expect((await pg.query<{ meta: { modal: number } }>("select meta from cash_entries where id=$1", [receipt.id])).rows[0].meta.modal).toBe(800000);
});
test("cloud rejects cash-only, wrong-cost and mixed unit edits atomically", async () => {
  const { unit, entry } = await purchase(); await correction(entry, 800000); const changes = await graph();
  await expect(commit(changes.filter((row) => row.table !== "units"))).rejects.toThrow("modal unit");
  const wrong = structuredClone(changes); wrong.find((row) => row.table === "units")!.row.harga_beli = 700000;
  await expect(commit(wrong)).rejects.toThrow("Modal unit");
  const mixed = structuredClone(changes); mixed.find((row) => row.table === "units")!.row.harga_jual = 1800000;
  await expect(commit(mixed)).rejects.toThrow("Modal unit");
  expect((await pg.query<{ amount: number }>("select amount::int from cash_entries where id=$1", [entry.id])).rows[0].amount).toBe(1000000);
  expect((await pg.query<{ cost: number }>("select harga_beli::int as cost from units where id=$1", [unit.id])).rows[0].cost).toBe(1000000);
});
test("cloud rejects unit cost correction after any sale/return, including a returned stocked unit", async () => {
  const { unit, entry } = await purchase(); await correction(entry, 800000); const changes = await graph();
  db.syncCapture = false; await seed("cash", cash({ category: "retur_unit", refType: "unit", refId: unit.id, amount: 500000 }) as unknown as Record<string, unknown>);
  await expect(commit(changes)).rejects.toThrow("rekonsiliasi");
});
test("cloud rejects changing unit cost alone or voiding a unit purchase", async () => {
  const { unit, entry } = await purchase();
  await expect(commit([{ table: "units", key: unit.id, expected_version: 1, row: M.units.toRemote({ ...unit, hargaBeli: 800000 }) }])).rejects.toThrow("koreksi pembelian");
  await correction(entry, 800000); const changes = await graph(); changes.find((row) => row.table === "cash_entries")!.row.voided = true;
  await expect(commit(changes)).rejects.toThrow("tidak dapat dibatalkan");
});
test("cloud accessory cancellation restores stock atomically and replay cannot restore twice", async () => {
  const { part, entry } = await accessorySale(); await correction(entry, entry.amount, 1); const changes = await graph(); const batch = crypto.randomUUID();
  const result = await commit(changes, batch); expect((await commit(changes, batch)).rows).toEqual(result.rows);
  expect((await pg.query<{ stok: number }>("select stok from parts where id=$1", [part.id])).rows[0].stok).toBe(5);
  expect((await pg.query<{ voided: boolean }>("select voided from cash_entries where id=$1", [entry.id])).rows[0].voided).toBe(true);
  await expect(commit(changes)).rejects.toThrow("Konflik");
});
test("cloud rejects accessory cancellation with missing, doubled or unrelated inventory changes", async () => {
  const { part, entry } = await accessorySale(); await correction(entry, entry.amount, 1); const changes = await graph();
  await expect(commit(changes.filter((row) => row.table !== "parts"))).rejects.toThrow("menyertakan stok");
  for (const field of ["stok", "harga_jual", "harga_modal"]) { const wrong = structuredClone(changes); wrong.find((row) => row.table === "parts")!.row[field] = field === "stok" ? 7 : 150000; await expect(commit(wrong)).rejects.toThrow("tepat satu kali"); }
  expect((await pg.query<{ stok: number }>("select stok from parts where id=$1", [part.id])).rows[0].stok).toBe(3);
});
test("cloud restores the historical sale cost into inventory after a later restock changed its average", async () => {
  const { part, entry } = await accessorySale({ stok: 8, hargaModal: 90000 });
  await correction(entry, entry.amount, 1); const changes = await graph();
  const wrong = structuredClone(changes); wrong.find((row) => row.table === "parts")!.row.harga_modal = 90000;
  await expect(commit(wrong)).rejects.toThrow("memulihkan modal asli");
  await commit(changes);
  expect((await pg.query<{ stok: number; cost: number }>("select stok,harga_modal::int as cost from parts where id=$1", [part.id])).rows[0]).toEqual({ stok: 10, cost: 86000 });
  expect((await pg.query<{ meta: { modal: number; qty: number } }>("select meta from cash_entries where id=$1", [entry.id])).rows[0].meta).toEqual({ modal: 140000, qty: 2 });
});
test("cloud rejects reactivation of a cancelled accessory sale", async () => {
  const { entry } = await accessorySale(); await correction(entry, entry.amount, 1); await commit(await graph());
  const changed = { ...entry, voided: 0, note: "Aktif lagi" }; const record = { id: crypto.randomUUID(), at, entity: "cash", entityId: entry.id, reason: "Aktif lagi", before: { amount: entry.amount, note: entry.note, voided: 1 }, after: { amount: entry.amount, note: changed.note, voided: 0 }, requestedBy: owner.id, requestedByName: owner.name, status: "approved", decidedBy: owner.id, decidedByName: owner.name, decidedAt: at };
  await expect(commit([{ table: "cash_entries", key: entry.id, expected_version: 2, row: M.cash.toRemote(changed) }, { table: "corrections", key: record.id, expected_version: 0, row: M.corrections.toRemote(record) }])).rejects.toThrow("penjualan baru");
});
test("cloud blocks queued unit cost and accessory cancellation corrections after their cash is locked", async () => {
  const { unit, entry: purchaseEntry } = await purchase();
  await correction(purchaseEntry, 800000); const unitGraph = await graph();
  await pg.query("update cash_entries set locked=true where id=$1", [purchaseEntry.id]);
  await expect(commit(unitGraph)).rejects.toThrow("sudah ditutup");
  expect((await pg.query<{ cost: number }>("select harga_beli::int as cost from units where id=$1", [unit.id])).rows[0].cost).toBe(1000000);
  db.syncCapture = false; await db.outbox.clear();
  const { part, entry: sale } = await accessorySale(); await correction(sale, sale.amount, 1); const saleGraph = await graph();
  await pg.query("update cash_entries set locked=true where id=$1", [sale.id]);
  await expect(commit(saleGraph)).rejects.toThrow("sudah ditutup");
  expect((await pg.query<{ stok: number }>("select stok from parts where id=$1", [part.id])).rows[0].stok).toBe(3);
  expect((await pg.query<{ count: number }>("select count(*)::int as count from corrections")).rows[0].count).toBe(0);
});
test("cloud day close protects unlocked legacy cash while correction rejection remains possible", async () => {
  const { entry } = await purchase(); await correction(entry, 800000); const changes = await graph();
  await pg.query("insert into day_closes(day_key,expected,counted,selisih,note,closed_by,closed_by_name,closed_at) values($1,0,0,0,'Tutup kas',$2,'Owner',$3)", [entry.dayKey, owner.id, new Date(at).toISOString()]);
  await expect(commit(changes)).rejects.toThrow("sudah ditutup");
  const proposed = changes.find((row) => row.table === "corrections")!;
  const pending = { ...proposed.row, status: "pending", decided_by: null, decided_by_name: null, decided_at: null };
  await pg.query("insert into corrections select * from jsonb_populate_record(null::corrections,$1::jsonb)", [JSON.stringify({ ...pending, revision: 1 })]);
  await commit([{ table: "corrections", key: proposed.key, expected_version: 1, row: { ...pending, status: "rejected", decided_by: owner.id, decided_by_name: owner.name, decided_at: new Date(at).toISOString() } }]);
  expect((await pg.query<{ status: string }>("select status from corrections where id=$1", [proposed.key])).rows[0].status).toBe("rejected");
});

test.each([0, 123])("cashier unit sale keeps canonical cost with hidden input %d", async (hiddenCost) => {
  const { unit } = await purchase();
  await cacheVisible("units", cashier);
  const visible = (await db.units.get(unit.id))!;
  expect(visible.hargaBeli).toBe(0);
  expect(visible.sellerName).toBe("");
  await sellUnit(cashier, visible, { soldPrice: 1500000, buyerName: "Buyer", buyerPhone: "", garansiHari: 7, method: "tunai" });
  const changes = await graph();
  expect(changes.find((row) => row.table === "units")!.row.harga_beli).toBe(0);
  // A client-supplied hidden value is never authoritative, even if tampered.
  changes.find((row) => row.table === "units")!.row.harga_beli = hiddenCost;
  const result = await commit(changes, crypto.randomUUID(), cashier);
  expect((await pg.query<{ cost: number; status: string }>("select harga_beli::int as cost,status from units where id=$1", [unit.id])).rows[0]).toEqual({ cost: 1000000, status: "terjual" });
  const sale = (await pg.query<{ meta: { modal: number } }>("select meta from cash_entries where category='jual_unit'")).rows[0];
  expect(sale.meta.modal).toBe(1000000);
  // Receipts only acknowledge revisions; they never disclose purchase values.
  expect(JSON.stringify(result.rows)).not.toContain('"harga_beli"');
});

test.each([0, 123])("cashier part sale keeps canonical cost with hidden input %d", async (hiddenCost) => {
  const { part } = await accessorySale();
  await cacheVisible("parts", cashier);
  expect((await db.parts.get(part.id))?.hargaModal).toBe(0);
  await sellPart(cashier, { partId: part.id, qty: 1, harga: part.hargaJual, method: "qris" });
  const changes = await graph();
  expect(changes.find((row) => row.table === "parts")!.row.harga_modal).toBe(0);
  changes.find((row) => row.table === "parts")!.row.harga_modal = hiddenCost;
  await commit(changes, crypto.randomUUID(), cashier);
  expect((await pg.query<{ stok: number; cost: number }>("select stok,harga_modal::int as cost from parts where id=$1", [part.id])).rows[0]).toEqual({ stok: 2, cost: 70000 });
  expect((await pg.query<{ meta: { modal: number } }>("select meta from cash_entries where by_user=$1", [cashier.id])).rows[0].meta.modal).toBe(70000);
});

test.each([0, 123])("technician part usage keeps canonical cost with hidden input %d", async (hiddenCost) => {
  const { part } = await accessorySale();
  db.syncCapture = false;
  const ticket: Ticket = { id: crypto.randomUUID(), noNota: `LS-${crypto.randomUUID()}`, customerName: "Customer", phone: "081234567890", brand: "Samsung", model: "Test", keluhan: "LCD rusak", kelengkapan: [], estimasi: 0, biayaJasa: 0, dp: 0, status: "masuk", history: [], partsUsed: [], createdAt: at, updatedAt: at, createdBy: owner.id };
  await seed("tickets", ticket as unknown as Record<string, unknown>);
  await cacheVisible("parts", technician);
  await cacheVisible("tickets", technician);
  expect((await db.parts.get(part.id))?.hargaModal).toBe(0);
  await usePart(technician, (await db.tickets.get(ticket.id))!, part.id, 1);
  const changes = await graph();
  const partRow = changes.find((row) => row.table === "parts")!.row;
  expect(partRow.harga_modal).toBe(0);
  partRow.harga_modal = hiddenCost;
  await commit(changes, crypto.randomUUID(), technician);
  expect((await pg.query<{ stok: number; cost: number }>("select stok,harga_modal::int as cost from parts where id=$1", [part.id])).rows[0]).toEqual({ stok: 2, cost: 70000 });
  expect((await pg.query<{ used: { modal: number }[] }>("select parts_used as used from tickets where id=$1", [ticket.id])).rows[0].used[0].modal).toBe(70000);
});
