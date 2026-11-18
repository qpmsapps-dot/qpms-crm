-- REVIEW/READ ONLY. Run only through an authorized production read connection.
begin transaction read only;
select current_database(), current_setting('server_version');
select table_schema,table_name,column_name,data_type,is_nullable
from information_schema.columns
where table_schema in ('public','storage') and table_name in
('retail_thermography_inspections','retail_thermography_report_versions','retail_thermography_report_events',
 'retail_thermography_report_requests','reliance_retail_store_master','retail_mis_assignments','buckets','objects')
order by table_schema,table_name,ordinal_position;
-- Definitions are necessary for the migration's fail-closed drift checks.
select p.oid::regprocedure as signature,p.prosecdef,p.proconfig,p.proacl,
 md5(pg_get_functiondef(p.oid)) as definition_hash,pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in
('retail_mis_allowed','retail_mis_super','retail_mis_unique_store','retail_operations_access',
 'rpc_retail_mis_report','rpc_retail_operations_snapshot','rpc_retail_thermography_reports')
 or n.nspname='public' and p.proname like 'thermo_report_%';
select c.relname,pg_get_userbyid(c.relowner) as owner,c.relrowsecurity,c.relacl
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname like 'retail_thermography%';
select tablename,indexname,indexdef from pg_indexes
where schemaname='public' and tablename like 'retail_thermography%';
select conrelid::regclass,conname,pg_get_constraintdef(oid)
from pg_constraint where conrelid in(select c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname like 'retail_thermography%');
select tgrelid::regclass,tgname,pg_get_triggerdef(oid) from pg_trigger where not tgisinternal
and (tgrelid='storage.objects'::regclass or tgrelid in(select c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname like 'retail_thermography%'));
select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check
from pg_policies where (schemaname='storage' and tablename='objects')
or (schemaname='public' and tablename like 'retail_thermography%');
select id,public,file_size_limit,allowed_mime_types from storage.buckets
where id='retail-thermography-reports';
-- The project's GLOBAL Storage upload limit requires an authorized Management
-- API/Storage Settings read as well; bucket metadata is not proof of that limit.
-- Aggregate only: no employee data, filenames, object keys or private URLs.
select date_trunc('month',scheduled_date)::date as scheduled_month,status,count(*)
from public.retail_thermography_inspections group by 1,2 order by 1,2;
rollback;
