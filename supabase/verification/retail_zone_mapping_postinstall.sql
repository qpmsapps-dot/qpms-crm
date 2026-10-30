begin transaction read only;
select count(*) as initial_draft_count from public.retail_zone_mapping_drafts;
select conname,convalidated,pg_get_constraintdef(oid) from pg_constraint where conname='retail_zones_defined_state';
select r,has_table_privilege(r,'public.retail_zone_mapping_drafts','SELECT') as sel,has_table_privilege(r,'public.retail_zone_mapping_drafts','INSERT') as ins,has_table_privilege(r,'public.retail_zone_mapping_drafts','UPDATE') as upd,has_table_privilege(r,'public.retail_zone_mapping_drafts','DELETE') as del from unnest(array['anon','authenticated','service_role']) r;
select p.oid::regprocedure,p.prosecdef,p.proconfig,has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,has_function_privilege('service_role',p.oid,'EXECUTE') as service_execute from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('rpc_retail_zone_drafts','rpc_retail_zone_draft_save');
rollback;
-- Repeat only the protected digest queries from retail_zone_mapping_preflight.sql.
-- Every protected row digest must match. The future-write CHECK is intentionally
-- NOT VALID: it does not silently recategorize any existing legacy zones.
