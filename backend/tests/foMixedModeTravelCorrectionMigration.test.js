import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL(
  '../../supabase/migrations_2_0/118_fo_mixed_mode_travel_reimbursement_integrity.sql',
  import.meta.url,
);
const migration = await readFile(migrationUrl, 'utf8');

test('migration 118 adds a service-role-only durable correction audit', () => {
  assert.match(migration, /create table if not exists public\.fo_travel_reimbursement_corrections/i);
  assert.match(migration, /correction_confidence in \('HIGH', 'MEDIUM', 'LOW'\)/i);
  assert.match(migration, /before_state jsonb not null/i);
  assert.match(migration, /proposed_state jsonb not null/i);
  assert.match(migration, /applied_state jsonb/i);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /revoke all on table public\.fo_travel_reimbursement_corrections from public, anon, authenticated/i);
  assert.match(migration, /grant select, insert, update on table public\.fo_travel_reimbursement_corrections to service_role/i);
});

test('site-visit refresh defers to travel legs and preserves legacy single-mode clients', () => {
  assert.match(migration, /v_has_travel_legs/i);
  assert.match(migration, /if v_has_travel_legs then\s+return;/i);
  assert.match(migration, /legacy_single_mode_site_visit_route_km_sum/i);
  assert.match(migration, /travel_mode, 'bike'\)\) in \('bike', 'own_vehicle', 'car'\)/i);
  assert.match(migration, /travel_mode, ''\)\) = 'car'[\s\S]*route_totals\.total_route_km \* 8/i);
  assert.match(migration, /travel_mode, 'bike'\)\) in \('bike', 'own_vehicle'\)[\s\S]*route_totals\.total_route_km \* 4/i);
  assert.match(migration, /revoke all on function public\.refresh_fo_attendance_payable_route_km\(uuid\) from anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.refresh_fo_attendance_payable_route_km\(uuid\) to service_role/i);
  assert.doesNotMatch(migration, /grant execute[^;]*to authenticated/i);
});

test('migration 118 does not rewrite operational or expense source data', () => {
  assert.doesNotMatch(migration, /delete\s+from/i);
  assert.doesNotMatch(migration, /truncate/i);
  assert.doesNotMatch(migration, /drop\s+table/i);
  assert.doesNotMatch(migration, /update\s+public\.fo_location_logs/i);
  assert.doesNotMatch(migration, /update\s+public\.fo_site_visits/i);
  assert.doesNotMatch(migration, /update\s+public\.fo_travel_expense_claims/i);
  assert.doesNotMatch(migration, /update\s+public\.fo_travel_legs/i);
});
