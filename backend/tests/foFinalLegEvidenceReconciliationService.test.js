import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildFinalLegEvidencePlan,
  persistFinalLegEvidenceReconciliation,
} from '../services/foFinalLegEvidenceReconciliationService.js';

const attendance = (overrides = {}) => ({
  id: 'a8d170e6-cbb4-4788-928d-6eb9999d51e2',
  employee_code: 'QPMSTNC17015',
  attendance_date: '2026-10-07',
  logout_time: '2026-10-07T14:14:49.941909Z',
  end_latitude: 12.8926102,
  end_longitude: 80.0828082,
  total_route_km: 76.45,
  eligible_km: 76.45,
  total_approved_km: 76.45,
  petrol_amount: 0,
  updated_at: '2026-10-07T14:14:50.366503Z',
  ...overrides,
});

const finalLeg = (overrides = {}) => ({
  id: '48991354-ca06-4856-9931-8f95e6bb932e',
  attendance_id: 'a8d170e6-cbb4-4788-928d-6eb9999d51e2',
  status: 'completed',
  started_at: '2026-10-07T13:14:51.302142Z',
  ended_at: '2026-10-07T14:14:49.941909Z',
  start_lat: 12.8017917,
  start_lng: 80.1993063,
  end_lat: 12.8926102,
  end_lng: 80.0828082,
  calculated_km: 0,
  payable_km: 0,
  payable_amount: 0,
  fare_amount: 0,
  updated_at: '2026-10-07T14:14:50.565107Z',
  ...overrides,
});

const routeValues = [10.24, 1.49, 6.99, 19.10, 16.60, 5.29, 16.74];
const visits = routeValues.map((route_km, index) => ({
  id: `visit-${index + 1}`,
  attendance_id: attendance().id,
  check_in_time: `2026-10-07T0${index + 5}:00:00Z`,
  check_out_time: index === 6 ? '2026-10-07T13:14:51.302142Z' : `2026-10-07T0${index + 5}:30:00Z`,
  check_out_latitude: index === 6 ? 12.8017917 : 12.7 + index / 100,
  check_out_longitude: index === 6 ? 80.1993063 : 80.1 + index / 100,
  route_km,
}));

const gpsCalculation = (overrides = {}) => ({
  legKm: 19.401,
  legSource: 'GPS_BASED',
  gpsCoverageClassification: 'GPS_COMPLETE',
  gpsLogCount: 177,
  gpsRawSampleCount: 177,
  gpsDuplicateSampleCount: 0,
  gpsEffectiveSampleCount: 177,
  validPoints: 131,
  gpsValidRatio: 131 / 177,
  rejectedPoints: 46,
  gpsRejectedUniqueSampleCount: 46,
  rejectionReasonCounts: { poor_accuracy: 46 },
  acceptedGpsKm: 19.401,
  reviewFlags: [],
  ...overrides,
});

function plan(overrides = {}) {
  return buildFinalLegEvidencePlan({
    attendance: attendance(overrides.attendance),
    finalLeg: finalLeg(overrides.finalLeg),
    visits: overrides.visits || visits,
    gpsRows: Array.from({ length: 177 }, (_, index) => ({ id: `gps-${index + 1}` })),
    calculation: gpsCalculation(overrides.calculation),
    expectedEmployeeCode: 'QPMSTNC17015',
    expectedAttendanceDate: '2026-10-07',
    expectedBaseKm: 76.45,
    expectedSiteVisitCount: 7,
    expectedSiteVisitRouteKm: 76.45,
    expectedPetrolAmount: 0,
  });
}

function planForOctober8(overrides = {}) {
  const attendance8 = {
    id: 'd299f0c4-9af7-4f0c-b8cc-86e5b7fb1f91',
    employee_code: 'QPMSTNC17015',
    attendance_date: '2026-10-08',
    logout_time: '2026-10-08T13:38:51Z',
    end_latitude: 12.91,
    end_longitude: 80.12,
    total_route_km: 80.62,
    eligible_km: 80.62,
    total_approved_km: 80.62,
    petrol_amount: 322.48,
    updated_at: '2026-10-08T13:39:00Z',
    ...overrides.attendance,
  };
  const finalLeg8 = {
    id: '850bc41b-e492-4661-9f5e-05aaafb19d0c',
    attendance_id: attendance8.id,
    status: 'completed',
    started_at: '2026-10-08T12:37:42Z',
    ended_at: '2026-10-08T13:38:51Z',
    start_lat: 12.84,
    start_lng: 80.18,
    end_lat: 12.91,
    end_lng: 80.12,
    calculated_km: 0,
    payable_km: 0,
    payable_amount: 0,
    fare_amount: 0,
    updated_at: '2026-10-08T13:39:00Z',
    ...overrides.finalLeg,
  };
  const visits8 = [
    {
      id: 'visit-8-1', attendance_id: attendance8.id,
      check_in_time: '2026-10-08T07:00:00Z', check_out_time: '2026-10-08T08:00:00Z',
      check_out_latitude: 12.8, check_out_longitude: 80.1, route_km: 30,
    },
    {
      id: 'visit-8-2', attendance_id: attendance8.id,
      check_in_time: '2026-10-08T11:00:00Z', check_out_time: '2026-10-08T12:37:42Z',
      check_out_latitude: 12.84, check_out_longitude: 80.18, route_km: 50.62,
    },
  ];
  return buildFinalLegEvidencePlan({
    attendance: attendance8,
    finalLeg: finalLeg8,
    visits: overrides.visits || visits8,
    gpsRows: Array.from({ length: 155 }, (_, index) => ({ id: `gps-8-${index + 1}` })),
    calculation: gpsCalculation({
      legKm: 9.68,
      gpsLogCount: 155,
      gpsRawSampleCount: 155,
      gpsDuplicateSampleCount: 44,
      gpsEffectiveSampleCount: 111,
      validPoints: 79,
      gpsValidRatio: 79 / 111,
      rejectedPoints: 76,
      gpsRejectedUniqueSampleCount: 32,
      rejectionReasonCounts: { duplicate: 44, poor_accuracy: 32 },
      acceptedGpsKm: 9.68,
      ...overrides.calculation,
    }),
    expectedEmployeeCode: 'QPMSTNC17015',
    expectedAttendanceDate: '2026-10-08',
    expectedBaseKm: 80.62,
    expectedSiteVisitCount: 2,
    expectedSiteVisitRouteKm: 80.62,
    expectedPetrolAmount: 322.48,
  });
}

test('input digest is stable across unrelated row timestamp changes', () => {
  const before = plan();
  const replay = plan({
    attendance: { updated_at: '2026-10-08T00:00:00Z' },
    finalLeg: { updated_at: '2026-10-08T00:00:00Z' },
  });
  assert.equal(replay.inputDigest, before.inputDigest);
});

test('GPS evidence plan preserves all existing payable and reimbursement values', () => {
  const result = plan();
  assert.equal(result.persistable, true);
  assert.equal(result.candidateCalculatedKm, 19.4);
  assert.equal(result.gpsCoverageClassification, 'GPS_COMPLETE');
  assert.equal(result.rawSampleCount, 177);
  assert.equal(result.effectiveSampleCount, 177);
  assert.equal(result.validPointCount, 131);
  assert.equal(Number(result.validSampleRatio.toFixed(4)), 0.7401);
  assert.deepEqual(result.rejectedPointReasons, { poor_accuracy: 46 });
  assert.equal(result.decision, 'MANUAL_REVIEW');
  assert.equal(result.proposedPayableKm, 0);
  assert.equal(result.proposedReimbursementChange, 0);
  assert.equal(result.expectedTotalRouteKm, 76.45);
  assert.equal(result.expectedEligibleKm, 76.45);
  assert.equal(result.expectedTotalApprovedKm, 76.45);
  assert.equal(result.expectedSiteVisitCount, 7);
  assert.equal(result.expectedSiteVisitRouteKm, 76.45);
  assert.equal(result.canonicalRecalculationComplete, false);
  assert.equal(result.referenceOnly, false);
});

test('8 October duplicate-aware GPS evidence is independently recordable and nonpayable', () => {
  const result = planForOctober8();
  assert.equal(result.attendanceId, 'd299f0c4-9af7-4f0c-b8cc-86e5b7fb1f91');
  assert.equal(result.finalLegId, '850bc41b-e492-4661-9f5e-05aaafb19d0c');
  assert.equal(result.candidateCalculatedKm, 9.68);
  assert.equal(result.gpsCoverageClassification, 'GPS_COMPLETE');
  assert.equal(result.rawSampleCount, 155);
  assert.equal(result.duplicateSampleCount, 44);
  assert.equal(result.effectiveSampleCount, 111);
  assert.equal(result.validPointCount, 79);
  assert.equal(Number((result.validSampleRatio * 100).toFixed(2)), 71.17);
  assert.equal(result.rejectedUniqueSampleCount, 32);
  assert.deepEqual(result.rejectedPointReasons, { duplicate: 44, poor_accuracy: 32 });
  assert.equal(result.decision, 'MANUAL_REVIEW');
  assert.equal(result.proposedPayableKm, 0);
  assert.equal(result.proposedReimbursementChange, 0);
  assert.equal(result.expectedTotalRouteKm, 80.62);
  assert.equal(result.expectedSiteVisitRouteKm, 80.62);
  assert.equal(result.canonicalRecalculationComplete, false);
});

test('stale or changed existing totals fail closed before persistence', () => {
  assert.throws(
    () => plan({ attendance: { total_route_km: 76.46 } }),
    (error) => error.code === 'final_leg_existing_totals_mismatch' && error.statusCode === 409,
  );
});

test('zero candidate is non-persistable manual review evidence', () => {
  const result = plan({ calculation: { legKm: 0, legSource: 'SKIPPED', fallbackReason: 'no_valid_gps' } });
  assert.equal(result.persistable, false);
  assert.equal(result.proposedPayableKm, 0);
  assert.equal(result.decision, 'MANUAL_REVIEW');
});

test('Haversine-only distance is persistable only as reference evidence and remains nonpayable', async () => {
  const result = plan({ calculation: { legKm: 16.16, legSource: 'HAVERSINE_ROUTE_FALLBACK' } });
  assert.equal(result.persistable, true);
  assert.equal(result.source, 'HAVERSINE_REFERENCE');
  assert.equal(result.referenceOnly, true);
  assert.equal(result.proposedPayableKm, 0);
  assert.ok(result.riskFlags.includes('HAVERSINE_ONLY_NOT_PAYABLE'));
  const persisted = await persistFinalLegEvidenceReconciliation({
    rpc: async () => ({ data: { ok: true, reference_only: true }, error: null }),
  }, result);
  assert.equal(persisted.reference_only, true);
});

test('a different attendance, employee, date or final leg is rejected locally', () => {
  assert.throws(
    () => plan({ attendance: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } }),
    (error) => error.code === 'final_leg_attendance_mismatch' || error.code === 'final_leg_target_not_authorized',
  );
  assert.throws(
    () => plan({ attendance: { employee_code: 'QPMSTNC17016' } }),
    (error) => error.code === 'final_leg_target_not_authorized' && error.statusCode === 403,
  );
  assert.throws(
    () => planForOctober8({ finalLeg: { id: '850bc41b-e492-4661-9f5e-05aaafb19d0d' } }),
    (error) => error.code === 'final_leg_target_not_authorized' && error.statusCode === 403,
  );
});

test('missing companion schema is reported distinctly', async () => {
  const client = { rpc: async () => ({ data: null, error: { code: 'PGRST202', message: 'schema cache miss' } }) };
  await assert.rejects(
    persistFinalLegEvidenceReconciliation(client, plan()),
    (error) => error.code === 'final_leg_evidence_schema_missing' && error.statusCode === 503,
  );
});

test('duplicate apply delegates idempotency to one guarded RPC call', async () => {
  let calls = 0;
  const client = {
    rpc: async () => {
      calls += 1;
      return { data: { ok: true, idempotent_replay: calls > 1 }, error: null };
    },
  };
  const evidencePlan = plan();
  const first = await persistFinalLegEvidenceReconciliation(client, evidencePlan);
  const second = await persistFinalLegEvidenceReconciliation(client, evidencePlan);
  assert.equal(first.idempotent_replay, false);
  assert.equal(second.idempotent_replay, true);
  assert.equal(calls, 2);
});
