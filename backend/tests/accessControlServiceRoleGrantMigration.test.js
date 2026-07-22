import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(
  new URL('../../supabase/migrations_2_0/031_grant_service_role_unified_access.sql', import.meta.url),
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

test('migration 031 grants service_role access to every unified access table', () => {
  assert.match(sql, /grant usage on schema public to service_role/i);
  assert.match(sql, /grant select, insert, update, delete on[\s\S]*to service_role/i);
  for (const table of accessTables) {
    assert.match(sql, new RegExp(`public\\.${table}`));
  }
});

test('migration 031 does not grant anon or authenticated access', () => {
  assert.doesNotMatch(sql, /grant[\s\S]{0,200}to\s+(anon|authenticated)/i);
  assert.match(sql, /from anon, authenticated/i);
});

test('migration 031 is narrowly scoped to access tables only', () => {
  assert.doesNotMatch(sql, /public\.profiles/i);
  assert.doesNotMatch(sql, /public\.hospital_/i);
  assert.doesNotMatch(sql, /public\.fo_/i);
  assert.doesNotMatch(sql, /public\.fault/i);
  assert.doesNotMatch(sql, /drop\s+/i);
  assert.doesNotMatch(sql, /alter\s+table/i);
});
