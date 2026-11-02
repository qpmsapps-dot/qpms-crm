-- Cleaning-link installation postcheck: all workflow RPCs are now required.
-- READ ONLY. One combined four-row report. No mutation or evidence-signing RPCs.
-- Retain privately and compare the approved latest preservation baseline.
begin transaction read only;
set local statement_timeout='30s';
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

-- New link bodies must match the reviewed candidate exactly; existing isolation
-- helpers and Training guard must retain their installed fingerprints.
do $link_check$ declare item record;p record;begin
 for item in select * from (values
 ('public.rpc_retail_cleaning_link_source(uuid,uuid)','7a9cafa4ac95c7fddbd849dd5baa1ef0'),
 ('public.rpc_retail_cleaning_link_fo(uuid,uuid,uuid)','c41410e5b813a1f56bc168f25ad4f707'),
 ('public.retail_cleaning_object_access(text,text,boolean)','20a3caa9ed2dd6997a64ded6467449b7'),
 ('public.retail_cleaning_has_stored_pair(uuid)','3ca145deb7c40277ffcb33c8d612cd12'),
 ('public.retail_cleaning_legacy_guard()','5401d8130d7eed83c91873cbddf6447c'),
 ('public.retail_cleaning_storage_guard()','5adc6c2bbf9ae1052e5aa5d70502cd17'),
 ('public.training_legacy_write_guard()','708d133bfea8906bf76ce0a863d12d7b')
 ) expected(signature,body_md5) loop
  select * into p from pg_proc where oid=to_regprocedure(item.signature);
  if not found then raise exception 'Missing prerequisite/link function: %',item.signature;end if;
  if md5(replace(p.prosrc,E'\r\n',E'\n'))<>item.body_md5 then raise exception 'Function body differs from reviewed/installed version: %',item.signature;end if;
 end loop;
 if (select count(*) from pg_policies where schemaname='storage' and tablename='objects' and permissive='RESTRICTIVE' and policyname in ('retail_cleaning_private_read','retail_cleaning_owned_insert','retail_cleaning_draft_update','retail_cleaning_draft_delete'))<>4 then raise exception 'Four restrictive evidence policies required';end if;
 if (select count(*) from pg_trigger where not tgisinternal and (
  tgrelid=to_regclass('public.fo_activity_submissions') and tgname in ('trg_fo_activity_submissions_updated_at','trg_training_legacy_submission_write','trg_retail_cleaning_submission_guard')
  or tgrelid=to_regclass('public.fo_activity_uploads') and tgname in ('trg_training_legacy_upload_write','trg_retail_cleaning_upload_guard')
  or tgrelid=to_regclass('public.reliance_retail_management_audit') and tgname='trg_retail_management_audit_immutable'
  or tgrelid=to_regclass('storage.objects') and tgname='trg_retail_cleaning_storage_guard'))<>7 then raise exception 'Existing and additive protection triggers required';end if;
end;$link_check$;

with routines as (
 select p.oid::regprocedure signature,r.rolname owner,p.proconfig,
 md5(replace(p.prosrc,E'\r\n',E'\n')) body_md5,p.proacl,
 has_function_privilege('anon',p.oid,'EXECUTE') anon_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated_execute,
 has_function_privilege('service_role',p.oid,'EXECUTE') service_execute
 from pg_proc p join pg_roles r on r.oid=p.proowner
 where p.oid in (to_regprocedure('public.rpc_retail_fault_update_capability()'),to_regprocedure('public.rpc_retail_fault_update(uuid,uuid,text,text,timestamptz,uuid)'),to_regprocedure('public.rpc_retail_cleaning_link_source(uuid,uuid)'),to_regprocedure('public.rpc_retail_cleaning_link_fo(uuid,uuid,uuid)'))
), isolation as (
 select p.oid::regprocedure signature,md5(replace(p.prosrc,E'\r\n',E'\n')) body_md5
 from pg_proc p where p.oid in (to_regprocedure('public.retail_cleaning_object_access(text,text,boolean)'),to_regprocedure('public.retail_cleaning_has_stored_pair(uuid)'),to_regprocedure('public.retail_cleaning_legacy_guard()'),to_regprocedure('public.retail_cleaning_storage_guard()'),to_regprocedure('public.training_legacy_write_guard()'))
), protections as (
 select jsonb_build_object('policy',policyname,'kind',permissive,'cmd',cmd,'roles',roles,'using',qual,'with_check',with_check) details from pg_policies where schemaname='storage' and tablename='objects' and policyname in ('retail_cleaning_private_read','retail_cleaning_owned_insert','retail_cleaning_draft_update','retail_cleaning_draft_delete')
 union all select jsonb_build_object('trigger',tgname,'relation',tgrelid::regclass::text,'definition',pg_get_triggerdef(oid)) from pg_trigger where not tgisinternal and tgname in ('trg_fo_activity_submissions_updated_at','trg_training_legacy_submission_write','trg_retail_cleaning_submission_guard','trg_training_legacy_upload_write','trg_retail_cleaning_upload_guard','trg_retail_management_audit_immutable','trg_retail_cleaning_storage_guard')
 union all select jsonb_build_object('bucket',id,'public',public) from storage.buckets where id='fo-activity-uploads'
), preservation as (
 select 'stores' source,count(*) rows,md5(string_agg(md5(to_jsonb(r)::text),'' order by md5(to_jsonb(r)::text))) digest from public.reliance_retail_store_master r
 union all select 'aop',count(*),md5(string_agg(md5(to_jsonb(r)::text),'' order by md5(to_jsonb(r)::text))) from public.retail_attendance_aop_versions r
 union all select 'imports',count(*),md5(string_agg(md5(to_jsonb(r)::text),'' order by md5(to_jsonb(r)::text))) from public.fault_tracker_import_batches r
 union all select 'tickets',count(*),md5(string_agg(md5(to_jsonb(r)::text),'' order by md5(to_jsonb(r)::text))) from public.fault_tracker_tickets r
 union all select 'ticket_history',count(*),md5(string_agg(md5(to_jsonb(r)::text),'' order by md5(to_jsonb(r)::text))) from public.fault_tracker_ticket_updates r
 union all select 'schedules',count(*),md5(string_agg(md5(to_jsonb(r)::text),'' order by md5(to_jsonb(r)::text))) from public.client_deep_cleaning_schedules r
 union all select 'fo_submissions',count(*),md5(string_agg(md5(to_jsonb(r)::text),'' order by md5(to_jsonb(r)::text))) from public.fo_activity_submissions r
 union all select 'fo_uploads',count(*),md5(string_agg(md5(to_jsonb(r)::text),'' order by md5(to_jsonb(r)::text))) from public.fo_activity_uploads r
)
select 1 section_number,'All four workflow RPCs: assertions passed, settings and ACLs' section_name,(select jsonb_agg(to_jsonb(r)) from routines r) result
union all select 2,'Installed isolation and Training body fingerprints preserved',(select jsonb_agg(to_jsonb(i)) from isolation i)
union all select 3,'Evidence protections, original triggers and private bucket',(select jsonb_agg(details) from protections)
union all select 4,'Data preservation: no business Save/link invoked',(select jsonb_agg(to_jsonb(p)) from preservation p)
order by section_number;
rollback;
