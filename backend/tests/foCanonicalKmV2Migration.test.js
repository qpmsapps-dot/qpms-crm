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

test('canonical financial persistence is fail-closed in PostgreSQL itself', () => {
  assert.match(sql, /fo_km_financial_control/);
  assert.match(sql, /financial_writes_enabled[^;]+for share/s);
  assert.match(sql, /km_v2_database_financial_writes_closed/);
  assert.match(sql, /km_v2_financial_approval_required/);
  assert.match(sql, /fo_km_financial_approval_consumptions/);
  assert.match(sql, /for update of a/);
  assert.match(sql, /v_approval\.id[^;]+insert into public\.fo_km_financial_approval_consumptions/s);
  assert.match(sql, /km_v2_direct_financial_write_not_authorized/);
  assert.match(sql, /coalesce\(current_setting\('app\.km_v2_authorized_financial_write', true\) = 'true', false\)/);
  assert.match(sql, /app\.km_v2_authorized_financial_write/);
});

test('approval issuance is authenticated-admin-only and approval records are immutable', () => {
  assert.match(sql, /rpc_approve_fo_km_financial_change_v1/);
  assert.match(sql, /auth\.uid\(\)[\s\S]+public\.is_qpms_admin\(\)/);
  assert.match(sql, /revoke all on function public\.rpc_approve_fo_km_financial_change_v1[\s\S]+service_role/);
  assert.match(sql, /trg_immutable_fo_km_financial_approvals/);
  assert.match(sql, /trg_immutable_fo_km_financial_consumptions/);
  assert.match(sql, /km_v2_immutable_audit_record/);
});

test('pending or rejected final-leg evidence vetoes a payable final leg', () => {
  assert.match(sql, /fo_final_leg_reconciliation_runs/);
  assert.match(sql, /fo_final_leg_reconciliation_resolutions/);
  assert.match(sql, /r\.decision <> 'approved_evidence'/);
  assert.match(sql, /km_v2_final_leg_evidence_unresolved/);
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

test('preflight checks exact schema, unique conflict index, trigger definitions, grants and RLS', () => {
  assert.match(sql, /information_schema\.columns/);
  assert.match(sql, /ux_fo_travel_legs_attendance_started/);
  assert.match(sql, /pg_get_triggerdef/);
  assert.match(sql, /has_function_privilege/);
  assert.match(sql, /relrowsecurity/);
  assert.match(sql, /partial canonical v2 installation detected/);
});

test('migration rerun accepts its own disabled GPS trigger only after V2 objects exist', () => {
  assert.match(sql, /v_v2_already_applied boolean/);
  assert.match(sql, /t\.tgenabled = 'd'[\s\S]+legacy location audit trigger was disabled before first v2 application/i);
  assert.match(sql, /fo_km_v2_recovery_snapshot/);
  assert.match(sql, /on conflict \(snapshot_key\) do nothing/);
});

test('idempotent replay validates canonical attendance state before returning the old run', () => {
  const existingRun = sql.indexOf('select * into v_existing');
  const replayReturn = sql.indexOf("'idempotent_replay', true", existingRun);
  const stateMismatch = sql.indexOf('km_v2_idempotent_replay_state_mismatch', existingRun);
  assert.ok(existingRun >= 0 && stateMismatch > existingRun && replayReturn > stateMismatch);
  assert.match(sql, /metadata ->> 'km_calculation_run_id'/);
  assert.match(sql, /metadata ->> 'km_input_digest'/);
  assert.match(sql, /total_approved_km[\s\S]+v_existing\.payable_km/);
  assert.match(sql, /petrol_amount[\s\S]+v_existing\.reimbursement/);
});

test('legacy invalid-time travel legs are preserved for manual review', () => {
  assert.match(sql, /ended_at < started_at/);
  assert.match(sql, /km_v2_legacy_invalid_leg_time_manual_review/);
  assert.doesNotMatch(sql, /update\s+public\.fo_travel_legs[\s\S]+set\s+(started_at|ended_at)/i);
});
