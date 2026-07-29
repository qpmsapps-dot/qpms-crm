-- Read-only verification after 037_bd_site_visit_foundation.sql is applied.
select required.object_name, to_regclass('public.' || required.object_name) is not null as exists
from (values
  ('site_visits'), ('site_assessments'), ('assessment_sections'),
  ('assessment_section_versions'), ('assessment_drafts'), ('site_images'), ('site_mom'),
  ('site_assessment_reviews'), ('workflow_instances'), ('workflow_assignments'),
  ('workflow_events'), ('workflow_status'), ('approval_requests'), ('proposals')
) required(object_name);

select c.relname as table_name, c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'site_visits', 'site_assessments', 'assessment_sections',
    'assessment_section_versions', 'assessment_drafts', 'site_images', 'site_mom',
    'site_assessment_reviews', 'workflow_instances', 'workflow_assignments',
    'workflow_events', 'workflow_status', 'approval_requests', 'proposals'
  )
order by c.relname;

select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'site_visits', 'site_assessments', 'assessment_sections',
    'assessment_section_versions', 'assessment_drafts', 'site_images', 'site_mom',
    'site_assessment_reviews', 'workflow_instances', 'workflow_assignments',
    'workflow_events', 'workflow_status', 'approval_requests', 'proposals'
  )
order by tablename, policyname;

select p.proname, pg_get_function_identity_arguments(p.oid) as arguments,
  p.prosecdef as security_definer,
  has_function_privilege('PUBLIC', p.oid, 'EXECUTE') as public_execute,
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
      'id', 'auth_user_id', 'employee_code', 'role', 'state', 'branch'
    ))
    or table_name = 'activity_logs'
  )
order by table_name, ordinal_position;

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
