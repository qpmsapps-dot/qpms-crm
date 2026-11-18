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
  update public.client_deep_cleaning_submissions set status='submitted',submitted_at=now(),final_outcome=outcome,not_done_reason=reason where id=d.id returning * into d;
  update public.client_deep_cleaning_schedules set status=outcome,completed_at=now(),not_done_reason=reason,assigned_fo_profile_id=p_actor,updated_at=now(),metadata=coalesce(metadata,'{}')||jsonb_build_object('executor_profile_id',p_actor,'executor_auth_id',p_auth,'executor_employee_code',actor.employee_code,'dedicated_submission_id',d.id) where id=sid;
 else raise exception using errcode='22023',message='Unknown command'; end if;
 return to_jsonb(d);
end $function$
