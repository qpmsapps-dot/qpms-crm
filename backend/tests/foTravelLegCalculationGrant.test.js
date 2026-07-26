import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(
  'supabase/migrations_2_0/035_grant_service_role_travel_leg_calculation_update.sql',
  'utf8',
);

test('service role receives only travel-leg update required by recalculation', () => {
  assert.match(
    migration,
    /grant\s+update\s*\([\s\S]*calculated_km[\s\S]*payable_amount[\s\S]*\)\s+on\s+table\s+public\.fo_travel_legs\s+to\s+service_role/i,
  );
  assert.doesNotMatch(migration, /grant\s+(insert|delete)/i);
  assert.doesNotMatch(migration, /to\s+(anon|authenticated)/i);
});
