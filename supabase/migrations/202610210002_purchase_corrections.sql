-- Atomic purchase corrections for Owner/HO without approval queue.
begin;
-- Direct purchase corrections for Owner/HO. Validate the entire graph before
-- allowing the narrowly scoped exception to the Owner-only cash policy.
create or replace function private.validate_purchase_corrections(changes jsonb, originals jsonb, actor public.users)
returns text[] language plpgsql security definer set search_path='' as $$
declare c jsonb; proposal jsonb; source jsonb; target jsonb; old_part jsonb; new_part jsonb; snap jsonb;
  b jsonb; a jsonb; expected_meta jsonb; refund_row jsonb; pending public.corrections;
  cash_id text; part_id text; ids text[]:=array[]::text[]; used_parts text[]:=array[]::text[];
  quantity bigint; old_quantity bigint; base_stock bigint; base_cost bigint; net_cost bigint; old_net bigint; refunds bigint;
  stock bigint; cost bigint; refund_count int; kind text;
begin
  for c in select x from jsonb_array_elements(changes) x where x->>'table'='corrections' and x->'row'->'after_data'->'purchase' is not null loop
    proposal:=c->'row'; cash_id:=proposal->>'entity_id';
    if actor.role not in ('owner','headops') or proposal->>'status'<>'approved' or proposal->>'entity'<>'cash'
      or coalesce(length(trim(proposal->>'reason')),0)=0 or originals->('corrections:'||(c->>'key')) is distinct from 'null'::jsonb
      or cash_id=any(ids) then raise exception 'Koreksi pembelian langsung hanya untuk Owner/HO dan harus berupa catatan baru'; end if;
    source:=nullif(originals->('cash_entries:'||cash_id),'null');
    select x->'row' into target from jsonb_array_elements(changes) x where x->>'table'='cash_entries' and x->>'key'=cash_id;
    if source is null or target is null or source->>'category'<>'restok_part' or source->>'type'<>'out'
      or source->>'ref_type'<>'part' or (source->>'voided')::boolean then raise exception 'Sumber koreksi pembelian tidak valid'; end if;
    if (source->>'locked')::boolean or exists(select 1 from public.day_closes where day_key=(source->>'day_key')::date) then raise exception 'Kas pembelian sudah ditutup'; end if;
    part_id:=source->>'ref_id'; old_part:=nullif(originals->('parts:'||part_id),'null');
    if part_id=any(used_parts) then raise exception 'Satu transaksi hanya boleh mengoreksi satu pembelian per barang'; end if;
    used_parts:=array_append(used_parts,part_id);
    select x->'row' into new_part from jsonb_array_elements(changes) x where x->>'table'='parts' and x->>'key'=part_id;
    if old_part is null or new_part is null or new_part-array['stok','harga_modal','revision'] is distinct from old_part-array['stok','harga_modal','revision'] then raise exception 'Koreksi pembelian harus menyertakan stok dan modal barang yang sama'; end if;
    select coalesce(sum(amount),0) into refunds from public.cash_entries where ref_type='part' and ref_id=part_id::uuid and type='in' and not voided and meta->>'purchaseRefundFor'=cash_id;
    old_net:=(source->>'amount')::bigint-refunds;
    snap:=source->'meta'->'purchase';
    if snap is not null then
      if (snap->>'partVersion')::bigint is distinct from (old_part->>'revision')::bigint
        or (snap->>'stockAfter')::bigint is distinct from (old_part->>'stok')::bigint
        or (snap->>'costAfter')::bigint is distinct from (old_part->>'harga_modal')::bigint
        or (snap->>'totalCost')::bigint is distinct from old_net then raise exception 'Stok atau pembelian sudah berubah; rekonsiliasi diperlukan'; end if;
      old_quantity:=(snap->>'qty')::bigint; base_stock:=(snap->>'stockBefore')::bigint; base_cost:=(snap->>'costBefore')::bigint;
    else
      if (select count(*) from public.cash_entries where ref_type='part' and ref_id=part_id::uuid and type='out' and category='restok_part')<>1
        or exists(select 1 from public.cash_entries where ref_type='part' and ref_id=part_id::uuid and category='jual_aksesoris')
        or exists(select 1 from public.tickets t cross join lateral jsonb_array_elements(t.parts_used) p where p->>'partId'=part_id)
        or (old_part->>'stok')::bigint<=0 or old_net<0 then raise exception 'Pembelian lama dengan pemakaian atau beberapa pembelian memerlukan rekonsiliasi'; end if;
      old_quantity:=(old_part->>'stok')::bigint; base_stock:=0; base_cost:=0;
    end if;
    a:=proposal->'after_data'->'purchase'; kind:=a->>'kind';
    quantity:=(a->>'qty')::bigint; net_cost:=(a->>'totalCost')::bigint;
    if quantity is null or quantity<=0 or net_cost is null or net_cost<0 or kind is null or kind not in ('record','refund') then raise exception 'Jumlah/total koreksi pembelian tidak valid'; end if;
    stock:=base_stock+quantity; cost:=round((base_stock::numeric*base_cost+net_cost)/stock);
    b:=jsonb_build_object('partId',part_id,'qty',old_quantity,'stock',(old_part->>'stok')::bigint,'unitCost',(old_part->>'harga_modal')::bigint,'totalCost',old_net,'kind',kind);
    if proposal->'before_data' is distinct from jsonb_build_object('amount',(source->>'amount')::bigint,'note',source->>'note','voided',0,'purchase',b)
      or a is distinct from jsonb_build_object('partId',part_id,'qty',quantity,'stock',stock,'unitCost',cost,'totalCost',net_cost,'kind',kind)
      or (new_part->>'stok')::bigint is distinct from stock or (new_part->>'harga_modal')::bigint is distinct from cost then raise exception 'Perhitungan modal atau snapshot koreksi pembelian tidak sesuai'; end if;
    expected_meta:=jsonb_build_object('qty',quantity,'stockBefore',base_stock,'costBefore',base_cost,'stockAfter',stock,'costAfter',cost,'totalCost',net_cost,'partVersion',(old_part->>'revision')::bigint+1);
    if target->'meta' is distinct from (coalesce(nullif(source->'meta','null'),'{}')||jsonb_build_object('purchase',expected_meta)) then raise exception 'Snapshot pembelian tidak sesuai'; end if;
    if proposal->'after_data' is distinct from jsonb_build_object('amount',case when kind='record' then net_cost+refunds else (source->>'amount')::bigint end,'note',source->>'note','voided',0,'purchase',a)
      or (target->>'amount')::bigint is distinct from (proposal->'after_data'->>'amount')::bigint
      or target->>'note' is distinct from source->>'note' or (target->>'voided')::boolean then raise exception 'Nominal kas koreksi pembelian tidak sesuai'; end if;
    select count(*) into refund_count from jsonb_array_elements(changes) x where x->>'table'='cash_entries' and x->'row'->'meta'->>'purchaseRefundFor'=cash_id;
    if kind='refund' then
      if quantity<>old_quantity or net_cost>=old_net or refund_count<>1 then raise exception 'Pengembalian supplier harus mengurangi biaya dan mempertahankan jumlah pembelian'; end if;
      select x into refund_row from jsonb_array_elements(changes) x where x->>'table'='cash_entries' and x->'row'->'meta'->>'purchaseRefundFor'=cash_id;
      if originals->('cash_entries:'||(refund_row->>'key')) is distinct from 'null'::jsonb
        or refund_row->'row'->>'type'<>'in' or refund_row->'row'->>'category'<>'restok_part' or refund_row->'row'->>'ref_type'<>'part'
        or refund_row->'row'->>'ref_id'<>part_id or (refund_row->'row'->>'amount')::bigint<>old_net-net_cost
        or refund_row->'row'->'meta' is distinct from jsonb_build_object('purchaseRefundFor',cash_id) then raise exception 'Jurnal pengembalian supplier tidak sesuai'; end if;
    elsif refund_count<>0 then raise exception 'Koreksi pencatatan tidak membuat pengembalian uang'; end if;
    if stock=(old_part->>'stok')::bigint and cost=(old_part->>'harga_modal')::bigint and net_cost=old_net and quantity=old_quantity then raise exception 'Tidak ada perubahan pembelian'; end if;
    for pending in select * from public.corrections where entity_id=cash_id::uuid and status='pending' loop
      if not exists(select 1 from jsonb_array_elements(changes) x where x->>'table'='corrections' and x->>'key'=pending.id::text and x->'row'->>'status'='rejected') then raise exception 'Permintaan lama harus ditandai digantikan oleh koreksi pembelian'; end if;
    end loop;
    ids:=array_append(ids,cash_id);
  end loop;
  return ids;
end $$;
revoke all on function private.validate_purchase_corrections(jsonb,jsonb,public.users) from public,anon,authenticated;

create or replace function public.apply_changes(p_batch_id uuid,p_changes jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u public.users:=private.actor(); receipt private.applied_batches; c jsonb; r jsonb; old jsonb; old_rows jsonb:='{}';
  t text; k text; pk text; rev bigint; cols text; updates text; result jsonb:='[]'; item jsonb; original jsonb; part jsonb; parts jsonb;
  purchase_cash_ids text[]; purchase_change boolean;
  next_status text; delta numeric; used numeric; total numeric; paid numeric; previous_dp numeric;
begin
  perform pg_advisory_xact_lock(73801946);
  if jsonb_typeof(p_changes)<>'array' or jsonb_array_length(p_changes)=0 or jsonb_array_length(p_changes)>2000 then raise exception 'Ukuran transaksi tidak valid'; end if;
  select * into receipt from private.applied_batches where id=p_batch_id;
  if found then
    if receipt.actor_id<>u.id or receipt.fingerprint<>md5(p_changes::text) then raise exception 'Identitas transaksi sudah digunakan'; end if;
    return receipt.result;
  end if;
  if (select count(*) from jsonb_array_elements(p_changes))<>(select count(distinct (x->>'table',x->>'key')) from jsonb_array_elements(p_changes) x) then raise exception 'Baris transaksi duplikat'; end if;
  -- Validate all versions under the same lock before changing ANY table.
  for c in select * from jsonb_array_elements(p_changes) loop
    t:=c->>'table'; k:=c->>'key';
    if t<>all(array['settings','customers','tickets','units','parts','cash_entries','day_closes','corrections','audit_log','photos']) or t is null then raise exception 'Tabel tidak diizinkan'; end if;
    pk:=case t when 'settings' then 'key' when 'day_closes' then 'day_key' else 'id' end;
    execute format('select to_jsonb(r) from public.%I r where %I::text=$1 for update',t,pk) into old using k;
    if coalesce((old->>'revision')::bigint,0)<>coalesce((c->>'expected_version')::bigint,-1) then raise exception 'Konflik pada %/%; data lokal tetap disimpan untuk diperiksa',t,k using errcode='40001'; end if;
    old_rows:=jsonb_set(old_rows,array[t||':'||k],coalesce(old,'null'));
  end loop;
  purchase_cash_ids:=private.validate_purchase_corrections(p_changes,old_rows,u);
  -- Write the graph in FK order, not client order.
  for c in select x from jsonb_array_elements(p_changes) x order by array_position(array['settings','parts','units','customers','tickets','cash_entries','day_closes','corrections','audit_log','photos'],x->>'table') loop
    t:=c->>'table'; k:=c->>'key'; old:=nullif(old_rows->(t||':'||k),'null'); r:=nullif(c->'row','null');
    pk:=case t when 'settings' then 'key' when 'day_closes' then 'day_key' else 'id' end;
    if r is null then
      if t<>'photos' or old is null or u.role not in ('owner','headops') then raise exception 'Penghapusan tidak diizinkan'; end if;
      r:=old||'{"deleted":true}'::jsonb;
    end if;
    execute format('select to_jsonb(jsonb_populate_record(null::public.%I,$1))',t) into r using r;
    if r->>pk is distinct from k then raise exception 'Identitas baris berubah'; end if;
    if t in ('settings','day_closes') and u.role not in ('owner','headops') then raise exception 'Khusus Owner/Head Ops'; end if;
    if t='settings' and k<>all(array['storeName','storeTagline','storeAddress','storePhone','storeHours','notaFooter','waTemplates']) then raise exception 'Pengaturan perangkat tidak boleh dikirim'; end if;
    if t in ('audit_log','day_closes') and old is not null then raise exception 'Catatan permanen tidak dapat diubah'; end if;
    if t='customers' then
      if u.role='teknisi' then
        if old is not null or r->>'notes' is distinct from '' or r->'is_regular' is distinct from 'false'::jsonb
          or not exists(select 1 from jsonb_array_elements(p_changes) x
            where x->>'table'='tickets' and x->'row'->>'customer_id'=k
              and old_rows->('tickets:'||(x->>'key'))='null'::jsonb) then
          raise exception 'Teknisi hanya boleh membuat profil awal bersama nota baru';
        end if;
      elsif u.role not in ('owner','headops','kasir') then raise exception 'Tidak boleh mengubah pelanggan'; end if;
      if old is null then r:=r||jsonb_build_object('created_by',u.id);
      elsif old-array['name','phone','phone_normalized','notes','is_regular','updated_at','revision']
        is distinct from r-array['name','phone','phone_normalized','notes','is_regular','updated_at','revision'] then
        raise exception 'Identitas dan pembuat profil tidak dapat diubah';
      end if;
    end if;
    if t='units' then
      if (old is null or old->>'imei' is distinct from r->>'imei') and not private.valid_imei(r->>'imei') then raise exception 'IMEI harus 15 digit dan digit cek valid'; end if;
      if u.role='teknisi' then raise exception 'Teknisi tidak boleh menjual/membeli unit'; end if;
      if u.role='kasir' then
        if old is null or old->>'status'<>'stok' or r->>'status'<>'terjual' then raise exception 'Kasir hanya boleh menjual unit stok'; end if;
        r:=r||jsonb_build_object('harga_beli',old->'harga_beli','seller_name',old->'seller_name','seller_phone',old->'seller_phone');
        if (r-array['status','sold_at','sold_price','buyer_name','buyer_phone','garansi_hari','revision']) is distinct from (old-array['status','sold_at','sold_price','buyer_name','buyer_phone','garansi_hari','revision']) then raise exception 'Data pembelian unit tidak boleh diubah Kasir'; end if;
      end if;
      if old is null then r:=r||jsonb_build_object('created_by',u.id); end if;
      if (r->>'harga_beli')::bigint<0 or (r->>'harga_jual')::bigint<0 or (r->>'garansi_hari')::int<0 then raise exception 'Harga/garansi unit tidak valid'; end if;
    end if;
    if t='parts' then
      if old is not null and old->'harga_modal' is distinct from r->'harga_modal' and not exists(select 1 from jsonb_array_elements(p_changes) x where x->>'table'='cash_entries' and x->'row'->>'ref_id'=k and ((x->>'key'=any(purchase_cash_ids)) or (old_rows->('cash_entries:'||(x->>'key'))='null'::jsonb and x->'row'->>'type'='out' and x->'row'->>'category'='restok_part' and x->'row'->'meta'->'purchase' is not null))) then raise exception 'Perubahan modal harus melalui Restok atau Koreksi Pembelian'; end if;
      if u.role not in ('owner','headops') then
        if old is null then raise exception 'Tidak boleh membuat item stok'; end if;
        r:=r||jsonb_build_object('harga_modal',old->'harga_modal');
        if r-array['stok','revision'] is distinct from old-array['stok','revision'] then raise exception 'Hanya jumlah stok yang dapat berubah'; end if;
      end if;
      if (r->>'stok')::bigint<0 or (r->>'harga_modal')::bigint<0 or (r->>'harga_jual')::bigint<0 or (r->>'min_stok')::bigint<0 then raise exception 'Stok/harga part tidak valid'; end if;
    end if;
    if t='tickets' then
      if old is not null and old->'customer_id' is distinct from r->'customer_id' then
        raise exception 'Pelanggan pada nota yang sudah dibuat tidak dapat diganti';
      end if;
      if r->>'customer_id' is not null and not exists(select 1 from public.customers where id=(r->>'customer_id')::uuid) then
        raise exception 'Profil pelanggan tidak ditemukan';
      end if;
      next_status:=r->>'status';
      if old is null then
        if next_status<>'masuk' then raise exception 'Nota baru harus berstatus masuk'; end if;
        if r->>'garansi_dari' is not null and not exists(
          select 1 from public.tickets source where source.id=(r->>'garansi_dari')::uuid
            and source.status='diambil' and source.garansi_dari is null
        ) then raise exception 'Garansi harus merujuk nota asli yang sudah diambil'; end if;
        r:=r||jsonb_build_object('created_by',u.id);
      elsif old->>'status'<>next_status then
        if old->>'status' in ('diambil','batal') or not ((old->>'status'='masuk' and next_status='dicek') or (old->>'status'='dicek' and next_status='konfirmasi') or (old->>'status'='dicek' and next_status='dikerjakan' and private.has_confirmed_work_history(old,r)) or (old->>'status'='konfirmasi' and next_status='dikerjakan') or (old->>'status'='dikerjakan' and next_status='selesai') or (old->>'status'='selesai' and next_status='diambil') or next_status='batal') then raise exception 'Transisi status servis tidak valid'; end if;
      end if;
      if old is not null and r-array['customer_name','phone','brand','model','keluhan','kelengkapan','biaya_jasa','harga_final','status','history','parts_used','dp','piutang','updated_at','revision'] is distinct from old-array['customer_name','phone','brand','model','keluhan','kelengkapan','biaya_jasa','harga_final','status','history','parts_used','dp','piutang','updated_at','revision'] then raise exception 'Identitas dan estimasi awal nota tidak dapat diubah'; end if;
      if old->>'status' in ('diambil','batal') and r-array['customer_name','phone','brand','model','keluhan','kelengkapan','dp','piutang','updated_at','revision'] is distinct from old-array['customer_name','phone','brand','model','keluhan','kelengkapan','dp','piutang','updated_at','revision'] then raise exception 'Harga/status nota yang sudah ditutup tidak dapat diubah'; end if;
      if u.role='teknisi' and (next_status in ('diambil','batal') or (r->>'dp')::bigint>0 and old is null) then raise exception 'Teknisi tidak boleh menerima pembayaran/pembatalan'; end if;
      if old is not null and old->>'created_by' is distinct from r->>'created_by' then raise exception 'Pembuat nota tidak dapat diubah'; end if;
      parts:='[]';
      for item in select * from jsonb_array_elements(r->'parts_used') loop
        if (item->>'qty')::int<=0 or (item->>'harga')::bigint<0 then raise exception 'Jumlah/harga part tidak valid'; end if;
        select to_jsonb(p) into part from public.parts p where id=(item->>'partId')::uuid;
        if part is null then raise exception 'Part tidak ditemukan'; end if;
        select x into original from jsonb_array_elements(coalesce(old->'parts_used','[]')) x
          where (item->>'id' is not null and x->>'id'=item->>'id') or (item->>'id' is null and x-'modal'=item-'modal') limit 1;
        if original is not null and original-'modal' is distinct from item-'modal' then raise exception 'Part terpakai harus dibatalkan lalu ditambahkan kembali'; end if;
        item:=item||jsonb_build_object('modal',coalesce(original->'modal',part->'harga_modal'));
        if original is null and u.role not in ('owner','headops') and item->'harga'<>part->'harga_jual' then raise exception 'Harga part berbeda dari stok'; end if;
        parts:=parts||jsonb_build_array(item);
      end loop;
      r:=r||jsonb_build_object('parts_used',parts);
      if (r->>'estimasi')::bigint<0 or (r->>'biaya_jasa')::bigint<0 or (r->>'dp')::bigint<0 or (r->>'piutang')::bigint<0 then raise exception 'Nominal servis tidak valid'; end if;
    end if;
    if t='cash_entries' then
      purchase_change:=k=any(purchase_cash_ids);
      if u.role='teknisi' then raise exception 'Teknisi tidak memiliki akses kas'; end if;
      if old->>'category'='retur_unit' and (r->>'voided')::boolean then
        raise exception 'Retur unit tidak dapat dibatalkan melalui koreksi kas';
      end if;
      if old is null then
        if r->'meta'->>'purchaseRefundFor' is not null and not (r->'meta'->>'purchaseRefundFor'=any(purchase_cash_ids)) then raise exception 'Pengembalian supplier wajib menyertakan koreksi pembelian'; end if;
        if r->'meta'->'purchase' is not null then
          if r->>'category'<>'restok_part' or r->>'type'<>'out' or r->>'ref_type'<>'part' then raise exception 'Snapshot pembelian hanya untuk pembelian sparepart'; end if;
          original:=nullif(old_rows->('parts:'||(r->>'ref_id')),'null');
          select to_jsonb(p) into part from public.parts p where id=(r->>'ref_id')::uuid;
          if part is null or not exists(select 1 from jsonb_array_elements(p_changes) x where x->>'table'='parts' and x->>'key'=r->>'ref_id') then raise exception 'Pembelian harus menyertakan perubahan stok'; end if;
          delta:=(part->>'stok')::bigint-coalesce((original->>'stok')::bigint,0);
          total:=round((coalesce((original->>'stok')::numeric,0)*coalesce((original->>'harga_modal')::numeric,0)+(r->>'amount')::numeric)/(part->>'stok')::numeric);
          if (select count(*) from jsonb_array_elements(p_changes) x where x->>'table'='cash_entries' and x->'row'->>'ref_id'=r->>'ref_id' and x->'row'->'meta'->'purchase' is not null and old_rows->('cash_entries:'||(x->>'key'))='null'::jsonb)<>1 then raise exception 'Satu pembelian harus memiliki satu jurnal pembayaran'; end if;
          if delta<=0 or (part->>'harga_modal')::bigint<>total then raise exception 'Modal pembelian tidak sesuai jumlah dan total pembayaran'; end if;
          r:=r||jsonb_build_object('meta',coalesce(nullif(r->'meta','null'),'{}')||jsonb_build_object('purchase',jsonb_build_object('qty',delta,'stockBefore',coalesce((original->>'stok')::bigint,0),'costBefore',coalesce((original->>'harga_modal')::bigint,0),'stockAfter',(part->>'stok')::bigint,'costAfter',total,'totalCost',(r->>'amount')::bigint,'partVersion',(part->>'revision')::bigint)));
        end if;
        if r->>'by_user'<>u.id::text then raise exception 'Masuk sebagai staf pembuat transaksi untuk mengirim antrean ini'; end if;
        if (r->>'amount')::bigint<0 or ((r->>'amount')::bigint=0 and not (
          r->>'category'='retur_unit' and r->>'type'='out' and r->>'ref_type'='unit'
          and exists(select 1 from jsonb_array_elements(p_changes) x where x->>'table'='units'
            and x->>'key'=r->>'ref_id' and x->'row'->>'status'='stok'
            and old_rows->('units:'||(x->>'key'))->>'status'='terjual')
        )) or r->>'category'<>all(array['servis','jual_unit','retur_unit','jual_aksesoris','beli_unit','restok_part','operasional','prive','modal_masuk','lainnya']) then raise exception 'Transaksi kas tidak valid'; end if;
        if (r->>'day_key')::date<>((r->>'at')::timestamptz at time zone 'Asia/Makassar')::date then raise exception 'Tanggal kas harus mengikuti zona waktu toko'; end if;
        if exists(select 1 from public.day_closes where day_key=(r->>'day_key')::date) then raise exception 'Kas tanggal ini sudah ditutup'; end if;
        if u.role='kasir' and not ((r->>'type'='in' and r->>'category' in ('servis','jual_unit','jual_aksesoris')) or (r->>'type'='out' and r->>'category'='servis')) then raise exception 'Kategori kas tidak diizinkan untuk Kasir'; end if;
        r:=r||jsonb_build_object('by_user',u.id,'by_name',u.name,'locked',false,'voided',false);
        if r->>'category'='jual_unit' then
          select harga_beli into total from public.units where id=(r->>'ref_id')::uuid;
          if total is null then raise exception 'Unit penjualan tidak ditemukan'; end if;
          r:=r||jsonb_build_object('meta',coalesce(nullif(r->'meta','null'),'{}')||jsonb_build_object('modal',total));
        elsif r->>'category'='retur_unit' then
          original:=old_rows->('units:'||(r->>'ref_id'));
          if r->>'type'<>'out' or r->>'ref_type'<>'unit' or original->>'status' is distinct from 'terjual'
            or not exists(select 1 from jsonb_array_elements(p_changes) x where x->>'table'='units'
              and x->>'key'=r->>'ref_id' and x->'row'->>'status'='stok') then
            raise exception 'Retur harus menyertakan unit terjual yang kembali ke stok';
          end if;
          if (r->>'amount')::bigint>coalesce((original->>'sold_price')::bigint,0) then raise exception 'Refund melebihi harga jual'; end if;
          r:=r||jsonb_build_object('meta',coalesce(nullif(r->'meta','null'),'{}')||jsonb_build_object('modal',(original->>'harga_beli')::bigint));
        elsif r->>'category'='jual_aksesoris' then
          select harga_modal into total from public.parts where id=(r->>'ref_id')::uuid;
          if total is null or coalesce((r->'meta'->>'qty')::int,0)<=0 then raise exception 'Part penjualan tidak valid'; end if;
          r:=r||jsonb_build_object('meta',coalesce(nullif(r->'meta','null'),'{}')||jsonb_build_object('modal',total*(r->'meta'->>'qty')::int));
        end if;
      elsif old-array['locked','revision'] = r-array['locked','revision'] and (r->>'locked')::boolean then
        if u.role not in ('owner','headops') or not exists(select 1 from jsonb_array_elements(p_changes) x where x->>'table'='day_closes' and x->'row'->>'day_key'=r->>'day_key') then raise exception 'Penguncian kas harus melalui tutup kas'; end if;
      else
        if (old->'meta'->'purchase' is not null or old->'meta'->>'purchaseRefundFor' is not null) and not purchase_change then raise exception 'Gunakan Koreksi Pembelian untuk mengubah kas pembelian tertaut'; end if;
        if not purchase_change and (u.role<>'owner' or not exists(select 1 from jsonb_array_elements(p_changes) x where x->>'table'='corrections' and x->'row'->>'entity_id'=k and x->'row'->>'status'='approved' and (x->'row'->'after_data'->>'amount')::bigint=(r->>'amount')::bigint and x->'row'->'after_data'->>'note'=r->>'note' and (x->'row'->'after_data'->>'voided')::int=case when (r->>'voided')::boolean then 1 else 0 end)) then raise exception 'Perubahan kas wajib melalui koreksi Owner'; end if;
        if old-array['amount','note','voided','meta','revision'] is distinct from r-array['amount','note','voided','meta','revision'] then raise exception 'Koreksi tidak boleh mengubah referensi kas'; end if;
        if not purchase_change and r->'meta' is distinct from old->'meta' and not (old->>'category'='servis' and old->>'type'='in' and old->>'note' like 'DP servis %' and old->'meta'->>'paymentKind' is null and r->'meta'=(coalesce(nullif(old->'meta','null'),'{}')||'{"paymentKind":"dp"}'::jsonb)) then raise exception 'Snapshot metadata kas tidak boleh diubah'; end if;
      end if;
    end if;
    if t='day_closes' then r:=r||jsonb_build_object('closed_by',u.id,'closed_by_name',u.name); end if;
    if t='corrections' then
      if r->>'entity'<>'cash' or length(trim(r->>'reason'))=0 or (r->'before_data'->>'amount')::bigint<0 or (r->'after_data'->>'amount')::bigint<0 or r->'after_data'->>'voided'<>all(array['0','1']) then raise exception 'Koreksi kas tidak valid'; end if;
      if u.role='teknisi' then raise exception 'Teknisi tidak dapat mengajukan koreksi'; end if;
      if old is null then
        r:=r||jsonb_build_object('requested_by',u.id,'requested_by_name',u.name);
        if u.role<>'owner' and r->>'status'<>'pending' and not (r->>'entity_id'=any(purchase_cash_ids) and r->>'status'='approved' and r->'after_data'->'purchase' is not null) then raise exception 'Persetujuan khusus Owner'; end if;
        if u.role='kasir' and not exists(select 1 from public.cash_entries where id=(r->>'entity_id')::uuid and by_user=u.id) then raise exception 'Hanya transaksi sendiri'; end if;
      elsif (u.role<>'owner' and not (r->>'entity_id'=any(purchase_cash_ids) and r->>'status'='rejected')) or old->>'status'<>'pending' or r-array['status','decided_by','decided_by_name','decided_at','revision'] is distinct from old-array['status','decided_by','decided_by_name','decided_at','revision'] then raise exception 'Koreksi tidak dapat diubah'; end if;
      if r->>'status'<>'pending' then r:=r||jsonb_build_object('decided_by',u.id,'decided_by_name',u.name); end if;
    end if;
    if t='audit_log' then
      if r->>'user_id'<>u.id::text then raise exception 'Masuk sebagai staf pembuat antrean sebelum mengirim transaksi'; end if;
      r:=r||jsonb_build_object('user_id',u.id,'user_name',u.name,'at',now());
    end if;
    if t='photos' then
      if r->>'ref_type'='ticket' and not exists(select 1 from public.tickets where id=(r->>'ref_id')::uuid) then raise exception 'Nota foto tidak ditemukan'; end if;
      if r->>'ref_type' in ('unit','unit-ktp') and not exists(select 1 from public.units where id=(r->>'ref_id')::uuid) then raise exception 'Unit foto tidak ditemukan'; end if;
      if r->>'ref_type'='unit-ktp' and u.role not in ('owner','headops') then raise exception 'KTP khusus Owner/Head Ops'; end if;
      if old is null and r->>'path'<>u.auth_id::text||'/'||k||'.jpg' then raise exception 'Lokasi foto tidak sah'; end if;
      if old is not null and r-array['deleted','revision'] is distinct from old-array['deleted','revision'] then raise exception 'Foto bukti tidak dapat diganti'; end if;
    end if;
    rev:=coalesce((old->>'revision')::bigint,0)+1;
    r:=r||jsonb_build_object('revision',rev);
    select string_agg(format('%I',a.attname),','),string_agg(format('%I=excluded.%I',a.attname,a.attname),',') into cols,updates
      from pg_attribute a where a.attrelid=format('public.%I',t)::regclass and a.attnum>0 and not a.attisdropped;
    execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I,$1) on conflict (%I) do update set %s',t,cols,cols,t,pk,updates) using r;
    result:=result||jsonb_build_array(jsonb_build_object('table',t,'key',k,'revision',rev));
  end loop;
  -- Validate relationships after all rows exist; a failure rolls back the graph.
  for c in select * from jsonb_array_elements(p_changes) loop
    t:=c->>'table'; k:=c->>'key'; old:=nullif(old_rows->(t||':'||k),'null'); r:=c->'row';
    if t='units' and old is not null and old->>'status'='stok' and r->>'status'='terjual' then
      if (r->>'sold_price')::bigint<=0 then raise exception 'Harga jual harus positif'; end if;
      if not exists(select 1 from jsonb_array_elements(p_changes) x where x->>'table'='cash_entries' and x->'row'->>'ref_id'=k and x->'row'->>'category'='jual_unit' and x->'row'->>'type'='in' and (x->'row'->>'amount')::bigint=(r->>'sold_price')::bigint) then raise exception 'Penjualan unit harus menyertakan kas yang sesuai'; end if;
    end if;
    if t='units' and old is not null and old->>'status'='terjual' and r->>'status'='stok' then
      if (select count(*) from jsonb_array_elements(p_changes) x where x->>'table'='cash_entries'
        and x->'row'->>'ref_id'=k and x->'row'->>'ref_type'='unit' and x->'row'->>'category'='retur_unit'
        and x->'row'->>'type'='out' and old_rows->('cash_entries:'||(x->>'key'))='null'::jsonb)<>1 then
        raise exception 'Retur unit harus menyertakan satu catatan refund, termasuk refund nol';
      end if;
    end if;
    if t='units' and old is null then
      if not exists(select 1 from jsonb_array_elements(p_changes) x where x->>'table'='cash_entries' and x->'row'->>'ref_id'=k and x->'row'->>'category'='beli_unit' and x->'row'->>'type'='out' and (x->'row'->>'amount')::bigint=(r->>'harga_beli')::bigint) then raise exception 'Pembelian unit harus menyertakan kas keluar'; end if;
    end if;
    if t='parts' and old is not null and u.role not in ('owner','headops') then
      delta:=(old->>'stok')::bigint-(r->>'stok')::bigint; used:=0;
      for item in select * from jsonb_array_elements(p_changes) where value->>'table'='tickets' loop
        select coalesce(sum((p->>'qty')::int),0) into total from jsonb_array_elements(item->'row'->'parts_used') p where p->>'partId'=k;
        select coalesce(sum((p->>'qty')::int),0) into previous_dp from jsonb_array_elements(coalesce(old_rows->('tickets:'||(item->>'key'))->'parts_used','[]')) p where p->>'partId'=k;
        used:=used+total-previous_dp;
      end loop;
      select used+coalesce(sum((x->'row'->'meta'->>'qty')::int),0) into used from jsonb_array_elements(p_changes) x where x->>'table'='cash_entries' and x->'row'->>'category'='jual_aksesoris' and x->'row'->>'ref_id'=k;
      if delta<>used then raise exception 'Perubahan stok harus sesuai pemakaian/penjualan'; end if;
    end if;
    if t='tickets' then
      for item in select jsonb_build_object('id',p->>'partId') from jsonb_array_elements(coalesce(r->'parts_used','[]')||coalesce(old->'parts_used','[]')) p group by p->>'partId' loop
        select coalesce(sum((p->>'qty')::int),0) into used from jsonb_array_elements(coalesce(r->'parts_used','[]')) p where p->>'partId'=item->>'id';
        select coalesce(sum((p->>'qty')::int),0) into delta from jsonb_array_elements(coalesce(old->'parts_used','[]')) p where p->>'partId'=item->>'id';
        if used<>delta and not exists(select 1 from jsonb_array_elements(p_changes) x where x->>'table'='parts' and x->>'key'=item->>'id') then raise exception 'Part nota harus menyertakan perubahan stok'; end if;
      end loop;
      select case when harga_final then biaya_jasa else estimasi end+coalesce((select sum((p->>'harga')::bigint*(p->>'qty')::int) from jsonb_array_elements(parts_used) p),0) into total from public.tickets where id=k::uuid;
      select coalesce(sum(case when type='in' then amount else -amount end),0),coalesce(sum(case when type='in' and (meta->>'paymentKind'='dp' or (meta->>'paymentKind' is null and note like 'DP servis %')) then amount else 0 end),0) into paid,previous_dp from public.cash_entries where ref_id=k::uuid and category='servis' and not voided;
      if paid<0 then raise exception 'Refund melebihi penerimaan servis'; end if;
      if r->>'status'='diambil' then update public.tickets set piutang=greatest(0,total-paid),dp=previous_dp where id=k::uuid;
      elsif (r->>'dp')::bigint<>previous_dp then raise exception 'DP harus sesuai penerimaan kas'; end if;
    end if;
    if t='day_closes' then
      if (r->>'counted')::bigint<0 then raise exception 'Jumlah uang fisik tidak boleh negatif'; end if;
      select coalesce((select counted from public.day_closes where day_key<>k::date order by closed_at desc limit 1),0)
        +coalesce(sum(case when type='in' then amount else -amount end),0) into total
        from public.cash_entries where not voided and method='tunai'
          and at>coalesce((select closed_at from public.day_closes where day_key<>k::date order by closed_at desc limit 1),'-infinity'::timestamptz)
          and at<=(r->>'closed_at')::timestamptz;
      if total<>(r->>'expected')::bigint or (r->>'selisih')::bigint<>(r->>'counted')::bigint-total then raise exception 'Saldo tutup kas berbeda dari jurnal server'; end if;
    end if;
    if t='cash_entries' and old is null and u.role='kasir' then
      if r->>'category'='servis' and not exists(select 1 from jsonb_array_elements(p_changes) x where x->>'table'='tickets' and x->>'key'=r->>'ref_id') then raise exception 'Pembayaran harus menyertakan nota'; end if;
      if r->>'category'='jual_unit' and not exists(select 1 from jsonb_array_elements(p_changes) x where x->>'table'='units' and x->>'key'=r->>'ref_id' and x->'row'->>'status'='terjual') then raise exception 'Penjualan harus menyertakan unit'; end if;
      if r->>'category'='jual_aksesoris' and not exists(select 1 from jsonb_array_elements(p_changes) x where x->>'table'='parts' and x->>'key'=r->>'ref_id') then raise exception 'Penjualan harus menyertakan stok'; end if;
    end if;
  end loop;
  insert into public.audit_log(user_id,user_name,action,entity,entity_id,summary) values(u.id,u.name,'cloud-commit','sistem',p_batch_id::text,'Transaksi atomik: '||(select string_agg(x->>'table'||'/'||(x->>'key'),', ') from jsonb_array_elements(p_changes) x));
  insert into private.applied_batches(id,actor_id,fingerprint,result) values(p_batch_id,u.id,md5(p_changes::text),result);
  return result;
end $$;

revoke all on function public.apply_changes(uuid,jsonb) from public,anon;
grant execute on function public.apply_changes(uuid,jsonb) to authenticated;
commit;
