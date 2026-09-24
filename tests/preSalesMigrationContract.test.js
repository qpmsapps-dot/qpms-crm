import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL('../supabase/migrations_2_0/102_pre_sales_mvp_foundation.sql', import.meta.url);

const productionProfileRoles = [
  'Admin',
  'QPMS Admin',
  'Developer',
  'Dev',
  'IT Admin',
  'Management IT Admin',
  'Management',
  'MD',
  'COO',
  'Executive Assistant',
  'GM',
  'General Manager',
  'South Head',
  'Business Head',
  'Branch Head',
  'Operations Manager',
  'Manager',
  'KAM',
  'FO',
  'Field Officer',
  'Supervisor',
  'BD Executive',
  'BD Head',
  'Hospital Management',
  'RMO',
  'Doctor',
  'Operations Team',
  'Coordinator',
  'Commercial',
  'Commercial Team',
  'Commercial Reviewer',
  'Finance',
  'Finance Team',
  'Finance Reviewer',
  'HR Reviewer',
  'HR',
  'HR GM',
  'Finance GM',
  'DEMO_VIEWER',
];

const preSalesProfileRoles = ['Pre-Sales Executive', 'Pre-Sales Manager'];

function migrationProfileRoles(sql) {
  const constraint = sql.match(
    /add constraint profiles_role_check check \(\s*role in \(\s*([\s\S]*?)\s*\)\s*\) not valid;/i,
  );
  assert.ok(constraint, 'profiles_role_check definition must be present');
  return [...constraint[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

test('Pre-Sales migration is additive and creates structured tables with required indexes', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  for (const table of ['lead_call_updates', 'lead_followups', 'lead_meetings', 'lead_handoffs']) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  for (const index of ['idx_lead_call_updates_lead_created', 'idx_lead_followups_owner_scheduled', 'idx_lead_followups_lead_scheduled', 'idx_lead_followups_status_scheduled', 'idx_lead_meetings_lead_scheduled', 'idx_lead_meetings_status_scheduled', 'idx_lead_handoffs_lead_created', 'idx_lead_handoffs_status_created']) assert.match(sql, new RegExp(index));
  assert.match(sql, /'Pre-Sales Executive'/);
  assert.match(sql, /'Pre-Sales Manager'/);
  assert.doesNotMatch(sql, /drop table|truncate|delete from/i);
});

test('call update RPC is service-role-only and commits call, follow-up, meeting, lead, and audit changes together', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /create or replace function public\.rpc_add_pre_sales_call_update/);
  assert.match(sql, /insert into public\.lead_call_updates/);
  assert.match(sql, /insert into public\.lead_followups/);
  assert.match(sql, /insert into public\.lead_meetings/);
  assert.match(sql, /update public\.leads/);
  assert.match(sql, /insert into public\.activity_logs/);
  assert.match(sql, /revoke all on function public\.rpc_add_pre_sales_call_update[^;]+authenticated/);
  assert.match(sql, /grant execute on function public\.rpc_add_pre_sales_call_update[^;]+service_role/);
});

test('profiles role constraint preserves production roles and adds only approved Pre-Sales roles', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  const roles = migrationProfileRoles(sql);
  const expectedRoles = [...productionProfileRoles, ...preSalesProfileRoles];

  assert.deepEqual(new Set(roles), new Set(expectedRoles));
  assert.equal(roles.length, expectedRoles.length, 'role allow-list must not contain duplicates');
  assert.ok(roles.includes('DEMO_VIEWER'));
  assert.ok(roles.includes('Management'));
  assert.ok(roles.includes('Pre-Sales Executive'));
  assert.ok(roles.includes('Pre-Sales Manager'));
  assert.equal(roles.includes('__INVALID_ROLE_TEST__'), false);
});
