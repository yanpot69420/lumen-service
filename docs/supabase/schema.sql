-- Lumen Service — skema PostgreSQL untuk Supabase
-- ===============================================
-- Aplikasi saat ini berjalan local-first (IndexedDB di perangkat).
-- Jalankan skema ini di Supabase SQL Editor saat siap pindah ke
-- multi-perangkat (HP + PC konter berbagi data + owner pantau jarak jauh).
--
-- Langkah singkat:
--   1. Buat project di https://supabase.com (dibuat oleh owner sendiri).
--   2. SQL Editor → jalankan seluruh file ini.
--   3. Salin Project URL + anon key ke file .env aplikasi.
--   4. Minta pengembang mengaktifkan lapisan sinkronisasi.

create table users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  role text not null check (role in ('owner','headops','kasir','teknisi')),
  pin_hash text not null,
  salt text not null,
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
  amount bigint not null,
  note text not null default '',
  ref_type text,
  ref_id uuid,
  meta jsonb,
  by_user uuid not null references users(id),
  locked boolean not null default false,
  voided boolean not null default false
);
create index cash_day_idx on cash_entries(day_key);

create table day_closes (
  day_key date primary key,
  expected bigint not null,
  counted bigint not null,
  selisih bigint not null,
  note text not null default '',
  closed_by uuid not null references users(id),
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
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_by uuid references users(id),
  decided_at timestamptz
);

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  user_id uuid not null references users(id),
  action text not null,
  entity text not null,
  entity_id text not null,
  summary text not null
);
create index audit_at_idx on audit_log(at desc);

-- ============ Row Level Security ============
-- Prinsip: append-only untuk transaksi; UPDATE/DELETE kas hanya lewat
-- fungsi koreksi; audit_log tidak bisa diubah siapa pun.

alter table tickets enable row level security;
alter table units enable row level security;
alter table parts enable row level security;
alter table cash_entries enable row level security;
alter table day_closes enable row level security;
alter table corrections enable row level security;
alter table audit_log enable row level security;

-- Contoh kebijakan (sesuaikan dengan skema auth yang dipakai saat integrasi;
-- disarankan Supabase Auth + klaim role di JWT):
-- create policy "staff bisa baca-tulis tickets" on tickets
--   for all using (auth.role() = 'authenticated');
-- create policy "audit hanya insert" on audit_log
--   for insert with check (auth.role() = 'authenticated');
-- create policy "audit bisa dibaca" on audit_log
--   for select using (auth.role() = 'authenticated');
-- (Tidak ada policy UPDATE/DELETE untuk audit_log = tidak bisa diubah.)

-- Katalog publik: view tanpa harga modal, aman untuk anon key.
create view public_catalog as
  select kode, brand, model, varian, kondisi, harga_jual
  from units
  where status = 'stok' and harga_jual > 0;

create view public_ticket_status as
  select no_nota, brand, model, status, estimasi, biaya_jasa, dp, history
  from tickets;
