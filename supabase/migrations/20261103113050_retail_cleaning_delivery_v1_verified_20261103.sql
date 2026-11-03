-- APPLIED to QPMS CRM production 2026-11-03 as migration 20261103113050.
-- Exact DDL of the reviewed conditional proposal, with transaction-local review flag.
-- For new databases, rely on the migration runner's transaction.
-- Run verification/retail_cleaning_delivery_read_only.sql first; owner must compare
-- against the live canonical Reliance Store Master (which has no business/client_name columns).
-- installed definitions with PR #59. Never apply local 213/214 table foundations.
select set_config('qpms.cleaning_delivery_reviewed','yes',true);
do $$ begin
 if current_setting('qpms.cleaning_delivery_reviewed',true) is distinct from 'yes' then
  raise exception 'Owner review of installed schema, RLS, grants and completion triggers required';
 end if;
 if to_regclass('public.client_deep_cleaning_schedules') is null or to_regclass('public.client_deep_cleaning_submissions') is null then
  raise exception 'Existing canonical tables required';
 end if;
end $$;

alter table public.client_deep_cleaning_submissions add column if not exists schedule_id uuid references public.client_deep_cleaning_schedules(id);
alter table public.client_deep_cleaning_submissions add column if not exists final_outcome text;
alter table public.client_deep_cleaning_submissions add column if not exists not_done_reason text;
do $$ begin
 if exists(select 1 from pg_attribute where attrelid='public.client_deep_cleaning_submissions'::regclass and attname='schedule_id' and atttypid<>'uuid'::regtype and not attisdropped) then raise exception 'Installed schedule_id type differs; owner reconciliation required'; end if;
 if exists(select 1 from pg_index i where i.indrelid='public.client_deep_cleaning_submissions'::regclass and i.indisunique and i.indnkeyatts=1 and pg_get_indexdef(i.indexrelid,1,true)='schedule_id' and coalesce(pg_get_expr(i.indpred,i.indrelid),'') not ilike '%status%') then raise exception 'Installed one-draft-per-schedule index conflicts with reassignment; review 214, do not drop blindly'; end if;
 if not exists(select 1 from pg_constraint where conrelid='public.client_deep_cleaning_submissions'::regclass and contype='f' and conkey=array[(select attnum from pg_attribute where attrelid='public.client_deep_cleaning_submissions'::regclass and attname='schedule_id')]::smallint[] and confrelid='public.client_deep_cleaning_schedules'::regclass) then raise exception 'Installed schedule linkage FK missing or incompatible'; end if;
end $$;
-- Existing duplicate linked drafts must be reviewed, never deleted to force this index.
create unique index if not exists client_cleaning_schedule_actor_v1 on public.client_deep_cleaning_submissions(schedule_id,submitted_by_user_id) where schedule_id is not null;
create unique index if not exists client_cleaning_schedule_completed_v1 on public.client_deep_cleaning_submissions(schedule_id) where schedule_id is not null and status='submitted';
create unique index if not exists client_cleaning_upload_request_v1 on public.client_deep_cleaning_uploads(submission_id,(metadata->>'upload_request_id')) where metadata->>'upload_request_id' is not null;

create function public.retail_cleaning_executor_v1(p_schedule uuid) returns uuid
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare c public.client_deep_cleaning_schedules%rowtype; s public.reliance_retail_store_master%rowtype; f public.profiles%rowtype; owner_info jsonb; candidate uuid; geography text; fo_state text;
begin
 select * into c from public.client_deep_cleaning_schedules where id=p_schedule;
 if not found then return null; end if;
 if c.status in ('Completed','Not Done') then
  return coalesce((c.metadata->>'executor_profile_id')::uuid,c.assigned_fo_profile_id);
 end if;
 if c.status not in ('Planned','Scheduled') then return null; end if;
 select * into s from public.reliance_retail_store_master where id=c.retail_store_id;
 if upper(s.status) is distinct from 'ACTIVE' then return null; end if;
 geography:=case upper(s.state) when 'KN' then 'KA' else upper(s.state) end;
 if geography in ('TN','PY') then
  owner_info:=public.retail_unified_owner(s.id,now());
  if coalesce((owner_info->>'known')::boolean,false) is not true then return null; end if;
  candidate:=(owner_info->>'fo_profile_id')::uuid;
 else
  -- Explicit schedule or store assignment only. No state-wide FO fallback.
  candidate:=coalesce(c.assigned_fo_profile_id,s.assigned_fo_profile_id);
 end if;
 select * into f from public.profiles where id=candidate;
 fo_state:=case upper(f.state) when 'KN' then 'KA' when 'PY' then 'TN' else upper(f.state) end;
 if upper(f.status) is distinct from 'ACTIVE' or coalesce((to_jsonb(f)->>'is_active')::boolean,false)=false or upper(regexp_replace(coalesce(f.role,''),'[^a-zA-Z]','','g')) not in ('FO','FIELDOFFICER')
  or upper(regexp_replace(coalesce(f.business,''),'[^a-zA-Z]','','g')) not in ('RELIANCE','RELIANCERETAIL') or f.auth_user_id is null
  or geography not in ('TN','PY','KA','KL','TG','AP-1','AP-2') or fo_state is distinct from (case when geography='PY' then 'TN' else geography end) then return null; end if;
 return candidate;
end $$;

create function public.rpc_retail_cleaning_delivery_v1(p_actor uuid,p_auth uuid,p_stores uuid[],p_from date,p_to date,p_schedule uuid default null) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare actor public.profiles%rowtype; is_fo boolean; result jsonb;
begin
 select * into actor from public.profiles where id=p_actor and auth_user_id=p_auth and upper(status)='ACTIVE';
 if not found or coalesce((to_jsonb(actor)->>'is_active')::boolean,false)=false then raise exception using errcode='42501',message='Verified active identity required'; end if;
 is_fo:=upper(regexp_replace(coalesce(actor.role,''),'[^a-zA-Z]','','g')) in ('FO','FIELDOFFICER');
 if is_fo and upper(regexp_replace(coalesce(actor.business,''),'[^a-zA-Z]','','g')) not in ('RELIANCE','RELIANCERETAIL') then raise exception using errcode='42501',message='Reliance FO required'; end if;
 if not is_fo and p_stores is null then raise exception using errcode='42501',message='Verified server-side scope required'; end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>92 then raise exception using errcode='22023',message='Invalid range'; end if;
 select coalesce(jsonb_agg(row_data order by scheduled_date,schedule_id),'[]') into result from (
  select c.scheduled_date,c.id schedule_id,jsonb_build_object(
   'id',c.id,'schedule_id',c.id,'retail_store_id',s.id,'store_code',s.store_code,'store_name',s.store_name,
   'state',s.state,'geographic_state',case when s.state='KN' then 'KA' else s.state end,'reporting_state',case when s.state in ('TN','PY') then 'TN' when s.state='KN' then 'KA' else s.state end,
   'zone_id',case when s.state in ('TN','PY') then public.retail_unified_owner(s.id,now())->>'zone_id' else s.zone_id::text end,
   'zone',case when z.id is null then null else jsonb_build_object('id',z.id,'code',z.zone_code,'name',z.zone_name) end,
   'zone_code',z.zone_code,'zone_name',z.zone_name,
   'scheduled_date',c.scheduled_date,'status',c.status,'activity','Deep Cleaning','notes',c.metadata->>'notes',
   'city',to_jsonb(s)->>'city','latitude',to_jsonb(s)->>'latitude','longitude',to_jsonb(s)->>'longitude',
   'assigned_fo_profile_id',x.executor,'assignment_status',case when x.executor is null then 'Assignment Pending' else 'Assigned' end,
   'completed_at',c.completed_at,'not_done_reason',c.not_done_reason,'executor_profile_id',case when c.status in ('Completed','Not Done') then x.executor else null end,
   'permitted_actions',case when is_fo and x.executor=p_actor and c.status in ('Planned','Scheduled') and c.scheduled_date<=(now() at time zone 'Asia/Kolkata')::date then jsonb_build_array('view','execute') else jsonb_build_array('view') end
  ) row_data
  from public.client_deep_cleaning_schedules c join public.reliance_retail_store_master s on s.id=c.retail_store_id
  cross join lateral (select public.retail_cleaning_executor_v1(c.id) executor) x
  left join public.reliance_retail_zones z on z.id=case when s.state in ('TN','PY') then (public.retail_unified_owner(s.id,now())->>'zone_id')::uuid else s.zone_id end
  where (p_schedule is null and c.scheduled_date between p_from and p_to or c.id=p_schedule)
   and (case when is_fo then x.executor=p_actor else s.id=any(p_stores) end)
 ) rows;
 return jsonb_build_object('contract_version','retail-cleaning.v1','rows',result);
end $$;

create function public.rpc_retail_cleaning_submission_v1(p_actor uuid,p_auth uuid,p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
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
  update public.client_deep_cleaning_submissions set status='submitted',submitted_at=now(),final_outcome=outcome,not_done_reason=reason where id=d.id returning * into d;
  update public.client_deep_cleaning_schedules set status=outcome,completed_at=now(),not_done_reason=reason,assigned_fo_profile_id=p_actor,updated_at=now(),metadata=coalesce(metadata,'{}')||jsonb_build_object('executor_profile_id',p_actor,'executor_auth_id',p_auth,'executor_employee_code',actor.employee_code,'dedicated_submission_id',d.id) where id=sid;
 else raise exception using errcode='22023',message='Unknown command'; end if;
 return to_jsonb(d);
end $$;

-- Atomic idempotency on existing upload rows; legacy requests without request_id
-- retain their original API path. No new table or client-side database grant.
create function public.rpc_client_cleaning_upload_intent_v1(p_actor uuid,p_auth uuid,p_submission uuid,p_request uuid,p_upload jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor public.profiles%rowtype; d public.client_deep_cleaning_submissions%rowtype; u public.client_deep_cleaning_uploads%rowtype; size_bytes bigint; kind text; mime text; path text; prefix text;
begin
 select * into actor from public.profiles where id=p_actor and auth_user_id=p_auth and upper(status)='ACTIVE' and is_active=true;
 if not found or upper(regexp_replace(coalesce(actor.role,''),'[^a-zA-Z]','','g')) not in ('FO','FIELDOFFICER') or upper(regexp_replace(coalesce(actor.business,''),'[^a-zA-Z]','','g')) not in ('RELIANCE','RELIANCERETAIL') then raise exception using errcode='42501',message='Verified Reliance FO required'; end if;
 select * into d from public.client_deep_cleaning_submissions where id=p_submission and submitted_by_user_id=p_auth;
 if not found then raise exception using errcode='42501',message='Owned draft required'; end if;
 if d.schedule_id is not null then perform public.rpc_retail_cleaning_submission_v1(p_actor,p_auth,'validate',jsonb_build_object('submission_id',p_submission)); end if;
 select * into d from public.client_deep_cleaning_submissions where id=p_submission for update;
 if coalesce(d.status,'') not in ('draft','uploading') then raise exception using errcode='23505',message='Submitted evidence is immutable'; end if;
 kind:=p_upload->>'upload_type'; mime:=p_upload->>'mime_type'; size_bytes:=(p_upload->>'file_size')::bigint; path:=p_upload->>'storage_path';
 prefix:='deep-cleaning/reliance-retail/'||coalesce(nullif(left(regexp_replace(regexp_replace(btrim(d.store_code),'[^a-zA-Z0-9._-]+','-','g'),'^-+|-+$','','g'),120),''),'store')||'/'||p_submission::text||'/';
 if p_request is null or kind is null or mime is null or size_bytes is null or size_bytes<1 or size_bytes>5242880 or kind not in ('before','after','document','checklist') or mime not in ('image/jpeg','image/png','image/webp','application/pdf') or kind in ('before','after') and mime='application/pdf' or path is null or left(path,length(prefix))<>prefix then raise exception using errcode='22023',message='Invalid upload intent'; end if;
 select * into u from public.client_deep_cleaning_uploads where submission_id=p_submission and metadata->>'upload_request_id'=p_request::text;
 if found then
  if u.uploaded_by_user_id is distinct from p_auth or u.upload_type is distinct from kind or u.mime_type is distinct from mime or u.file_size is distinct from size_bytes or u.storage_path is distinct from path or u.original_filename is distinct from p_upload->>'original_filename' or u.metadata->>'pair_id' is distinct from p_upload->>'pair_id' then raise exception using errcode='23505',message='Upload request reused for another file'; end if;
  return to_jsonb(u);
 end if;
 insert into public.client_deep_cleaning_uploads(submission_id,upload_type,storage_bucket,storage_path,original_filename,mime_type,file_size,sequence_no,uploaded_by_user_id,upload_status,metadata)
 values(p_submission,kind,'client-deep-cleaning-uploads',path,p_upload->>'original_filename',mime,size_bytes,coalesce((select max(sequence_no)+1 from public.client_deep_cleaning_uploads where submission_id=p_submission),1),p_auth,'pending',jsonb_build_object('source','retail-cleaning.v1','upload_request_id',p_request,'pair_id',p_upload->>'pair_id','pair_order',p_upload->'pair_order')) returning * into u;
 update public.client_deep_cleaning_submissions set status='uploading' where id=p_submission;
 return to_jsonb(u);
end $$;

revoke all on function public.retail_cleaning_executor_v1(uuid),public.rpc_retail_cleaning_delivery_v1(uuid,uuid,uuid[],date,date,uuid),public.rpc_retail_cleaning_submission_v1(uuid,uuid,text,jsonb),public.rpc_client_cleaning_upload_intent_v1(uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.rpc_retail_cleaning_delivery_v1(uuid,uuid,uuid[],date,date,uuid),public.rpc_retail_cleaning_submission_v1(uuid,uuid,text,jsonb),public.rpc_client_cleaning_upload_intent_v1(uuid,uuid,uuid,uuid,jsonb) to service_role;
-- No direct table grants, client JWT execution, RLS changes, or user assignments.
