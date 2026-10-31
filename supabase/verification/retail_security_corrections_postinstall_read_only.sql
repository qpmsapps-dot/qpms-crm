-- ONE combined private report. No mutation RPCs are invoked.
-- Compare with owner export (9) and the approved pre-DDL preservation baseline.
begin transaction read only;
set local statement_timeout='30s';
with required_functions(name) as (values
 ('retail_cleaning_object_access'),('retail_cleaning_has_stored_pair'),
 ('retail_cleaning_legacy_guard'),('retail_cleaning_storage_guard'),
 ('rpc_retail_fault_update'),('rpc_retail_fault_update_capability'),
 ('rpc_retail_cleaning_link_source'),('rpc_retail_cleaning_link_fo'),
 ('training_legacy_write_guard')),
functions as (
 select r.name,p.oid is not null as present,p.oid::regprocedure as signature,
 owner_role.rolname as owner,p.prosecdef,p.proconfig,
 case when p.oid is not null then md5(replace(p.prosrc,E'\r\n',E'\n')) end body_md5,
 case when p.oid is not null and anon_role.oid is not null then has_function_privilege(anon_role.oid,p.oid,'EXECUTE') end anon_execute,
 case when p.oid is not null and employee_role.oid is not null then has_function_privilege(employee_role.oid,p.oid,'EXECUTE') end employee_execute,
 case when p.oid is not null and service_role.oid is not null then has_function_privilege(service_role.oid,p.oid,'EXECUTE') end service_execute
 from required_functions r left join pg_namespace n on n.nspname='public'
 left join pg_proc p on p.pronamespace=n.oid and p.proname=r.name and p.prokind='f'
 left join pg_roles owner_role on owner_role.oid=p.proowner
 left join pg_roles anon_role on anon_role.rolname='anon'
 left join pg_roles employee_role on employee_role.rolname='authenticated'
 left join pg_roles service_role on service_role.rolname='service_role'
), rights as (
 select t.name,roles.role_name,c.oid is not null as present,
 case when c.oid is not null and r.oid is not null then has_table_privilege(r.oid,c.oid,'SELECT') end can_read,
 case when c.oid is not null and r.oid is not null then has_table_privilege(r.oid,c.oid,'INSERT,UPDATE,DELETE') or has_any_column_privilege(r.oid,c.oid,'INSERT,UPDATE') end any_direct_write
 from (values('fault_tracker_import_batches'),('fault_tracker_tickets'),('fault_tracker_ticket_updates')) t(name)
 cross join (values('anon'),('authenticated'),('service_role')) roles(role_name)
 left join pg_roles r on r.rolname::text=roles.role_name
 left join pg_namespace n on n.nspname='public'
 left join pg_class c on c.relnamespace=n.oid and c.relname=t.name
), policies as (
 select policyname,permissive,roles,cmd,qual,with_check from pg_policies where schemaname='storage' and tablename='objects'
), triggers as (
 select c.oid::regclass as relation,t.tgname,pg_get_triggerdef(t.oid) as definition
 from pg_trigger t join pg_class c on c.oid=t.tgrelid
 where not t.tgisinternal and t.tgname in ('trg_training_legacy_submission_write','trg_training_legacy_upload_write','trg_retail_management_audit_immutable','trg_fo_activity_submissions_updated_at','trg_retail_cleaning_submission_guard','trg_retail_cleaning_upload_guard','trg_retail_cleaning_storage_guard')
), installer as (
 select current_user as actor,a.rolsuper,a.rolbypassrls,o.rolname as storage_table_owner,
 (a.rolsuper or pg_has_role(a.oid,c.relowner,'USAGE')) as can_manage_storage_policies_and_triggers
 from pg_roles a join pg_class c on c.oid=to_regclass('storage.objects') join pg_roles o on o.oid=c.relowner where a.rolname=current_user
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
select 1 section_number,'Function settings and execution ACLs' section_name,coalesce(jsonb_agg(to_jsonb(f)),'[]') result from functions f
union all select 2,'Effective Fault Tracker rights',coalesce(jsonb_agg(to_jsonb(r)),'[]') from rights r
union all select 3,'All storage policies (old permissive AND new restrictive)',coalesce(jsonb_agg(to_jsonb(p)),'[]') from policies p
union all select 4,'Preserved and new triggers',coalesce(jsonb_agg(to_jsonb(t)),'[]') from triggers t
union all select 5,'Installer ownership (BYPASSRLS alone is insufficient)',coalesce(jsonb_agg(to_jsonb(i)),'[]') from installer i
union all select 6,'Bucket remains private',coalesce(jsonb_agg(jsonb_build_object('id',b.id,'public',b.public)),'[]') from storage.buckets b where b.id='fo-activity-uploads'
union all select 7,'Data preservation: compare before allowing saves',coalesce(jsonb_agg(to_jsonb(p)),'[]') from preservation p
order by section_number;
rollback;
