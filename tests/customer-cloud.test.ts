import { afterAll, beforeAll, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";

const pg = new PGlite();
const owner = "00000000-0000-4000-8000-000000000101";
const cashier = "00000000-0000-4000-8000-000000000102";
const technician = "00000000-0000-4000-8000-000000000103";
const headops = "00000000-0000-4000-8000-000000000104";
const staff = [owner, cashier, technician, headops];
const sessions = staff.map((_, i) => `00000000-0000-4000-8000-00000000020${i}`);
const at = new Date().toISOString();

beforeAll(async () => {
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid,bucket_id text,name text); alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated; grant select,insert on storage.objects to authenticated;
    create schema auth; create table auth.users(id uuid primary key,email text);
    create table auth.sessions(id uuid primary key,user_id uuid);
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql as $$select jsonb_build_object('session_id',current_setting('request.jwt.claim.session_id',true))$$;
    grant usage on schema auth to authenticated; grant execute on all functions in schema auth to authenticated;`);
  const schema = await readFile(new URL("../docs/supabase/schema.sql", import.meta.url), "utf8");
  await pg.exec(schema);
  // The standalone migration remains exercised until it is added to fresh installs.
  if (!schema.includes("create table if not exists public.customers")) {
    await pg.exec(await readFile(new URL("../supabase/migrations/202610200007_customers.sql", import.meta.url), "utf8"));
  }
  for (const [i, id] of staff.entries()) {
    const role = ["owner", "kasir", "teknisi", "headops"][i];
    await pg.query("insert into auth.users values($1,$2)", [id, `${role}@lumen.local`]);
    await pg.query("insert into auth.sessions values($1,$2)", [sessions[i], id]);
    await pg.query("insert into users(id,auth_id,name,username,role) values($1,$1,$2,$2,$2)", [id, role]);
  }
}, 30000);
afterAll(() => pg.close(), 30000);

async function asUser<T>(id: string, query: string, params: unknown[] = []) {
  return pg.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [id]);
    await tx.query("select set_config('request.jwt.claim.session_id',$1,true)", [sessions[staff.indexOf(id)]]);
    await tx.exec("set local role authenticated");
    return tx.query<T>(query, params);
  });
}
const customer = (extra: Record<string, unknown> = {}) => ({
  id: crypto.randomUUID(), name: "Budi Pelanggan", phone: "081234567890", phone_normalized: "6281234567890",
  notes: "", is_regular: false, created_at: at, updated_at: at, created_by: owner, ...extra,
});
const change = (table: string, row: Record<string, unknown>, version = 0) => ({ table, key: row.id, expected_version: version, row });
const commit = (id: string, changes: unknown[], batch = crypto.randomUUID()) => asUser<{ result: unknown }>(id, "select apply_changes($1,$2::jsonb) as result", [batch, JSON.stringify(changes)]);
const ticket = (profile: ReturnType<typeof customer>, extra: Record<string, unknown> = {}) => ({
  id: crypto.randomUUID(), no_nota: `LS-${crypto.randomUUID()}`, customer_id: profile.id, customer_name: profile.name,
  phone: profile.phone, garansi_dari: null, piutang: 0, brand: "Samsung", model: "A15", keluhan: "LCD pecah", kelengkapan: [],
  estimasi: 0, biaya_jasa: 0, harga_final: false, dp: 0, status: "masuk", history: [], parts_used: [],
  created_by: owner, created_at: at, updated_at: at, ...extra,
});

test("customer profiles use authenticated sync and reject direct table access and deletion", async () => {
  const row = customer({ name: "Akses Profil" });
  await commit(owner, [change("customers", row)]);
  for (const id of staff) {
    const result = await asUser<{ result: { rows: { id: string }[] } }>(id, "select sync_page('customers') as result");
    expect(result.rows[0].result.rows.some((item) => item.id === row.id)).toBe(true);
    await expect(asUser(id, "select * from customers")).rejects.toThrow();
    await expect(asUser(id, "delete from customers where id=$1", [row.id])).rejects.toThrow();
  }
  await expect(pg.transaction(async (tx) => {
    await tx.exec("set local role anon");
    return tx.exec("select sync_page('customers')");
  })).rejects.toThrow();
  await expect(commit(owner, [{ table: "customers", key: row.id, expected_version: 1, row: null }])).rejects.toThrow("Penghapusan");
});

test("cashier and head ops can manage profiles with server actor, atomicity, CAS and retries", async () => {
  const row = customer({ name: "Profil Kasir", notes: "Suka dihubungi sore", is_regular: true });
  const batch = crypto.randomUUID();
  const changes = [change("customers", row)];
  const first = await commit(cashier, changes, batch);
  expect((await commit(cashier, changes, batch)).rows).toEqual(first.rows);
  const saved = (await pg.query<Record<string, unknown>>("select * from customers where id=$1", [row.id])).rows[0];
  expect(saved.created_by).toBe(cashier);
  expect(saved.is_regular).toBe(true);
  expect(saved.revision).toBe(1);
  await expect(commit(cashier, changes)).rejects.toThrow("Konflik");
  await commit(headops, [change("customers", { ...saved, notes: "Catatan diperbarui", updated_at: new Date().toISOString() }, 1)]);
  await expect(commit(owner, [change("customers", { ...saved, created_by: owner }, 2)])).rejects.toThrow("Identitas");
  const invalid = customer({ name: "Pelanggan lain", phone_normalized: "081234567890" });
  await expect(commit(owner, [change("customers", { ...saved, notes: "Jangan tersimpan" }, 2), change("customers", invalid)])).rejects.toThrow("customers_phone_valid");
  expect((await pg.query<{ notes: string }>("select notes from customers where id=$1", [row.id])).rows[0].notes).toBe("Catatan diperbarui");
});

test("normalized phone and name prevent duplicates while allowing shared and absent numbers", async () => {
  const row = customer({ name: "Sari Keluarga", phone: "0812-3333-4444", phone_normalized: "6281233334444" });
  await commit(owner, [change("customers", row)]);
  await expect(commit(owner, [change("customers", customer({ name: "sari keluarga", phone: "+62 812 3333 4444", phone_normalized: row.phone_normalized }))])).rejects.toThrow("customers_identity_unique");
  await commit(cashier, [change("customers", customer({ name: "Andi Keluarga", phone: row.phone, phone_normalized: row.phone_normalized }))]);
  await commit(owner, [change("customers", customer({ name: "Tanpa WA", phone: "", phone_normalized: "" })), change("customers", customer({ name: "Tanpa WA", phone: "", phone_normalized: "" }))]);
  await expect(commit(owner, [change("customers", customer({ name: "  Tidak   Rapi  " }))])).rejects.toThrow("customers_name_valid");
  await expect(commit(owner, [change("customers", customer({ name: "x".repeat(121) }))])).rejects.toThrow("customers_name_valid");
  await expect(commit(owner, [change("customers", customer({ notes: "x".repeat(2001) }))])).rejects.toThrow("customers_notes_valid");
  for (const [phone, phone_normalized] of [["0812abc34567", "6281234567"], ["+", ""], ["1234", "1234"], ["081234567890", "081234567890"]]) {
    await expect(commit(owner, [change("customers", customer({ name: `Invalid ${phone}`, phone, phone_normalized }))])).rejects.toThrow("customers_phone_valid");
  }
});

test("technicians can only create baseline profiles with a new ticket in the same graph", async () => {
  const row = customer({ name: "Pelanggan Teknisi" });
  await expect(commit(technician, [change("customers", row)])).rejects.toThrow("Teknisi");
  const linked = ticket(row);
  await expect(commit(technician, [change("customers", { ...row, is_regular: true }), change("tickets", linked)])).rejects.toThrow("Teknisi");
  await expect(commit(technician, [change("customers", { ...row, notes: "Catatan rahasia" }), change("tickets", linked)])).rejects.toThrow("Teknisi");
  // Intentionally reversed: the server writes profiles before referencing tickets.
  await commit(technician, [change("tickets", linked), change("customers", row)]);
  expect((await pg.query<{ created_by: string }>("select created_by from customers where id=$1", [row.id])).rows[0].created_by).toBe(technician);
  await expect(commit(technician, [change("customers", { ...row, created_by: technician, is_regular: true }, 1)])).rejects.toThrow("Teknisi");
  const second = ticket(row, { created_by: technician });
  await commit(technician, [change("tickets", second)]);
  const unrelated = customer({ name: "Bukan profil nota" });
  await expect(commit(technician, [change("customers", unrelated), change("tickets", { ...linked, customer_id: unrelated.id }, 1)])).rejects.toThrow("Teknisi");
});

test("profile edits preserve ticket snapshots and ticket links cannot be reassigned", async () => {
  const row = customer({ name: "Nama Saat Datang", phone: "081255551234", phone_normalized: "6281255551234" });
  const linked = ticket(row, { no_nota: "LS-PROFILE-SNAPSHOT" });
  await commit(owner, [change("tickets", linked), change("customers", row)]);
  const updated = { ...row, name: "Nama Baru", phone: "081299991234", phone_normalized: "6281299991234", is_regular: true };
  await commit(cashier, [change("customers", updated, 1)]);
  const snapshot = (await pg.query<{ customer_id: string; customer_name: string; phone: string }>("select customer_id,customer_name,phone from tickets where id=$1", [linked.id])).rows[0];
  expect(snapshot).toEqual({ customer_id: row.id, customer_name: row.name, phone: row.phone });
  // Another device can capture an offline intake before the profile edit arrives.
  // Its stable link is still valid, while the name and phone remain intake snapshots.
  const offlineIntake = ticket(row);
  await commit(technician, [change("tickets", offlineIntake)]);
  expect((await pg.query<{ customer_name: string }>("select customer_name from tickets where id=$1", [offlineIntake.id])).rows[0].customer_name).toBe(row.name);
  const other = customer({ name: "Profil Berbeda" });
  await commit(owner, [change("customers", other)]);
  await expect(commit(owner, [change("tickets", { ...linked, customer_id: other.id }, 1)])).rejects.toThrow("tidak dapat diganti");
  await expect(commit(owner, [change("tickets", { ...linked, customer_id: null }, 1)])).rejects.toThrow("tidak dapat diganti");
  const oldClientUpdate = { ...linked } as Record<string, unknown>;
  delete oldClientUpdate.customer_id;
  await expect(commit(owner, [change("tickets", oldClientUpdate, 1)])).rejects.toThrow("tidak dapat diganti");
  const missing = ticket(customer());
  await expect(commit(owner, [change("tickets", missing)])).rejects.toThrow("Profil pelanggan");
  const publicResult = (await pg.query<{ result: Record<string, unknown> }>("select read_public('status',$1::jsonb) as result", [JSON.stringify({ nota: linked.no_nota, suffix: "1234" })])).rows[0].result;
  expect(publicResult.noNota).toBe(linked.no_nota);
  expect(publicResult).not.toHaveProperty("customer_id");
  expect(publicResult).not.toHaveProperty("is_regular");
  expect(publicResult).not.toHaveProperty("notes");
});

test("legacy tickets without a profile remain valid and customer sync paginates all staff records", async () => {
  const legacy = ticket(customer(), { customer_id: null, no_nota: "LS-LEGACY-CUSTOMER" });
  await commit(owner, [change("tickets", legacy)]);
  await commit(owner, [change("tickets", { ...legacy, status: "dicek" }, 1)]);
  await pg.query("insert into customers(name,phone,phone_normalized,created_by) select 'Pagination '||n,'','',$1::uuid from generate_series(1,203) n", [owner]);
  const expected = (await pg.query<{ count: number }>("select count(*)::int as count from customers")).rows[0].count;
  const ids = new Set<string>();
  let after: string | null = null;
  do {
    const result = (await asUser<{ result: { rows: { id: string }[]; next: string | null } }>(technician, "select sync_page('customers',$1,200) as result", [after])).rows[0].result;
    result.rows.forEach((row) => ids.add(row.id));
    after = result.next;
  } while (after);
  expect(ids.size).toBe(expected);
});
