begin;
create or replace function public.read_public(p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; rows jsonb; t public.tickets; total bigint;
begin
  if p_action='profile' then
    select jsonb_object_agg(key,value) into result from public.settings where key in ('storeName','storeTagline','storeAddress','storePhone','storeHours');
    return coalesce(result,'{}');
  elsif p_action='catalog' then
    select coalesce(jsonb_agg(jsonb_build_object('kode',r.kode,'brand',r.brand,'model',r.model,'varian',r.varian,'kondisi',r.kondisi,'hargaJual',r.harga_jual,'garansiHari',r.garansi_hari,
      'photoPath',(select p.path from public.photos p where p.ref_type='unit' and p.ref_id=r.id and not p.deleted order by p.created_at,p.id limit 1))),'[]') into rows
      from (select * from public.units where status='stok' and harga_jual>0 and (p_payload->>'after' is null or kode>p_payload->>'after') order by kode limit 24) r;
    return jsonb_build_object('rows',rows,'next',case when jsonb_array_length(rows)=24 then rows->23->>'kode' else null end);
  elsif p_action='status' then
    if coalesce(p_payload->>'suffix','') !~ '^\d{4}$' or length(coalesce(p_payload->>'nota',''))>100 then return 'null'; end if;
    select * into t from public.tickets where no_nota=upper(trim(p_payload->>'nota')) and right(regexp_replace(phone,'\D','','g'),4)=p_payload->>'suffix' and length(regexp_replace(phone,'\D','','g'))>=8;
    if not found then return 'null'; end if;
    total:=(case when t.harga_final then t.biaya_jasa else t.estimasi end)+(select coalesce(sum((p->>'harga')::bigint*(p->>'qty')::int),0) from jsonb_array_elements(t.parts_used) p);
    return jsonb_build_object('noNota',t.no_nota,'brand',t.brand,'model',t.model,'status',t.status,'total',total,'dp',t.dp,
      'sisa',case when t.status='batal' then 0 when t.status='diambil' then t.piutang else greatest(0,total-t.dp) end,
      'history',(select coalesce(jsonb_agg(jsonb_build_object('status',h->>'status','at',h->'at')),'[]') from jsonb_array_elements(t.history) h));
  end if;
  raise exception 'Aksi publik tidak dikenal';
end $$;
revoke all on function public.read_public(text,jsonb) from public,anon,authenticated;
grant execute on function public.read_public(text,jsonb) to service_role;
commit;
