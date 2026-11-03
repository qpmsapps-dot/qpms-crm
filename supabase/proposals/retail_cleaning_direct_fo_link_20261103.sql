-- Accept audited MIS_DIRECT schedules as a lawful source for verified FO completion linkage.
-- Existing applied approval route and all store/date/FO/photo verifications remain unchanged.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
CREATE OR REPLACE FUNCTION public.rpc_retail_cleaning_link_fo(p_actor uuid, p_schedule uuid, p_source uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare p public.profiles%rowtype;s public.client_deep_cleaning_schedules%rowtype;v jsonb;
begin
 select * into p from public.profiles where id=p_actor;
 if not found or p.is_active is not true or upper(coalesce(p.status,'Active'))<>'ACTIVE' or regexp_replace(upper(coalesce(p.role,'')),'[^A-Z0-9]','','g') not in ('ADMIN','QPMSADMIN') then raise exception using errcode='42501',message='Existing Retail Admin required';end if;
 select * into s from public.client_deep_cleaning_schedules where id=p_schedule for update;
 -- Unified keeps the proposal APPROVED; application is proven by its audit receipt.
 -- APPLIED is not a valid proposal status in the existing schema.
 if p_source is null or not found or not ((s.source_type='MIS_DIRECT' and s.created_by_profile_id is not null and s.metadata->>'source'='retail_cleaning_direct_v1') or exists(
  select 1 from public.retail_provisional_proposals r
  join public.reliance_retail_management_audit a on a.entity_id=r.id and a.entity_type='proposal' and a.action='UNIFIED_APPLY'
  where r.id::text=s.source_reference and r.kind='DC_SCHEDULE' and r.status='APPROVED'
  and r.target_store=s.retail_store_id and r.proposed_by is not null and r.decided_by is not null and r.decided_by<>r.proposed_by
  and a.after_state->>'proposal_id'=r.id::text and a.after_state->>'kind'='DC_SCHEDULE'
  and a.after_state->>'store_id'=s.retail_store_id::text
  and a.after_state->'changes'->>'scheduled_date'=s.scheduled_date::text
 )) then raise exception using errcode='42501',message='Validated direct or independently approved schedule required';end if;
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
end;$function$
;
commit;
