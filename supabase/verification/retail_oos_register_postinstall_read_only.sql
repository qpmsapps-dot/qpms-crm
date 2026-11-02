-- Prepared owner check. Does not require or change operational write gates.
begin read only;
set local search_path=pg_catalog,public;
set local statement_timeout='30s';
do $$declare f record;begin
 select * into f from pg_proc where oid=to_regprocedure('public.rpc_retail_oos_register(uuid)');
 if not found or not f.prosecdef or pg_get_userbyid(f.proowner)<>'postgres' or md5(replace(f.prosrc,E'\r\n',E'\n'))<>'3d861d6c2eb1f3723fd082c50f8c9e11' then raise exception 'Register body/owner drift';end if;
 if not exists(select 1 from unnest(f.proconfig) c where regexp_replace(c,'[[:space:]]','','g')='search_path=pg_catalog,public') then raise exception 'Register search path drift';end if;
 if has_function_privilege('anon',f.oid,'EXECUTE') or has_function_privilege('authenticated',f.oid,'EXECUTE') or not has_function_privilege('service_role',f.oid,'EXECUTE') then raise exception 'Register execute ACL drift';end if;
 if exists(select 1 from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a where a.grantee not in (f.proowner,'service_role'::regrole)) then raise exception 'Unexpected register execute grant';end if;
 if not exists(select 1 from pg_class where oid='public.retail_oos_workflow_catalog'::regclass and relrowsecurity and pg_get_userbyid(relowner)='postgres') then raise exception 'Catalog RLS/owner drift';end if;
 if exists(select 1 from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where c.oid='public.retail_oos_workflow_catalog'::regclass and a.grantee<>c.relowner) then raise exception 'Catalog direct grant';end if;
 if (select count(*) from public.retail_oos_workflow_catalog)<>1 or not exists(select 1 from public.retail_oos_workflow_catalog where version=2 and enabled=false and jsonb_array_length(stages)=12) then raise exception 'Disabled versioned catalog drift';end if;
 if not exists(select 1 from pg_trigger where tgrelid='public.retail_oos_workflow_catalog'::regclass and tgname='retail_oos_workflow_catalog_immutable' and tgfoid='public.retail_mis_immutable()'::regprocedure and tgenabled='O' and tgtype=27) then raise exception 'Catalog immutable trigger drift';end if;
 if not exists(select 1 from pg_proc where oid='public.retail_mis_service_command(uuid,uuid,text,uuid,integer,jsonb)'::regprocedure and md5(replace(prosrc,E'\r\n',E'\n'))='56d34f56c522e23d236df09a0e3de69b') then raise exception 'Legacy command changed';end if;
 if not exists(select 1 from pg_proc where oid='public.rpc_retail_mis_oos_import(uuid,text,text,text,jsonb)'::regprocedure and md5(replace(prosrc,E'\r\n',E'\n'))='692f6ccbccedba33ad6250bae7066969') then raise exception 'Legacy import changed';end if;
end;$$;
select 'PASS: register projection private; v2 catalog disabled; legacy write contracts unchanged' result;
rollback;
