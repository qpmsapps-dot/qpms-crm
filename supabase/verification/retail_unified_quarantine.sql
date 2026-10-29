-- AUTHORIZATION REQUIRED. Non-destructive write quarantine; never drop retained evidence.
-- Close RETAIL_STORE_IMPORT_WRITES_ENABLED through the approved configuration process first.
begin;
do $$ declare f regprocedure;begin
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('rpc_retail_unified_stage','rpc_retail_unified_propose','rpc_retail_unified_decide','rpc_retail_unified_apply') loop
 execute format('revoke execute on function %s from service_role',f);
 end loop;
end; $$;
commit;
-- Reads, original bytes, rows, versions, proposals, activity records and approval history
-- remain intact. Do not restore legacy direct writes or erase an AOP revision as rollback.
