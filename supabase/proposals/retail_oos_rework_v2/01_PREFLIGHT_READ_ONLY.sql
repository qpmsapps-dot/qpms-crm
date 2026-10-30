begin transaction read only;
select version,name from supabase_migrations.schema_migrations where version in ('20261030140000','20261030160000');
select md5(replace(prosrc,E'\r\n',E'\n'))='efabf57819cd99a3514da79ca8662e39' as original_command_exact from pg_proc where oid=to_regprocedure('public.rpc_retail_service_command(uuid,uuid,text,uuid,integer,jsonb)');
select count(*) as orders,count(*) filter(where kind='OOS') as quotations from public.retail_service_orders;
rollback;
