import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(
  new URL('../../supabase/migrations_2_0/030_unified_access_control_foundation.sql', import.meta.url),
  'utf8',
);

const accessTables = [
  'access_business_verticals',
  'access_clients',
  'access_modules',
  'access_business_vertical_modules',
  'access_client_modules',
  'access_roles',
  'access_permissions',
  'access_role_permissions',
  'access_user_assignments',
  'access_user_scopes',
  'access_audit_logs',
];

test('migration creates the canonical unified access table set', () => {
  for (const table of accessTables) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
  }
});

test('migration uses additive access_* names and does not alter legacy authorization tables', () => {
  assert.doesNotMatch(sql, /drop\s+table/i);
  assert.doesNotMatch(sql, /alter\s+table\s+public\.profiles/i);
  assert.doesNotMatch(sql, /alter\s+table\s+public\.hospital_ticket_users/i);
  assert.doesNotMatch(sql, /alter\s+table\s+public\.hospital_ticket_user_scopes/i);
  assert.doesNotMatch(sql, /alter\s+table\s+public\.hospital_clients/i);
  assert.doesNotMatch(sql, /alter\s+table\s+public\.fo_/i);
  assert.doesNotMatch(sql, /alter\s+table\s+public\.fault/i);
});

test('new tables have practical uniqueness and active lookup indexes', () => {
  assert.match(sql, /ux_access_business_verticals_code/);
  assert.match(sql, /ux_access_clients_vertical_code/);
  assert.match(sql, /ux_access_modules_code/);
  assert.match(sql, /ux_access_roles_code_module_user_type/);
  assert.match(sql, /ux_access_permissions_code/);
  assert.match(sql, /ux_access_user_assignments_active_identity/);
  assert.match(sql, /idx_access_user_scopes_scope_lookup/);
});

test('identity strategy supports missing profiles without using email or phone as relational keys', () => {
  assert.match(sql, /auth_user_id uuid/);
  assert.match(sql, /profile_id uuid references public\.profiles\(id\) on delete restrict/);
  assert.match(sql, /check \(auth_user_id is not null or profile_id is not null\)/);
  assert.doesNotMatch(sql, /email\s+text/i);
  assert.doesNotMatch(sql, /phone\s+text/i);
});

test('foundation seed creates definitions only and never grants real user access', () => {
  assert.match(sql, /insert into public\.access_business_verticals/);
  assert.match(sql, /insert into public\.access_modules/);
  assert.match(sql, /insert into public\.access_roles/);
  assert.match(sql, /insert into public\.access_permissions/);
  assert.doesNotMatch(sql, /insert into public\.access_user_assignments/i);
  assert.doesNotMatch(sql, /insert into public\.access_user_scopes/i);
});

test('foundation data is generic and does not hardcode client-specific routing assumptions', () => {
  assert.match(sql, /'hospital'/);
  assert.match(sql, /'retail'/);
  assert.match(sql, /'client_ticketing'/);
  assert.match(sql, /'hospital_operations'/);
  assert.doesNotMatch(sql, /NIMS Hyderabad/i);
  assert.doesNotMatch(sql, /Block A/i);
  assert.doesNotMatch(sql, /Block B/i);
});

test('access tables have no direct authenticated reads or writes', () => {
  assert.match(sql, /revoke all on public\.access_user_assignments from anon, authenticated/);
  assert.match(sql, /revoke all on public\.access_audit_logs from anon, authenticated/);
  assert.doesNotMatch(sql, /grant\s+select[\s\S]{0,400}to authenticated/i);
  assert.doesNotMatch(sql, /grant\s+(insert|update|delete|all)[\s\S]{0,120}to authenticated/i);
  assert.doesNotMatch(sql, /create policy[\s\S]{0,200}to authenticated/i);
});

test('migration is safe to rerun for seed data and guarded policies/triggers', () => {
  assert.match(sql, /create table if not exists/);
  assert.match(sql, /create unique index if not exists/);
  assert.match(sql, /drop trigger if exists/);
  assert.match(sql, /on conflict do nothing/);
});
