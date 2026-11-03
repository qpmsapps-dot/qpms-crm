-- Correct approved direct scheduling scope: HK MIS or existing authorized Unified editor / Super Admin.
-- No approval step is introduced. Unauthorized FOs remain rejected.
begin;
set local lock_timeout='5s';
CREATE OR REPLACE FUNCTION public.rpc_retail_cleaning_schedule_direct(p_actor uuid, p_store uuid, p_scheduled date, p_request uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
 s public.reliance_retail_store_master%rowtype;
 existing public.client_deep_cleaning_schedules%rowtype;
 owner_info jsonb;
 assignee uuid;
 zone_id uuid;
 scope_name text;
 now_day date:=public.retail_operations_today();
begin
 if p_actor is null or p_store is null or p_request is null or p_scheduled is null then raise exception using errcode='22023',message='Store, scheduled date and request ID required';end if;
 if p_scheduled<now_day or p_scheduled>now_day+365 then raise exception using errcode='22023',message='Schedule date must be today through 365 days ahead';end if;
 if length(coalesce(p_reason,''))>2000 then raise exception using errcode='22023',message='Notes exceed 2,000 characters';end if;
 select * into s from public.reliance_retail_store_master where id=p_store;
 if not found or s.status<>'Active' then raise exception using errcode='22023',message='Select an active canonical Retail store';end if;
 if (select count(*) from public.reliance_retail_store_master where upper(btrim(store_code))=upper(btrim(s.store_code)))<>1 then raise exception using errcode='23505',message='Ambiguous Store Code; schedule not created';end if;
 if not (public.retail_mis_cleaning_access(p_actor,s.state,'edit') or public.retail_unified_access(p_actor,s.state,'edit')) then raise exception using errcode='42501',message='Store is outside assigned Cleaning editor scope';end if;
 perform pg_advisory_xact_lock(hashtextextended('retail-direct-cleaning:'||p_request::text,0));
 select * into existing from public.client_deep_cleaning_schedules where source_reference=p_request::text;
 if found then
  if existing.source_type<>'MIS_DIRECT' or existing.retail_store_id<>s.id or existing.scheduled_date<>p_scheduled or existing.created_by_profile_id<>p_actor then raise exception using errcode='23505',message='Schedule request ID reused for a different request';end if;
  return jsonb_build_object('replayed',true,'schedule',to_jsonb(existing));
 end if;
 owner_info:=public.retail_unified_owner(s.id,(p_scheduled::text||'T23:59:59+05:30')::timestamptz);
 assignee:=nullif(owner_info->>'fo_profile_id','')::uuid;
 zone_id:=nullif(owner_info->>'zone_id','')::uuid;
 scope_name:=case when regexp_replace(upper(coalesce(s.state,'')),'[^A-Z0-9]','','g') in ('TN','PY','TAMILNADU','PUDUCHERRY') then 'ZONE' else 'STATE' end;
 if assignee is not null and not exists(select 1 from public.profiles p where p.id=assignee and p.is_active=true) then assignee:=null;end if;
 insert into public.client_deep_cleaning_schedules(
  retail_store_id,scheduled_date,assigned_fo_profile_id,status,source_type,
  source_reference,created_by_profile_id,metadata
 )values(
  s.id,p_scheduled,assignee,'Planned','MIS_DIRECT',p_request::text,p_actor,
  jsonb_build_object('source','retail_cleaning_direct_v1','dispatch_scope',scope_name,
  'zone_id',zone_id,'assignment_pending',scope_name='ZONE' and assignee is null,
  'notes',nullif(btrim(coalesce(p_reason,'')),''))
 )on conflict (retail_store_id,scheduled_date) do nothing returning * into existing;
 if not found then raise exception using errcode='23505',message='A schedule already exists for this Store Code and date';end if;
 insert into public.reliance_retail_management_audit(
  action,entity_type,entity_id,actor_profile_id,after_state
 )values('DIRECT_CLEANING_SCHEDULE','deep_cleaning_schedule',existing.id,p_actor,to_jsonb(existing));
 return jsonb_build_object('replayed',false,'schedule',to_jsonb(existing),
  'dispatch_scope',scope_name,'assigned_fo',assignee,'assignment_pending',scope_name='ZONE' and assignee is null);
end;
$function$
;
commit;
