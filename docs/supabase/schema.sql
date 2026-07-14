-- Lumen Service — skema PostgreSQL untuk Supabase
-- =================================================
-- Arsitektur: ONLINE + ANTREAN OFFLINE.
--   Supabase = sumber kebenaran. Aplikasi menyimpan cache + antrean tulis di
--   IndexedDB (Dexie) lokal, lalu mendorongnya ke sini saat online.
--
-- Cara pakai (JANGAN dijalankan dulu — tunggu instruksi final saat auth
-- disambungkan, agar tidak menjalankan skema yang masih berubah):
--   Supabase Dashboard → SQL Editor → tempel seluruh file ini → Run.
--
-- Catatan foto: blob TIDAK disimpan di database. Foto diunggah ke Supabase
-- Storage (bucket privat "photos"); tabel photos hanya menyimpan path-nya.

-- ============================================================
-- 1. TABEL
-- ============================================================

create table users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  username text unique not null,
  role text not null check (role in ('owner','headops','kasir','teknisi')),
  pin_hash text not null,
  pin_ver int not null default 2,
  salt text not null,
  recovery_hash text,
  recovery_salt text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table settings (
  key text primary key,
  value text not null
);

create table tickets (
  id uuid primary key default gen_random_uuid(),
  no_nota text unique not null,
  garansi_dari uuid references tickets(id),
  piutang bigint not null default 0,
  customer_name text not null,
  phone text not null default '',
  brand text not null,
  model text not null default '',
  keluhan text not null,
  kelengkapan text[] not null default '{}',
  estimasi bigint not null default 0,
  biaya_jasa bigint not null default 0,
  dp bigint not null default 0,
  status text not null default 'masuk'
    check (status in ('masuk','dicek','konfirmasi','dikerjakan','selesai','diambil','batal')),
  history jsonb not null default '[]',
  parts_used jsonb not null default '[]',
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tickets_status_idx on tickets(status);
create index tickets_created_idx on tickets(created_at desc);
create index tickets_phone_idx on tickets(phone);

create table units (
  id uuid primary key default gen_random_uuid(),
  kode text unique not null,
  brand text not null,
  model text not null default '',
  varian text not null default '',
  imei text not null,
  kondisi text not null default '',
  harga_beli bigint not null,
  harga_jual bigint not null default 0,
  status text not null default 'stok' check (status in ('stok','terjual')),
  seller_name text not null,
  seller_phone text not null default '',
  garansi_hari int not null default 7,
  bought_at timestamptz not null default now(),
  sold_at timestamptz,
  sold_price bigint,
  buyer_name text,
  buyer_phone text,
  created_by uuid not null references users(id)
);
create index units_imei_idx on units(imei);
create index units_status_idx on units(status);
create index units_bought_idx on units(bought_at desc);

create table parts (
  id uuid primary key default gen_random_uuid(),
  nama text not null,
  kategori text not null check (kategori in ('sparepart','aksesoris')),
  stok int not null default 0,
  harga_modal bigint not null default 0,
  harga_jual bigint not null default 0,
  min_stok int not null default 1
);

create table cash_entries (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  day_key date not null,
  type text not null check (type in ('in','out')),
  category text not null,
  method text not null default 'tunai' check (method in ('tunai','qris','transfer')),
  amount bigint not null,
  note text not null default '',
  ref_type text,
  ref_id uuid,
  meta jsonb,
  by_user uuid not null references users(id),
  by_name text not null,
  locked boolean not null default false,
  voided boolean not null default false
);
create index cash_day_idx on cash_entries(day_key);
create index cash_at_idx on cash_entries(at desc);

create table day_closes (
  day_key date primary key,
  expected bigint not null,
  counted bigint not null,
  selisih bigint not null,
  note text not null default '',
  closed_by uuid not null references users(id),
  closed_by_name text not null,
  closed_at timestamptz not null default now()
);

create table corrections (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  entity text not null,
  entity_id uuid not null,
  reason text not null,
  before_data jsonb not null,
  after_data jsonb not null,
  requested_by uuid not null references users(id),
  requested_by_name text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_by uuid references users(id),
  decided_by_name text,
  decided_at timestamptz
);
create index corrections_status_idx on corrections(status);

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  user_id uuid not null references users(id),
  user_name text not null,
  action text not null,
  entity text not null,
  entity_id text not null,
  summary text not null
);
create index audit_at_idx on audit_log(at desc);

create table photos (
  id uuid primary key default gen_random_uuid(),
  ref_type text not null check (ref_type in ('ticket','unit','unit-ktp')),
  ref_id uuid not null,
  path text not null,          -- lokasi objek di Storage bucket "photos"
  created_at timestamptz not null default now()
);
create index photos_ref_idx on photos(ref_type, ref_id);

-- ============================================================
-- 2. ROW LEVEL SECURITY — TAHAP 1 (auth level-toko)
-- ============================================================
-- Semua perangkat toko login sebagai SATU akun cloud toko (Supabase Auth).
-- RLS mewajibkan sesi terautentikasi → data toko tidak bisa diakses hanya
-- dengan anon key yang publik. Yang ditegakkan server di tahap ini:
--   • audit_log & day_closes = APPEND-ONLY (tak bisa diubah/dihapus siapa pun)
--   • TIDAK ADA policy DELETE di mana pun = tak ada data yang bisa dihapus permanen
-- Aturan per-peran (kasir tak lihat modal, koreksi kas owner-only) masih dijaga
-- aplikasi di tahap ini; dipindah ke server saat auth per-staf ditambahkan.

alter table users        enable row level security;
alter table settings     enable row level security;
alter table tickets      enable row level security;
alter table units        enable row level security;
alter table parts        enable row level security;
alter table cash_entries enable row level security;
alter table day_closes   enable row level security;
alter table corrections  enable row level security;
alter table audit_log    enable row level security;
alter table photos       enable row level security;

-- Tabel operasional: sesi toko boleh baca/tambah/ubah (tanpa hapus).
do $$
declare t text;
begin
  foreach t in array array['users','settings','tickets','units','parts','cash_entries','corrections','photos']
  loop
    execute format('create policy rw_select on %I for select to authenticated using (true)', t);
    execute format('create policy rw_insert on %I for insert to authenticated with check (true)', t);
    execute format('create policy rw_update on %I for update to authenticated using (true)', t);
  end loop;
end $$;

-- audit_log & day_closes: hanya baca + tambah = PERMANEN (append-only).
create policy ao_select_audit on audit_log  for select to authenticated using (true);
create policy ao_insert_audit on audit_log  for insert to authenticated with check (true);
create policy ao_select_close on day_closes for select to authenticated using (true);
create policy ao_insert_close on day_closes for insert to authenticated with check (true);

-- ============================================================
-- 3. VIEW PUBLIK (untuk fitur publik — diaktifkan nanti)
-- ============================================================
create or replace view public_catalog as
  select kode, brand, model, varian, kondisi, harga_jual
  from units where status = 'stok' and harga_jual > 0;

create or replace view public_ticket_status as
  select no_nota, brand, model, status, estimasi, biaya_jasa, dp, piutang, history
  from tickets;

-- Catatan: akses anon ke dua view ini diatur terpisah (grant select to anon)
-- saat fitur publik diaktifkan, dengan rate limiting di sisi Edge Function.
