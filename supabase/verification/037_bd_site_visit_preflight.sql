-- Read-only production preflight for 037_bd_site_visit_foundation.sql.
select current_database() as database_name, current_user as inspected_as;

select c.table_schema, c.table_name, c.column_name, c.data_type, c.is_nullable
from information_schema.columns c
where c.table_schema = 'public'
  and (
    (c.table_name = 'leads' and c.column_name = 'id')
    or (c.table_name = 'profiles' and c.column_name in (
      'id', 'auth_user_id', 'employee_code', 'name', 'email', 'role', 'state', 'branch',
      'status', 'is_active', 'web_access_enabled'
    ))
  )
order by c.table_name, c.ordinal_position;

select required.object_name, to_regclass('public.' || required.object_name) as existing_object
from (values
  ('leads'), ('lead_contacts'), ('profiles'), ('activity_logs'),
  ('site_visits'), ('site_assessments'), ('assessment_sections'),
  ('assessment_section_versions'), ('assessment_drafts'), ('site_images'), ('site_mom'),
  ('site_assessment_reviews'), ('workflow_instances'), ('workflow_assignments'),
  ('workflow_events'), ('workflow_status'), ('approval_requests'), ('proposals')
) required(object_name);

select required.object_name, to_regclass('storage.' || required.object_name) as existing_object
from (values ('buckets'), ('objects')) required(object_name);

select table_name, row_count
from (
  select 'leads'::text as table_name, count(*)::bigint as row_count from public.leads
  union all select 'lead_contacts', count(*) from public.lead_contacts
  union all select 'profiles', count(*) from public.profiles
  union all select 'activity_logs', count(*) from public.activity_logs
) counts
order by table_name;

select n.nspname as function_schema, p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments,
  p.prosecdef as security_definer,
  p.proconfig as function_configuration
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and (p.proname like 'rpc_%assessment%' or p.proname like 'site_workflow_%')
order by p.proname, arguments;

select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename like any (array['site_%', 'assessment_%', 'workflow_%', 'approval_%', 'proposals'])
order by tablename, policyname;

select routine_schema, routine_name, grantee, privilege_type
from information_schema.routine_privileges
where routine_schema = 'public'
  and (routine_name like 'rpc_%assessment%' or routine_name like 'site_workflow_%')
order by routine_name, grantee;

select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets
where id = 'site-survey-images';

select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
  and policyname like 'site_survey_images_%'
order by policyname;
