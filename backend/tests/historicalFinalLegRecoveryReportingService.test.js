import assert from 'node:assert/strict';
import test from 'node:test';

import {
  loadHistoricalFinalLegRecoveries,
  overlayHistoricalFinalLegRecoveries,
} from '../services/historicalFinalLegRecoveryReportingService.js';

function attendance(overrides = {}) {
  return {
    id: 'attendance-1',
    attendance_date: '2026-10-01',
    logout_time: '2026-10-01T12:30:00Z',
    travel_mode: 'bike',
    payable_km_allowed: true,
    total_route_km: 12.5,
    eligible_km: 12.5,
    total_approved_km: 12.5,
    petrol_amount: 50,
    ...overrides,
  };
}

function dataset() {
  return {
    attendance_days: [attendance()],
    daily_summary: [{ attendance_id: 'attendance-1', payable_km: 12.5, petrol_amount: 50 }],
    site_visit_summary: [{
      attendance_id: 'attendance-1',
      attendance_date: '2026-10-01',
      row_type: 'end_day',
      site_name: 'End Day',
      payable_km: 0,
    }],
    period_summary: { canonical_payable_km: 12.5, canonical_petrol_amount: 50 },
  };
}

function adjustment(overrides = {}) {
  return {
    attendance_id: 'attendance-1',
    run_id: 'run-1',
    delta_km: 2.5,
    delta_amount: 10,
    attendance_before: attendance({
      total_route_km: 10,
      eligible_km: 10,
      total_approved_km: 10,
      petrol_amount: 40,
    }),
    attendance_after: attendance(),
    evidence: {
      financial_projection: {
        finance_approved: true,
        finance_authorization_id: 'FIN-2026-0001',
        finance_reviewed_by: 'finance-reviewer',
        finance_authorized_at: '2026-10-15T12:00:00Z',
        baseline_amount: 40,
        baseline_materialization_amount: 0,
        final_leg_reimbursement_delta: 10,
      },
    },
    reversed: false,
    ...overrides,
  };
}

test('historical final leg is separate while canonical payable totals remain unchanged', () => {
  const input = dataset();
  const output = overlayHistoricalFinalLegRecoveries(input, [adjustment()]);

  assert.notEqual(output, input);
  assert.deepEqual(output.period_summary, input.period_summary);
  assert.deepEqual(output.daily_summary, input.daily_summary);
  assert.equal(output.site_visit_summary[0].payable_km, 2.5);
  assert.equal(output.site_visit_summary[0].historical_final_leg_amount, 10);
  assert.equal(output.site_visit_summary[0].included_in_canonical_totals, true);
  assert.equal(output.site_visit_summary[0].incremental_total_contribution, 0);
  assert.equal(output.attendance_days[0].metadata.final_return_leg_km, 2.5);
  assert.deepEqual(output.historical_recovery_summary, {
    records: 1,
    final_leg_km: 2.5,
    final_leg_amount: 10,
    included_in_canonical_totals: true,
    informational_only: true,
  });
});

test('missing record-specific Finance evidence is rejected', () => {
  const row = adjustment();
  row.evidence.financial_projection.finance_approved = false;
  assert.throws(
    () => overlayHistoricalFinalLegRecoveries(dataset(), [row]),
    /Finance authorization is required/,
  );
});

test('a persisted reimbursement mismatch is rejected instead of reduced or hidden', () => {
  const input = dataset();
  input.attendance_days[0].petrol_amount = 49;
  assert.throws(
    () => overlayHistoricalFinalLegRecoveries(input, [adjustment()]),
    /does not match persisted canonical report totals/,
  );
});

test('derived zero-petrol baseline stays unmaterialized while effective reimbursement rises once', () => {
  const before = attendance({
    route_sync_status: 'pending_canonical_end_day_recalculation',
    total_route_km: 10,
    eligible_km: 10,
    total_approved_km: 10,
    petrol_amount: 0,
  });
  const after = attendance({
    route_sync_status: 'pending_canonical_end_day_recalculation',
    petrol_amount: 0,
  });
  const input = dataset();
  input.attendance_days = [after];
  input.daily_summary = [{ attendance_id: 'attendance-1', payable_km: 12.5, petrol_amount: 50 }];
  const row = adjustment({ attendance_before: before, attendance_after: after });

  const output = overlayHistoricalFinalLegRecoveries(input, [row]);
  assert.equal(output.attendance_days[0].petrol_amount, 0);
  assert.equal(output.daily_summary[0].petrol_amount, 50);
  assert.equal(output.site_visit_summary[0].derived_baseline_kept_separate, true);
  assert.equal(output.period_summary.canonical_petrol_amount, 50);
});

test('ledger evidence that materializes an old derived baseline is rejected', () => {
  const row = adjustment();
  row.evidence.financial_projection.baseline_materialization_amount = 40;
  assert.throws(
    () => overlayHistoricalFinalLegRecoveries(dataset(), [row]),
    /attempts baseline materialization/,
  );
});

test('ledger reads are limited to the attendance IDs already authorized by the report', async () => {
  const ids = Array.from({ length: 205 }, (_, index) => `attendance-${index + 1}`);
  const calls = [];
  const client = {
    async rpc(name, args) {
      calls.push({ name, args });
      return { data: [], error: null };
    },
  };
  assert.deepEqual(await loadHistoricalFinalLegRecoveries(client, ids), []);
  assert.deepEqual(calls.map((call) => call.args.p_authorized_attendance_ids.length), [100, 100, 5]);
  assert.ok(calls.every((call) => call.name === 'rpc_read_fo_hist_20261015'));
  assert.deepEqual(calls.flatMap((call) => call.args.p_authorized_attendance_ids), ids);
});

test('ledger read errors fail closed', async () => {
  const client = {
    async rpc() {
      return { data: null, error: new Error('ledger unavailable') };
    },
  };
  await assert.rejects(
    loadHistoricalFinalLegRecoveries(client, ['attendance-1']),
    /ledger unavailable/,
  );
});

function v3Adjustment(overrides = {}) {
  const row = adjustment(overrides);
  row.evidence = { financial_projection: {
    version: 'FINANCE_BASELINE_V3_DERIVED_PRESERVED',
    storage_action: row.attendance_before.petrol_amount === 0 ? 'PRESERVE_DERIVED_ZERO' : 'ADD_FINAL_DELTA_TO_STORED',
    raw_petrol_before: row.attendance_before.petrol_amount,
    raw_petrol_after: row.attendance_after.petrol_amount,
    existing_effective_reimbursement: 40,
    effective_reimbursement_after: 50,
    final_leg_reimbursement_delta: 10,
    baseline_materialization_amount: 0,
  } };
  row.recovery_authorization = {
    id: 'fixture-authorization', reviewer: 'fixture-auth-user', action: 'APPLY',
    approved_at: '2026-10-15T12:00:00Z', record_bound: true,
    financial_projection_version: 'FINANCE_BASELINE_V3_DERIVED_PRESERVED',
    payload_sha256: '9757f1b6a35c19ec1d9c700f5d4cf06e1a1bd37e48049c414338474b376fbc2b',
    manifest_sha256: '0fb181fca59aab6609980d2bb54c92fa6fab233f7dfb4365d364d2ad545058e0',
  };
  return row;
}

test('V3 authenticated batch evidence displays a separate final leg without changing totals', () => {
  const input = dataset();
  const report = overlayHistoricalFinalLegRecoveries(input, [v3Adjustment()]);
  assert.deepEqual(report.daily_summary, input.daily_summary);
  assert.deepEqual(report.period_summary, input.period_summary);
  assert.equal(report.site_visit_summary[0].payable_km, 2.5);
  assert.equal(report.site_visit_summary[0].incremental_total_contribution, 0);
});

test('V3 derived-zero storage preserves its existing effective baseline', () => {
  const before = attendance({ route_sync_status: 'pending_canonical_end_day_recalculation',
    total_route_km: 10, eligible_km: 10, total_approved_km: 10, petrol_amount: 0 });
  const after = attendance({ route_sync_status: 'pending_canonical_end_day_recalculation', petrol_amount: 0 });
  const input = dataset(); input.attendance_days = [after];
  const report = overlayHistoricalFinalLegRecoveries(input, [v3Adjustment({ attendance_before: before, attendance_after: after })]);
  assert.equal(report.attendance_days[0].petrol_amount, 0);
  assert.equal(report.daily_summary[0].petrol_amount, 50);
  assert.equal(report.site_visit_summary[0].derived_baseline_kept_separate, true);
});

test('V3 rejects altered or unbound authorization and baseline materialization', () => {
  for (const mutate of [
    (row) => { delete row.recovery_authorization; },
    (row) => { row.recovery_authorization.record_bound = false; },
    (row) => { row.recovery_authorization.payload_sha256 = 'wrong'; },
    (row) => { row.recovery_authorization.manifest_sha256 = 'wrong'; },
    (row) => { row.evidence.financial_projection.baseline_materialization_amount = 1; },
    (row) => { row.evidence.financial_projection.raw_petrol_after = null; },
  ]) {
    const row = v3Adjustment(); mutate(row);
    assert.throws(() => overlayHistoricalFinalLegRecoveries(dataset(), [row]));
  }
});
