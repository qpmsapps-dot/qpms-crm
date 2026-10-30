-- Read-only preflight for NEW draft storage and future-write state constraint.
begin transaction read only;
select to_regclass('public.retail_zone_mapping_drafts') is null as draft_table_must_be_absent,
 to_regprocedure('public.retail_unified_access(uuid,text,text)') is not null as installed_access_required;
select id,zone_code,state from public.reliance_retail_zones where state is null or state not in ('TN','PY','KA','KL','TG','AP-1','AP-2');
select 'canonical' as relation,count(*),md5(coalesce(jsonb_agg(to_jsonb(x) order by id),'[]')::text) as digest from public.reliance_retail_store_master x
union all select 'zones',count(*),md5(coalesce(jsonb_agg(to_jsonb(x) order by id),'[]')::text) from public.reliance_retail_zones x
union all select 'fo_assignments',count(*),md5(coalesce(jsonb_agg(to_jsonb(x) order by id),'[]')::text) from public.reliance_retail_zone_fo_assignments x
union all select 'store_zone_history',count(*),md5(coalesce(jsonb_agg(to_jsonb(x) order by id),'[]')::text) from public.reliance_retail_store_zone_history x
union all select 'provisional_rows',count(*),md5(coalesce(jsonb_agg(to_jsonb(x) order by id),'[]')::text) from public.retail_provisional_rows x
union all select 'attendance',count(*),md5(coalesce(jsonb_agg(to_jsonb(x) order by id),'[]')::text) from public.retail_employee_daily_attendance x;
rollback;
