import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const migration102 = new URL('../supabase/migrations_2_0/102_pre_sales_mvp_foundation.sql', import.meta.url);
const migration105 = new URL('../supabase/migrations_2_0/105_add_pre_sales_business_role.sql', import.meta.url);

const productionRoles = [
  'Admin', 'QPMS Admin', 'Developer', 'Dev', 'IT Admin', 'Management IT Admin', 'Management',
  'MD', 'COO', 'Executive Assistant', 'GM', 'General Manager', 'South Head', 'Business Head',
  'Branch Head', 'Operations Manager', 'Manager', 'KAM', 'FO', 'Field Officer', 'Supervisor',
  'BD Executive', 'BD Head', 'Pre-Sales Executive', 'Pre-Sales Manager', 'Hospital Management',
  'RMO', 'Doctor', 'Operations Team', 'Coordinator', 'Commercial', 'Commercial Team',
  'Commercial Reviewer', 'Finance', 'Finance Team', 'Finance Reviewer', 'HR Reviewer', 'HR',
  'HR GM', 'Finance GM', 'DEMO_VIEWER',
];

function roles(sql) {
  const definition = sql.match(/add constraint profiles_role_check check \(\s*role in \(\s*([\s\S]*?)\s*\)\s*\) not valid;/i);
  assert.ok(definition);
  return [...definition[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

test('migration 105 preserves the exact production vocabulary and adds only canonical Pre-Sales', async () => {
  const sql = await readFile(migration105, 'utf8');
  const allowed = roles(sql);
  assert.deepEqual(new Set(allowed), new Set([...productionRoles, 'Pre-Sales']));
  assert.equal(allowed.length, productionRoles.length + 1);
  assert.ok(allowed.includes('Pre-Sales Executive'));
  assert.ok(allowed.includes('Pre-Sales Manager'));
  assert.ok(allowed.includes('Pre-Sales'));
  assert.equal(allowed.includes('__INVALID_ROLE_TEST__'), false);
  assert.match(sql, /^begin;/m);
  assert.match(sql, /^commit;/m);
  assert.doesNotMatch(sql, /\b(update|delete|insert|truncate|drop table|drop column)\b/i);
  assert.match(sql, /canonical business role/i);
});

test('already-applied migration 102 remains byte-for-byte unchanged', async () => {
  const bytes = await readFile(migration102);
  assert.equal(createHash('sha256').update(bytes).digest('hex').toUpperCase(), 'E89BC28D6CF523982C78CED5BAD8AB6D5D82C643A24308E9A8E60093699835F8');
});
