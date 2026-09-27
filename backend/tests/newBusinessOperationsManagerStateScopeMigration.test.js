import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  'supabase/migrations_2_0/110_new_business_operations_manager_state_scope.sql',
  'utf8',
);
const service = readFileSync('backend/services/opportunityWorkflowService.js', 'utf8');

const seededMappings = [
  ['TN', 'QPMSTN10098'],
  ['TN', 'QPMSTN12728'],
  ['TN', 'QPMSTN15552'],
  ['TN', 'QPMSTN16099'],
  ['TN', 'QPMSTNC16974'],
  ['TG', 'QPMSTS1891'],
  ['TG', 'QPMSTS4053'],
  ['KA', 'QPMSKA3846'],
];

test('Migration 110 is transactional, additive and isolated from operational modules', () => {
  assert.match(migration, /^--[^\n]*\n--[^\n]*\nbegin;/);
  assert.match(migration, /commit;\s*$/);
  assert.match(migration, /create table public\.new_business_operations_manager_state_scope/);
  assert.doesNotMatch(migration, /update\s+public\.profiles/i);
  assert.doesNotMatch(migration, /(?:insert|update|delete)\s+(?:into\s+|from\s+)?public\.employee_hierarchy/i);
  assert.doesNotMatch(migration, /\bdelete\s+from\b|\btruncate\b/i);
  assert.doesNotMatch(migration, /fo_|hospital|nims|kilometer|business\s*=/i);
});

test('OM State-scope table has the reviewed keys, indexes and service-role boundary', () => {
  assert.match(migration, /id uuid primary key default gen_random_uuid\(\)/);
  assert.match(migration, /operations_manager_profile_id uuid not null/);
  assert.match(migration, /foreign key \(operations_manager_profile_id\) references public\.profiles\(id\) on delete restrict/);
  assert.match(migration, /unique \(operations_manager_profile_id, state\)/);
  assert.match(migration, /\(state, is_active\)/);
  assert.match(migration, /\(operations_manager_profile_id, is_active\)/);
  assert.doesNotMatch(migration, /unique index[^;]*\(state\)[^;]*where is_active/is);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on table public\.new_business_operations_manager_state_scope from public, anon, authenticated/);
  assert.match(migration, /grant select, insert, update, delete on table public\.new_business_operations_manager_state_scope to service_role/);
});

test('only confirmed TN, TG and KA Operations Managers are seeded by employee code', () => {
  for (const [state, employeeCode] of seededMappings) {
    assert.match(migration, new RegExp(`\\('${state}', '${employeeCode}'\\)`));
  }
  for (const employeeCode of [
    'QPMSKL1410', 'QPMSKL1346',
    'QPMSAPC16997', 'QPMSAP16999', 'QPMSAP1527', 'QPMSAPC17011', 'QPMSAP2406',
  ]) assert.doesNotMatch(migration, new RegExp(`'${employeeCode}'`));
  assert.match(migration, /Expected exactly one profile for confirmed Operations Manager employee code/);
  assert.match(migration, /v_profile\.role <> 'Operations Manager'/);
  assert.match(migration, /v_profile\.auth_user_id is null/);
});

test('one OM may cover multiple States and multiple OMs may cover one State', () => {
  assert.match(migration, /unique \(operations_manager_profile_id, state\)/);
  assert.equal(seededMappings.filter(([state]) => state === 'TN').length, 5);
  assert.equal(seededMappings.filter(([state]) => state === 'TG').length, 2);
  assert.doesNotMatch(migration, /one_active_per_state/);
});

test('assignment RPC requires active auth-mapped profile, explicit State scope and direct hierarchy', () => {
  const rpc = migration.slice(
    migration.indexOf('create or replace function public.rpc_assign_site_survey_operations_manager'),
    migration.indexOf('comment on function public.rpc_assign_site_survey_operations_manager'),
  );
  assert.match(rpc, /v_manager\.role is distinct from 'Operations Manager'/);
  assert.match(rpc, /v_manager\.is_active is not true/);
  assert.match(rpc, /v_manager\.auth_user_id is null/);
  assert.match(rpc, /new_business_operations_manager_state_scope scope/);
  assert.match(rpc, /scope\.operations_manager_profile_id = v_manager\.id/);
  assert.match(rpc, /opportunity_state_key\(scope\.state\) = public\.opportunity_state_key\(v_visit\.owner_state\)/);
  assert.match(rpc, /eh\.manager_employee_code = v_branch\.employee_code/);
  assert.match(rpc, /v_visit\.branch_head_profile_id is distinct from p_branch_head_profile_id/);
  assert.match(rpc, /operations_manager_state_scope_missing/);
  assert.match(rpc, /operations_manager_not_direct_report/);
  assert.doesNotMatch(rpc, /opportunity_state_key\(v_manager\.state\)/);
  assert.doesNotMatch(rpc, /\.business/i);
});

test('backend candidate list uses the same explicit scope without exposing auth IDs', () => {
  const candidateList = service.slice(
    service.indexOf('export async function listBranchOperationsManagers'),
    service.indexOf('export async function assignSurveyOperationsManager'),
  );
  assert.match(candidateList, /new_business_operations_manager_state_scope/);
  assert.match(candidateList, /auth_user_id/);
  assert.match(candidateList, /normalizedStateKey\(scope\.state\) === ownerState/);
  assert.match(candidateList, /manager_employee_code/);
  assert.match(candidateList, /branch_head_profile_id !== actor\.profileId/);
  assert.doesNotMatch(candidateList, /stateScopeAllows/);
  assert.doesNotMatch(candidateList, /(?:profile|scope|visit)\.business|\.eq\(['"]business/);
});

test('precise OM eligibility errors are retained across database and service layers', () => {
  for (const code of [
    'operations_manager_not_eligible',
    'operations_manager_not_active',
    'operations_manager_auth_mapping_missing',
    'operations_manager_state_scope_missing',
    'operations_manager_not_direct_report',
  ]) {
    assert.match(migration, new RegExp(code));
    assert.match(service, new RegExp(code));
  }
});

test('Site Survey notifications add safe context and remain recipient-scoped best effort', () => {
  const notification = migration.slice(
    migration.indexOf('create or replace function public.opportunity_site_visit_notification_trigger'),
  );
  for (const field of [
    'client', 'state', 'site', 'preferred_survey_date',
    'scheduled_survey_date', 'branch_head', 'requirement_summary',
  ]) assert.match(notification, new RegExp(`'${field}'`));
  assert.match(notification, /new\.branch_head_profile_id/);
  assert.match(notification, /new\.assigned_operations_manager_profile_id/);
  assert.match(notification, /perform public\.opportunity_notify/);
  assert.match(notification, /exception when others then[\s\S]*return new/);
  assert.doesNotMatch(notification, /cost|margin|finance|commercial|proposal/i);
});

test('assignment RPC and scope storage remain unavailable to browser roles', () => {
  assert.match(migration, /revoke all on function public\.rpc_assign_site_survey_operations_manager\(uuid,uuid,uuid\) from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.rpc_assign_site_survey_operations_manager\(uuid,uuid,uuid\) to service_role/);
});
