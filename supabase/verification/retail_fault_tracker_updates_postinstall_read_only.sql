-- Fault-RPC-only postcheck. The Cleaning link RPCs remain absent/on hold.
-- No Save/import/mutation RPC is invoked. One combined result table.
begin transaction read only;
set local statement_timeout='30s';
do $check$
declare item record;p record;role_name text;
begin
 for item in select * from (values
  ('public.rpc_retail_fault_update_capability()','c3217d3441e0a7e5de42e3955cd32e94'),
  ('public.rpc_retail_fault_update(uuid,uuid,text,text,timestamptz,uuid)','2f7e5039907d5ce2c24e25b4554ffa23')
 ) expected(signature,body_md5) loop
  select * into p from pg_proc where oid=to_regprocedure(item.signature);
  if not found then raise exception 'Required Fault RPC missing: %',item.signature;end if;
  if p.prosecdef is not true or (p.proconfig @> array['search_path=pg_catalog, public']) is not true or md5(replace(p.prosrc,E'\r\n',E'\n'))<>item.body_md5 then raise exception 'Fault RPC definition/settings mismatch: %',item.signature;end if;
  if has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE') or not has_function_privilege('service_role',p.oid,'EXECUTE') then raise exception 'Incorrect Fault RPC execution privileges: %',item.signature;end if;
  if exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.privilege_type='EXECUTE' and a.grantee not in (p.proowner,'service_role'::regrole::oid)) then raise exception 'Unexpected Fault RPC grantee: %',item.signature;end if;
 end loop;
 if not exists(select 1 from pg_index i where i.indexrelid=to_regclass('public.retail_fault_update_request') and i.indrelid='public.fault_tracker_ticket_updates'::regclass and i.indisunique and i.indisvalid and i.indnkeyatts=2
  and i.indkey[0]=(select attnum from pg_attribute where attrelid=i.indrelid and attname='ticket_id' and not attisdropped)
  and i.indkey[1]=0
  and pg_get_expr(i.indexprs,i.indrelid)='(metadata ->> ''retail_request_id''::text)'
  and pg_get_expr(i.indpred,i.indrelid)='(metadata ? ''retail_request_id''::text)') then raise exception 'Fault idempotency index definition/validity mismatch';end if;
 for item in select name from (values('fault_tracker_import_batches'),('fault_tracker_tickets'),('fault_tracker_ticket_updates')) t(name) loop
  foreach role_name in array array['anon','authenticated'] loop
   if has_table_privilege(role_name,'public.'||item.name,'INSERT,UPDATE,DELETE') or has_any_column_privilege(role_name,'public.'||item.name,'INSERT,UPDATE') then raise exception 'Direct Fault writes remain for % on %',role_name,item.name;end if;
  end loop;
  foreach role_name in array array['SELECT','INSERT','UPDATE','DELETE'] loop
   if not has_table_privilege('service_role','public.'||item.name,role_name) then raise exception 'Required backend % privilege missing on %',role_name,item.name;end if;
  end loop;
  if not has_table_privilege('authenticated','public.'||item.name,'SELECT') then raise exception 'Existing authenticated reporting SELECT missing on %',item.name;end if;
 end loop;
end;$check$;
with functions as (
 select p.oid::regprocedure signature,r.rolname owner,p.proconfig,
 md5(replace(p.prosrc,E'\r\n',E'\n')) body_md5,
 has_function_privilege('anon',p.oid,'EXECUTE') anon_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated_execute,
 has_function_privilege('service_role',p.oid,'EXECUTE') service_execute
 from pg_proc p join pg_roles r on r.oid=p.proowner
 where p.oid in (to_regprocedure('public.rpc_retail_fault_update_capability()'),to_regprocedure('public.rpc_retail_fault_update(uuid,uuid,text,text,timestamptz,uuid)'))
), preservation as (
 select 'imports' source,count(*) rows,md5(string_agg(md5(to_jsonb(r)::text),'' order by md5(to_jsonb(r)::text))) digest from public.fault_tracker_import_batches r
 union all select 'tickets',count(*),md5(string_agg(md5(to_jsonb(r)::text),'' order by md5(to_jsonb(r)::text))) from public.fault_tracker_tickets r
 union all select 'ticket_history',count(*),md5(string_agg(md5(to_jsonb(r)::text),'' order by md5(to_jsonb(r)::text))) from public.fault_tracker_ticket_updates r
)
select 1 section_number,'Fault RPC assertions passed; settings and ACLs' section_name,(select jsonb_agg(to_jsonb(f)) from functions f) result
union all select 2,'Verified unique request index',(select jsonb_agg(jsonb_build_object('indexdef',indexdef)) from pg_indexes where schemaname='public' and indexname='retail_fault_update_request')
union all select 3,'Fault source/history preservation (compare approved baseline)',(select jsonb_agg(to_jsonb(p)) from preservation p)
union all select 4,'Cleaning workflow RPCs still on hold',jsonb_build_object('link_source_present',to_regprocedure('public.rpc_retail_cleaning_link_source(uuid,uuid)') is not null,'link_fo_present',to_regprocedure('public.rpc_retail_cleaning_link_fo(uuid,uuid,uuid)') is not null)
order by section_number;
rollback;
