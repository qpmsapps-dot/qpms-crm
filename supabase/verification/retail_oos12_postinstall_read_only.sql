-- Immediate engine postinstall. READ ONLY. Leaves all existing operational gates unchanged.
begin read only;
set local search_path=pg_catalog,public;set local statement_timeout='30s';
do $verify$ declare expected record;f record;c record;t text;begin
 for expected in select * from (values
('retail_oos12_catalog_guard','cc30db278b7098f5eb02cc76da60d49b',true),
('retail_oos12_reference_guard','0ef652f087dcacf9cf098fa7c1d63655',true),
('retail_oos12_identity','af903a15c7dc369f92c36f04d2de99b7',true),
('retail_oos12_authority','33b7f9aafc08b77686e4aabb92e2e70e',true),
('retail_oos12_scope','8a8b84c3b2d6e3a668d32e985e70ef09',true),
('retail_oos12_order_allowed','0af91161fb59c65fbaccd26b0da08aa9',true),
('retail_oos12_enabled','2fb9e6e6b531acb78b5de3df71046142',true),
('rpc_retail_oos12_activate','dcc577e1eca1f966a3d941dbb305002a',true),
('retail_oos12_spec','53358ac2de0ec53bcefe94f412f5b7b6',false),
('retail_oos12_can_advance','508ff3867457a660f938a96b55210b08',true),
('rpc_retail_oos12_access','57dec1e638fd29f8acbe53282365d130',true),
('retail_oos12_evidence_guard','4949c2c18016cfa64a564418b60bac07',false),
('retail_oos12_storage_guard','80cab19414f2bcf6c01d3644e8f592cd',true),
('rpc_retail_oos12_evidence_prepare','aff0075c2f4ac359549d443d6e7904be',true),
('rpc_retail_oos12_evidence_object','f83c047ece81e3d0cb5319907e792740',true),
('rpc_retail_oos12_transition','25c15001240ded37f47e565fa824011b',true),
('rpc_retail_oos12_import','0d70dc00370851b3a4af5cae4214befa',true),
('rpc_retail_oos12_stores','671dedf6c46703cc675d7b4b474db2d3',true),
('rpc_retail_oos12_capabilities','aa8dc6d33338b2cd7c18d6462e53134a',true),
('rpc_retail_oos_register','b0be10ca6d4fd7eb267608467038ff54',true),
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
 if not exists(select 1 from pg_proc where oid='public.retail_oos12_legacy_register(uuid)'::regprocedure and md5(replace(prosrc,E'\r\n',E'\n'))='3d861d6c2eb1f3723fd082c50f8c9e11') or has_function_privilege('service_role','public.retail_oos12_legacy_register(uuid)','EXECUTE') then raise exception 'Private legacy projection drift';end if;
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
 if not exists(select 1 from pg_policies p where p.schemaname='storage' and p.tablename='objects' and p.policyname=expected.name and p.permissive='RESTRICTIVE' and p.roles=array['authenticated']::name[] and p.cmd=expected.command and md5(p.qual) is not distinct from expected.using_digest and md5(p.with_check) is not distinct from expected.check_digest) then raise exception 'OOS12 storage policy drift: %',expected.name;end if;end loop;
 if not exists(select 1 from pg_trigger where tgrelid='public.retail_service_orders'::regclass and tgname='retail_oos12_legacy_reference_guard' and tgenabled='O' and tgtype=7 and tgfoid='public.retail_oos12_reference_guard()'::regprocedure) or not exists(select 1 from pg_trigger where tgrelid='public.retail_oos12_orders'::regclass and tgname='retail_oos12_reference_guard' and tgenabled='O' and tgtype=7 and tgfoid='public.retail_oos12_reference_guard()'::regprocedure) then raise exception 'Cross-version reference guard drift';end if;
 if not exists(select 1 from storage.buckets where id='retail-oos12-evidence' and not public and file_size_limit=15728640 and allowed_mime_types=array['application/pdf','image/jpeg','image/png','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.openxmlformats-officedocument.wordprocessingml.document']) then raise exception 'OOS12 private bucket drift';end if;
end;$verify$;
select 'PASS: OOS12 disabled; scoped service-only APIs; immutable evidence/history; legacy contracts unchanged' result;
rollback;
