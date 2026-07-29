import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(
  new URL('../supabase/migrations_2_0/037_bd_site_visit_foundation.sql', import.meta.url),
  'utf8',
);
const preflight = await readFile(
  new URL('../supabase/verification/037_bd_site_visit_preflight.sql', import.meta.url),
  'utf8',
);
const postflight = await readFile(
  new URL('../supabase/verification/037_bd_site_visit_postflight.sql', import.meta.url),
  'utf8',
);
const rollbackGuidance = await readFile(
  new URL('../supabase/verification/037_bd_site_visit_rollback.md', import.meta.url),
  'utf8',
);

const requiredTables = [
  'site_visits',
  'site_assessments',
  'assessment_sections',
  'assessment_section_versions',
  'assessment_drafts',
  'site_images',
  'site_mom',
  'site_assessment_reviews',
  'workflow_instances',
  'workflow_assignments',
  'workflow_events',
  'workflow_status',
  'approval_requests',
  'proposals',
];

const workflowRpcs = [
  'rpc_convert_lead_to_assessment',
  'rpc_save_assessment_section',
  'rpc_save_assessment_draft',
  'rpc_save_site_mom',
  'rpc_register_site_image',
  'rpc_submit_for_review',
  'rpc_record_approval_decision',
  'rpc_return_assessment_for_correction',
  'rpc_generate_proposal_record',
  'rpc_mark_proposal_sent',
];

test('foundation migration creates every reconciled object additively', () => {
  for (const table of requiredTables) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}\\b`, 'i'));
  }
  assert.match(migration, /create or replace view public\.approval_queue/i);
  assert.match(migration, /begin;[\s\S]*commit;/i);
});

test('modern lead profile and activity tables are preflight-only and preserved', () => {
  for (const table of ['leads', 'lead_contacts', 'profiles', 'activity_logs']) {
    assert.doesNotMatch(migration, new RegExp(`(?:create|alter|drop) table(?: if exists| if not exists)? public\\.${table}\\b`, 'i'));
  }
  assert.match(migration, /required table public\.% is missing/i);
  assert.match(migration, /public\.profiles\.% must be uuid/i);
  assert.match(migration, /Authoritative immutable Site Visit workflow audit trail/i);
});

test('preflight fails closed on missing or incompatible modern schema', () => {
  assert.match(migration, /raise exception 'BD Site Visit preflight failed: required table/i);
  assert.match(migration, /public\.leads\.id must be uuid/i);
  assert.match(migration, /public\.profiles\.% must be boolean/i);
  assert.match(migration, /required Supabase Storage table storage\.% is missing/i);
  for (const column of ['auth_user_id', 'employee_code', 'role', 'state', 'branch']) {
    assert.match(migration, new RegExp(`'${column}'`));
  }
});

test('site evidence uses a private constrained bucket and scoped registration', () => {
  assert.match(migration, /'site-survey-images',[\s\S]*?false,[\s\S]*?10485760/i);
  for (const mime of ['image/jpeg', 'image/png', 'image/webp']) {
    assert.match(migration, new RegExp(`'${mime}'`));
  }
  assert.match(migration, /create policy site_survey_images_scoped_select/i);
  assert.match(migration, /create policy site_survey_images_scoped_insert/i);
  assert.match(migration, /create policy site_survey_images_owner_delete/i);
  assert.match(migration, /site_workflow_actor_can_edit\(sa\.id\)/i);
});

test('migration is rerunnable without destructive replacement', () => {
  assert.doesNotMatch(migration, /\bdrop table\b/i);
  assert.doesNotMatch(migration, /\btruncate\b/i);
  assert.match(migration, /create table if not exists/i);
  assert.match(migration, /create or replace function/i);
  assert.match(migration, /drop policy if exists/i);
});

test('authenticated identity is derived from auth uid and actor parameters are compatibility-only', () => {
  assert.match(migration, /where p\.auth_user_id = auth\.uid\(\)/i);
  assert.match(migration, /Authenticated identity must resolve to exactly one active profile/i);
  assert.match(migration, /p\.is_active is true/i);
  assert.match(migration, /p\.web_access_enabled is true/i);
  assert.doesNotMatch(migration, /v_actor\.(?:role_key|profile_id)\s*:=\s*p_actor/i);
});

test('role matrix and exact workflow stage order are centralized', () => {
  for (const role of [
    'BD_EXECUTIVE',
    'BD_HEAD',
    'ADMIN',
    'OPERATIONS',
    'PROJECT_COORDINATOR',
    'HR',
    'COMMERCIAL',
    'FINANCE',
    'COO',
    'GM',
    'MD',
  ]) {
    assert.match(migration, new RegExp(`'${role}'`));
  }
  assert.match(
    migration,
    /when 'bd_survey' then 'operations_review'[\s\S]*when 'operations_review' then 'coordinator_costing'[\s\S]*when 'coordinator_costing' then 'hr_validation'[\s\S]*when 'hr_validation' then 'commercial_review'[\s\S]*when 'commercial_review' then 'finance_review'[\s\S]*when 'finance_review' then 'returned_to_bd'/i,
  );
  assert.doesNotMatch(migration, /v_actor\.actor_(?:state|branch) is null/i);
});

test('stage skipping stale writes and repeated boundaries are database-protected', () => {
  assert.match(migration, /Invalid assessment submit transition/i);
  assert.match(migration, /Stale or invalid workflow stage/i);
  assert.match(migration, /Assessment section version conflict/i);
  assert.match(migration, /Draft version conflict/i);
  assert.match(migration, /site_workflow_idempotency/i);
  assert.match(migration, /assessment_sections_current_unique/i);
  assert.match(migration, /workflow_assignments_one_pending_stage/i);
  assert.match(migration, /proposals_one_version/i);
});

test('RLS is scoped and direct authenticated writes are blocked', () => {
  for (const table of requiredTables) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
  }
  assert.doesNotMatch(migration, /using\s*\(\s*true\s*\)/i);
  assert.doesNotMatch(migration, /with check\s*\(\s*true\s*\)/i);
  assert.match(migration, /revoke all on table[\s\S]*from anon, authenticated/i);
  assert.doesNotMatch(migration, /grant (?:insert|update|delete|all)[\s\S]{0,200} to authenticated/i);
});

test('PUBLIC and anonymous cannot execute workflow RPCs', () => {
  for (const rpc of workflowRpcs) {
    assert.match(migration, new RegExp(`revoke all on function public\\.${rpc}\\([\\s\\S]*?from public, anon`, 'i'));
    assert.match(migration, new RegExp(`grant execute on function public\\.${rpc}\\([\\s\\S]*?to authenticated`, 'i'));
  }
});

test('section history is append-only and workflow events own the audit trail', () => {
  assert.match(migration, /insert into public\.assessment_section_versions/i);
  assert.doesNotMatch(migration, /update public\.assessment_section_versions/i);
  assert.doesNotMatch(migration, /delete from public\.assessment_section_versions/i);
  assert.match(migration, /insert into public\.workflow_events/i);
  assert.doesNotMatch(migration, /update public\.workflow_events/i);
  assert.doesNotMatch(migration, /delete from public\.workflow_events/i);
});

test('preflight and postflight reports cover catalog grants RLS and unchanged modern tables', () => {
  assert.match(preflight, /information_schema\.columns/i);
  assert.match(preflight, /pg_policies/i);
  assert.match(preflight, /routine_privileges/i);
  assert.match(postflight, /relrowsecurity/i);
  assert.match(postflight, /public_execute/i);
  assert.match(postflight, /authenticated_execute/i);
  assert.match(postflight, /storage\.buckets/i);
  assert.match(postflight, /rpc_register_site_image/i);
  assert.match(postflight, /site_survey_images_scoped_insert/i);
  assert.match(postflight, /activity_logs/i);
  assert.match(rollbackGuidance, /Do not bypass a failed preflight/i);
  assert.match(rollbackGuidance, /public\.activity_logs/i);
  assert.match(rollbackGuidance, /forward migration/i);
});
