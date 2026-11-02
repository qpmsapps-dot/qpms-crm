-- Prepared owner verification for the NEW MIS migration only. No legacy reinstall.
begin read only;
select p.oid::regprocedure signature,p.prosecdef,p.proconfig,
 has_function_privilege('anon',p.oid,'EXECUTE') anon_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') employee_execute,
 has_function_privilege('service_role',p.oid,'EXECUTE') service_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'rpc_retail_mis_%' or p.proname like 'retail_mis_%') order by p.oid::regprocedure::text;
select c.relname,c.relrowsecurity,has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') employee_any_access,has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE') service_direct_any_access
from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname like 'retail_mis_%' order by c.relname;
select singleton,oos_writes_enabled from public.retail_mis_controls;
select id,public,file_size_limit,allowed_mime_types from storage.buckets where id='retail-mis-evidence';
select policyname,permissive,cmd,roles,qual,with_check from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'retail_mis_%' order by policyname;
select tgname,tgrelid::regclass,pg_get_triggerdef(oid) from pg_trigger where not tgisinternal and tgname like 'retail_mis_%' order by tgname;
-- Existing installed workflow fingerprints must match the retained preinstall baseline.
select p.oid::regprocedure signature,md5(replace(p.prosrc,E'\r\n',E'\n')) body_md5 from pg_proc p where p.oid in (
 to_regprocedure('public.rpc_retail_fault_update(uuid,uuid,text,text,timestamptz,uuid)'),
 to_regprocedure('public.rpc_retail_cleaning_link_fo(uuid,uuid,uuid)'),
 to_regprocedure('public.rpc_retail_cleaning_link_source(uuid,uuid)'),
 to_regprocedure('public.training_legacy_write_guard()'),
 to_regprocedure('public.retail_cleaning_storage_guard()')) order by p.oid::regprocedure::text;
rollback;
