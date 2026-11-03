-- Immediate engine postinstall. READ ONLY. Leaves all existing operational gates unchanged.
begin read only;
set local search_path=pg_catalog,public;set local statement_timeout='30s';
do $verify$ declare expected record;f record;c record;t text;begin
 for expected in select * from (values
('retail_oos12_catalog_guard','cc30db278b7098f5eb02cc76da60d49b',true),
('retail_oos12_reference_guard','0ef652f087dcacf9cf098fa7c1d63655',true),
('retail_oos12_identity','af903a15c7dc369f92c36f04d2de99b7',true),
('retail_oos12_authority','a1ac9ceb153407c1f5687b9e1a071219',true),
('retail_oos12_scope','4d9a60f4f41a066a44c5563c405d2e7b',true),
('retail_oos12_order_allowed','28ea3893e24502aa54ebae821ff1b362',true),
('retail_oos12_enabled','2fb9e6e6b531acb78b5de3df71046142',true),
('rpc_retail_oos12_activate','e52052b9dedc45f053eff5be0cb2839d',true),
('retail_oos12_spec','fc57043347bddf490257e20deb675a62',false),
('retail_oos12_can_advance','6bf5a7d19f5da3582594c239ae72d203',true),
('rpc_retail_oos12_access','0b3e0b021610056213a92cb0881c9336',true),
('retail_oos12_evidence_guard','4949c2c18016cfa64a564418b60bac07',false),
('retail_oos12_storage_guard','80cab19414f2bcf6c01d3644e8f592cd',true),
('rpc_retail_oos12_evidence_prepare','aff0075c2f4ac359549d443d6e7904be',true),
('rpc_retail_oos12_evidence_object','f83c047ece81e3d0cb5319907e792740',true),
('rpc_retail_oos12_transition','cc5a4a0cdfe1c7bb7dce765934ee0089',true),
('rpc_retail_oos12_import','572ffd3b3b313b0b91eb8509722ad12e',true),
('rpc_retail_oos12_stores','349db6a4d91730888afbef90d6a3bf53',true),
('rpc_retail_oos12_capabilities','5d9bd305a4b9ab2488dc05da13884a12',true),
('rpc_retail_oos_register','f27faf8c1071916ab75304827c51510d',true),
('rpc_retail_oos12_history','20aa5fd77a8a6e500898fe0f6fe9248c',true)
 ) x(name,digest,definer) loop
 select * into f from pg_proc where pronamespace='public'::regnamespace and proname=expected.name;
 if not found or md5(replace(f.prosrc,E'\r\n',E'\n'))<>expected.digest or f.prosecdef<>expected.definer or pg_get_userbyid(f.proowner)<>'postgres' then raise exception 'OOS12 function drift: %',expected.name;end if;
 if not exists(select 1 from unnest(f.proconfig) cfg where regexp_replace(cfg,'[[:space:]]','','g')='search_path=pg_catalog,public') then raise exception 'OOS12 search path drift';end if;
 if exists(select 1 from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a where a.grantee<>f.proowner and not(expected.name like 'rpc_%' and a.grantee='service_role'::regrole)) or has_function_privilege('anon',f.oid,'EXECUTE') or has_function_privilege('authenticated',f.oid,'EXECUTE') or has_function_privilege('service_role',f.oid,'EXECUTE') is distinct from (expected.name like 'rpc_%') then raise exception 'OOS12 execute ACL drift: %',expected.name;end if;
 end loop;
 foreach t in array array['retail_oos12_orders','retail_oos12_events','retail_oos12_order_stores','retail_oos12_evidence','retail_oos12_import_receipts','retail_oos_workflow_catalog'] loop
 select * into c from pg_class where oid=to_regclass('public.'||t);
 if not found or not c.relrowsecurity or pg_get_userbyid(c.relowner)<>'postgres' then raise exception 'OOS12 private table RLS/owner drift';end if;
 if exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where a.grantee<>c.relowner) or exists(select 1 from pg_attribute a cross join lateral aclexplode(a.attacl) acl where a.attrelid=c.oid and acl.grantee<>c.relowner) then raise exception 'OOS12 private table grants drift';end if;
 end loop;
 if not exists(select 1 from public.retail_oos_workflow_catalog where version=2 and not enabled and revision=0) then raise exception 'Immediate install requires v2 disabled revision zero';end if;
 if not exists(select 1 from pg_proc where oid='public.retail_oos12_legacy_register(uuid)'::regprocedure and md5(replace(prosrc,E'\r\n',E'\n'))='3e91a19f8f4a9f8e03d13c12f26d6100') or has_function_privilege('service_role','public.retail_oos12_legacy_register(uuid)','EXECUTE') then raise exception 'Private legacy projection drift';end if;
 for expected in select * from (values
 ('public.retail_mis_service_command(uuid,uuid,text,uuid,integer,jsonb)','56d34f56c522e23d236df09a0e3de69b'),
 ('public.rpc_retail_mis_oos_import(uuid,text,text,text,jsonb)','692f6ccbccedba33ad6250bae7066969'),
 ('public.rpc_retail_service_command(uuid,uuid,text,uuid,integer,jsonb)','efabf57819cd99a3514da79ca8662e39'),
 ('public.rpc_retail_service_snapshot(uuid)','bd40e5ca30d4f6fb1049891b2f257339')
 ) x(signature,digest) loop
 if not exists(select 1 from pg_proc where oid=to_regprocedure(expected.signature) and md5(replace(prosrc,E'\r\n',E'\n'))=expected.digest) then raise exception 'Legacy contract drift: %',expected.signature;end if;end loop;
 for expected in select * from (values
 ('retail_oos12_events','retail_oos12_events_immutable','retail_mis_immutable',27),
 ('retail_oos12_order_stores','retail_oos12_links_immutable','retail_mis_immutable',27),
 ('retail_oos12_import_receipts','retail_oos12_receipts_immutable','retail_mis_immutable',27),
 ('retail_oos12_evidence','retail_oos12_evidence_immutable','retail_oos12_evidence_guard',27),
 ('retail_oos_workflow_catalog','retail_oos_workflow_catalog_immutable','retail_oos12_catalog_guard',27)
 ) x(relation,trigger_name,function_name,trigger_type) loop
 if not exists(select 1 from pg_trigger where tgrelid=to_regclass('public.'||expected.relation) and tgname=expected.trigger_name and tgenabled='O' and tgtype=expected.trigger_type and tgfoid=to_regprocedure('public.'||expected.function_name||'()')) then raise exception 'OOS12 immutable trigger drift';end if;end loop;
 if not exists(select 1 from pg_trigger where tgrelid='storage.objects'::regclass and tgname='retail_oos12_storage_guard' and tgenabled='O' and tgtype=31 and tgfoid='public.retail_oos12_storage_guard()'::regprocedure) then raise exception 'Storage immutable guard drift';end if;
 for expected in select * from (values
 ('retail_oos12_private_insert','INSERT',null,md5('(bucket_id <> ''retail-oos12-evidence''::text)')),
 ('retail_oos12_private_read','SELECT',md5('(bucket_id <> ''retail-oos12-evidence''::text)'),null),
 ('retail_oos12_private_update','UPDATE',md5('(bucket_id <> ''retail-oos12-evidence''::text)'),md5('(bucket_id <> ''retail-oos12-evidence''::text)')),
 ('retail_oos12_private_delete','DELETE',md5('(bucket_id <> ''retail-oos12-evidence''::text)'),null)
 ) x(name,command,using_digest,check_digest) loop
 if not exists(select 1 from pg_policies p where p.schemaname='storage' and p.tablename='objects' and p.policyname=expected.name and p.permissive='RESTRICTIVE' and p.roles=array['anon','authenticated']::name[] and p.cmd=expected.command and md5(p.qual) is not distinct from expected.using_digest and md5(p.with_check) is not distinct from expected.check_digest) then raise exception 'OOS12 storage policy drift: %',expected.name;end if;end loop;
 if not exists(select 1 from pg_trigger where tgrelid='public.retail_service_orders'::regclass and tgname='retail_oos12_legacy_reference_guard' and tgenabled='O' and tgtype=7 and tgfoid='public.retail_oos12_reference_guard()'::regprocedure) or not exists(select 1 from pg_trigger where tgrelid='public.retail_oos12_orders'::regclass and tgname='retail_oos12_reference_guard' and tgenabled='O' and tgtype=7 and tgfoid='public.retail_oos12_reference_guard()'::regprocedure) then raise exception 'Cross-version reference guard drift';end if;
 if not exists(select 1 from storage.buckets where id='retail-oos12-evidence' and not public and file_size_limit=15728640 and allowed_mime_types=array['application/pdf','image/jpeg','image/png','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.openxmlformats-officedocument.wordprocessingml.document']) then raise exception 'OOS12 private bucket drift';end if;
end;$verify$;

-- Reviewed MIS profile/state and OOS normalization contracts, including private execute ACLs.
do $mis_verify$ declare f record;expected record;begin
 for expected in select * from (values
 ('retail_oos_state','d1c70cc3b897479f1d08b7010ebb3645',false),
 ('retail_mis_allowed','65bad364fa194b73341b7939e7c9795a',false),
 ('rpc_retail_mis_assign','b240e2b167c642cbcd03cd3796450a9b',true),
 ('rpc_retail_mis_user_contract','dca405901f772aa8ed90f1aad856b4c3',true),
 ('rpc_retail_mis_user_save','380497f895e947a4f8c3e600ac9387d1',true)
 ) x(name,digest,service) loop
 select * into f from pg_proc where pronamespace='public'::regnamespace and proname=expected.name;
 if not found or md5(replace(f.prosrc,E'\r\n',E'\n'))<>expected.digest or pg_get_userbyid(f.proowner)<>'postgres' or f.prosecdef is distinct from (expected.name<>'retail_oos_state') then raise exception 'MIS final contract drift: %',expected.name;end if;
 if not exists(select 1 from unnest(f.proconfig) cfg where regexp_replace(cfg,'[[:space:]]','','g')='search_path=pg_catalog,public') or exists(select 1 from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a where a.grantee<>f.proowner and not(expected.service and a.grantee='service_role'::regrole)) or has_function_privilege('anon',f.oid,'EXECUTE') or has_function_privilege('authenticated',f.oid,'EXECUTE') or has_function_privilege('service_role',f.oid,'EXECUTE') is distinct from expected.service then raise exception 'MIS final execute ACL drift: %',expected.name;end if;
 end loop;
 if public.retail_oos_state('PY')<>'TN' or public.retail_oos_state('AP-1')=public.retail_oos_state('AP-2') then raise exception 'OOS six-state normalization drift';end if;
end;$mis_verify$;
select 'PASS: OOS12 disabled; scoped service-only APIs; immutable evidence/history; legacy contracts unchanged' result;
rollback;
