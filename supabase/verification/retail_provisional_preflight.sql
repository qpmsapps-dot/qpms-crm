begin transaction read only;
select version,name from supabase_migrations.schema_migrations order by version desc limit 10;
select 'canonical' as relation,count(*),md5(coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]')::text) as digest from public.reliance_retail_store_master s;
select 'retail_attendance_uploads' as relation,count(*),md5(coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]')::text) as digest from public.retail_attendance_uploads s;
select 'retail_employee_daily_attendance' as relation,count(*),md5(coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]')::text) as digest from public.retail_employee_daily_attendance s;
select 'retail_attendance_aop_versions' as relation,count(*),md5(coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]')::text) as digest from public.retail_attendance_aop_versions s;
select p.oid::regprocedure,md5(replace(pg_get_functiondef(p.oid),E'\r\n',E'\n')) as definition_md5,p.prosecdef,p.proconfig,p.proacl
from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname in ('rpc_confirm_retail_bulk_identity','rpc_confirm_retail_store_import','rpc_rollback_retail_store_import','retail_store_import_admin') or p.proname like 'rpc_retail_provisional_%' or p.proname in ('retail_provisional_admin','retail_provisional_allowed')) order by p.proname;
select c.relname,c.relrowsecurity,c.relacl from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('retail_provisional_access','retail_provisional_files','retail_provisional_rows','retail_provisional_proposals','retail_provisional_events');
rollback;
