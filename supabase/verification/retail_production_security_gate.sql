-- Supplemental owner SQL packet. READ ONLY: no auth impersonation or mutation.
-- Run after retail_workflow_updates_preinstall.sql; retain results privately.
begin transaction read only;
set local statement_timeout='30s';

-- Effective table AND separately granted column rights, including inherited grants.
select t.name relation,r.name role_name,
 has_table_privilege(r.name,to_regclass('public.'||t.name),'SELECT') table_read,
 has_table_privilege(r.name,to_regclass('public.'||t.name),'INSERT,UPDATE,DELETE') any_table_write,
 has_any_column_privilege(r.name,to_regclass('public.'||t.name),'INSERT,UPDATE') any_column_write
from (values('fault_tracker_import_batches'),('fault_tracker_tickets'),('fault_tracker_ticket_updates'),('fo_activity_submissions'),('fo_activity_uploads'))t(name)
cross join (values('anon'),('authenticated'),('service_role'))r(name) order by t.name,r.name;
select parent.rolname inherited_role,member.rolname member_role,m.admin_option
from pg_auth_members m join pg_roles parent on parent.oid=m.roleid join pg_roles member on member.oid=m.member
where pg_has_role('authenticated',parent.oid,'USAGE') or pg_has_role('anon',parent.oid,'USAGE') order by member.rolname,parent.rolname;

-- Callable write-capable routines can bypass table ACLs via SECURITY DEFINER.
-- Body text search is a REVIEW CANDIDATE list, not a proof that dynamic SQL is absent.
select p.oid::regprocedure signature,r.rolname owner,p.prosecdef,p.proconfig,
 has_function_privilege('anon',p.oid,'EXECUTE') anon_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') employee_execute,
 has_function_privilege('service_role',p.oid,'EXECUTE') service_execute,
 md5(replace(pg_get_functiondef(p.oid),E'\r\n',E'\n')) definition_md5,
 pg_get_functiondef(p.oid) definition_for_private_review
from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner
where n.nspname='public' and p.prokind='f' and (p.prosrc ~* '(fault_tracker_|fo_activity_|fo-activity-uploads|retail_cleaning_link)' or p.proname ~* '(exec.*sql|sql.*exec|query.*sql|sql.*query)')
order by p.oid::regprocedure::text;

-- Ownership/path inventory: aggregate counts only, no paths/URLs/identities.
-- Unknown or ambiguous cases block a final storage patch; never guess the owner.
with evidence as (
 select o.name,s.id,s.employee_code,s.status,s.store_code,
  exists(select 1 from public.client_deep_cleaning_schedules plan where plan.metadata->'retail_fo_completion'->>'source_id'=s.id::text) linked,
  (select count(*) from public.profiles p where p.employee_code=s.employee_code and p.auth_user_id is not null and p.is_active is true and upper(coalesce(p.status,'Active'))='ACTIVE') active_auth_profiles,
  (select count(*) from public.reliance_retail_store_master m where upper(btrim(m.store_code))=upper(btrim(s.store_code))) canonical_candidates
 from storage.objects o left join public.fo_activity_submissions s on s.id::text=split_part(o.name,'/',4) and s.activity_type='deep_cleaning'
 where o.bucket_id='fo-activity-uploads' and split_part(o.name,'/',3)='deep_cleaning'
)
select count(*) deep_cleaning_objects,count(*) filter(where id is null) missing_submission,
 count(*) filter(where employee_code is distinct from split_part(name,'/',1)) ownership_mismatch,
 count(*) filter(where active_auth_profiles<>1) unknown_or_ambiguous_active_identity,
 count(*) filter(where canonical_candidates<>1) unknown_or_ambiguous_canonical_store,
 count(*) filter(where lower(status)='submitted') submitted_objects,
 count(*) filter(where linked) linked_objects from evidence;
select bucket_id,count(*) object_count from storage.objects where bucket_id='fo-activity-uploads' group by bucket_id;
select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies
where schemaname='storage' and tablename='objects' or schemaname='public' and tablename in ('fault_tracker_import_batches','fault_tracker_tickets','fault_tracker_ticket_updates','fo_activity_submissions','fo_activity_uploads') order by schemaname,tablename,policyname;
rollback;
