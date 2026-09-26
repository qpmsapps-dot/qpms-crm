import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const migration102 = await readFile(new URL('../supabase/migrations_2_0/102_pre_sales_mvp_foundation.sql', import.meta.url));
const migration105 = await readFile(new URL('../supabase/migrations_2_0/105_add_pre_sales_business_role.sql', import.meta.url), 'utf8');
const migration108 = await readFile(new URL('../supabase/migrations_2_0/108_add_business_development_roles.sql', import.meta.url), 'utf8');

function constraintRoles(sql) {
  const block = sql.match(/add constraint profiles_role_check check\s*\(\s*role in\s*\(([\s\S]*?)\)\s*\)\s*not valid/i)?.[1] || '';
  return [...block.matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

test('Migration 108 preserves every role from 105 and adds only the two canonical BD roles', () => {
  const oldRoles = constraintRoles(migration105);
  const nextRoles = constraintRoles(migration108);
  assert.ok(oldRoles.length > 0);
  assert.equal(new Set(nextRoles).size, nextRoles.length, 'role literals must not be duplicated');
  for (const role of oldRoles) assert.ok(nextRoles.includes(role), role);
  assert.deepEqual(nextRoles.filter((role) => !oldRoles.includes(role)).sort(), [
    'Business Development Executive',
    'Business Development Head',
  ]);
  assert.ok(nextRoles.includes('BD Executive'));
  assert.ok(nextRoles.includes('BD Head'));
  assert.equal(nextRoles.includes('__INVALID_ROLE_TEST__'), false);
});

test('Migration 108 is transactional, data-safe, and does not alter profiles or business rows', () => {
  assert.match(migration108, /^--[\s\S]*\bbegin;/i);
  assert.match(migration108, /commit;\s*$/i);
  assert.doesNotMatch(migration108, /\b(delete|truncate|insert|update)\b\s+(?:into\s+|from\s+)?public\./i);
  assert.doesNotMatch(migration108, /alter\s+table\s+public\.(leads|lead_handoffs|lead_meetings|proposals)/i);
});

test('Migration 108 extends all deployed BD workflow RPC role checks without changing assignment enforcement', () => {
  assert.match(migration108, /is_business_development_role/);
  for (const signature of [
    'rpc_decide_pre_sales_handoff',
    'rpc_schedule_pre_sales_meeting_handoff',
    'rpc_submit_bd_meeting_mom',
    'rpc_prepare_opportunity_proposal',
    'rpc_send_opportunity_proposal',
    'rpc_record_proposal_outcome',
  ]) assert.match(migration108, new RegExp(signature));
  assert.match(migration108, /Expected legacy BD role check was not found/);
  assert.match(migration108, /revoke all on function public\.is_business_development_role\(text\) from public, anon, authenticated/);
  assert.match(migration108, /grant execute on function public\.is_business_development_role\(text\) to service_role/);
});

test('Migration 102 remains byte-for-byte unchanged', () => {
  assert.equal(
    createHash('sha256').update(migration102).digest('hex').toUpperCase(),
    'E89BC28D6CF523982C78CED5BAD8AB6D5D82C643A24308E9A8E60093699835F8',
  );
});
