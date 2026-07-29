-- Read-only verification after 037_bd_site_visit_foundation.sql is applied.
select required.object_name, to_regclass('public.' || required.object_name) is not null as exists
from (values
  ('site_visits'), ('site_assessments'), ('assessment_sections'),
  ('assessment_section_versions'), ('assessment_drafts'), ('site_images'), ('site_mom'),
  ('site_assessment_reviews'), ('workflow_instances'), ('workflow_assignments'),
  ('workflow_events'), ('workflow_status'), ('approval_requests'), ('approval_queue'),
  ('proposals'), ('site_workflow_idempotency')
) required(object_name);

select c.relname as table_name, c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'site_visits', 'site_assessments', 'assessment_sections',
    'assessment_section_versions', 'assessment_drafts', 'site_images', 'site_mom',
    'site_assessment_reviews', 'workflow_instances', 'workflow_assignments',
    'workflow_events', 'workflow_status', 'approval_requests', 'proposals',
    'site_workflow_idempotency'
  )
order by c.relname;

select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'site_visits', 'site_assessments', 'assessment_sections',
    'assessment_section_versions', 'assessment_drafts', 'site_images', 'site_mom',
    'site_assessment_reviews', 'workflow_instances', 'workflow_assignments',
    'workflow_events', 'workflow_status', 'approval_requests', 'proposals',
    'site_workflow_idempotency'
  )
order by tablename, policyname;

select p.proname, pg_get_function_identity_arguments(p.oid) as arguments,
  p.prosecdef as security_definer,
  exists (
    select 1
    from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
  ) as public_execute,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'rpc_convert_lead_to_assessment', 'rpc_save_assessment_section',
    'rpc_save_assessment_draft', 'rpc_save_site_mom', 'rpc_register_site_image',
    'rpc_submit_for_review',
    'rpc_record_approval_decision', 'rpc_return_assessment_for_correction',
    'rpc_generate_proposal_record', 'rpc_mark_proposal_sent'
  )
order by p.proname;

select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in (
    'site_visits', 'site_assessments', 'assessment_sections',
    'assessment_section_versions', 'workflow_assignments', 'approval_requests',
    'proposals', 'site_workflow_idempotency'
  )
order by tablename, indexname;

select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name = 'leads' and column_name = 'id')
    or (table_name = 'profiles' and column_name in (
      'id', 'auth_user_id', 'employee_code', 'full_name', 'role', 'state', 'branch'
    ))
    or table_name = 'activity_logs'
  )
order by table_name, ordinal_position;

select table_name, row_count
from (
  select 'leads'::text as table_name, count(*)::bigint as row_count from public.leads
  union all select 'lead_contacts', count(*) from public.lead_contacts
  union all select 'profiles', count(*) from public.profiles
  union all select 'activity_logs', count(*) from public.activity_logs
) counts
order by table_name;

select table_name,
  md5(string_agg(
    concat_ws('|', ordinal_position, column_name, data_type, udt_name, is_nullable, column_default),
    ';' order by ordinal_position
  )) as column_definition_checksum
from information_schema.columns
where table_schema = 'public'
  and table_name in ('leads', 'lead_contacts', 'profiles', 'activity_logs')
group by table_name
order by table_name;

select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets
where id in ('site-survey-images', 'site-assessment-documents');

select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
  and policyname in (
    'site_survey_images_scoped_select',
    'site_survey_images_scoped_insert',
    'site_survey_images_owner_delete'
  )
order by policyname;
