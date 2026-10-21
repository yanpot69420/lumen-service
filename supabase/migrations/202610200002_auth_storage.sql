begin;
create or replace function public.auth_allow(p_key text,p_limit integer,p_seconds integer default 900) returns boolean
language plpgsql security definer set search_path='' as $$
declare n integer;
begin
  delete from private.auth_attempts where expires_at<now()-interval '1 day';
  insert into private.auth_attempts(key,attempts,expires_at) values(p_key,1,now()+make_interval(secs=>p_seconds))
    on conflict(key) do update set attempts=case when private.auth_attempts.expires_at<=now() then 1 else least(private.auth_attempts.attempts+1,100000) end,
      expires_at=case when private.auth_attempts.expires_at<=now() then now()+make_interval(secs=>p_seconds) else private.auth_attempts.expires_at end
    returning attempts into n;
  return n<=p_limit;
end $$;
create or replace function public.auth_lookup(p_username text) returns jsonb
language sql security definer set search_path='' as $$
  select to_jsonb(c)||to_jsonb(u) from public.users u join private.staff_credentials c on c.user_id=u.id where u.username=p_username
$$;
create or replace function public.auth_upgrade(p_user_id uuid,p_expected text,p_hash text) returns void
language sql security definer set search_path='' as $$
  update private.staff_credentials set pin_hash=p_hash,pin_ver=2 where user_id=p_user_id and pin_hash=p_expected and pin_ver=1
$$;
create or replace function public.bootstrap_store(p_store jsonb,p_users jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare p jsonb; owner_id uuid;
begin
  perform pg_advisory_xact_lock(73801946);
  if exists(select 1 from public.users) then raise exception 'Toko sudah di-setup'; end if;
  if jsonb_array_length(p_users)<>2 or (select count(*) from jsonb_array_elements(p_users) x where x->>'role'='owner')<>1 or (select count(*) from jsonb_array_elements(p_users) x where x->>'role'='headops')<>1 then raise exception 'Setup memerlukan Owner dan Head Ops'; end if;
  for p in select * from jsonb_array_elements(p_users) loop
    insert into public.users(id,name,username,role,active,has_recovery) values((p->>'id')::uuid,p->>'name',p->>'username',p->>'role',true,p->>'recovery_hash' is not null);
    insert into private.staff_credentials(user_id,pin_hash,pin_ver,salt,recovery_hash,recovery_salt) values((p->>'id')::uuid,p->>'pin_hash',2,p->>'salt',p->>'recovery_hash',p->>'recovery_salt');
    if p->>'role'='owner' then owner_id:=(p->>'id')::uuid; end if;
  end loop;
  insert into public.settings(key,value) values('storeName',p_store->>'name'),('storePhone',coalesce(p_store->>'phone',''));
  insert into public.audit_log(user_id,user_name,action,entity,entity_id,summary) select id,name,'setup','sistem','-','Setup awal: Owner dan Head Ops' from public.users where id=owner_id;
  return owner_id;
end $$;
create or replace function public.auth_recover(p_user_id uuid,p_expected text,p_hash text,p_salt text) returns void
language plpgsql security definer set search_path='' as $$
begin
  update private.staff_credentials set pin_hash=p_hash,salt=p_salt,pin_ver=2,recovery_hash=null,recovery_salt=null where user_id=p_user_id and recovery_hash=p_expected;
  if not found then raise exception 'Kode pemulihan sudah dipakai atau tidak valid'; end if;
  update public.users set has_recovery=false,revision=revision+1 where id=p_user_id and active;
  delete from auth.sessions where user_id=(select auth_id from public.users where id=p_user_id);
  insert into public.audit_log(user_id,user_name,action,entity,entity_id,summary) select id,name,'pulihkan-pin','pengguna',id::text,'PIN dipulihkan; kode sekali pakai dinonaktifkan' from public.users where id=p_user_id;
end $$;
create or replace function public.manage_staff(p_actor_auth uuid,p_target uuid,p_profile jsonb default null,p_credentials jsonb default null,p_session uuid default null) returns void
language plpgsql security definer set search_path='' as $$
declare actor public.users; target public.users;
begin
  select * into actor from public.users where auth_id=p_actor_auth and active and role='owner';
  if not found then raise exception 'Pengelolaan staf khusus Owner' using errcode='42501'; end if;
  if not exists(select 1 from auth.sessions where id=p_session and user_id=p_actor_auth) then raise exception 'Sesi Owner sudah berakhir' using errcode='42501'; end if;
  select * into target from public.users where id=p_target for update;
  if p_profile is not null then
    if target.id is null then
      if p_profile->>'role'<>all(array['headops','kasir','teknisi']) then raise exception 'Peran tidak valid'; end if;
      insert into public.users(id,name,username,role,active) values(p_target,p_profile->>'name',p_profile->>'username',p_profile->>'role',true);
    else
      if p_target=actor.id and p_profile->>'active'='false' then raise exception 'Owner tidak dapat menonaktifkan dirinya'; end if;
      update public.users set active=coalesce((p_profile->>'active')::boolean,active),revision=revision+1 where id=p_target;
    end if;
  end if;
  if p_credentials is not null then
    if p_credentials ? 'pin_hash' then
      insert into private.staff_credentials(user_id,pin_hash,salt,pin_ver) values(p_target,p_credentials->>'pin_hash',p_credentials->>'salt',2)
      on conflict(user_id) do update set pin_hash=excluded.pin_hash,salt=excluded.salt,pin_ver=2;
      delete from auth.sessions where user_id=(select auth_id from public.users where id=p_target);
    end if;
    if p_credentials ? 'recovery_hash' then
      update private.staff_credentials set recovery_hash=p_credentials->>'recovery_hash',recovery_salt=p_credentials->>'recovery_salt' where user_id=p_target;
      update public.users set has_recovery=true,revision=revision+1 where id=p_target;
    end if;
  end if;
  if p_profile->>'active'='false' then delete from auth.sessions where user_id=target.auth_id; end if;
  insert into public.audit_log(user_id,user_name,action,entity,entity_id,summary) values(actor.id,actor.name,'kelola-staf','pengguna',p_target::text,'Data akses staf diperbarui oleh Owner');
end $$;
revoke all on function public.auth_allow(text,integer,integer),public.auth_lookup(text),public.auth_upgrade(uuid,text,text),public.bootstrap_store(jsonb,jsonb),public.auth_recover(uuid,text,text,text),public.manage_staff(uuid,uuid,jsonb,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.auth_allow(text,integer,integer),public.auth_lookup(text),public.auth_upgrade(uuid,text,text),public.bootstrap_store(jsonb,jsonb),public.auth_recover(uuid,text,text,text),public.manage_staff(uuid,uuid,jsonb,jsonb,uuid) to service_role;

-- Private bucket: uploads belong to the authenticated staff; reads require a
-- committed, non-deleted metadata row and the correct business permission.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('photos','photos',false,5242880,array['image/jpeg','image/png','image/webp'])
  on conflict(id) do update set public=false,file_size_limit=5242880,allowed_mime_types=excluded.allowed_mime_types;
create or replace function private.can_read_photo(p_path text) returns boolean
language plpgsql security definer set search_path='' as $$
declare u public.users:=private.actor();
begin
  return exists(select 1 from public.photos p where path=p_path and not deleted and (ref_type<>'unit-ktp' or u.role in ('owner','headops')));
end $$;
create or replace function private.can_upload_photo(p_path text) returns boolean
language plpgsql security definer set search_path='' as $$
declare u public.users:=private.actor();
begin return split_part(p_path,'/',1)=u.auth_id::text and p_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$'; end $$;
drop policy if exists lumen_photo_read on storage.objects;
drop policy if exists lumen_photo_upload on storage.objects;
create policy lumen_photo_read on storage.objects for select to authenticated using(bucket_id='photos' and private.can_read_photo(name));
create policy lumen_photo_upload on storage.objects for insert to authenticated with check(bucket_id='photos' and private.can_upload_photo(name));
-- Helpers can be called through these policies; no private tables are exposed.
grant usage on schema private to authenticated;
grant execute on function private.can_read_photo(text),private.can_upload_photo(text) to authenticated;
commit;
