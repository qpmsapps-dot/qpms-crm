import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  buildFinalLegFinancialPlan,
  summarizeFinalLegRecoveryRows,
} from '../services/foFinalLegRecoveryWorkflowService.js';

const migration = readFileSync(new URL(
  '../../supabase/migrations_2_0/207_fo_generalized_final_leg_recovery.sql', import.meta.url,
), 'utf8');
const recovery = readFileSync(new URL(
  '../../supabase/recovery/207_fo_generalized_final_leg_recovery_recovery.sql', import.meta.url,
), 'utf8');
const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../../src/pages/FOActivities.jsx', import.meta.url), 'utf8');

function approvedPreview(overrides = {}) {
  return {
    attendanceId: 'a8d170e6-cbb4-4788-928d-6eb9999d51e2',
    finalLegId: '48991354-ca06-4856-9931-8f95e6bb932e',
    attendanceUpdatedAt: '2026-10-07T14:14:50Z',
    expectedTotalRouteKm: 76.45,
    expectedEligibleKm: 76.45,
    expectedTotalApprovedKm: 76.45,
    expectedPetrolAmount: 305.8,
    existingEvidence: { id: 'run-1', input_digest: 'a'.repeat(64) },
    evidenceResolution: { decision: 'APPROVED_EVIDENCE', approved_evidence_km: 19.4 },
    existingCorrection: null,
    existingSettlement: null,
    ...overrides,
  };
}

test('7 October plan is additive and preserves the 76.45 km base', () => {
  const plan = buildFinalLegFinancialPlan(approvedPreview(), {
    approved_rate_per_km: 4,
    approved_payable_amount: 77.6,
    rate_policy: 'approved-bike-rate',
  });
  assert.equal(plan.before.totalApprovedKm, 76.45);
  assert.equal(plan.after.totalApprovedKm, 95.85);
  assert.equal(plan.after.petrolAmount, 383.4);
  assert.match(plan.inputDigest, /^[0-9a-f]{64}$/);
});

test('8 October plan is additive and produces 67.22 km', () => {
  const plan = buildFinalLegFinancialPlan(approvedPreview({
    attendanceId: 'd299f0c4-9af7-4f0c-b8cc-86e5b7fb1f91',
    finalLegId: '850bc41b-e492-4661-9f5e-05aaafb19d0c',
    expectedTotalRouteKm: 57.54,
    expectedEligibleKm: 57.54,
    expectedTotalApprovedKm: 57.54,
    evidenceResolution: { decision: 'APPROVED_EVIDENCE', approved_evidence_km: 9.68 },
  }), {
    approved_rate_per_km: 4,
    approved_payable_amount: 38.72,
    rate_policy: 'approved-bike-rate',
  });
  assert.equal(plan.after.totalApprovedKm, 67.22);
});

test('manual-review and previously corrected rows cannot create a financial plan', () => {
  assert.throws(
    () => buildFinalLegFinancialPlan(approvedPreview({ evidenceResolution: null }), {}),
    (error) => error.code === 'final_leg_evidence_approval_required',
  );
  assert.throws(
    () => buildFinalLegFinancialPlan(approvedPreview({ existingSettlement: { id: 'settlement-1' } }), {
      approved_rate_per_km: 4, approved_payable_amount: 77.6, rate_policy: 'policy',
    }),
    (error) => error.code === 'final_leg_existing_settlement_manual_review',
  );
  assert.throws(
    () => buildFinalLegFinancialPlan(approvedPreview({ existingCorrection: { id: 'correction-1' } }), {
      approved_rate_per_km: 4, approved_payable_amount: 77.6, rate_policy: 'policy',
    }),
    (error) => error.code === 'final_leg_existing_correction_manual_review',
  );
});

test('range outcomes distinguish complete, partial, blocked-for-review and eligible states', () => {
  assert.equal(summarizeFinalLegRecoveryRows([
    { status: 'ALREADY_APPLIED' }, { status: 'ALREADY_PAYABLE' },
  ]).outcome, 'complete');
  assert.equal(summarizeFinalLegRecoveryRows([
    { status: 'ELIGIBLE_FOR_EVIDENCE_REVIEW' }, { status: 'MANUAL_REVIEW' },
  ]).outcome, 'partial_review_required');
  assert.equal(summarizeFinalLegRecoveryRows([
    { status: 'MANUAL_REVIEW' },
  ]).outcome, 'manual_review_required');
  assert.equal(summarizeFinalLegRecoveryRows([
    { status: 'ELIGIBLE_FOR_EVIDENCE_REVIEW' },
  ]).outcome, 'review_required');
});

test('Migration 207 is generalized, additive, idempotent and fail-closed', () => {
  assert.match(migration, /Unexpected Migration 206 evidence RPC/);
  assert.doesNotMatch(migration, /QPMSTNC17015/);
  assert.match(migration, /pg_try_advisory_xact_lock/);
  assert.match(migration, /set lock_timeout='2s'/);
  assert.match(migration, /set statement_timeout='15s'/);
  assert.match(migration, /km_v2_database_financial_writes_closed/);
  assert.match(migration, /final_leg_existing_correction_manual_review/);
  assert.match(migration, /final_leg_existing_settlement_manual_review/);
  assert.match(migration, /v_ar:=round\(v_br\+v_km,2\)/);
  assert.match(migration, /final_leg_financial_applies/);
  assert.match(migration, /fo_km_financial_approval_consumptions/);
  assert.match(migration, /site_visit_snapshot_changed/);
  assert.match(migration, /HAVERSINE_REFERENCE/);
  assert.match(migration, /revoke all on function public\.rpc_apply_fo_final_leg_financial_v1[\s\S]+grant execute[\s\S]+to service_role/);
});

test('recovery revokes execution without deleting immutable audit evidence', () => {
  assert.match(recovery, /revoke execute/);
  assert.doesNotMatch(recovery, /delete from|truncate|drop table/i);
});

test('button uses preview workflow and never calls old replacement endpoint', () => {
  assert.match(ui, /\/api\/fo\/km\/final-leg-recovery\/preview-range/);
  assert.match(ui, /GPS Calculated/);
  assert.match(ui, /Payable KM/);
  assert.match(ui, /Apply Approved Delta/);
  const handler = ui.slice(ui.indexOf('async function recalculateSelectedOfficerKm'), ui.indexOf('async function recalculateTemporarySwitchKmForOfficer'));
  assert.doesNotMatch(handler, /recalculate-employee-range/);
  assert.match(server, /KM_FINANCIAL_WRITES_MAINTENANCE/);
  assert.match(server, /KM_V2_DATABASE_FINANCIAL_WRITES_CLOSED/);
  assert.match(server, /final-leg-recovery\/preview-range', requireSupabaseJwt, requireFoKmBatchRecalculationPermission/);
  assert.match(server, /final-leg-recovery\/action', requireSupabaseJwtWithUserScopedProfile, requireFoKmBatchRecalculationPermission/);
  assert.match(server, /rangeDays > 31/);
});
