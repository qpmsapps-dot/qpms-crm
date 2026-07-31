import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(
  'supabase/migrations_2_0/038_grant_service_role_final_leg_reconciliation.sql',
  'utf8',
);

test('final-leg reconciliation grants only trusted backend table privileges', () => {
  assert.match(
    migration,
    /grant\s+select,\s*insert,\s*update\s+on\s+table\s+public\.fo_travel_legs\s+to\s+service_role/i,
  );
  assert.match(
    migration,
    /grant\s+update\s+on\s+table\s+public\.fo_attendance\s+to\s+service_role/i,
  );
  assert.doesNotMatch(migration, /to\s+(anon|authenticated)/i);
  assert.doesNotMatch(migration, /grant[^;]*(sequence|serial)/i);
});
