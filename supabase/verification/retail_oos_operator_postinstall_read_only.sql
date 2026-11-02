-- Immediate verification before a separately approved operator grant.
begin read only;
set local search_path=pg_catalog,public;
set local statement_timeout='30s';
do $$declare expected record;f record;obj oid;begin
 if not exists(select 1 from pg_class where oid=to_regclass('public.retail_oos_operator_access') and relrowsecurity and pg_get_userbyid(relowner)='postgres') then raise exception 'Operator table RLS/owner missing';end if;
 if exists(select 1 from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where c.oid='public.retail_oos_operator_access'::regclass and a.grantee<>c.relowner) then raise exception 'Operator table direct grants';end if;
 if exists(select 1 from public.retail_oos_operator_access) then raise exception 'Immediate check requires zero operator grants';end if;
 if exists(select 1 from public.retail_mis_assignments) or (select count(*) from public.retail_mis_controls)<>1 or not exists(select 1 from public.retail_mis_controls where singleton and oos_writes_enabled=false) then raise exception 'Assignments or closed gate drift';end if;
 for expected in select * from (values
 ('retail_oos_operator_allowed','2a1252c74f3eb8880c66cdf3532c781c'),
 ('rpc_retail_oos_operator_grant','f584ca572c346a9cdf5c6506656abd14'),
 ('retail_mis_allowed','b6263716364179e72456cbe7a11532f0'),
 ('rpc_retail_mis_access','53053e4e76a2c775cff98ef6bd3656b5'),
 ('rpc_retail_oos_capabilities','85e384f22f7c6218e5c64fca178a59b1')
 ) x(name,digest) loop
 select * into f from pg_proc where pronamespace='public'::regnamespace and proname=expected.name;
 if not found or not f.prosecdef or pg_get_userbyid(f.proowner)<>'postgres' or md5(replace(f.prosrc,E'\r\n',E'\n'))<>expected.digest then raise exception 'Operator function drift: %',expected.name;end if;
 if not exists(select 1 from unnest(f.proconfig) cfg where regexp_replace(cfg,'[[:space:]]','','g')='search_path=pg_catalog,public') then raise exception 'Operator search_path drift';end if;
 if exists(select 1 from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a where a.grantee<>f.proowner and not(expected.name in ('rpc_retail_oos_operator_grant','rpc_retail_oos_capabilities','rpc_retail_mis_access') and a.grantee='service_role'::regrole)) then raise exception 'Operator function ACL drift';end if;
 if expected.name in ('rpc_retail_oos_operator_grant','rpc_retail_oos_capabilities','rpc_retail_mis_access') and not has_function_privilege('service_role',f.oid,'EXECUTE') then raise exception 'Operator RPC execute missing';end if;
 end loop;
 for expected in select * from (values
 ('public.retail_unified_access(uuid,text,text)','53963434582b4ca43e0e98a77a76dfe0'),
 ('public.rpc_retail_service_command(uuid,uuid,text,uuid,integer,jsonb)','efabf57819cd99a3514da79ca8662e39'),
 ('public.rpc_retail_service_import(uuid,text,text,text,jsonb)','d8b0498b3670eac2c4bfea497f63426c'),
 ('public.rpc_retail_service_snapshot(uuid)','bd40e5ca30d4f6fb1049891b2f257339')
 ) x(signature,digest) loop
 obj:=to_regprocedure(expected.signature);if obj is null then raise exception 'Protected service missing';end if;select * into f from pg_proc where oid=obj;
 if md5(replace(f.prosrc,E'\r\n',E'\n'))<>expected.digest or has_function_privilege('anon',obj,'EXECUTE') or has_function_privilege('authenticated',obj,'EXECUTE') or has_function_privilege('service_role',obj,'EXECUTE') is distinct from (f.proname<>'retail_unified_access') then raise exception 'Protected service drift';end if;
 end loop;
end;$$;
select 'PASS: operator extension; no grants; no MIS assignments; OOS gate closed; protected service routines unchanged' result;
rollback;
