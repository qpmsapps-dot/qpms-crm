-- Owner-level READ ONLY inventory. Does not call command/import/assignment RPCs.
begin read only;
set local statement_timeout='30s';
select jsonb_build_object(
 'migration_ledger',(select jsonb_agg(jsonb_build_object('version',version,'name',name,'statement_count',cardinality(statements),'source_md5',case when cardinality(statements)=1 then md5(replace(statements[1],E'\r\n',E'\n')) end,'identity_only_expected',case when version='20261031080000' then cardinality(statements)=1 and md5(replace(statements[1],E'\r\n',E'\n'))='3de29cda20ea1106b28bdf69987d5c7c' else null end)) from supabase_migrations.schema_migrations where version in ('20261031080000','20261102071258')),
 'relations',(select jsonb_agg(jsonb_build_object('table',c.relname,'rls',c.relrowsecurity,'authenticated_write',has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE'))) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('retail_service_orders','retail_service_events','retail_service_order_stores','retail_mis_assignments','retail_mis_controls','retail_mis_oos_retirements')),
 'routines',(select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'body_md5',md5(replace(p.prosrc,E'\r\n',E'\n')),'definer',p.prosecdef,'settings',p.proconfig,'anon_execute',has_function_privilege('anon',p.oid,'EXECUTE'),'authenticated_execute',has_function_privilege('authenticated',p.oid,'EXECUTE'),'service_execute',has_function_privilege('service_role',p.oid,'EXECUTE'))) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'rpc_retail_service_%' or p.proname like 'rpc_retail_mis_%' or p.proname like 'retail_mis_%' or p.proname in ('retail_unified_access','retail_service_public_order','retail_service_event_immutable','rpc_retail_identity_activation_contract') or p.proname like '%oos%v2%')),
 'order_columns',(select jsonb_agg(jsonb_build_object('column',column_name,'type',data_type)) from information_schema.columns where table_schema='public' and table_name='retail_service_orders'),
 'order_counts',(select jsonb_agg(to_jsonb(x)) from (select kind,status,count(*) records from public.retail_service_orders group by kind,status order by kind,status) x),
 'events',(select count(*) from public.retail_service_events),
 'new_mis_installed',to_regclass('public.retail_mis_assignments') is not null
) evidence;
rollback;
