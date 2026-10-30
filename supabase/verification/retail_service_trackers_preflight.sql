-- Read-only preflight for the NEW, not-yet-installed Service Tracker proposal.
begin transaction read only;
select to_regprocedure('public.retail_unified_access(uuid,text,text)') is not null as existing_access_required,
 to_regprocedure('public.retail_unified_owner(uuid,timestamptz)') is not null as existing_ownership_required,
 to_regclass('public.retail_service_orders') is null as new_orders_absent,
 to_regclass('public.retail_service_events') is null as new_events_absent;
select 'canonical' as relation,count(*),md5(coalesce(jsonb_agg(to_jsonb(s) order by id),'[]')::text) as digest from public.reliance_retail_store_master s
union all select 'zones',count(*),md5(coalesce(jsonb_agg(to_jsonb(s) order by id),'[]')::text) from public.reliance_retail_zones s
union all select 'fo_assignments',count(*),md5(coalesce(jsonb_agg(to_jsonb(s) order by id),'[]')::text) from public.reliance_retail_zone_fo_assignments s
union all select 'attendance',count(*),md5(coalesce(jsonb_agg(to_jsonb(s) order by id),'[]')::text) from public.retail_employee_daily_attendance s
union all select 'provisional_rows',count(*),md5(coalesce(jsonb_agg(to_jsonb(s) order by id),'[]')::text) from public.retail_provisional_rows s;
rollback;
