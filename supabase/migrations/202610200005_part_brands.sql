-- Add brand classification without rewriting existing parts or their revisions.
begin;
alter table public.parts add column if not exists brand text;
alter table public.parts add constraint parts_brand_valid check (
  brand is null or brand in (
    'Samsung','iPhone','vivo','OPPO','Xiaomi','realme','Infinix','TECNO','itel',
    'ASUS','Nokia','Huawei','Honor','Sony','Lenovo','Motorola','Google',
    'OnePlus','Nothing','Advan','ZTE','Universal','Lainnya'
  )
);
create index if not exists parts_brand_idx on public.parts(brand);
commit;
