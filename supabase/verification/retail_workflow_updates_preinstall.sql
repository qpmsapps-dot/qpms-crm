-- Targeted owner-level READ ONLY preflight for the two workflow proposals.
-- Retain output privately. No business rows, evidence URLs or tokens are returned.
begin transaction read only;
set local statement_timeout='30s';
do $check$
declare item record;
begin
 for item in select * from (values
 ('profiles','id','uuid'),('profiles','auth_user_id','uuid'),('profiles','employee_code','text'),('profiles','role','text'),('profiles','is_active','boolean'),('profiles','status','text'),
 ('reliance_retail_store_master','id','uuid'),('reliance_retail_store_master','store_code','text'),('reliance_retail_store_master','state','text'),('reliance_retail_store_master','status','text'),
 ('fault_tracker_tickets','id','uuid'),('fault_tracker_tickets','store_code','text'),('fault_tracker_tickets','is_active','boolean'),('fault_tracker_tickets','stage','text'),('fault_tracker_tickets','stage_group','text'),('fault_tracker_tickets','remarks','text'),('fault_tracker_tickets','metadata','jsonb'),('fault_tracker_tickets','raw_row','jsonb'),('fault_tracker_tickets','updated_at','timestamptz'),
 ('fault_tracker_ticket_updates','id','uuid'),('fault_tracker_ticket_updates','ticket_id','uuid'),('fault_tracker_ticket_updates','updated_by_auth_user_id','uuid'),('fault_tracker_ticket_updates','updated_by_employee_code','text'),('fault_tracker_ticket_updates','update_type','text'),('fault_tracker_ticket_updates','previous_stage','text'),('fault_tracker_ticket_updates','new_stage','text'),('fault_tracker_ticket_updates','remarks','text'),('fault_tracker_ticket_updates','metadata','jsonb'),('fault_tracker_ticket_updates','created_at','timestamptz'),
 ('client_deep_cleaning_schedules','id','uuid'),('client_deep_cleaning_schedules','retail_store_id','uuid'),('client_deep_cleaning_schedules','scheduled_date','date'),('client_deep_cleaning_schedules','assigned_fo_profile_id','uuid'),('client_deep_cleaning_schedules','status','text'),('client_deep_cleaning_schedules','source_reference','text'),('client_deep_cleaning_schedules','metadata','jsonb'),('client_deep_cleaning_schedules','completed_at','timestamptz'),('client_deep_cleaning_schedules','created_at','timestamptz'),('client_deep_cleaning_schedules','updated_at','timestamptz'),
 ('retail_provisional_proposals','id','uuid'),('retail_provisional_proposals','kind','text'),('retail_provisional_proposals','status','text'),('retail_provisional_proposals','target_store','uuid'),('retail_provisional_proposals','decided_by','uuid'),('retail_provisional_proposals','proposed_by','uuid'),
 ('fo_activity_submissions','id','uuid'),('fo_activity_submissions','employee_code','text'),('fo_activity_submissions','activity_type','text'),('fo_activity_submissions','status','text'),('fo_activity_submissions','store_code','text'),('fo_activity_submissions','metadata','jsonb'),('fo_activity_submissions','submitted_at','timestamptz'),
 ('fo_activity_uploads','id','uuid'),('fo_activity_uploads','submission_id','uuid'),('fo_activity_uploads','employee_code','text'),('fo_activity_uploads','activity_type','text'),('fo_activity_uploads','store_code','text'),('fo_activity_uploads','uploaded_at','timestamptz'),('fo_activity_uploads','storage_bucket','text'),('fo_activity_uploads','upload_role','text'),('fo_activity_uploads','file_type','text'),('fo_activity_uploads','file_url','text'),('fo_activity_uploads','file_name','text'),
 ('reliance_retail_management_audit','action','text'),('reliance_retail_management_audit','entity_type','text'),('reliance_retail_management_audit','entity_id','uuid'),('reliance_retail_management_audit','actor_profile_id','uuid'),('reliance_retail_management_audit','before_state','jsonb'),('reliance_retail_management_audit','after_state','jsonb')
 ) v(relation,column_name,type_name) loop
  if not exists(select 1 from pg_attribute where attrelid=to_regclass('public.'||item.relation) and attname=item.column_name and not attisdropped and (atttypid=to_regtype(item.type_name) or item.type_name='text' and atttypid in ('varchar'::regtype,'bpchar'::regtype))) then
   raise exception 'Missing/incompatible %.% (expected %)',item.relation,item.column_name,item.type_name;
  end if;
 end loop;
 if not exists(select 1 from pg_attribute where attrelid='public.fo_activity_uploads'::regclass and attname='file_size' and atttypid in ('int4'::regtype,'int8'::regtype) and not attisdropped) then raise exception 'Compatible upload file_size required';end if;
 if to_regclass('storage.objects') is null or to_regclass('storage.buckets') is null then raise exception 'Supabase storage schema required';end if;
 if to_regprocedure('public.retail_unified_access(uuid,text,text)') is null or to_regprocedure('public.retail_unified_owner(uuid,timestamptz)') is null then raise exception 'Installed Unified access/ownership contracts required; do not reinstall Unified';end if;
 if not exists(select 1 from storage.buckets where id='fo-activity-uploads' and public is false) then raise exception 'Private legacy FO bucket required';end if;
 if exists(select 1 from public.fault_tracker_ticket_updates where metadata ? 'retail_request_id' group by ticket_id,metadata->>'retail_request_id' having count(*)>1) then raise exception 'Existing request keys conflict; do not delete history to install';end if;
 if exists(select 1 from public.client_deep_cleaning_schedules where metadata->'retail_fo_completion'->>'source_id' is not null group by metadata->'retail_fo_completion'->>'source_id' having count(*)>1) then raise exception 'Existing duplicate FO links require review, not backfill';end if;
end;$check$;

-- Installer must own the definer routines and have access to protected relations.
select current_user,r.rolsuper,r.rolbypassrls from pg_roles r where r.rolname=current_user;
-- Existing objects with these names MUST be reviewed before CREATE OR REPLACE.
select p.oid::regprocedure signature,r.rolname owner,p.prosecdef,p.proconfig,
 md5(replace(pg_get_functiondef(p.oid),E'\r\n',E'\n')) definition_md5,
 has_function_privilege('anon',p.oid,'EXECUTE') anon_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated_execute,
 has_function_privilege('service_role',p.oid,'EXECUTE') service_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner
where n.nspname='public' and p.proname in ('retail_unified_access','retail_unified_owner','rpc_retail_fault_update','rpc_retail_fault_update_capability','rpc_retail_cleaning_link_source','rpc_retail_cleaning_link_fo') order by p.oid::regprocedure::text;
select c.oid::regclass relation,c.relrowsecurity,c.relforcerowsecurity,
 has_table_privilege('authenticated',c.oid,'SELECT') employee_select,
 has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE') employee_any_write,
 has_table_privilege('service_role',c.oid,'SELECT') service_select
from pg_class c where c.oid in ('public.fault_tracker_tickets'::regclass,'public.fault_tracker_ticket_updates'::regclass,'public.client_deep_cleaning_schedules'::regclass,'public.retail_provisional_proposals'::regclass,'public.fo_activity_submissions'::regclass,'public.fo_activity_uploads'::regclass,'public.reliance_retail_management_audit'::regclass,'storage.objects'::regclass);
-- ALL storage policies, including broad ones that do not mention this bucket.
select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies
where schemaname='storage' and tablename='objects' or schemaname='public' and tablename in ('fault_tracker_tickets','fault_tracker_ticket_updates','client_deep_cleaning_schedules','retail_provisional_proposals','fo_activity_submissions','fo_activity_uploads','reliance_retail_management_audit') order by schemaname,tablename,policyname;
select c.conrelid::regclass relation,c.conname,c.convalidated,pg_get_constraintdef(c.oid) definition from pg_constraint c
where c.conrelid in ('public.client_deep_cleaning_schedules'::regclass,'public.retail_provisional_proposals'::regclass,'public.fault_tracker_ticket_updates'::regclass,'public.reliance_retail_management_audit'::regclass) order by c.conrelid::regclass::text,c.conname;
select attrelid::regclass relation,attname,attnotnull,pg_get_expr(d.adbin,d.adrelid) column_default
from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
where a.attnum>0 and not a.attisdropped and a.attrelid in ('public.fault_tracker_ticket_updates'::regclass,'public.client_deep_cleaning_schedules'::regclass,'public.reliance_retail_management_audit'::regclass) order by a.attrelid::regclass::text,a.attnum;
select defaclrole::regrole owner,defaclnamespace::regnamespace schema_name,defaclobjtype,defaclacl from pg_default_acl where defaclobjtype='f';
select tgrelid::regclass relation,tgname,pg_get_triggerdef(oid) definition from pg_trigger where not tgisinternal and tgrelid in ('public.fault_tracker_tickets'::regclass,'public.fault_tracker_ticket_updates'::regclass,'public.client_deep_cleaning_schedules'::regclass,'public.fo_activity_submissions'::regclass,'public.fo_activity_uploads'::regclass,'public.reliance_retail_management_audit'::regclass);
select id,public from storage.buckets where id='fo-activity-uploads';
-- Baselines only: no identity, AOP or ticket import changes are authorized.
-- Repeat immediately after DDL, before permitting business writes; compare exactly.
select 'stores' source,count(*) rows,md5(string_agg(md5(to_jsonb(r)::text),'' order by md5(to_jsonb(r)::text))) digest from public.reliance_retail_store_master r
union all select 'aop',count(*),md5(string_agg(md5(to_jsonb(r)::text),'' order by md5(to_jsonb(r)::text))) from public.retail_attendance_aop_versions r
union all select 'imports',count(*),md5(string_agg(md5(to_jsonb(r)::text),'' order by md5(to_jsonb(r)::text))) from public.fault_tracker_import_batches r
union all select 'tickets',count(*),md5(string_agg(md5(to_jsonb(r)::text),'' order by md5(to_jsonb(r)::text))) from public.fault_tracker_tickets r
union all select 'ticket_history',count(*),md5(string_agg(md5(to_jsonb(r)::text),'' order by md5(to_jsonb(r)::text))) from public.fault_tracker_ticket_updates r
union all select 'schedules',count(*),md5(string_agg(md5(to_jsonb(r)::text),'' order by md5(to_jsonb(r)::text))) from public.client_deep_cleaning_schedules r
union all select 'fo_submissions',count(*),md5(string_agg(md5(to_jsonb(r)::text),'' order by md5(to_jsonb(r)::text))) from public.fo_activity_submissions r
union all select 'fo_uploads',count(*),md5(string_agg(md5(to_jsonb(r)::text),'' order by md5(to_jsonb(r)::text))) from public.fo_activity_uploads r;
rollback;
