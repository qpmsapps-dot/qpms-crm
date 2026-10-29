begin transaction read only;
select version,name,cardinality(statements)=1 as one_statement,md5(replace(statements[1],E'\r\n',E'\n'))='0800864af23894d608e5a0d11e65f0c4' as source_exact_match,md5(replace(statements[1],E'\r\n',E'\n')) as source_md5 from supabase_migrations.schema_migrations where version='20261029140000';
select * from public.retail_unified_epoch;
select p.oid::regprocedure,p.prosecdef,p.proconfig,has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,has_function_privilege('service_role',p.oid,'EXECUTE') as service_execute from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'rpc_retail_unified_%' order by p.proname;
select t,r,has_table_privilege(r,'public.'||t,'INSERT') as ins,has_table_privilege(r,'public.'||t,'UPDATE') as upd,has_table_privilege(r,'public.'||t,'DELETE') as del from unnest(array['retail_unified_epoch','reliance_retail_store_master','reliance_retail_zones','reliance_retail_zone_fo_assignments','retail_attendance_aop_versions']) t cross join unnest(array['anon','authenticated','service_role']) r;
select has_function_privilege('service_role','public.rpc_sync_reliance_retail_fo_zones(uuid,uuid,uuid[])','EXECUTE') as legacy_direct_fo_sync;
select store_code,state,zone_id,current_responsible_fo_profile_id from public.reliance_retail_store_operational_ownership order by store_code;
select actor_id,state,permission from public.retail_provisional_access order by actor_id,state;
rollback;
-- Repeat retail_unified_preflight.sql and compare protected digests. AOP and staging
-- rows gain nullable schema keys; compare old columns with the saved preflight shapes.
-- Canonical, attendance, Deep Cleaning and Training row digests must be identical.
