-- Eight-section owner security verification. Run the COMPLETE file.
-- READ ONLY: no installation, grants, policies, impersonation or business writes.
-- Retain ALL result sets privately. Routine definitions are for private review.
-- Missing objects/roles are reported as missing/NULL, never as a security PASS.
begin transaction read only;
set local statement_timeout = '30s';

-- 1. Execution identity.
select current_user as execution_identity, r.rolsuper, r.rolbypassrls
from (select current_user::text as name) identity_name
left join pg_catalog.pg_roles r on r.rolname::text = identity_name.name;

-- 2. Required tables, RLS, owners, effective table AND column privileges.
-- Resolve both relation and role OIDs first. CASE prevents privilege checks
-- against missing objects; NULL means unavailable, not denied and not PASS.
with required(schema_name, table_name) as (
 values
 ('public','profiles'),
 ('public','reliance_retail_store_master'),
 ('public','fault_tracker_import_batches'),
 ('public','fault_tracker_tickets'),
 ('public','fault_tracker_ticket_updates'),
 ('public','client_deep_cleaning_schedules'),
 ('public','retail_provisional_proposals'),
 ('public','fo_activity_submissions'),
 ('public','fo_activity_uploads'),
 ('public','reliance_retail_management_audit'),
 ('storage','objects'),
 ('storage','buckets')
), required_roles(role_name) as (
 values ('anon'), ('authenticated'), ('service_role')
)
select q.schema_name, q.table_name,
       c.oid is not null as table_present,
       owner_role.rolname as table_owner,
       c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as force_rls,
       rr.role_name, role_entry.oid is not null as role_present,
       case when c.oid is not null and role_entry.oid is not null
            then pg_catalog.has_table_privilege(role_entry.oid,c.oid,'SELECT') end as table_select,
       case when c.oid is not null and role_entry.oid is not null
            then pg_catalog.has_table_privilege(role_entry.oid,c.oid,'INSERT') end as table_insert,
       case when c.oid is not null and role_entry.oid is not null
            then pg_catalog.has_table_privilege(role_entry.oid,c.oid,'UPDATE') end as table_update,
       case when c.oid is not null and role_entry.oid is not null
            then pg_catalog.has_table_privilege(role_entry.oid,c.oid,'DELETE') end as table_delete,
       case when c.oid is not null and role_entry.oid is not null
            then pg_catalog.has_any_column_privilege(role_entry.oid,c.oid,'INSERT') end as any_column_insert,
       case when c.oid is not null and role_entry.oid is not null
            then pg_catalog.has_any_column_privilege(role_entry.oid,c.oid,'UPDATE') end as any_column_update
from required q
left join pg_catalog.pg_namespace n on n.nspname = q.schema_name
left join pg_catalog.pg_class c on c.relnamespace = n.oid
     and c.relname = q.table_name and c.relkind in ('r','p','v','m','f')
left join pg_catalog.pg_roles owner_role on owner_role.oid = c.relowner
cross join required_roles rr
left join pg_catalog.pg_roles role_entry on role_entry.rolname::text = rr.role_name
order by q.schema_name,q.table_name,rr.role_name;

-- 3. Effective role memberships relevant to anonymous/authenticated access.
-- A row with no inherited/member role is diagnostic, not proof of secure ACLs.
with required_roles(role_name) as (values ('anon'),('authenticated'))
select rr.role_name as checked_role, checked.oid is not null as role_present,
       parent.rolname as inherited_role, member.rolname as member_role,
       m.admin_option
from required_roles rr
left join pg_catalog.pg_roles checked on checked.rolname::text = rr.role_name
left join pg_catalog.pg_auth_members m
 on case when checked.oid is not null
         then pg_catalog.pg_has_role(checked.oid,m.roleid,'USAGE')
         else false end
left join pg_catalog.pg_roles parent on parent.oid = m.roleid
left join pg_catalog.pg_roles member on member.oid = m.member
order by rr.role_name,member.rolname,parent.rolname;

-- 4. ALL storage policies, including broad policies without a bucket name.
-- Missing tables safely produce no matching policy rows; see Section 2 presence.
select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check
from pg_catalog.pg_policies
where (schemaname='storage' and tablename='objects')
   or (schemaname='public' and tablename in (
       'fault_tracker_import_batches','fault_tracker_tickets',
       'fault_tracker_ticket_updates','client_deep_cleaning_schedules',
       'retail_provisional_proposals','fo_activity_submissions',
       'fo_activity_uploads','reliance_retail_management_audit'
   ))
order by schemaname,tablename,policyname;

-- 5. Helpers/new RPCs, definitions and effective execution privileges.
-- Keep a diagnostic row for missing names and show ALL existing overloads.
-- Missing/new RPCs are expected before installation, but not a security PASS.
with required_functions(function_name) as (
 values ('retail_unified_access'),('retail_unified_owner'),
 ('rpc_retail_unified_apply'),('rpc_retail_fault_update'),
 ('rpc_retail_fault_update_capability'),('rpc_retail_cleaning_link_source'),
 ('rpc_retail_cleaning_link_fo')
), role_oids as (
 select
  (select oid from pg_catalog.pg_roles where rolname='anon') as anon_oid,
  (select oid from pg_catalog.pg_roles where rolname='authenticated') as employee_oid,
  (select oid from pg_catalog.pg_roles where rolname='service_role') as service_oid
)
select f.function_name,p.oid is not null as function_present,
       p.oid::regprocedure as signature,
       owner_role.rolname as function_owner,p.prosecdef as security_definer,
       p.proconfig as function_settings,p.proacl as explicit_acl,
       roles.anon_oid is not null as anon_role_present,
       roles.employee_oid is not null as authenticated_role_present,
       roles.service_oid is not null as service_role_present,
       case when p.oid is not null and roles.anon_oid is not null
            then pg_catalog.has_function_privilege(roles.anon_oid,p.oid,'EXECUTE') end as anon_execute,
       case when p.oid is not null and roles.employee_oid is not null
            then pg_catalog.has_function_privilege(roles.employee_oid,p.oid,'EXECUTE') end as authenticated_execute,
       case when p.oid is not null and roles.service_oid is not null
            then pg_catalog.has_function_privilege(roles.service_oid,p.oid,'EXECUTE') end as service_execute,
       case when p.oid is not null then pg_catalog.pg_get_functiondef(p.oid) end as definition_for_private_review
from required_functions f
left join pg_catalog.pg_namespace n on n.nspname='public'
left join pg_catalog.pg_proc p on p.pronamespace=n.oid
     and p.proname=f.function_name and p.prokind='f'
left join pg_catalog.pg_roles owner_role on owner_role.oid=p.proowner
cross join role_oids roles
order by f.function_name,p.oid::regprocedure::text;

-- 6. Other routines requiring review for indirect write bypass.
-- Candidate search only; not proof that indirect/dynamic SQL bypasses are absent.
with role_oids as (
 select
  (select oid from pg_catalog.pg_roles where rolname='anon') as anon_oid,
  (select oid from pg_catalog.pg_roles where rolname='authenticated') as employee_oid
)
select p.oid::regprocedure as signature,p.prosecdef as security_definer,
       roles.anon_oid is not null as anon_role_present,
       roles.employee_oid is not null as authenticated_role_present,
       case when roles.anon_oid is not null
            then pg_catalog.has_function_privilege(roles.anon_oid,p.oid,'EXECUTE') end as anon_execute,
       case when roles.employee_oid is not null
            then pg_catalog.has_function_privilege(roles.employee_oid,p.oid,'EXECUTE') end as authenticated_execute,
       pg_catalog.pg_get_functiondef(p.oid) as definition_for_private_review
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid=p.pronamespace
cross join role_oids roles
where n.nspname='public' and p.prokind='f'
  and (p.prosrc ~* '(fault_tracker_|fo_activity_|fo-activity-uploads)'
       or p.proname ~* '(exec.*sql|sql.*exec|query.*sql|sql.*query)')
order by p.oid::regprocedure::text;

-- 7a. Existing constraints. No throwing string-to-regclass casts.
-- Preserve one diagnostic row even when a requested table is absent.
with required(table_name) as (
 values ('fault_tracker_ticket_updates'),('client_deep_cleaning_schedules'),
 ('retail_provisional_proposals'),('fo_activity_submissions'),
 ('fo_activity_uploads'),('reliance_retail_management_audit')
)
select 'public.'||q.table_name as relation,c.oid is not null as table_present,
       constraint_entry.conname,constraint_entry.convalidated,
       case when constraint_entry.oid is not null
            then pg_catalog.pg_get_constraintdef(constraint_entry.oid) end as definition
from required q
left join pg_catalog.pg_namespace n on n.nspname='public'
left join pg_catalog.pg_class c on c.relnamespace=n.oid and c.relname=q.table_name
left join pg_catalog.pg_constraint constraint_entry on constraint_entry.conrelid=c.oid
order by q.table_name,constraint_entry.conname;

-- 7b. Audit/evidence protection triggers, also tolerant of absent tables.
with required(table_name) as (
 values ('fault_tracker_import_batches'),('fault_tracker_tickets'),
 ('fault_tracker_ticket_updates'),('client_deep_cleaning_schedules'),
 ('fo_activity_submissions'),('fo_activity_uploads'),
 ('reliance_retail_management_audit')
)
select 'public.'||q.table_name as relation,c.oid is not null as table_present,
       trigger_entry.tgname,
       case when trigger_entry.oid is not null
            then pg_catalog.pg_get_triggerdef(trigger_entry.oid) end as definition
from required q
left join pg_catalog.pg_namespace n on n.nspname='public'
left join pg_catalog.pg_class c on c.relnamespace=n.oid and c.relname=q.table_name
left join pg_catalog.pg_trigger trigger_entry on trigger_entry.tgrelid=c.oid
     and not trigger_entry.tgisinternal
order by q.table_name,trigger_entry.tgname;

-- 8. Bucket configuration, including a missing storage schema/table/columns.
-- The only dynamically executed SQL is the constant SELECT below. It is inside
-- CASE so PostgreSQL never parses a storage.buckets reference when unavailable.
-- to_jsonb tolerates absent optional file_size_limit/allowed_mime_types columns.
-- XML is used only to return that guarded SELECT as a regular result set;
-- there are no temporary tables, functions or other DDL.
with bucket_relation as (
 select c.oid
 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
 where n.nspname='storage' and c.relname='buckets' and c.relkind in ('r','p','v','f')
), availability as (
 select (select oid from bucket_relation) as relation_oid,
        (select oid from pg_catalog.pg_roles where rolname=current_user) as actor_oid
), checks as (
 select a.*,
  exists(select 1 from pg_catalog.pg_attribute where attrelid=a.relation_oid and attname='id' and attnum>0 and not attisdropped) as id_column_present,
  exists(select 1 from pg_catalog.pg_attribute where attrelid=a.relation_oid and attname='public' and attnum>0 and not attisdropped) as public_column_present,
  case when a.relation_oid is not null and a.actor_oid is not null
       then pg_catalog.has_table_privilege(a.actor_oid,a.relation_oid,'SELECT') else false end as can_read
 from availability a
), bucket_xml as (
 select checks.*,
  case when relation_oid is not null and id_column_present and public_column_present and can_read
       then pg_catalog.query_to_xml(
        'select b.id::text as id, to_jsonb(b)->>''public'' as is_public, to_jsonb(b)->>''file_size_limit'' as file_size_limit, to_jsonb(b)->>''allowed_mime_types'' as allowed_mime_types from storage.buckets b where b.id::text = ''fo-activity-uploads''',
        true,false,'')
       else '<table/>'::xml end as result_xml
 from checks
)
select relation_oid is not null as bucket_table_present,
       id_column_present,public_column_present,can_read,
       x.id is not null as bucket_row_visible,
       x.id,x.is_public,x.file_size_limit,x.allowed_mime_types
from bucket_xml
left join lateral xmltable('/table/row' passing result_xml columns
 id text path 'id',is_public text path 'is_public',
 file_size_limit text path 'file_size_limit',allowed_mime_types text path 'allowed_mime_types'
) x on true;

rollback;
