begin transaction read only;
select version,name,cardinality(statements)=1 and md5(replace(statements[1],E'\r\n',E'\n'))='f8976c9fc4836ba5316f6c91dea11b97' as source_exact_match from supabase_migrations.schema_migrations where version='20261030160000';
select md5(replace(prosrc,E'\r\n',E'\n'))='f477683eb2dcac80fe96a0938a50aaf6' as body_exact_match,prosecdef,proconfig,has_function_privilege('anon',oid,'EXECUTE') as anon_execute,has_function_privilege('authenticated',oid,'EXECUTE') as authenticated_execute,has_function_privilege('service_role',oid,'EXECUTE') as service_execute from pg_proc where oid=to_regprocedure('public.rpc_retail_service_rework_v2(uuid,uuid,text,uuid,integer,jsonb)');
select md5(replace(prosrc,E'\r\n',E'\n'))='efabf57819cd99a3514da79ca8662e39' as original_command_unchanged from pg_proc where oid=to_regprocedure('public.rpc_retail_service_command(uuid,uuid,text,uuid,integer,jsonb)');
rollback;
