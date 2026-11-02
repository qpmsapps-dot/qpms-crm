-- REVIEWED PROPOSAL ONLY: no production execution by the preparation task.
-- Scope: legacy deep_cleaning paths/rows only. Training and other activity paths
-- keep their existing policies/triggers. Admin review uses the scoped server API.
-- Supabase-compatible installation: use existing delegated policy authority and
-- the existing TRIGGER privilege; never change roles, ownership or platform GUCs.
-- Configuration is NOT proof of authority. The actual CREATE POLICY/TRIGGER
-- statements below must succeed before the single COMMIT. Any error aborts
-- this transaction, including earlier helper functions and public-table guards.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

do $preflight$ begin
 if not exists(select 1 from storage.buckets where id='fo-activity-uploads' and public is false) then raise exception 'Private legacy FO bucket required';end if;
 if not exists(select 1 from pg_proc where oid=to_regprocedure('public.training_legacy_write_guard()') and md5(replace(prosrc,E'\r\n',E'\n'))='708d133bfea8906bf76ce0a863d12d7b') then raise exception 'Exported Training guard drift; stop without replacing it';end if;
 if not has_schema_privilege(current_user,'public','CREATE') then raise exception 'Existing public CREATE privilege required; no privilege escalation is performed';end if;
 if not has_table_privilege(current_user,'storage.objects','TRIGGER') then raise exception 'Existing storage.objects TRIGGER privilege required; no privilege escalation is performed';end if;
 -- Do not require native ownership or supautils.version. Supabase may delegate
 -- policy management without either. PostgreSQL/platform checks on the actual
 -- CREATE POLICY and CREATE TRIGGER statements remain the final authority.
 if (select count(*) from pg_policies where schemaname='storage' and tablename='objects' and permissive='PERMISSIVE' and roles=array['authenticated']::name[] and policyname in ('fo_activity_uploads_authenticated_read','fo_activity_uploads_authenticated_insert','fo_activity_uploads_authenticated_update','fo_activity_uploads_authenticated_delete'))<>4 then raise exception 'Exported legacy policy set drift; review current catalog before installation';end if;
end;$preflight$;

-- No business rows, bucket settings, existing policies or triggers are changed.
create function public.retail_cleaning_object_access(p_bucket text,p_name text,p_write boolean)
returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare s public.fo_activity_submissions%rowtype; owner_count integer;
begin
 if p_bucket is distinct from 'fo-activity-uploads' or split_part(p_name,'/',3) is distinct from 'deep_cleaning' then return true;end if;
 if p_name is null or array_length(string_to_array(p_name,'/'),1)<>5 or p_name ~ E'(^|/)(\\.\\.?)(/|$)|\\\\' then return false;end if;
 select * into s from public.fo_activity_submissions where id::text=split_part(p_name,'/',4);
 if not found or s.activity_type is distinct from 'deep_cleaning' or nullif(s.employee_code,'') is null
    or nullif(s.fo_user_id,'') is distinct from s.employee_code
    or split_part(p_name,'/',1) is distinct from s.employee_code
    or split_part(p_name,'/',2) is distinct from s.metadata->>'activity_date' then return false;end if;
 select count(*) into owner_count from public.profiles p where p.auth_user_id is not null
 and p.is_active is true and upper(coalesce(p.status,'Active'))='ACTIVE' and p.employee_code=s.employee_code;
 -- Historical owners include Operations Manager/Admin as well as FO. Preserve
 -- their own-record access; existing permissive authoring policies remain an
 -- additional upper bound. This restrictive helper grants no new role rights.
 if owner_count<>1 or not exists(select 1 from public.profiles p where p.auth_user_id=auth.uid()
 and p.is_active is true and upper(coalesce(p.status,'Active'))='ACTIVE' and p.employee_code=s.employee_code) then return false;end if;
 if not p_write then return true;end if;
 return (s.status='draft' or s.status='submitted' and s.metadata->>'pending_images'='true')
 and not exists(select 1 from public.client_deep_cleaning_schedules plan where plan.metadata->'retail_fo_completion'->>'source_id'=s.id::text);
end;$$;

-- A final submission requires real objects belonging to this source, not just
-- client-supplied before/after flags. The existing two-phase mobile upload is
-- supported: submitted + pending_images=true remains writable until finalized.
create function public.retail_cleaning_has_stored_pair(p_source uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from storage.buckets where id='fo-activity-uploads' and public is false)
 and not exists(
  select 1 from (values('deep_cleaning_before'),('deep_cleaning_after')) required(kind)
  where not exists(
   select 1 from public.fo_activity_submissions s join public.fo_activity_uploads u on u.submission_id=s.id
   join storage.objects o on o.bucket_id=u.storage_bucket and o.name=substring(u.file_url from length('fo-activity-uploads/')+1)
   where s.id=p_source and u.activity_type='deep_cleaning' and u.upload_role=required.kind
    and u.employee_code=s.employee_code and u.fo_user_id=s.fo_user_id and u.store_code is not distinct from s.store_code
    and u.storage_bucket='fo-activity-uploads' and u.uploaded_at is not null
    and u.file_type in ('image/jpeg','image/png','image/webp') and u.file_size between 1 and 5242880
    and starts_with(u.file_url,'fo-activity-uploads/'||s.employee_code||'/'||(s.metadata->>'activity_date')||'/deep_cleaning/'||s.id::text||'/')
    and u.file_url !~ E'(^|/)(\\.\\.?)(/|$)|\\\\'
    and coalesce(o.metadata->>'size','')=u.file_size::text
  )
 );
$$;

create function public.retail_cleaning_legacy_guard() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.fo_activity_submissions%rowtype; actor_ok boolean; candidate jsonb;
begin
 if tg_op='DELETE' then candidate:=to_jsonb(old);else candidate:=to_jsonb(new);end if;
 if candidate->>'activity_type' is distinct from 'deep_cleaning'
 and (tg_op='INSERT' or to_jsonb(old)->>'activity_type' is distinct from 'deep_cleaning') then
  if tg_op='DELETE' then return old;else return new;end if;
 end if;
 if tg_table_name='fo_activity_submissions' then
  if tg_op<>'INSERT' then
   if old.activity_type is distinct from 'deep_cleaning' or (tg_op='UPDATE' and new.activity_type is distinct from old.activity_type) then raise exception using errcode='42501',message='Cleaning identity cannot be relabelled';end if;
   if (old.status='submitted' and old.metadata->>'pending_images'='false') or exists(select 1 from public.client_deep_cleaning_schedules plan where plan.metadata->'retail_fo_completion'->>'source_id'=old.id::text) then raise exception using errcode='42501',message='Submitted or linked cleaning evidence is immutable';end if;
   if tg_op='UPDATE' and (to_jsonb(new)-array['status','metadata','submitted_at','updated_at','remarks']) is distinct from (to_jsonb(old)-array['status','metadata','submitted_at','updated_at','remarks']) then raise exception using errcode='42501',message='Cleaning source identity is immutable';end if;
   if tg_op='UPDATE' and (new.metadata-array['pending_images','last_mobile_activity_submit_at']) is distinct from (old.metadata-array['pending_images','last_mobile_activity_submit_at']) then raise exception using errcode='42501',message='Cleaning source metadata identity is immutable';end if;
  end if;
  if tg_op='DELETE' then s:=old;else s:=new;end if;
 else
  if tg_op='UPDATE' and (old.activity_type is distinct from new.activity_type or old.submission_id is distinct from new.submission_id) then raise exception using errcode='42501',message='Cleaning upload cannot be relabelled';end if;
  select * into s from public.fo_activity_submissions where id=(candidate->>'submission_id')::uuid for update;
  if not found or s.activity_type is distinct from 'deep_cleaning' then raise exception using errcode='42501',message='Cleaning source required';end if;
  if (s.status='draft' or s.status='submitted' and s.metadata->>'pending_images'='true') is not true or exists(select 1 from public.client_deep_cleaning_schedules plan where plan.metadata->'retail_fo_completion'->>'source_id'=s.id::text) then raise exception using errcode='42501',message='Submitted or linked cleaning evidence is immutable';end if;
  if candidate->>'employee_code' is distinct from s.employee_code or candidate->>'fo_user_id' is distinct from s.fo_user_id or candidate->>'store_code' is distinct from s.store_code
     or candidate->>'storage_bucket' is distinct from 'fo-activity-uploads'
     or not starts_with(coalesce(candidate->>'file_url',''),'fo-activity-uploads/'||s.employee_code||'/'||(s.metadata->>'activity_date')||'/deep_cleaning/'||s.id::text||'/') then raise exception using errcode='42501',message='Cleaning upload identity/path mismatch';end if;
 end if;
 actor_ok:=(select count(*) from public.profiles p where p.auth_user_id is not null and p.is_active is true and upper(coalesce(p.status,'Active'))='ACTIVE' and p.employee_code=s.employee_code)=1
 and exists(select 1 from public.profiles p where p.auth_user_id=auth.uid() and p.is_active is true and upper(coalesce(p.status,'Active'))='ACTIVE' and p.employee_code=s.employee_code);
 if auth.role()='authenticated' and (not actor_ok or nullif(s.fo_user_id,'') is distinct from s.employee_code) then raise exception using errcode='42501',message='Cleaning owner required';end if;
 if tg_table_name='fo_activity_submissions' and tg_op<>'DELETE' then
  if candidate->>'status'='submitted' and candidate->'metadata'->>'pending_images'='false' and not public.retail_cleaning_has_stored_pair((candidate->>'id')::uuid) then raise exception using errcode='42501',message='Stored before/after evidence required before final submission';end if;
 end if;
 if tg_op='DELETE' then return old;else return new;end if;
end;$$;

-- Serialize physical object writes with submission finalization. RLS alone can
-- race a status change; locking the source row closes that window. Existing
-- unrelated Storage triggers are neither replaced nor disabled.
create function public.retail_cleaning_storage_guard() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare item jsonb;s public.fo_activity_submissions%rowtype;items jsonb[];
begin
 if tg_op='INSERT' then items:=array[to_jsonb(new)];elsif tg_op='DELETE' then items:=array[to_jsonb(old)];else items:=array[to_jsonb(old),to_jsonb(new)];end if;
 foreach item in array items loop
  if item->>'bucket_id'='fo-activity-uploads' and split_part(item->>'name','/',3)='deep_cleaning' then
   select * into s from public.fo_activity_submissions where id::text=split_part(item->>'name','/',4) for update;
   if not found then raise exception using errcode='42501',message='Cleaning source required';end if;
   if (s.status='draft' or s.status='submitted' and s.metadata->>'pending_images'='true') is not true or exists(select 1 from public.client_deep_cleaning_schedules plan where plan.metadata->'retail_fo_completion'->>'source_id'=s.id::text) then raise exception using errcode='42501',message='Submitted or linked cleaning object is immutable';end if;
   if auth.role() is distinct from 'service_role' and not public.retail_cleaning_object_access(item->>'bucket_id',item->>'name',true) then raise exception using errcode='42501',message='Cleaning owner/path required';end if;
  end if;
 end loop;
 if tg_op='DELETE' then return old;else return new;end if;
end;$$;

revoke all on function public.retail_cleaning_object_access(text,text,boolean),public.retail_cleaning_has_stored_pair(uuid),public.retail_cleaning_legacy_guard(),public.retail_cleaning_storage_guard() from public,anon,authenticated,service_role;
grant execute on function public.retail_cleaning_object_access(text,text,boolean) to anon,authenticated;

create policy retail_cleaning_private_read on storage.objects as restrictive for select to public
 using(public.retail_cleaning_object_access(bucket_id,name,false));
create policy retail_cleaning_owned_insert on storage.objects as restrictive for insert to public
 with check(public.retail_cleaning_object_access(bucket_id,name,true));
create policy retail_cleaning_draft_update on storage.objects as restrictive for update to public
 using(public.retail_cleaning_object_access(bucket_id,name,true)) with check(public.retail_cleaning_object_access(bucket_id,name,true));
create policy retail_cleaning_draft_delete on storage.objects as restrictive for delete to public
 using(public.retail_cleaning_object_access(bucket_id,name,true));

create trigger trg_retail_cleaning_submission_guard before insert or update or delete on public.fo_activity_submissions for each row execute function public.retail_cleaning_legacy_guard();
create trigger trg_retail_cleaning_upload_guard before insert or update or delete on public.fo_activity_uploads for each row execute function public.retail_cleaning_legacy_guard();
create trigger trg_retail_cleaning_storage_guard before insert or update or delete on storage.objects for each row execute function public.retail_cleaning_storage_guard();

-- Success is reported only after all actual DDL and these assertions succeed.
do $postinstall$ begin
 if (select count(*) from pg_policies where schemaname='storage' and tablename='objects' and permissive='RESTRICTIVE' and policyname in ('retail_cleaning_private_read','retail_cleaning_owned_insert','retail_cleaning_draft_update','retail_cleaning_draft_delete'))<>4 then raise exception 'All four restrictive storage policies are required; rollback installation';end if;
 if (select count(*) from pg_trigger where not tgisinternal and (tgrelid='public.fo_activity_submissions'::regclass and tgname='trg_retail_cleaning_submission_guard' or tgrelid='public.fo_activity_uploads'::regclass and tgname='trg_retail_cleaning_upload_guard' or tgrelid='storage.objects'::regclass and tgname='trg_retail_cleaning_storage_guard'))<>3 then raise exception 'All three additive guards are required; rollback installation';end if;
 if not exists(select 1 from pg_proc where oid=to_regprocedure('public.training_legacy_write_guard()') and md5(replace(prosrc,E'\r\n',E'\n'))='708d133bfea8906bf76ce0a863d12d7b') then raise exception 'Existing Training guard changed; rollback installation';end if;
 if not exists(select 1 from storage.buckets where id='fo-activity-uploads' and public is false) then raise exception 'Evidence bucket must remain private; rollback installation';end if;
end;$postinstall$;
commit;
