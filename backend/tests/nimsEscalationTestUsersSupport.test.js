import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const migration = readFileSync(
  new URL('../../supabase/migrations_2_0/063_fix_hospital_ticket_escalation_schema_drift.sql', import.meta.url),
  'utf8',
);
const script = readFileSync(
  new URL('../scripts/create-nims-escalation-test-users.js', import.meta.url),
  'utf8',
);
const migration027 = readFileSync(
  new URL('../../supabase/migrations_2_0/027_nims_supervisor_routing_foundation.sql', import.meta.url),
  'utf8',
);
const migration028 = readFileSync(
  new URL('../../supabase/migrations_2_0/028_complete_nims_supervisor_routing.sql', import.meta.url),
  'utf8',
);
const migration042 = readFileSync(
  new URL('../../supabase/migrations_2_0/042_hospital_ticket_supervisor_self_assignment.sql', import.meta.url),
  'utf8',
);
const migration057 = readFileSync(
  new URL('../../supabase/migrations_2_0/057_hospital_supervisor_acceptance_20_minutes.sql', import.meta.url),
  'utf8',
);
const migration061 = readFileSync(
  new URL('../../supabase/migrations_2_0/061_hospital_escalation_acceptance_sla_2_minutes.sql', import.meta.url),
  'utf8',
);
const hospitalTicketService = readFileSync(
  new URL('../services/hospitalTicketService.js', import.meta.url),
  'utf8',
);

test('schema drift migration fixes role order without creating test users or Auth users', () => {
  const uncommentedMigration = migration
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
  assert.doesNotMatch(uncommentedMigration, /insert\s+into\s+auth\.users/i);
  assert.doesNotMatch(uncommentedMigration, /insert\s+into\s+public\.hospital_ticket_users/i);
  assert.doesNotMatch(uncommentedMigration, /insert\s+into\s+public\.hospital_ticket_user_scopes/i);
  assert.doesNotMatch(migration, /create\s+or\s+replace\s+function\s+public\.rpc_process_hospital_ticket_sla/i);
  assert.match(migration, /when 1 then 'housekeeping_supervisor'/);
  assert.match(migration, /when 2 then 'operations_executive'/);
  assert.match(migration, /when 3 then 'facility_manager'/);
  assert.match(migration, /when 4 then 'project_head'/);
  assert.match(migration, /when 5 then 'hospital_dean'/);
  assert.doesNotMatch(migration, /when 2 then 'facility_manager'/);
  assert.doesNotMatch(migration, /when 3 then 'operations_executive'/);
});

test('schema drift migration preserves dean support and normal SLA stops at project head', () => {
  assert.match(migration, /when p_level = 5 then 'escalated_hospital_dean'/);
  assert.match(migration, /when 'hospital_dean' then 5/);
  assert.match(migration, /when 'hospital_dean' then 'Hospital Dean'/);
  assert.match(migration061, /while v_next_level <= 4 loop/);
  assert.match(migration061, /final_escalation\s*=\s*v_next_level\s*=\s*4/);
  assert.doesNotMatch(migration061, /v_next_level <= 5 loop/);
  assert.doesNotMatch(migration, /drop function .*rpc_submit_public_cleanliness_complaint/i);
  assert.doesNotMatch(migration, /drop column .*dean/i);
});

test('schema drift migration is transactional and does not change function grants', () => {
  assert.match(migration, /^\s*begin;/i);
  assert.match(migration, /commit;\s*$/i);
  assert.match(migration, /Unexpected hospital_ticket_assignment_history\.assignment_type values exist/);
  assert.doesNotMatch(migration, /\brevoke\b/i);
  assert.doesNotMatch(migration, /\bgrant\b/i);
});

test('schema drift migration allows every current assignment history writer type', () => {
  assert.match(migration, /drop constraint hospital_ticket_assignment_history_type_check/i);
  assert.match(migration, /add constraint hospital_ticket_assignment_history_type_check/i);
  for (const assignmentType of [
    'primary',
    'backup',
    'overall_fallback',
    'operations_fallback',
    'acceptance_escalation',
    'manual_reassignment',
  ]) {
    assert.match(migration, new RegExp(`'${assignmentType}'`));
  }
});

test('assignment history writers are compatible with final CHECK constraint', () => {
  const combinedSqlWriters = [migration027, migration028, migration042, migration057, migration061].join('\n');
  const expectedWriters = {
    primary: combinedSqlWriters,
    backup: combinedSqlWriters,
    overall_fallback: combinedSqlWriters,
    operations_fallback: combinedSqlWriters,
    acceptance_escalation: migration061,
    manual_reassignment: hospitalTicketService,
  };
  for (const [assignmentType, source] of Object.entries(expectedWriters)) {
    assert.match(source, new RegExp(`'${assignmentType}'`));
    assert.match(migration, new RegExp(`'${assignmentType}'`));
  }
});

test('NIMS escalation test script reuses existing test users with dry-run and confirmation guards', () => {
  assert.match(script, /client\.auth\.admin\.updateUserById/);
  assert.match(script, /\.from\('hospital_ticket_users'\)/);
  assert.match(script, /\.from\('hospital_ticket_user_scopes'\)/);
  assert.match(script, /Expected exactly one active NIMS hospital client/);
  assert.match(script, /user\.profile_type === 'internal'/);
  assert.match(script, /scopeResult\.data\?\.can_view === true/);
  assert.match(script, /scopeResult\.data\?\.can_update === true/);
  assert.match(script, /scopeResult\.data\?\.can_create === false/);
  assert.match(script, /NIMS_ESCALATION_TEST_USERS_CONFIRM/);
  assert.match(script, /NIMS_ESCALATION_TEST_PASSWORD/);
  assert.match(script, /configuredPassword\.length < 8/);
  assert.match(script, /NIMS_ESCALATION_TEST_PASSWORD must be at least 8 characters/);
  assert.match(script, /const dryRun = !args\.apply/);
  assert.match(script, /secrets_logged/);
  assert.match(script, /safe_to_prepare_password/);
  assert.match(script, /REFUSED_UNSAFE_TEST_USER_STATE/);
  assert.match(script, /password_reset_on_existing_test_auth_user/);
  assert.doesNotMatch(script, /client\.auth\.admin\.createUser/);
  assert.doesNotMatch(script, /client\.auth\.admin\.deleteUser/);
  assert.doesNotMatch(script, /\.insert\(/);
  assert.doesNotMatch(script, /\.upsert\(/);
  assert.doesNotMatch(script, /\.from\('hospital_ticket_users'\)\.update/);
  assert.doesNotMatch(script, /\.from\('hospital_ticket_user_scopes'\)\.update/);
  assert.doesNotMatch(script, /upsert_nims_escalation_test_hospital_user/);
  assert.doesNotMatch(script, /resolve_nims_escalation_test_client/);
  assert.doesNotMatch(script, /verify_nims_escalation_test_hospital_user/);
  assert.doesNotMatch(script, /temporary_password/);
  assert.doesNotMatch(script, /console\.log\([^)]*serviceKey/i);
  assert.doesNotMatch(script, /console\.log\([^)]*SUPABASE_SERVICE_ROLE_KEY/i);
});

test('NIMS escalation test script targets only existing picker-selected test Auth users', () => {
  for (const expected of [
    'test.nims.operations.executive@qpms.invalid',
    'test.nims.facility.manager@qpms.invalid',
    'test.nims.project.head@qpms.invalid',
    '35b60c7a-a3f0-4e7c-89a3-d5eac5a644d8',
    'fa838e7b-e130-4bf6-93fa-752e16106338',
    '31dd3529-776e-4ba6-8fc5-b8594e8822bf',
  ]) {
    assert.match(script, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(script, /auth_email_confirmed/);
  assert.match(script, /auth_usable_for_email_password/);
  assert.match(script, /hospital_escalation_manual_test === true/);
  assert.match(script, /do_not_use_for_real_staff === true/);
  assert.match(script, /picker_matches_test_user/);
});
