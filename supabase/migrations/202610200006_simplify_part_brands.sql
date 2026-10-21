-- New category labels plus legacy values so existing rows/queues remain valid.
begin;
alter table public.parts drop constraint if exists parts_brand_valid;
alter table public.parts add constraint parts_brand_valid check (
  brand is null or brand in (
    'Samsung','Apple','Vivo','Oppo','Xiaomi','Realme','Infinix','Tecno','Universal','Lainnya',
    'iPhone','vivo','OPPO','realme','TECNO','itel','ASUS','Nokia','Huawei','Honor','Sony',
    'Lenovo','Motorola','Google','OnePlus','Nothing','Advan','ZTE'
  )
);
commit;
