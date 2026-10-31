-- PROPOSAL ONLY: explicit Admin-verified linkage; no historical backfill or source copying.
begin;
create or replace function public.rpc_retail_cleaning_link_source(p_actor uuid,p_schedule uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.client_deep_cleaning_schedules%rowtype;m public.reliance_retail_store_master%rowtype;f public.fo_activity_submissions%rowtype;u jsonb;owner jsonb;
begin
 select * into s from public.client_deep_cleaning_schedules where id=p_schedule;
 if not found then raise exception using errcode='42501',message='Schedule unavailable';end if;
 select * into m from public.reliance_retail_store_master where id=s.retail_store_id;
 if not found or public.retail_unified_access(p_actor,m.state,'view') is not true then raise exception using errcode='42501',message='Outside schedule scope';end if;
 if s.metadata->'retail_fo_completion'->>'source_id' is null then return null;end if;
 if not exists(select 1 from storage.buckets where id='fo-activity-uploads' and public is false) then raise exception using errcode='42501',message='Private legacy FO evidence bucket required';end if;
 select * into f from public.fo_activity_submissions where id=(s.metadata->'retail_fo_completion'->>'source_id')::uuid;
 if not found or lower(f.activity_type) is distinct from 'deep_cleaning' or lower(f.status) is distinct from 'submitted' or f.metadata->>'pending_images' is distinct from 'false' or f.submitted_at is null or s.created_at is null or f.submitted_at<s.created_at or f.submitted_at>clock_timestamp() or nullif(upper(btrim(f.store_code)),'') is distinct from nullif(upper(btrim(m.store_code)),'') or f.store_code is null or f.metadata->>'activity_date' is distinct from s.scheduled_date::text or upper(coalesce(f.metadata->>'state','')) is distinct from upper(m.state) then raise exception using errcode='22023',message='Verified submitted store/date evidence required';end if;
 if (select count(*) from public.reliance_retail_store_master where upper(btrim(store_code))=upper(btrim(m.store_code)))<>1 then raise exception 'Ambiguous Store Code';end if;
 owner:=public.retail_unified_owner(m.id,(s.scheduled_date::text||'T23:59:59+05:30')::timestamptz);
 if owner->>'known' is distinct from 'true' or owner->>'fo_profile_id' is null or not exists(select 1 from public.profiles p where p.id=(owner->>'fo_profile_id')::uuid and p.employee_code=f.employee_code) or (s.assigned_fo_profile_id is not null and s.assigned_fo_profile_id is distinct from (owner->>'fo_profile_id')::uuid) then raise exception using errcode='42501',message='Verified historical FO ownership required';end if;
 select coalesce(jsonb_agg(to_jsonb(a)),'[]') into u from public.fo_activity_uploads a
 where a.submission_id=f.id and a.activity_type='deep_cleaning' and a.employee_code=f.employee_code
 and upper(btrim(a.store_code))=upper(btrim(m.store_code)) and a.uploaded_at is not null
 and a.storage_bucket='fo-activity-uploads' and a.upload_role in ('deep_cleaning_before','deep_cleaning_after')
 and a.file_type in ('image/jpeg','image/png','image/webp') and a.file_size between 1 and 5242880
 and starts_with(a.file_url,'fo-activity-uploads/'||f.employee_code||'/'||s.scheduled_date::text||'/deep_cleaning/'||f.id::text||'/')
 and a.file_url !~ '(^|/)(\.\.?)(/|$)'
 and exists(select 1 from storage.objects o where o.bucket_id='fo-activity-uploads' and o.name=substring(a.file_url from length('fo-activity-uploads/')+1));
 if not exists(select 1 from jsonb_array_elements(u) a where a->>'upload_role'='deep_cleaning_before') or not exists(select 1 from jsonb_array_elements(u) a where a->>'upload_role'='deep_cleaning_after') then raise exception using errcode='22023',message='Stored before and after evidence required';end if;
 return jsonb_build_object('id','fo:'||f.id::text,'source_kind','verified_fo_link','schedule_id',s.id,'retail_store_id',m.id,'store_code',m.store_code,'state',m.state,'deep_cleaning_date',s.scheduled_date,'status','submitted','submitted_at',f.submitted_at,'employee_code',f.employee_code,'uploads',u);
end;$$;
create or replace function public.rpc_retail_cleaning_link_fo(p_actor uuid,p_schedule uuid,p_source uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare p public.profiles%rowtype;s public.client_deep_cleaning_schedules%rowtype;v jsonb;
begin
 select * into p from public.profiles where id=p_actor;
 if not found or p.is_active is not true or upper(coalesce(p.status,'Active'))<>'ACTIVE' or regexp_replace(upper(coalesce(p.role,'')),'[^A-Z0-9]','','g') not in ('ADMIN','QPMSADMIN') then raise exception using errcode='42501',message='Existing Retail Admin required';end if;
 select * into s from public.client_deep_cleaning_schedules where id=p_schedule for update;
 -- Unified keeps the proposal APPROVED; application is proven by its audit receipt.
 -- APPLIED is not a valid proposal status in the existing schema.
 if p_source is null or not found or not exists(
  select 1 from public.retail_provisional_proposals r
  join public.reliance_retail_management_audit a on a.entity_id=r.id and a.entity_type='proposal' and a.action='UNIFIED_APPLY'
  where r.id::text=s.source_reference and r.kind='DC_SCHEDULE' and r.status='APPROVED'
  and r.target_store=s.retail_store_id and r.proposed_by is not null and r.decided_by is not null and r.decided_by<>r.proposed_by
  and a.after_state->>'proposal_id'=r.id::text and a.after_state->>'kind'='DC_SCHEDULE'
  and a.after_state->>'store_id'=s.retail_store_id::text
  and a.after_state->'changes'->>'scheduled_date'=s.scheduled_date::text
 ) then raise exception using errcode='42501',message='Independently approved and applied schedule required';end if;
 if s.metadata ? 'retail_fo_completion' then
  if s.metadata->'retail_fo_completion'->>'source_id' is distinct from p_source::text then raise exception using errcode='40001',message='Schedule already linked';end if;
  return public.rpc_retail_cleaning_link_source(p_actor,p_schedule);
 end if;
 if s.status is null or s.status not in ('Planned','Scheduled') or not exists(select 1 from public.reliance_retail_store_master m where m.id=s.retail_store_id and upper(m.status)='ACTIVE') or exists(select 1 from public.client_deep_cleaning_schedules x where x.metadata->'retail_fo_completion'->>'source_id'=p_source::text) then raise exception using errcode='40001',message='Completion already linked, store inactive or schedule finalized';end if;
 perform pg_advisory_xact_lock(hashtextextended('retail_fo_link:'||p_source::text,0));
 if exists(select 1 from public.client_deep_cleaning_schedules x where x.metadata->'retail_fo_completion'->>'source_id'=p_source::text) then raise exception using errcode='40001',message='Source already linked';end if;
 update public.client_deep_cleaning_schedules set metadata=metadata||jsonb_build_object('retail_fo_completion',jsonb_build_object('source_id',p_source,'verified_by',p_actor,'verified_at',clock_timestamp())) where id=s.id;
 v:=public.rpc_retail_cleaning_link_source(p_actor,s.id);
 update public.client_deep_cleaning_schedules set status='Completed',completed_at=(v->>'submitted_at')::timestamptz,updated_at=clock_timestamp() where id=s.id;
 insert into public.reliance_retail_management_audit(action,entity_type,entity_id,actor_profile_id,before_state,after_state) values('VERIFIED_FO_CLEANING_LINK','deep_cleaning_schedule',s.id,p_actor,to_jsonb(s),jsonb_build_object('source_id',p_source,'status','Completed'));
 return v;
end;$$;
revoke all on function public.rpc_retail_cleaning_link_source(uuid,uuid),public.rpc_retail_cleaning_link_fo(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.rpc_retail_cleaning_link_source(uuid,uuid),public.rpc_retail_cleaning_link_fo(uuid,uuid,uuid) to service_role;
commit;
