-- Prepared owner verification for the NEW MIS migration only. No legacy reinstall.
begin read only;
do $verify$ declare t text;f record;begin
 foreach t in array array['retail_mis_assignments','retail_mis_audit','retail_mis_records','retail_mis_evidence','retail_mis_oos_retirements','retail_mis_controls','retail_mis_store_proposals'] loop
  if not exists(select 1 from pg_class where oid=to_regclass('public.'||t) and relrowsecurity) or has_table_privilege('authenticated','public.'||t,'SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('anon','public.'||t,'SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('service_role','public.'||t,'SELECT,INSERT,UPDATE,DELETE') then raise exception 'MIS private table protection failed: %',t;end if;
 end loop;
 for f in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'rpc_retail_mis_%' or p.proname like 'retail_mis_%') loop
  if has_function_privilege('anon',f.oid,'EXECUTE') or (f.proname<>'retail_mis_current_account' and has_function_privilege('authenticated',f.oid,'EXECUTE')) or (f.proname like 'rpc_retail_mis_%' and not has_function_privilege('service_role',f.oid,'EXECUTE')) or (f.proname not like 'rpc_retail_mis_%' and has_function_privilege('service_role',f.oid,'EXECUTE')) then raise exception 'MIS routine ACL failed: %',f.proname;end if;
 end loop;
 if not exists(select 1 from public.retail_mis_controls where singleton and oos_writes_enabled=false) then raise exception 'MIS OOS write control must remain closed';end if;
 if not exists(select 1 from storage.buckets where id='retail-mis-evidence' and public=false and file_size_limit=5242880 and allowed_mime_types=array['image/jpeg','image/png','image/webp']) then raise exception 'MIS private bucket configuration failed';end if;
 if (select count(*) from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'retail_mis_%' and permissive='RESTRICTIVE')<>8 then raise exception 'MIS restrictive storage policies missing';end if;
 if (select count(*) from pg_policies where schemaname='public' and tablename='profiles' and policyname like 'retail_mis_profile_%' and permissive='RESTRICTIVE')<>4 then raise exception 'MIS restrictive profile policies missing';end if;
 if (select count(*) from pg_policies where schemaname='public' and policyname='retail_mis_api_only' and permissive='RESTRICTIVE')<>5 then raise exception 'MIS legacy API containment missing';end if;
end;$verify$;
select p.oid::regprocedure signature,p.prosecdef,p.proconfig,
 has_function_privilege('anon',p.oid,'EXECUTE') anon_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') employee_execute,
 has_function_privilege('service_role',p.oid,'EXECUTE') service_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'rpc_retail_mis_%' or p.proname like 'retail_mis_%') order by p.oid::regprocedure::text;
select c.relname,c.relrowsecurity,has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') employee_any_access,has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE') service_direct_any_access
from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname like 'retail_mis_%' order by c.relname;
select singleton,oos_writes_enabled from public.retail_mis_controls;
select id,public,file_size_limit,allowed_mime_types from storage.buckets where id='retail-mis-evidence';
select policyname,permissive,cmd,roles,qual,with_check from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'retail_mis_%' order by policyname;
select tgname,tgrelid::regclass,pg_get_triggerdef(oid) from pg_trigger where not tgisinternal and tgname like 'retail_mis_%' order by tgname;
-- Existing installed workflow fingerprints must match the retained preinstall baseline.
select p.oid::regprocedure signature,md5(replace(p.prosrc,E'\r\n',E'\n')) body_md5 from pg_proc p where p.oid in (
 to_regprocedure('public.rpc_retail_fault_update(uuid,uuid,text,text,timestamptz,uuid)'),
 to_regprocedure('public.rpc_retail_cleaning_link_fo(uuid,uuid,uuid)'),
 to_regprocedure('public.rpc_retail_cleaning_link_source(uuid,uuid)'),
 to_regprocedure('public.training_legacy_write_guard()'),
 to_regprocedure('public.retail_cleaning_storage_guard()')) order by p.oid::regprocedure::text;
rollback;
