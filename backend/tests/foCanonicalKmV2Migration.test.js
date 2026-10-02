import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL('../../supabase/migrations_2_0/200_fo_canonical_km_engine_v2_reconciliation.sql', import.meta.url);
const sql = (await readFile(migrationUrl, 'utf8')).toLowerCase();

test('migration is additive, preflighted and does not rewrite history on application', () => {
  assert.match(sql, /km v2 preflight failed/);
  assert.doesNotMatch(sql, /insert\s+into\s+supabase_migrations\.schema_migrations/);
  assert.doesNotMatch(sql, /update\s+public\.fo_attendance[\s\S]+where\s+attendance_date/);
});

test('canonical RPC is postgres-owned service-role-only security definer', () => {
  assert.match(sql, /security definer\s+set search_path = public, pg_temp/);
  assert.match(sql, /owner to postgres/);
  assert.match(sql, /revoke all on function[\s\S]+from public, anon, authenticated/);
  assert.match(sql, /grant execute on function[\s\S]+to service_role/);
});

test('canonical RPC serializes, locks row and rejects stale evidence', () => {
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /for update/);
  assert.match(sql, /km_v2_stale_input_digest/);
  assert.match(sql, /attendance_id, calculation_version, input_digest/);
});

test('one transaction persists legs, totals, missing KM and immutable evidence', () => {
  assert.match(sql, /insert into public\.fo_travel_legs/);
  assert.match(sql, /insert into public\.fo_km_calculation_runs/);
  assert.match(sql, /from public\.fo_missing_km_reviews/);
  assert.match(sql, /update public\.fo_attendance/);
  assert.match(sql, /^begin;/m);
  assert.match(sql, /^commit;/m);
  assert.match(sql, /revoke all on table public\.fo_km_calculation_runs/);
});

test('legacy triggers are restricted to evidence and active-day provisional output', () => {
  const actualBody = sql.split('create or replace function public.refresh_fo_attendance_actual_travel_km')[1]
    .split('create or replace function public.refresh_fo_attendance_payable_route_km')[0];
  assert.doesNotMatch(actualBody, /actual_km\s*=/);
  assert.match(actualBody, /gps_trigger_role', 'evidence_only/);
  assert.match(sql, /legacy_provisional_active_day/);
  assert.match(sql, /lower\(coalesce\(a\.status, ''\)\) = 'active'/);
  assert.match(sql, /km_calculation_version[\s\S]+km_engine_v2/);
  assert.match(sql, /disable trigger trg_fo_location_logs_actual_travel_km/);
  assert.match(sql, /pending_canonical_end_day_recalculation/);
  assert.match(sql, /trg_protect_fo_canonical_km_v2_financials/);
});

test('new writes receive safe nonnegative and time guardrails without validating historical rows', () => {
  assert.match(sql, /fo_travel_legs_v2_nonnegative_check[\s\S]+not valid/);
  assert.match(sql, /fo_travel_legs_v2_time_check[\s\S]+not valid/);
  assert.match(sql, /fo_attendance_v2_nonnegative_check[\s\S]+not valid/);
});
