-- PENDING REVIEW ONLY. NOT APPLIED. No grants or RLS policies change.
-- Based on the installed function read on 2026-11-06, not migration 214.
-- Recheck the live fingerprint and test in disposable PostgreSQL before release.
begin;
DO $preflight$
begin
 if md5(regexp_replace(replace(pg_get_functiondef('public.rpc_retail_cleaning_submission_v1(uuid,uuid,text,jsonb)'::regprocedure),chr(13),''),'^[[:space:]]+|[[:space:]]+$','','g')) is distinct from '4402778bb456360244e1f4dc97a4ad90' then
  raise exception 'Cleaning finalizer differs from reviewed baseline; stop and reconcile';
 end if;
end;
$preflight$;
CREATE OR REPLACE FUNCTION public.rpc_retail_cleaning_submission_v1(p_actor uuid, p_auth uuid, p_action text, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare actor public.profiles%rowtype; c public.client_deep_cleaning_schedules%rowtype; s public.reliance_retail_store_master%rowtype; d public.client_deep_cleaning_submissions%rowtype; sid uuid; outcome text; reason text; evidence_prefix text; before_count int; after_count int;
begin
 select * into actor from public.profiles where id=p_actor and auth_user_id=p_auth and upper(status)='ACTIVE';
 if not found or upper(regexp_replace(coalesce(actor.role,''),'[^a-zA-Z]','','g')) not in ('FO','FIELDOFFICER') or coalesce((to_jsonb(actor)->>'is_active')::boolean,false)=false then raise exception using errcode='42501',message='Executing FO identity required'; end if;
 if p_action='begin' then sid:=(p_data->>'schedule_id')::uuid;
 else select schedule_id into sid from public.client_deep_cleaning_submissions where id=(p_data->>'submission_id')::uuid and submitted_by_user_id=p_auth; end if;
 if sid is null then raise exception using errcode='42501',message='Owned schedule required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('retail_unified_ownership',0));
 -- One lock order for creation, validation and finalization. Replays cannot create a second draft.
 select * into c from public.client_deep_cleaning_schedules where id=sid for update;
 select * into d from public.client_deep_cleaning_submissions where schedule_id=sid and submitted_by_user_id=p_auth for update;
 -- Reassignment starts a new executor-owned draft. Earlier evidence remains
 -- linked to its original author and cannot be reused to complete the new draft.
 outcome:=case when p_data->>'outcome'='Not Done' then 'Not Done' else coalesce(p_data->>'outcome','Completed') end;
 if d.status='submitted' then
  if p_action='finalize' and d.final_outcome is distinct from outcome then raise exception using errcode='40001',message='Completion outcome already fixed'; end if;
  if public.retail_cleaning_executor_v1(sid) is distinct from p_actor then raise exception using errcode='42501',message='Historical executor required'; end if;
  return to_jsonb(d);
 end if;
 if public.retail_cleaning_executor_v1(sid) is distinct from p_actor or c.status not in ('Planned','Scheduled') or c.scheduled_date>(now() at time zone 'Asia/Kolkata')::date then raise exception using errcode='42501',message='Current actionable schedule ownership required'; end if;
 select * into s from public.reliance_retail_store_master where id=c.retail_store_id;
 if p_data ? 'store_code' and upper(trim(p_data->>'store_code'))<>upper(trim(s.store_code)) or p_data ? 'deep_cleaning_date' and (p_data->>'deep_cleaning_date')::date<>c.scheduled_date then raise exception using errcode='22023',message='Schedule store/date mismatch'; end if;
 if d.id is not null and (d.retail_store_id<>s.id or d.deep_cleaning_date<>c.scheduled_date or upper(btrim(d.store_code)) is distinct from upper(btrim(s.store_code))) then raise exception using errcode='40001',message='Schedule changed after evidence draft'; end if;
 if p_action='begin' then
  if d.id is null then
   insert into public.client_deep_cleaning_submissions(business,retail_store_id,store_code,store_name,client_name,state,city,deep_cleaning_date,performed_by_type,submitted_by_user_id,submitted_by_employee_code,status,schedule_id,metadata)
   values('Reliance Retail',s.id,s.store_code,s.store_name,'Reliance Retail',s.state,to_jsonb(s)->>'city',c.scheduled_date,'vendor',p_auth,actor.employee_code,'draft',sid,jsonb_build_object('source','retail-cleaning.v1','executor_profile_id',p_actor,'schedule_id',sid,'evidence_format','paired_v1')) returning * into d;
  end if;
 elsif p_action='validate' then
  if d.id is null then raise exception using errcode='22023',message='Draft required'; end if;
 elsif p_action='finalize' then
  if d.id is null or d.status not in ('draft','uploading') or outcome not in ('Completed','Not Done') then raise exception using errcode='22023',message='Valid draft and outcome required'; end if;
  reason:=nullif(trim(p_data->>'not_done_reason'),'');
  if outcome='Not Done' and reason is null then raise exception using errcode='22023',message='Not Done reason required'; end if;
  evidence_prefix:='deep-cleaning/reliance-retail/'||coalesce(nullif(left(regexp_replace(regexp_replace(btrim(d.store_code),'[^a-zA-Z0-9._-]+','-','g'),'^-+|-+$','','g'),120),''),'store')||'/'||d.id::text||'/';
  if outcome='Completed' and exists(select 1 from public.client_deep_cleaning_uploads where submission_id=d.id and upload_status is distinct from 'uploaded') then raise exception using errcode='22023',message='Incomplete uploads must be completed or removed'; end if;
  if exists(select 1 from public.client_deep_cleaning_uploads u where u.submission_id=d.id and u.upload_status='uploaded' and (u.uploaded_by_user_id is distinct from p_auth or u.storage_bucket is distinct from 'client-deep-cleaning-uploads' or left(u.storage_path,length(evidence_prefix)) is distinct from evidence_prefix or u.file_size is null or u.file_size<1 or u.file_size>5242880 or not exists(select 1 from storage.objects o where o.bucket_id=u.storage_bucket and o.name=u.storage_path and (o.metadata->>'size')::bigint=u.file_size))) then raise exception using errcode='22023',message='Evidence ownership or storage mismatch'; end if;
  select count(*) filter(where upload_type='before'),count(*) filter(where upload_type='after') into before_count,after_count from public.client_deep_cleaning_uploads where submission_id=d.id and upload_status='uploaded';
  if outcome='Completed' and (before_count<1 or after_count<1) then raise exception using errcode='22023',message='Before and after evidence required'; end if;
  if outcome='Completed' and exists(select 1 from public.client_deep_cleaning_uploads where submission_id=d.id and upload_status='uploaded' and upload_type in ('before','after') group by metadata->>'pair_id' having metadata->>'pair_id' is null or count(*) filter(where upload_type='before')<>1 or count(*) filter(where upload_type='after')<>1) then raise exception using errcode='22023',message='Complete before/after pairs required'; end if;
  if outcome='Completed' and (
   select count(*) from public.client_deep_cleaning_uploads
   where submission_id=d.id and upload_status='uploaded'
    and upload_type in ('document','checklist')
    and mime_type in ('image/jpeg','image/png','image/webp','application/pdf')
  ) <> 1 then
   raise exception using errcode='22023',message='Exactly one supporting document required';
  end if;
  update public.client_deep_cleaning_submissions set status='submitted',submitted_at=now(),final_outcome=outcome,not_done_reason=reason where id=d.id returning * into d;
  update public.client_deep_cleaning_schedules set status=outcome,completed_at=now(),not_done_reason=reason,assigned_fo_profile_id=p_actor,updated_at=now(),metadata=coalesce(metadata,'{}')||jsonb_build_object('executor_profile_id',p_actor,'executor_auth_id',p_auth,'executor_employee_code',actor.employee_code,'dedicated_submission_id',d.id) where id=sid;
 else raise exception using errcode='22023',message='Unknown command'; end if;
 return to_jsonb(d);
end $function$;

-- Prevent an evidence deletion/update which started before finalization from
-- removing mandatory evidence after the schedule transaction commits.
create or replace function public.guard_scheduled_cleaning_terminal_evidence()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public
as $guard$
declare s public.client_deep_cleaning_submissions%rowtype;
begin
 select * into s from public.client_deep_cleaning_submissions
 where id=old.submission_id for update;
 if s.schedule_id is not null and s.status='submitted' then
  raise exception using errcode='23514',message='Submitted scheduled evidence is immutable';
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end;
$guard$;
revoke all on function public.guard_scheduled_cleaning_terminal_evidence() from public,anon,authenticated;
create trigger guard_scheduled_cleaning_terminal_evidence
before update or delete on public.client_deep_cleaning_uploads
for each row execute function public.guard_scheduled_cleaning_terminal_evidence();
-- A metadata-first delete alone is insufficient: an idempotency key can recreate
-- the same path while an old Storage DELETE is delayed. Permanently retire paths
-- transactionally, and serialize all evidence references to each physical path.
create table public.evidence_storage_retirements (
 bucket text not null check(bucket in ('client-deep-cleaning-uploads','training-evidence')),
 path text not null,
 evidence_id uuid not null,
 parent_id uuid not null,
 owner_id uuid not null,
 retired_at timestamptz not null default now(),
 primary key(bucket,path),
 unique(bucket,evidence_id)
);
alter table public.evidence_storage_retirements enable row level security;
revoke all on public.evidence_storage_retirements from public,anon,authenticated,service_role;
grant select on public.evidence_storage_retirements to service_role;

create function public.guard_evidence_storage_retirement()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public
as $retirement$
declare r jsonb; bucket_name text; object_path text; parent uuid; owner_uuid uuid;
 parent_status text; allowed_bucket text; referenced boolean;
begin
 -- Reference checks must see a retirement committed while waiting on the path
 -- lock. Backend/PostgREST mutations use READ COMMITTED; reject stale snapshots.
 if current_setting('transaction_isolation') <> 'read committed' then
  raise exception using errcode='25000',message='Evidence mutations require READ COMMITTED isolation';
 end if;
 r:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 if tg_table_name='client_deep_cleaning_uploads' then
  parent:=(r->>'submission_id')::uuid; owner_uuid:=(r->>'uploaded_by_user_id')::uuid;
  allowed_bucket:='client-deep-cleaning-uploads';
  select status into parent_status from public.client_deep_cleaning_submissions where id=parent for update;
  if parent_status is null or parent_status not in ('draft','uploading') then
   raise exception using errcode='23514',message='Non-draft evidence is immutable';
  end if;
 else
  parent:=(r->>'training_session_id')::uuid; owner_uuid:=(r->>'uploaded_by')::uuid;
  allowed_bucket:='training-evidence';
  select status::text into parent_status from public.training_sessions where id=parent for update;
  if parent_status is distinct from 'draft' then
   raise exception using errcode='23514',message='Non-draft evidence is immutable';
  end if;
 end if;
 bucket_name:=r->>'storage_bucket'; object_path:=r->>'storage_path';
 if bucket_name is distinct from allowed_bucket or object_path is null or owner_uuid is null then
  raise exception using errcode='23514',message='Invalid evidence storage identity';
 end if;
 if tg_op='UPDATE' and (new.storage_bucket is distinct from old.storage_bucket or new.storage_path is distinct from old.storage_path or new.id is distinct from old.id or
  (case when tg_table_name='client_deep_cleaning_uploads' then to_jsonb(old)->>'submission_id' else to_jsonb(old)->>'training_session_id' end) is distinct from parent::text or
  (case when tg_table_name='client_deep_cleaning_uploads' then to_jsonb(old)->>'uploaded_by_user_id' else to_jsonb(old)->>'uploaded_by' end) is distinct from owner_uuid::text) then
  raise exception using errcode='23514',message='Evidence storage identity is immutable';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(bucket_name||'/'||object_path,0));
 if tg_table_name='client_deep_cleaning_uploads' then
  select exists(select 1 from public.client_deep_cleaning_uploads where storage_bucket=bucket_name and storage_path=object_path and id<>(r->>'id')::uuid) into referenced;
 else
  select exists(select 1 from public.training_evidence where storage_bucket=bucket_name and storage_path=object_path and id<>(r->>'id')::uuid) into referenced;
 end if;
 if referenced then raise exception using errcode='23514',message='Evidence path has another reference; cleanup denied'; end if;
 if tg_op='DELETE' then
  insert into public.evidence_storage_retirements(bucket,path,evidence_id,parent_id,owner_id)
  values(bucket_name,object_path,(r->>'id')::uuid,parent,owner_uuid);
  return old;
 end if;
 if exists(select 1 from public.evidence_storage_retirements where bucket=bucket_name and (path=object_path or evidence_id=(r->>'id')::uuid)) then
  raise exception using errcode='23514',message='Evidence path was retired; use a new upload request';
 end if;
 return new;
end;
$retirement$;
revoke all on function public.guard_evidence_storage_retirement() from public,anon,authenticated,service_role;
create trigger guard_evidence_storage_retirement before insert or update or delete on public.client_deep_cleaning_uploads
for each row execute function public.guard_evidence_storage_retirement();
create trigger guard_evidence_storage_retirement before insert or update or delete on public.training_evidence
for each row execute function public.guard_evidence_storage_retirement();
commit;
