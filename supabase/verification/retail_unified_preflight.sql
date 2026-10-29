begin transaction read only;
select version,name,cardinality(statements) as statement_count,md5(replace(statements[1],E'\r\n',E'\n')) as source_md5 from supabase_migrations.schema_migrations where version in ('20261028120000','20261029120000','20261029140000') order by version;
select 'canonical_stores' as relation,count(*),md5(coalesce(jsonb_agg(to_jsonb(x) order by id),'[]')::text) as digest from public.reliance_retail_store_master x
union all select 'provisional_files',count(*),md5(coalesce(jsonb_agg(to_jsonb(x) order by id),'[]')::text) from public.retail_provisional_files x
union all select 'provisional_rows',count(*),md5(coalesce(jsonb_agg(to_jsonb(x) order by id),'[]')::text) from public.retail_provisional_rows x
union all select 'attendance',count(*),md5(coalesce(jsonb_agg(to_jsonb(x) order by id),'[]')::text) from public.retail_employee_daily_attendance x
union all select 'approved_aop',count(*),md5(coalesce(jsonb_agg(to_jsonb(x) order by id),'[]')::text) from public.retail_attendance_aop_versions x
union all select 'deep_cleaning',count(*),md5(coalesce(jsonb_agg(to_jsonb(x) order by id),'[]')::text) from public.client_deep_cleaning_submissions x
union all select 'training',count(*),md5(coalesce(jsonb_agg(to_jsonb(x) order by id),'[]')::text) from public.training_sessions x;
select a.id,a.zone_id,a.effective_from,a.effective_to,b.id as overlapping_assignment from public.reliance_retail_zone_fo_assignments a join public.reliance_retail_zone_fo_assignments b on a.zone_id=b.zone_id and a.id<b.id and tstzrange(a.effective_from,a.effective_to,'[)') && tstzrange(b.effective_from,b.effective_to,'[)');
select retail_store_id,changed_at,count(*) from public.reliance_retail_store_zone_history group by retail_store_id,changed_at having count(*)>1;
select p.oid::regprocedure,md5(replace(pg_get_functiondef(p.oid),E'\r\n',E'\n')) as definition_md5,p.prosecdef,p.proconfig,p.proacl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('rpc_confirm_retail_store_import','rpc_confirm_retail_bulk_identity','retail_store_import_admin','retail_attendance_daily_cap','retail_attendance_aop_no_overlap','rpc_sync_reliance_retail_fo_zones');
select column_name,data_type,is_nullable from information_schema.columns where table_schema='public' and table_name in ('retail_attendance_aop_versions','retail_provisional_access','retail_provisional_files','retail_provisional_proposals') order by table_name,ordinal_position;
select to_regclass('public.client_deep_cleaning_schedules') as schedules,to_regclass('public.retail_unified_epoch') as unified_epoch;
rollback;
