import { beforeAll, afterAll, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { M } from "@/db/sync-mappers";
import { dayKey } from "@/lib/format";
import catalog from "@/db/seeds/spareparts.json";
const pg = new PGlite();
const owner = "00000000-0000-4000-8000-000000000001";
const cashier = "00000000-0000-4000-8000-000000000002";
const session = "00000000-0000-4000-8000-000000000003";
const partId = "00000000-0000-4000-8000-000000000004";
beforeAll(async () => {
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); create table storage.objects(id uuid,bucket_id text,name text); alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated; grant select,insert on storage.objects to authenticated;
    create schema auth; create table auth.users(id uuid primary key,email text); create table auth.sessions(id uuid primary key,user_id uuid);
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql as $$select jsonb_build_object('session_id',coalesce(nullif(current_setting('request.jwt.claim.session_id',true),''),'${session}'))$$;
    grant usage on schema auth to authenticated; grant execute on all functions in schema auth to authenticated;`);
  await pg.exec(await readFile(new URL("../docs/supabase/schema.sql", import.meta.url), "utf8"));
  await pg.exec(`insert into auth.users values('${owner}','owner@lumen.local'),('${cashier}','cashier@lumen.local');
    insert into auth.sessions values('${session}','${owner}'),('00000000-0000-4000-8000-000000000005','${cashier}');
    insert into users(id,auth_id,name,username,role) values('${owner}','${owner}','Owner','owner','owner'),('${cashier}','${cashier}','Kasir','kasir','kasir');`);
}, 30000);
afterAll(() => pg.close(), 30000);
async function asUser<T>(id: string, query: string, params: unknown[] = []) {
  return pg.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [id]);
    await tx.query("select set_config('request.jwt.claim.session_id',$1,true)", [id === cashier ? "00000000-0000-4000-8000-000000000005" : session]);
    await tx.exec("set local role authenticated");
    return tx.query<T>(query, params);
  });
}
const part = { id: partId, nama: "LCD", kategori: "sparepart", stok: 5, harga_modal: 70000, harga_jual: 100000, min_stok: 1 };
test("database denies direct user changes and private credential reads", async () => {
  await expect(asUser(owner, "update users set role='owner' where id=$1", [cashier])).rejects.toThrow();
  await expect(asUser(owner, "select * from private.staff_credentials")).rejects.toThrow();
});
test("cloud commit is atomic, idempotent and checks expected revisions", async () => {
  const id = crypto.randomUUID(); const changes = [{ table: "parts", key: partId, expected_version: 0, row: part }];
  const first = await asUser(owner, "select apply_changes($1,$2::jsonb) as result", [id, JSON.stringify(changes)]);
  const retry = await asUser(owner, "select apply_changes($1,$2::jsonb) as result", [id, JSON.stringify(changes)]);
  expect(retry.rows).toEqual(first.rows);
  await expect(asUser(owner, "select apply_changes($1,$2::jsonb)", [crypto.randomUUID(), JSON.stringify(changes)])).rejects.toThrow("Konflik");
  const failed = [{ table: "parts", key: partId, expected_version: 1, row: { ...part, stok: 3 } }, { table: "users", key: owner, expected_version: 1, row: {} }];
  await expect(asUser(owner, "select apply_changes($1,$2::jsonb)", [crypto.randomUUID(), JSON.stringify(failed)])).rejects.toThrow();
  expect((await pg.query<{ stok: number }>("select stok from parts where id=$1", [partId])).rows[0].stok).toBe(5);
});
test("unlinked or inactive sessions cannot call cloud sync", async () => {
  await expect(asUser(crypto.randomUUID(), "select sync_page('parts')")).rejects.toThrow();
  await pg.query("update users set active=false where id=$1", [owner]);
  try { await expect(asUser(owner, "select sync_page('parts')")).rejects.toThrow(); }
  finally { await pg.query("update users set active=true where id=$1", [owner]); }
});
test("cashier cannot promote users, change stock without sale, or see cost", async () => {
  const rows = await asUser<{ result: { rows: Record<string, unknown>[] } }>(cashier, "select sync_page('parts') as result");
  expect(rows.rows[0].result.rows[0].harga_modal).toBe(0);
  const promotion = [{ table: "users", key: cashier, expected_version: 1, row: { role: "owner" } }];
  await expect(asUser(cashier, "select apply_changes($1,$2::jsonb)", [crypto.randomUUID(), JSON.stringify(promotion)])).rejects.toThrow();
  const stolen = [{ table: "parts", key: partId, expected_version: 1, row: { ...part, stok: 0, harga_modal: 0 } }];
  await expect(asUser(cashier, "select apply_changes($1,$2::jsonb)", [crypto.randomUUID(), JSON.stringify(stolen)])).rejects.toThrow("stok");
});
test("rate limit is shared across requests and recovery code is consumed once", async () => {
  expect((await pg.query<{ allowed: boolean }>("select auth_allow('account:test',1,900) as allowed")).rows[0].allowed).toBe(true);
  expect((await pg.query<{ allowed: boolean }>("select auth_allow('account:test',1,900) as allowed")).rows[0].allowed).toBe(false);
  await pg.query("insert into private.staff_credentials(user_id,pin_hash,salt,recovery_hash,recovery_salt) values($1,'old','salt','code','recovery')", [cashier]);
  await pg.query("select auth_recover($1,'code','new','newsalt')", [cashier]);
  await expect(pg.query("select auth_recover($1,'code','another','salt')", [cashier])).rejects.toThrow();
  const credential = await pg.query<{ pin_hash: string; recovery_hash: null }>("select pin_hash,recovery_hash from private.staff_credentials where user_id=$1", [cashier]);
  expect(credential.rows[0]).toEqual({ pin_hash: "new", recovery_hash: null });
});
test("keyset pagination returns more than one thousand records without omissions", async () => {
  await pg.exec("insert into parts(id,nama,kategori,stok,harga_modal,harga_jual,min_stok) select gen_random_uuid(),'Item '||n,'sparepart',1,1,2,0 from generate_series(1,1201) n");
  const ids = new Set<string>(); let after: string | null = null;
  do {
    const page = await asUser<{ result: {rows:{id:string}[];next:string|null} }>(owner,"select sync_page('parts',$1,200) as result",[after]);
    const result = page.rows[0].result;
    result.rows.forEach((r) => ids.add(r.id)); after=result.next;
  } while(after);
  expect(ids.size).toBe(1202);
});
test("unit sale and ticket part transactions synchronize as complete graphs", async () => {
  const unitId=crypto.randomUUID(); const at=Date.now();
  const unit={ id:unitId,kode:"LU-TEST",brand:"Test",model:"Phone",varian:"",imei:"490154203237518",kondisi:"Baik",hargaBeli:1000000,hargaJual:1500000,status:"stok",sellerName:"Penjual",sellerPhone:"",garansiHari:7,boughtAt:at,createdBy:owner };
  const cash=(id:string,extra:Record<string,unknown>) => M.cash.toRemote({ id,at,dayKey:dayKey(new Date(at)),type:"in",category:"servis",amount:20000,note:"DP servis LS-TEST",by:owner,byName:"Owner",locked:0,voided:0,...extra });
  const commit = (changes:unknown[]) => asUser(owner,"select apply_changes($1,$2::jsonb)",[crypto.randomUUID(),JSON.stringify(changes)]);
  await commit([{table:"units",key:unitId,expected_version:0,row:M.units.toRemote(unit)}, {table:"cash_entries",key:unitId,expected_version:0,row:cash(unitId,{type:"out",category:"beli_unit",amount:1000000,refType:"unit",refId:unitId})}]);
  const sold={...unit,status:"terjual",soldAt:at,soldPrice:1500000,buyerName:"Pembeli",buyerPhone:""}; const saleId=crypto.randomUUID();
  const sale=[{table:"units",key:unitId,expected_version:1,row:M.units.toRemote(sold)}, {table:"cash_entries",key:saleId,expected_version:0,row:cash(saleId,{category:"jual_unit",amount:1500000,refType:"unit",refId:unitId,meta:{modal:1000000}})}];
  await commit(sale); await expect(commit(sale)).rejects.toThrow("Konflik");
  const ticketId=crypto.randomUUID(); const depositId=crypto.randomUUID();
  const ticket={ id:ticketId,noNota:"LS-TEST",customerName:"Customer",phone:"081234567890",brand:"Test",model:"Phone",keluhan:"LCD",kelengkapan:[],estimasi:100000,biayaJasa:0,dp:20000,status:"masuk",history:[],partsUsed:[],createdAt:at,updatedAt:at,createdBy:owner };
  await commit([{table:"tickets",key:ticketId,expected_version:0,row:M.tickets.toRemote(ticket)},{table:"cash_entries",key:depositId,expected_version:0,row:cash(depositId,{refType:"ticket",refId:ticketId})}]);
  const usage={...ticket,partsUsed:[{id:crypto.randomUUID(),partId,nama:"LCD",qty:1,harga:100000,modal:70000}]};
  await commit([{table:"parts",key:partId,expected_version:1,row:{...part,stok:4}},{table:"tickets",key:ticketId,expected_version:1,row:M.tickets.toRemote(usage)}]);
  expect((await pg.query<{stok:number}>("select stok from parts where id=$1",[partId])).rows[0].stok).toBe(4);
  const unsafe={...usage,noNota:"LS-TAMPERED"};
  await expect(commit([{table:"tickets",key:ticketId,expected_version:2,row:M.tickets.toRemote(unsafe)}])).rejects.toThrow("Identitas");
  const publicLookup=await pg.query<{result:Record<string,unknown>}>("select read_public('status',$1::jsonb) as result",[JSON.stringify({nota:"LS-TEST",suffix:"7890"})]);
  expect(publicLookup.rows[0].result.noNota).toBe("LS-TEST"); expect(publicLookup.rows[0].result).not.toHaveProperty("customer_name");
  expect(publicLookup.rows[0].result).not.toHaveProperty("parts_used");
  const wrongSuffix=await pg.query<{result:unknown}>("select read_public('status',$1::jsonb) as result",[JSON.stringify({nota:"LS-TEST",suffix:"9999"})]);
  expect(wrongSuffix.rows[0].result).toBeNull();
  const correctionId=crypto.randomUUID();
  const correction={id:correctionId,at,entity:"cash",entityId:depositId,reason:"Salah nominal",before:{amount:20000,note:"DP servis LS-TEST",voided:0},after:{amount:30000,note:"DP direvisi",voided:0},requestedBy:owner,requestedByName:"Owner",status:"approved",decidedBy:owner,decidedByName:"Owner",decidedAt:at};
  await commit([{table:"tickets",key:ticketId,expected_version:2,row:M.tickets.toRemote({...usage,dp:30000})},
    {table:"cash_entries",key:depositId,expected_version:1,row:cash(depositId,{refType:"ticket",refId:ticketId,amount:30000,note:"DP direvisi",meta:{paymentKind:"dp"}})},
    {table:"corrections",key:correctionId,expected_version:0,row:M.corrections.toRemote(correction)}]);
  expect((await pg.query<{dp:number}>("select dp from tickets where id=$1",[ticketId])).rows[0].dp).toBe(30000);
  const close={dayKey:dayKey(new Date(at)),expected:530000,counted:530000,selisih:0,note:"",closedBy:owner,closedByName:"Owner",closedAt:Date.now()+1000};
  await commit([{table:"day_closes",key:close.dayKey,expected_version:0,row:M.dayCloses.toRemote(close)}]);
  const invalidId=crypto.randomUUID();
  await expect(commit([{table:"cash_entries",key:invalidId,expected_version:0,row:cash(invalidId,{category:"modal_masuk",amount:100})}])).rejects.toThrow("sudah ditutup");
});
test("photo policies protect seller identity and prevent replacing evidence", async () => {
  await pg.query("insert into auth.sessions(id,user_id) values($1,$2) on conflict do nothing",["00000000-0000-4000-8000-000000000005",cashier]);
  const photoId=crypto.randomUUID(); const path=`${owner}/${photoId}.jpg`;
  await pg.query("insert into photos(id,ref_type,ref_id,path) values($1,'unit-ktp',$2,$3)",[photoId,crypto.randomUUID(),path]);
  await pg.query("insert into storage.objects(id,bucket_id,name) values($1,'photos',$2)",[photoId,path]);
  expect((await asUser(owner,"select * from storage.objects where name=$1",[path])).rows).toHaveLength(1);
  expect((await asUser(cashier,"select * from storage.objects where name=$1",[path])).rows).toHaveLength(0);
  await expect(asUser(cashier,"insert into storage.objects(id,bucket_id,name) values($1,'photos',$2)",[crypto.randomUUID(),`${owner}/${crypto.randomUUID()}.jpg`])).rejects.toThrow();
  await expect(asUser(owner,"update storage.objects set name='replacement' where name=$1",[path])).rejects.toThrow();
});
test("cloud accepts combined price confirmation and work only with both new history steps", async () => {
  const id = crypto.randomUUID();
  const at = Date.now();
  const entry = (status: string) => ({ status, at, by: "Owner" });
  const ticket = { id, noNota: "LS-SHORTTEST234", customerName: "Customer", phone: "", brand: "Test", model: "Phone", keluhan: "LCD", kelengkapan: [], estimasi: 0, biayaJasa: 0, dp: 0, status: "masuk", history: [entry("masuk")], partsUsed: [], createdAt: at, updatedAt: at, createdBy: owner };
  const commit = (row: Record<string, unknown>, version: number) => asUser(owner, "select apply_changes($1,$2::jsonb)", [crypto.randomUUID(), JSON.stringify([{ table: "tickets", key: id, expected_version: version, row: M.tickets.toRemote(row) }])]);
  await commit(ticket, 0);
  const checked = { ...ticket, status: "dicek", history: [...ticket.history, entry("dicek")] };
  await commit(checked, 1);
  const working = { ...checked, status: "dikerjakan", biayaJasa: 150000, hargaFinal: true, history: [...checked.history, entry("konfirmasi"), entry("dikerjakan")] };
  await expect(commit({ ...working, history: [...checked.history, entry("dikerjakan")] }, 2)).rejects.toThrow("Transisi");
  await expect(commit({ ...working, hargaFinal: false }, 2)).rejects.toThrow("Transisi");
  await expect(commit({ ...working, history: [entry("batal"), entry("dicek"), entry("konfirmasi"), entry("dikerjakan")] }, 2)).rejects.toThrow("Transisi");
  const before = (await pg.query<{ status: string; biaya_jasa: number }>("select status,biaya_jasa from tickets where id=$1", [id])).rows[0];
  expect(before.status).toBe("dicek");
  expect(before.biaya_jasa).toBe(0);
  await commit(working, 2);
  const saved = (await pg.query<{ status: string; harga_final: boolean; biaya_jasa: number; history: { status: string }[] }>("select status,harga_final,biaya_jasa,history from tickets where id=$1", [id])).rows[0];
  expect(saved.status).toBe("dikerjakan");
  expect(saved.harga_final).toBe(true);
  expect(saved.biaya_jasa).toBe(150000);
  expect(saved.history.slice(-2).map((h) => h.status)).toEqual(["konfirmasi", "dikerjakan"]);
});
test("SQL starter catalog matches local data and preserves existing names, prices and stock on rerun", async () => {
  const sql = await readFile(new URL("../supabase/seed.sql", import.meta.url), "utf8");
  const byName = crypto.randomUUID();
  await pg.query("insert into parts(id,nama,kategori,stok,harga_modal,harga_jual,min_stok) values($1,$2,'sparepart',4,70000,100000,3),($3,'Nama toko sendiri','sparepart',8,90000,140000,4)", [byName, ` ${catalog[0].nama.toUpperCase().replaceAll(" ", "   ")} `, catalog[1].id]);
  const before = (await pg.query<{ count: number }>("select count(*)::int as count from parts")).rows[0].count;
  const cashBefore = (await pg.query<{ count: number }>("select count(*)::int as count from cash_entries")).rows[0].count;
  await pg.exec(sql);
  await pg.exec(sql);
  expect((await pg.query<{ count: number }>("select count(*)::int as count from parts")).rows[0].count).toBe(before + 28);
  const rows = (await pg.query<{ id: string; nama: string; stok: number; harga_modal: number; harga_jual: number; min_stok: number }>("select id,nama,stok,harga_modal,harga_jual,min_stok from parts where id=any($1::uuid[])", [catalog.map((p) => p.id)])).rows;
  expect(rows).toHaveLength(29);
  for (const part of catalog.slice(2)) {
    expect(rows.find((row) => row.id === part.id)).toEqual({ id: part.id, nama: part.nama, stok: 0, harga_modal: 0, harga_jual: 0, min_stok: part.minStok });
    expect((await pg.query<{ brand: string }>("select brand from parts where id=$1", [part.id])).rows[0].brand).toBe(part.brand);
  }
  expect(rows.find((row) => row.id === catalog[1].id)).toEqual({ id: catalog[1].id, nama: "Nama toko sendiri", stok: 8, harga_modal: 90000, harga_jual: 140000, min_stok: 4 });
  expect((await pg.query<{ stok: number; harga_modal: number }>("select stok,harga_modal from parts where id=$1", [byName])).rows[0]).toEqual({ stok: 4, harga_modal: 70000 });
  expect((await pg.query<{ count: number }>("select count(*)::int as count from cash_entries")).rows[0].count).toBe(cashBefore);
});
test("cloud persists part brand and rejects unauthorized reclassification or invalid brands", async () => {
  const id = crypto.randomUUID();
  const row = { ...part, id, brand: "Samsung" };
  const commit = (actor: string, value: Record<string, unknown>, version: number) => asUser(actor, "select apply_changes($1,$2::jsonb)", [crypto.randomUUID(), JSON.stringify([{ table: "parts", key: id, expected_version: version, row: value }])]);
  await commit(owner, row, 0);
  expect((await pg.query<{ brand: string }>("select brand from parts where id=$1", [id])).rows[0].brand).toBe("Samsung");
  await expect(commit(cashier, { ...row, brand: "vivo", harga_modal: 0 }, 1)).rejects.toThrow("stok");
  await expect(commit(owner, { ...row, brand: "invalid-brand" }, 1)).rejects.toThrow("parts_brand_valid");
  await commit(owner, { ...row, brand: "Universal" }, 1);
  const previous = (await pg.query<{ id: string }>("select id::text as id from parts where id::text<$1 order by id::text desc limit 1", [id])).rows[0]?.id ?? null;
  const page = await asUser<{ result: { rows: { id: string; brand: string }[] } }>(cashier, "select sync_page('parts',$1,1) as result", [previous]);
  expect(page.rows[0].result.rows.find((p) => p.id === id)?.brand).toBe("Universal");
});

test("HO stock adjustment and Owner-approved purchase correction reach both cloud views", async () => {
  const headOps = crypto.randomUUID(); const headOpsSession = crypto.randomUUID();
  await pg.query("insert into auth.users values($1,'headops-audit@lumen.local')", [headOps]);
  await pg.query("insert into auth.sessions values($1,$2)", [headOpsSession, headOps]);
  await pg.query("insert into users(id,auth_id,name,username,role) values($1,$1,'HO Audit','ho-audit','headops')", [headOps]);
  const asHeadOps = <T>(query: string, params: unknown[] = []) => pg.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.session_id',$2,true)", [headOps, headOpsSession]);
    await tx.exec("set local role authenticated");
    return tx.query<T>(query, params);
  });
  // Use an open business day, separate from the cash-closing fixture above.
  const id = crypto.randomUUID(); const cashId = crypto.randomUUID(); const correctionId = crypto.randomUUID(); const at = Date.now() + 86400000;
  const item = { id, nama: "LCD audit", brand: "Samsung", kategori: "sparepart", stok: 2, hargaModal: 70000, hargaJual: 100000, minStok: 1 };
  const entry = { id: cashId, at, dayKey: dayKey(new Date(at)), type: "out", category: "restok_part", amount: 140000, note: "Stok awal LCD audit", refType: "part", refId: id, by: headOps, byName: "HO Audit", locked: 0, voided: 0 };
  const change = (table: string, row: Record<string, unknown>, version: number) => ({ table: M[table].remote, key: row.id, expected_version: version, row: M[table].toRemote(row) });
  const commitHO = (changes: unknown[]) => asHeadOps("select apply_changes($1,$2::jsonb)", [crypto.randomUUID(), JSON.stringify(changes)]);
  await commitHO([change("parts", item, 0), change("cash", entry, 0)]);
  await commitHO([change("parts", { ...item, stok: 3 }, 1)]);
  expect((await pg.query<{ amount: number }>("select amount::int from cash_entries where id=$1", [cashId])).rows[0].amount).toBe(140000);
  const correction = { id: correctionId, at, entity: "cash", entityId: cashId, reason: "Jumlah pembelian awal salah ketik", before: { amount: 140000, note: entry.note, voided: 0 }, after: { amount: 210000, note: entry.note, voided: 0 }, requestedBy: headOps, requestedByName: "HO Audit", status: "pending" };
  await commitHO([change("corrections", correction, 0)]);
  await expect(commitHO([change("cash", { ...entry, amount: 210000 }, 1)])).rejects.toThrow("Owner");
  await asUser(owner, "select apply_changes($1,$2::jsonb)", [crypto.randomUUID(), JSON.stringify([
    change("cash", { ...entry, amount: 210000 }, 1),
    change("corrections", { ...correction, status: "approved", decidedBy: owner, decidedByName: "Owner", decidedAt: at }, 1),
  ])]);
  const cashPage = await asHeadOps<{ result: { rows: Record<string, unknown>[] } }>("select sync_page('cash_entries',null,500) as result");
  const cashRow = cashPage.rows[0].result.rows.find((row) => row.id === cashId)!;
  expect(M.cash.toLocal(cashRow)).toMatchObject({ amount: 210000, by: headOps, refId: id });
  const stockRow = (await pg.query<{ stok: number; harga_modal: number }>("select stok,harga_modal::int from parts where id=$1", [id])).rows[0];
  expect(stockRow).toEqual({ stok: 3, harga_modal: 70000 });
  expect((await pg.query<{ status: string }>("select status from corrections where id=$1", [correctionId])).rows[0].status).toBe("approved");
});
