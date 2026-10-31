-- Owner-level READ ONLY postcheck. Never invokes mutation RPCs.
begin transaction read only;
do $check$ declare signature text;p record;begin
 foreach signature in array array['public.rpc_retail_fault_update(uuid,uuid,text,text,timestamptz,uuid)','public.rpc_retail_fault_update_capability()','public.rpc_retail_cleaning_link_source(uuid,uuid)','public.rpc_retail_cleaning_link_fo(uuid,uuid,uuid)'] loop
  select prosecdef,proconfig into p from pg_proc where oid=to_regprocedure(signature);
  if not found then raise exception 'Required RPC missing: %',signature;end if;
  if p.prosecdef is not true or p.proconfig @> array['search_path=pg_catalog, public'] is not true then raise exception 'Unsafe function settings: %',signature;end if;
  if has_function_privilege('anon',signature,'EXECUTE') or has_function_privilege('authenticated',signature,'EXECUTE') or not has_function_privilege('service_role',signature,'EXECUTE') then raise exception 'Incorrect RPC execution grants: %',signature;end if;
  if exists(select 1 from pg_proc f cross join lateral aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a where f.oid=to_regprocedure(signature) and a.privilege_type='EXECUTE' and a.grantee not in (f.proowner,'service_role'::regrole::oid)) then raise exception 'Unexpected RPC execution grantee: %',signature;end if;
 end loop;
 if not exists(select 1 from pg_index where indexrelid=to_regclass('public.retail_fault_update_request') and indisunique and indisvalid) then raise exception 'Valid unique ticket request index required';end if;
 if not exists(select 1 from storage.buckets where id='fo-activity-uploads' and public is false) then raise exception 'Legacy FO bucket must remain private';end if;
 if has_table_privilege('authenticated','public.client_deep_cleaning_schedules','SELECT') or has_table_privilege('service_role','public.client_deep_cleaning_schedules','SELECT') then raise exception 'Direct schedule SELECT must remain denied';end if;
end;$check$;
select p.oid::regprocedure signature,r.rolname owner,p.proconfig,md5(replace(pg_get_functiondef(p.oid),E'\r\n',E'\n')) definition_md5 from pg_proc p join pg_roles r on r.oid=p.proowner
where p.oid in (to_regprocedure('public.rpc_retail_fault_update(uuid,uuid,text,text,timestamptz,uuid)'),to_regprocedure('public.rpc_retail_fault_update_capability()'),to_regprocedure('public.rpc_retail_cleaning_link_source(uuid,uuid)'),to_regprocedure('public.rpc_retail_cleaning_link_fo(uuid,uuid,uuid)'));
select indexdef from pg_indexes where schemaname='public' and indexname='retail_fault_update_request';
select policyname,permissive,roles,cmd,qual,with_check from pg_policies where schemaname='storage' and tablename='objects' order by policyname;
rollback;
