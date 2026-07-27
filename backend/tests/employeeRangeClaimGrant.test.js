import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sql = await readFile(
  new URL(
    '../../supabase/migrations_2_0/036_grant_service_role_employee_range_claim_read.sql',
    import.meta.url,
  ),
  'utf8',
);

test('employee range claims grant is narrow and idempotent', () => {
  assert.match(
    sql,
    /grant\s+select\s+on\s+table\s+public\.fo_travel_expense_claims\s+to\s+service_role/i,
  );
  assert.doesNotMatch(sql, /grant\s+(insert|update|delete|all)/i);
  assert.doesNotMatch(sql, /authenticated|anon/i);
});
