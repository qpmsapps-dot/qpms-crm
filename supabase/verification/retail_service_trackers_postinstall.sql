begin transaction read only;
select 'orders' as relation,count(*) from public.retail_service_orders union all select 'events',count(*) from public.retail_service_events;
select t,r,has_table_privilege(r,'public.'||t,'SELECT') as sel,has_table_privilege(r,'public.'||t,'INSERT') as ins,has_table_privilege(r,'public.'||t,'UPDATE') as upd,has_table_privilege(r,'public.'||t,'DELETE') as del from unnest(array['retail_service_orders','retail_service_events']) t cross join unnest(array['anon','authenticated','service_role']) r;
select p.oid::regprocedure,p.prosecdef,p.proconfig,has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,has_function_privilege('service_role',p.oid,'EXECUTE') as service_execute from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'rpc_retail_service_%';
rollback;
-- Repeat ONLY retail_service_trackers_preflight.sql protected digests; they must
-- match. The new-relations-absent booleans will now be false, as expected.
