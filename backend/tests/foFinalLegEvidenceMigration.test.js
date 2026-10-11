import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sql = await readFile(
  new URL('../../supabase/migrations_2_0/205_fo_final_leg_evidence_reconciliation.sql', import.meta.url),
  'utf8',
);
const evidenceRpc = sql
  .split('create or replace function public.rpc_record_fo_final_leg_evidence_v1')[1]
  .split('create or replace function public.rpc_resolve_fo_final_leg_evidence_v1')[0];

test('companion migration requires guarded canonical V2', () => {
  assert.match(sql, /fo_km_calculation_runs/);
  assert.match(sql, /rpc_persist_fo_canonical_km_v2/);
  assert.match(sql, /guarded Migration 200 canonical V2 prerequisites are missing/);
  assert.doesNotMatch(sql, /update\s+public\.fo_site_visits/i);
});

test('RPC locks exact rows and guards stale state and existing totals', () => {
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /from public\.fo_attendance[\s\S]+for update/i);
  assert.match(sql, /from public\.fo_travel_legs[\s\S]+for update/i);
  assert.match(sql, /final_leg_evidence_stale_input/);
  assert.match(sql, /final_leg_evidence_not_pending_or_already_canonical/);
  assert.match(sql, /final_leg_evidence_site_visit_state_mismatch/);
  assert.match(sql, /final_leg_evidence_attendance_financial_state_mismatch/);
  assert.match(evidenceRpc, /v_site_visit_count <> \(p_plan ->> 'expectedSiteVisitCount'\)::integer/);
  assert.match(evidenceRpc, /v_site_visit_route_km <> round\(\(p_plan ->> 'expectedSiteVisitRouteKm'\)::numeric, 2\)/);
  assert.match(sql, /v_last_visit\.check_out_latitude/);
  assert.match(sql, /v_attendance\.end_latitude/);
});

test('RPC writes only immutable evidence and never inserts or updates a travel leg', () => {
  assert.doesNotMatch(evidenceRpc, /update\s+public\.fo_travel_legs/i);
  assert.doesNotMatch(evidenceRpc, /insert into public\.fo_travel_legs/i);
  assert.doesNotMatch(evidenceRpc, /update\s+public\.fo_attendance/i);
  assert.match(sql, /unique \(attendance_id, travel_leg_id, input_digest\)/);
  assert.match(sql, /idempotent_replay/);
});

test('financial apply is single-target, approval-backed and preserves canonical pending status', () => {
  assert.match(sql, /rpc_apply_fo_final_leg_financial_v1/);
  assert.match(sql, /final_leg_financial_apply_target_key unique \(attendance_id, travel_leg_id\)/i);
  assert.match(sql, /v_site_visit_count <> 7 or v_site_visit_route_km <> 76\.45/);
  assert.match(sql, /fo_km_financial_approval_consumptions/);
  assert.match(sql, /final_leg_apply_id/);
  assert.match(sql, /final_leg_reconciled_pending_canonical_v2/);
  assert.match(sql, /FINAL_LEG_FINANCIALLY_APPLIED_CANONICAL_PENDING/);
  assert.match(sql, /'canonical_recalculation_complete', false/);
  assert.doesNotMatch(sql, /update\s+public\.fo_site_visits/i);
});

test('Haversine is reference-only, cannot be evidence-approved and canonical completion stays pending', () => {
  assert.match(sql, /HAVERSINE_REFERENCE/);
  assert.doesNotMatch(sql, /HAVERSINE_ROUTE_FALLBACK/);
  assert.match(sql, /decision = 'MANUAL_REVIEW'/);
  assert.match(sql, /v_run\.reference_only or v_run\.source = 'HAVERSINE_REFERENCE'/);
  assert.match(sql, /'canonical_recalculation_complete', false/);
});

test('database evidence authorization is bound to the exact 7/8 October Balaji attendance and legs', () => {
  assert.match(sql, /a8d170e6-cbb4-4788-928d-6eb9999d51e2/);
  assert.match(sql, /48991354-ca06-4856-9931-8f95e6bb932e/);
  assert.match(evidenceRpc, /d299f0c4-9af7-4f0c-b8cc-86e5b7fb1f91/);
  assert.match(evidenceRpc, /850bc41b-e492-4661-9f5e-05aaafb19d0c/);
  assert.match(sql, /QPMSTNC17015/);
  assert.match(sql, /date '2026-10-07'/);
  assert.match(evidenceRpc, /date '2026-10-08'/);
  assert.match(sql, /final_leg_evidence_target_not_authorized/);
});

test('8 October extension remains evidence-only while 7 October financial apply stays exact', () => {
  const financialRpc = sql
    .split('create or replace function public.rpc_apply_fo_final_leg_financial_v1')[1]
    .split('alter function public.rpc_record_fo_final_leg_evidence_v1')[0];
  assert.doesNotMatch(financialRpc, /d299f0c4-9af7-4f0c-b8cc-86e5b7fb1f91/);
  assert.doesNotMatch(financialRpc, /850bc41b-e492-4661-9f5e-05aaafb19d0c/);
  assert.match(financialRpc, /a8d170e6-cbb4-4788-928d-6eb9999d51e2/);
  assert.match(financialRpc, /48991354-ca06-4856-9931-8f95e6bb932e/);
  assert.match(financialRpc, /v_before_route <> 76\.45/);
  assert.match(financialRpc, /v_site_visit_count <> 7 or v_site_visit_route_km <> 76\.45/);
});

test('evidence and resolution rows are immutable and evidence approval is not financial approval', () => {
  assert.match(sql, /trg_immutable_fo_final_leg_reconciliation_runs/);
  assert.match(sql, /trg_immutable_fo_final_leg_reconciliation_resolutions/);
  assert.match(sql, /'financially_approved', false/);
});

test('RLS and grants expose neither table writes nor RPC execution to clients', () => {
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on table[\s\S]+from public, anon, authenticated/);
  assert.match(sql, /revoke all on function[\s\S]+from public, anon, authenticated/);
  assert.match(sql, /grant execute on function[\s\S]+to service_role/);
});
