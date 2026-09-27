import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  'supabase/migrations_2_0/109_new_business_branch_head_state_scope.sql',
  'utf8',
);
const bridgeMigration = readFileSync(
  'supabase/migrations_2_0/107_opportunity_meeting_handoff_site_survey_bridge.sql',
  'utf8',
);
const opportunityService = readFileSync(
  'backend/services/opportunityWorkflowService.js',
  'utf8',
);
const workMappingScope = readFileSync('backend/services/workMappingScope.js', 'utf8');

const confirmedMappings = [
  ['TN', 'QPMSTN3082'],
  ['TG', 'QPMSTSC16952'],
  ['KL', 'QPMSKL3762'],
  ['KA', 'QPMSKL0318'],
  ['AP-1', 'QPMSAPC16980'],
  ['AP-2', 'QPMSAPC16980'],
];

function resolveBranchHead(state, mappings) {
  const matches = mappings.filter((row) => row.is_active && row.state === state);
  if (matches.length === 0) return { status: 'branch_head_unresolved', profile: null };
  if (matches.length > 1) return { status: 'branch_head_ambiguous', profile: null };
  return { status: 'resolved', profile: matches[0].employee_code };
}

test('Migration 109 is transactional, additive and leaves profiles and hierarchy unchanged', () => {
  assert.match(migration, /^--[^\n]*\n--[^\n]*\nbegin;/);
  assert.match(migration, /commit;\s*$/);
  assert.match(migration, /create table public\.new_business_branch_head_state_scope/);
  assert.doesNotMatch(migration, /update\s+public\.profiles/i);
  assert.doesNotMatch(migration, /update\s+public\.employee_hierarchy/i);
  assert.doesNotMatch(migration, /delete\s+from/i);
  assert.doesNotMatch(migration, /truncate\s+/i);
});

test('confirmed State routes are seeded by validated employee code without profile IDs', () => {
  for (const [state, employeeCode] of confirmedMappings) {
    assert.match(migration, new RegExp(`\\('${state}', '${employeeCode}'\\)`));
  }
  assert.equal(migration.match(/'QPMSAPC16980'/g)?.length, 2);
  assert.doesNotMatch(migration, /QPMSTNC16981/); // Senthil remains operational-only.
  assert.doesNotMatch(migration, /QPMSTSC17025/); // Keshab remains operational-only.
  assert.match(migration, /Expected exactly one profile for confirmed Branch Head employee code/);
  assert.match(migration, /v_profile\.role <> 'Branch Head'/);
});

test('one Head may cover multiple States while one active Head per State is enforced', () => {
  assert.match(migration, /unique \(branch_head_profile_id, state\)/);
  assert.match(
    migration,
    /create unique index new_business_branch_head_state_scope_one_active_per_state[\s\S]*on public\.new_business_branch_head_state_scope\(state\)[\s\S]*where is_active is true/,
  );
  assert.match(migration, /check \(state in \('TN', 'KL', 'KA', 'TG', 'AP-1', 'AP-2'\)\)/);
});

test('new-business routing replaces only the profile-State predicate and never uses Business', () => {
  const routing = migration.slice(migration.indexOf('do $routing$'), migration.indexOf('comment on function public.rpc_submit_bd_meeting_mom'));
  assert.match(routing, /new_business_branch_head_state_scope scope/);
  assert.match(routing, /scope\.branch_head_profile_id = p\.id/);
  assert.match(routing, /scope\.is_active is true/);
  assert.match(routing, /v_occurrences <> 2/);
  assert.doesNotMatch(routing, /(?:p|scope|v_lead)\.business/i);
  assert.doesNotMatch(routing, /business\s*=/i);
});

test('confirmed routing matrix resolves explicit TN, TG, KL, KA and multi-State AP mappings', () => {
  const rows = confirmedMappings.map(([state, employee_code]) => ({ state, employee_code, is_active: true }));
  for (const [state, employeeCode] of confirmedMappings) {
    assert.deepEqual(resolveBranchHead(state, rows), { status: 'resolved', profile: employeeCode });
  }
  assert.equal(resolveBranchHead('AP-1', rows).profile, 'QPMSAPC16980');
  assert.equal(resolveBranchHead('AP-2', rows).profile, 'QPMSAPC16980');
});

test('missing and duplicate mappings fail closed and existing RPC statuses remain intact', () => {
  assert.equal(resolveBranchHead('UNMAPPED', []).status, 'branch_head_unresolved');
  assert.equal(resolveBranchHead('TN', [
    { state: 'TN', employee_code: 'ONE', is_active: true },
    { state: 'TN', employee_code: 'TWO', is_active: true },
  ]).status, 'branch_head_ambiguous');
  assert.match(bridgeMigration, /when v_branch_count = 0 then 'branch_head_unresolved'/);
  assert.match(bridgeMigration, /else 'branch_head_ambiguous'/);
});

test('scope storage and routing RPC remain service-role-only', () => {
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on table public\.new_business_branch_head_state_scope from public, anon, authenticated/);
  assert.match(migration, /grant select, insert, update, delete on table public\.new_business_branch_head_state_scope to service_role/);
  assert.match(migration, /revoke all on function public\.rpc_submit_bd_meeting_mom\(uuid,uuid,jsonb\) from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.rpc_submit_bd_meeting_mom\(uuid,uuid,jsonb\) to service_role/);
});

test('AP Operations Managers remain a separate explicit eligibility decision', () => {
  assert.match(workMappingScope, /if \(scopeKey === 'AP'\) return \['AP', 'AP1', 'AP2'\]\.includes\(recordKey\)/);
  assert.match(opportunityService, /stateScopeAllows\(profile\.state, visit\.data\.owner_state\)/);
  assert.match(
    bridgeMigration,
    /public\.opportunity_state_key\(p\.state\) = public\.opportunity_state_key\(v_visit\.owner_state\)/,
  );
  assert.doesNotMatch(migration, /new_business_operations_manager_state_scope/);
  assert.doesNotMatch(migration, /rpc_assign_site_survey_operations_manager/);
});

test('normal operational profile, Business and hierarchy behavior is outside Migration 109', () => {
  assert.doesNotMatch(migration, /alter table public\.profiles/);
  assert.doesNotMatch(migration, /alter table public\.employee_hierarchy/);
  assert.doesNotMatch(migration, /site_workflow_actor_can_/);
  assert.doesNotMatch(migration, /fo_|hospital|nims/i);
});
