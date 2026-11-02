-- Prepared owner verification for the NEW MIS migration only. No legacy reinstall.
begin read only;
set local search_path=pg_catalog,public;
set local statement_timeout='30s';
-- Exact committed migration bodies/policies; PostgreSQL 17 catalog representation.
do $exact$ declare expected record;f record;p record;obj oid;r text;t text;begin
 for expected in select * from (values
('public.retail_mis_immutable()','37af66b89c200c8008e9027047832beb',false),
('public.retail_mis_super(uuid)','61e1d00ac4301adced86abee6b05d28d',true),
('public.retail_mis_allowed(uuid,text,text,boolean)','76d9993da440c19b5e15f2b3fc3bfa3b',true),
('public.retail_mis_unique_store(uuid)','17cae82665dd1eb4bd9c7a89c27c5bb6',true),
('public.rpc_retail_mis_access(uuid,uuid)','839b5f5685879b947eba345105bf8909',true),
('public.rpc_retail_mis_assignments(uuid)','f8b1aaf2b9501bfc02751b70368d69e6',true),
('public.rpc_retail_mis_assign(uuid,uuid,uuid,text,text,text[],text,integer)','49264cd751f59e5cb2590467b66371e4',true),
('public.rpc_retail_mis_oos_stores(uuid)','088751299e644e8828d0eef3e1c87147',true),
('public.retail_mis_oos_order_allowed(uuid,uuid,boolean)','935af0420dc829ecea24abe9bab8a745',true),
('public.rpc_retail_mis_report(uuid,text,date,date,text)','ebf26e30c962b7423c1da47f2f9e409b',true),
('public.retail_mis_storage_guard()','643598d03b9be3bcaa77fd1f51676528',true),
('public.retail_mis_current_account()','c37579580f61546d79cc78de916ff7aa',true),
('public.rpc_retail_mis_evidence_prepare(uuid,text,uuid,text,bigint)','954dc50a855f555c6627a1b96bf71ae7',true),
('public.rpc_retail_mis_evidence_object(uuid,uuid,boolean)','4cb150df8723fc204bc9131a3925e14d',true),
('public.rpc_retail_mis_evidence_finalize(uuid,uuid)','c9bd3afbfbca660251eae6bb85db2d8c',true),
('public.rpc_retail_mis_evidence_retire(uuid,uuid,text)','925496c9b858ae213415d9c3d5d53359',true),
('public.rpc_retail_mis_oos_history(uuid,uuid)','a969fef807df85ea326b8b81ee0ade74',true),
('public.rpc_retail_mis_oos_attachment(uuid,uuid)','24745d11107cfdd57fb2ff62d53f74c9',true),
('public.rpc_retail_mis_identity(uuid,text)','0234fd4eb287919f8938ba6685989a3f',true),
('public.rpc_retail_mis_store_reviews(uuid)','5189cf97d5591b7d5d15815dc7f96dc1',true),
('public.rpc_retail_mis_store_review(uuid,uuid,boolean,text)','290e68565d47903f5e6f669f314cd920',true),
('public.retail_mis_oos_enabled()','85af1fba3312ba61e687bb894a0d8229',true),
('public.retail_mis_retired_order_guard()','7dd7f1a2504a2718f2f24003c1f23c54',true),
('public.retail_mis_operations_access(uuid,text,boolean)','6a2afd2ecdaa2a5ddbfba7f9dff0018d',true),
('public.retail_mis_cleaning_access(uuid,text,text)','dcb793f236bf5b3acf5781866148d4ff',true),
('public.retail_mis_oos_access(uuid,text,text)','cb94e01ec7751b70be0eb49659073607',true),
('public.rpc_retail_mis_existing_evidence(uuid,text,uuid,uuid)','526528bd931dd7dd42cab38c9c76deeb',true),
('public.rpc_retail_mis_linked_evidence(uuid,uuid)','19a5c335330ebd962b5d34201d5d395d',true),
('public.rpc_retail_mis_command(uuid,text,text,jsonb)','034041405b434d9888c36ffce0c0c20f',true),
('public.retail_mis_maintenance_complete(uuid,uuid,text,date,uuid)','53b334481f459cca1944a03f9a4b8c53',true),
('public.retail_mis_thermography_command(uuid,text,uuid,uuid,date,integer,uuid)','877cd38c70248c956a6de046b883580c',true),
('public.retail_mis_fault_update(uuid,uuid,text,text,timestamptz,uuid)','960c74a282b851a0310c85b6e3010ddb',true),
('public.retail_mis_cleaning_link_source(uuid,uuid)','3cb6fdfa0952a3882545efce8d49beca',true),
('public.retail_mis_cleaning_link_fo(uuid,uuid,uuid)','c3897f125f1885c0c88e04ff7a9bba1f',true),
('public.retail_mis_service_command(uuid,uuid,text,uuid,integer,jsonb)','56d34f56c522e23d236df09a0e3de69b',true),
('public.rpc_retail_mis_oos_import(uuid,text,text,text,jsonb)','692f6ccbccedba33ad6250bae7066969',true),
('public.rpc_retail_mis_attendance_commit(uuid,uuid,boolean,text,text)','f3f621fbb66572222cdc8b4469a3d0bf',true)
 ) x(signature,digest,definer) loop
  obj:=to_regprocedure(expected.signature);if obj is null then raise exception 'MIS routine missing: %',expected.signature;end if;
  select * into f from pg_proc where oid=obj;
  if md5(replace(f.prosrc,E'\r\n',E'\n'))<>expected.digest or f.prosecdef<>expected.definer or pg_get_userbyid(f.proowner)<>'postgres' then raise exception 'MIS routine fingerprint/owner drift: %',expected.signature;end if;
  if not exists(select 1 from unnest(f.proconfig) cfg where regexp_replace(cfg,'[[:space:]]','','g') in ('search_path=pg_catalog,public','search_path=public,pg_temp')) then raise exception 'MIS routine search_path drift: %',expected.signature;end if;
  if exists(select 1 from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a where a.grantee<>f.proowner and not(f.proname like 'rpc_retail_mis_%' and a.grantee='service_role'::regrole) and not(f.proname='retail_mis_current_account' and a.grantee='authenticated'::regrole)) then raise exception 'MIS routine ACL failed: %',expected.signature;end if;
 end loop;
 if (select count(*) from pg_proc where pronamespace='public'::regnamespace and (proname like 'retail_mis_%' or proname like 'rpc_retail_mis_%'))<>37 then raise exception 'Unexpected MIS routine count';end if;
 -- Missing approved legacy functions are failures, never omitted result rows.
 for expected in select * from (values
('public.rpc_retail_fault_update(uuid,uuid,text,text,timestamptz,uuid)','2f7e5039907d5ce2c24e25b4554ffa23'),
('public.rpc_retail_cleaning_link_fo(uuid,uuid,uuid)','c41410e5b813a1f56bc168f25ad4f707'),
('public.rpc_retail_cleaning_link_source(uuid,uuid)','7a9cafa4ac95c7fddbd849dd5baa1ef0'),
('public.training_legacy_write_guard()','708d133bfea8906bf76ce0a863d12d7b'),
('public.retail_cleaning_storage_guard()','5adc6c2bbf9ae1052e5aa5d70502cd17'),
('public.retail_unified_access(uuid,text,text)','53963434582b4ca43e0e98a77a76dfe0'),
('public.rpc_retail_service_command(uuid,uuid,text,uuid,integer,jsonb)','efabf57819cd99a3514da79ca8662e39'),
('public.rpc_retail_service_import(uuid,text,text,text,jsonb)','d8b0498b3670eac2c4bfea497f63426c'),
('public.rpc_retail_service_snapshot(uuid)','bd40e5ca30d4f6fb1049891b2f257339')
 ) x(signature,digest) loop
  obj:=to_regprocedure(expected.signature);if obj is null then raise exception 'Existing protected workflow missing: %',expected.signature;end if;
  select * into f from pg_proc where oid=obj;
  if md5(replace(f.prosrc,E'\r\n',E'\n'))<>expected.digest then raise exception 'Existing protected workflow fingerprint drift: %',expected.signature;end if;
  if f.proname in ('retail_unified_access','rpc_retail_service_command','rpc_retail_service_import','rpc_retail_service_snapshot') then
   if not f.prosecdef or pg_get_userbyid(f.proowner)<>'postgres' or not exists(select 1 from unnest(f.proconfig) cfg where regexp_replace(cfg,'[[:space:]]','','g')='search_path=pg_catalog,public') then raise exception 'Existing OOS routine owner/settings drift: %',expected.signature;end if;
   if exists(select 1 from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a where a.grantee<>f.proowner and not(f.proname<>'retail_unified_access' and a.grantee='service_role'::regrole)) or has_function_privilege('anon',obj,'EXECUTE') or has_function_privilege('authenticated',obj,'EXECUTE') or has_function_privilege('service_role',obj,'EXECUTE') is distinct from (f.proname<>'retail_unified_access') then raise exception 'Existing OOS routine ACL drift: %',expected.signature;end if;
  end if;
 end loop;
 foreach t in array array['retail_mis_assignments','retail_mis_audit','retail_mis_records','retail_mis_evidence','retail_mis_oos_retirements','retail_mis_controls','retail_mis_store_proposals','retail_service_orders','retail_service_events','retail_service_order_stores'] loop
  obj:=to_regclass('public.'||t);if obj is null then raise exception 'Protected table missing: %',t;end if;
  select * into p from pg_class where oid=obj;
  if not p.relrowsecurity or p.relkind<>'r' or pg_get_userbyid(p.relowner)<>'postgres' then raise exception 'Protected table RLS/owner missing: %',t;end if;
  if exists(select 1 from aclexplode(coalesce(p.relacl,acldefault('r',p.relowner))) a where a.grantee<>p.relowner) or exists(select 1 from pg_attribute a cross join lateral aclexplode(a.attacl) acl where a.attrelid=obj and acl.grantee<>p.relowner) then raise exception 'Protected table PUBLIC/unintended direct grant: %',t;end if;
  foreach r in array array['anon','authenticated','service_role'] loop
   if has_table_privilege(r,obj,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') or has_any_column_privilege(r,obj,'SELECT,INSERT,UPDATE,REFERENCES') then raise exception 'Protected table direct privilege drift: % %',t,r;end if;
  end loop;
 end loop;
 for expected in select * from (values
('public','fault_tracker_import_batches','retail_mis_api_only','ALL','5afd0dccf72939cbbd02ee8e7e5e085d','5afd0dccf72939cbbd02ee8e7e5e085d'),
('public','fault_tracker_ticket_updates','retail_mis_api_only','ALL','5afd0dccf72939cbbd02ee8e7e5e085d','5afd0dccf72939cbbd02ee8e7e5e085d'),
('public','fault_tracker_tickets','retail_mis_api_only','ALL','5afd0dccf72939cbbd02ee8e7e5e085d','5afd0dccf72939cbbd02ee8e7e5e085d'),
('public','fo_activity_submissions','retail_mis_api_only','ALL','5afd0dccf72939cbbd02ee8e7e5e085d','5afd0dccf72939cbbd02ee8e7e5e085d'),
('public','fo_activity_uploads','retail_mis_api_only','ALL','5afd0dccf72939cbbd02ee8e7e5e085d','5afd0dccf72939cbbd02ee8e7e5e085d'),
('public','profiles','retail_mis_profile_delete','DELETE','5afd0dccf72939cbbd02ee8e7e5e085d',null),
('public','profiles','retail_mis_profile_insert','INSERT',null,'5afd0dccf72939cbbd02ee8e7e5e085d'),
('public','profiles','retail_mis_profile_read','SELECT','2febc93a1f9535809906ebbbea8b2bea',null),
('public','profiles','retail_mis_profile_update','UPDATE','5afd0dccf72939cbbd02ee8e7e5e085d','5afd0dccf72939cbbd02ee8e7e5e085d'),
('storage','objects','retail_mis_legacy_private_delete','DELETE','2c7504a32cf301eda5aed0a47971fbe2',null),
('storage','objects','retail_mis_legacy_private_insert','INSERT',null,'2c7504a32cf301eda5aed0a47971fbe2'),
('storage','objects','retail_mis_legacy_private_read','SELECT','2c7504a32cf301eda5aed0a47971fbe2',null),
('storage','objects','retail_mis_legacy_private_update','UPDATE','2c7504a32cf301eda5aed0a47971fbe2','2c7504a32cf301eda5aed0a47971fbe2'),
('storage','objects','retail_mis_private_delete','DELETE','6a1c1e0e75de55521bd0ba1dbb6793d1',null),
('storage','objects','retail_mis_private_insert','INSERT',null,'6a1c1e0e75de55521bd0ba1dbb6793d1'),
('storage','objects','retail_mis_private_read','SELECT','6a1c1e0e75de55521bd0ba1dbb6793d1',null),
('storage','objects','retail_mis_private_update','UPDATE','6a1c1e0e75de55521bd0ba1dbb6793d1','6a1c1e0e75de55521bd0ba1dbb6793d1')
 ) x(schema_name,table_name,policy_name,command,using_md5,check_md5) loop
  select * into p from pg_policies where schemaname=expected.schema_name and tablename=expected.table_name and policyname=expected.policy_name;
  if not found or p.permissive<>'RESTRICTIVE' or p.cmd<>expected.command or p.roles<>array['authenticated']::name[] or md5(replace(p.qual,E'\r\n',E'\n')) is distinct from expected.using_md5 or md5(replace(p.with_check,E'\r\n',E'\n')) is distinct from expected.check_md5 then raise exception 'MIS restrictive policy missing/changed: %.%.%',expected.schema_name,expected.table_name,expected.policy_name;end if;
 end loop;
 for expected in select * from (values
 ('public.retail_mis_audit','retail_mis_audit_immutable','public.retail_mis_immutable()',27),
 ('public.retail_mis_oos_retirements','retail_mis_retirement_immutable','public.retail_mis_immutable()',27),
 ('storage.objects','retail_mis_storage_guard','public.retail_mis_storage_guard()',31),
 ('public.retail_service_orders','retail_mis_retired_order_guard','public.retail_mis_retired_order_guard()',27)
 ) x(relation,trigger_name,signature,trigger_type) loop
  if not exists(select 1 from pg_trigger where tgrelid=to_regclass(expected.relation) and tgname=expected.trigger_name and not tgisinternal and tgenabled='O' and tgfoid=to_regprocedure(expected.signature) and tgtype=expected.trigger_type and tgqual is null and tgnargs=0) then raise exception 'MIS immutable/retirement trigger missing/changed: %',expected.trigger_name;end if;
 end loop;
 if (select count(*) from public.retail_mis_controls)<>1 or not exists(select 1 from pg_attribute a join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid='public.retail_mis_controls'::regclass and a.attname='oos_writes_enabled' and a.attnotnull and pg_get_expr(d.adbin,d.adrelid)='false') then raise exception 'MIS OOS false default/singleton drift';end if;
 if (select count(*) from storage.buckets where id in ('fo-activity-uploads','training-evidence','client-deep-cleaning-uploads') and public=false)<>3 then raise exception 'Existing evidence bucket missing or public';end if;
 if exists(select 1 from public.retail_mis_assignments) then raise exception 'Immediate postinstall requires zero MIS assignments; do not activate accounts yet';end if;
end;$exact$;

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
select 'PASS: immediate MIS postinstall; protected workflows unchanged; zero assignments; OOS gate closed' result;
rollback;
