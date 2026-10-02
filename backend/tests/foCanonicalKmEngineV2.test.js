import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GPS_REJECTION_REASON,
  KM_DECISION,
  KM_ENGINE_VERSION,
  applyWholeLegSanityGate,
  calculateGpsCoverageTrace,
  calculateCanonicalKmV2,
  canonicalKmInputDigest,
  evaluateLegCoverage,
  finalizeGpsSegments,
  normalizeGpsEvidence,
  planGpsSegments,
} from '../services/foCanonicalKmEngineV2.js';
import { calculateActualTravelKm } from '../foKmRecalculationService.js';

const at = (seconds) => new Date(Date.UTC(2026, 8, 30, 3, 30, seconds));
const point = (latitude, longitude, seconds, extra = {}) => ({
  id: extra.id || `p-${seconds}-${latitude}`,
  latitude,
  longitude,
  accuracy: 5,
  captured_at: at(seconds).toISOString(),
  logged_at: at(seconds + 1).toISOString(),
  attendance_id: 'attendance-1',
  employee_code: 'EMP1',
  ...extra,
});

test('normalizes GPS evidence with explicit rejection reasons', () => {
  const rows = [
    point(12.97, 77.59, 0),
    point(0, 0, 1, { id: 'zero' }),
    point(12.98, 77.60, 2, { id: 'poor', accuracy: 200 }),
    point(12.98, 77.60, 3, { id: 'mock', is_mocked: true }),
    point(12.97, 77.59, 4, { id: 'duplicate' }),
    point(12.99, 77.61, 5, { id: 'wrong', employee_code: 'OTHER' }),
  ];
  const result = normalizeGpsEvidence({
    rows,
    attendance: {
      id: 'attendance-1',
      employee_code: 'EMP1',
      login_time: at(0).toISOString(),
      logout_time: at(60).toISOString(),
    },
    now: at(100),
  });
  assert.equal(result.points.length, 1);
  assert.equal(result.rejectionCounts[GPS_REJECTION_REASON.ZERO_COORDINATE], 1);
  assert.equal(result.rejectionCounts[GPS_REJECTION_REASON.POOR_ACCURACY], 1);
  assert.equal(result.rejectionCounts[GPS_REJECTION_REASON.MOCKED], 1);
  assert.equal(result.rejectionCounts[GPS_REJECTION_REASON.DUPLICATE], 1);
  assert.equal(result.rejectionCounts[GPS_REJECTION_REASON.IDENTITY_MISMATCH], 1);
});

test('stale and future provider timestamps are rejected', () => {
  const stale = point(12.97, 77.59, 0, { logged_at: at(700).toISOString() });
  const future = point(12.98, 77.60, 500, { logged_at: at(500).toISOString() });
  const result = normalizeGpsEvidence({ rows: [stale, future], now: at(100) });
  assert.equal(result.points.length, 0);
  assert.equal(result.rejectionCounts.stale_provider_timestamp, 1);
  assert.equal(result.rejectionCounts.future_timestamp, 1);
});

test('QPMSAP2315 A-B-A stale cluster quarantines distant fixes', () => {
  const rows = [
    point(12.9716, 77.5946, 0, { id: 'a1' }),
    point(15.3173, 75.7139, 30, { id: 'b1' }),
    point(12.9717, 77.5947, 60, { id: 'a2' }),
    point(15.3174, 75.7140, 90, { id: 'b2' }),
    point(12.9718, 77.5948, 120, { id: 'a3' }),
  ];
  const normalized = normalizeGpsEvidence({ rows, now: at(180) });
  assert.deepEqual(normalized.points.map((item) => item.id), ['a1', 'a2', 'a3']);
  assert.equal(normalized.rejectionCounts.oscillation_outlier, 2);
  assert.equal(normalized.rejectionCounts.stale_cluster, 2);
  const planned = planGpsSegments(normalized.points);
  assert.equal(planned.segments.some((segment) => segment.googleEligible), false);
});

test('impossible speed is rejected before Google is eligible', async () => {
  const points = [
    { latitude: 12.9716, longitude: 77.5946, capturedAt: at(0) },
    { latitude: 15.3173, longitude: 75.7139, capturedAt: at(30) },
  ];
  const plan = planGpsSegments(points);
  assert.equal(plan.segments[0].reason, GPS_REJECTION_REASON.IMPOSSIBLE_SPEED);
  assert.equal(plan.segments[0].googleEligible, false);

  const previousEnabled = process.env.ENABLE_GOOGLE_DIRECTIONS;
  const previousFetch = global.fetch;
  let fetchCalls = 0;
  process.env.ENABLE_GOOGLE_DIRECTIONS = 'true';
  global.fetch = async () => {
    fetchCalls += 1;
    throw new Error('must not be called');
  };
  try {
    const calculation = await calculateActualTravelKm(points, { googleMapsApiKey: 'test-key' });
    assert.equal(fetchCalls, 0);
    assert.equal(calculation.actualTravelKm, 0);
    assert.equal(calculation.rejectionReasonCounts.impossible_speed, 1);
  } finally {
    global.fetch = previousFetch;
    if (previousEnabled === undefined) delete process.env.ENABLE_GOOGLE_DIRECTIONS;
    else process.env.ENABLE_GOOGLE_DIRECTIONS = previousEnabled;
  }
});

test('plausible long gap accepts validated Google evidence', () => {
  const points = [
    { latitude: 12.9716, longitude: 77.5946, capturedAt: at(0) },
    { latitude: 13.0716, longitude: 77.6946, capturedAt: at(3600) },
  ];
  const plan = planGpsSegments(points);
  assert.equal(plan.segments[0].googleEligible, true);
  const finalized = finalizeGpsSegments(plan, new Map([[1, {
    distanceKm: 18,
    durationSeconds: 1800,
  }]]));
  assert.equal(finalized.reconstructedGapKm, 18);
  assert.equal(finalized.segments[0].status, 'reconstructed_google');
});

test('huge Google distance and impossible route duration are nonpayable', () => {
  const points = [
    { latitude: 12.9716, longitude: 77.5946, capturedAt: at(0) },
    { latitude: 13.0716, longitude: 77.6946, capturedAt: at(3600) },
  ];
  const plan = planGpsSegments(points);
  const huge = finalizeGpsSegments(plan, new Map([[1, { distanceKm: 1000, durationSeconds: 36000 }]]));
  assert.equal(huge.reconstructedGapKm, 0);
  assert.equal(huge.segments[0].status, 'rejected');
  const duration = finalizeGpsSegments(plan, new Map([[1, { distanceKm: 20, durationSeconds: 60 }]]));
  assert.equal(duration.reconstructedGapKm, 0);
  assert.equal(duration.segments[0].reason, 'route_duration_mismatch');
});

test('whole-leg gate blocks QPMSAP2315-scale direct-route mismatch', () => {
  const result = applyWholeLegSanityGate({
    acceptedGpsKm: 31.64,
    reconstructedGapKm: 2096,
    calculatedKm: 2127.99,
    straightLineKm: 39,
    directRouteKm: 59,
    elapsedSeconds: 12 * 3600,
  });
  assert.equal(result.decision, KM_DECISION.MANUAL_REVIEW);
  assert.equal(result.payableKm, 0);
  assert.ok(result.riskFlags.includes('DIRECT_ROUTE_MISMATCH'));
});

test('topology-aware gate keeps clean loops, out-and-back travel and circular routes payable', () => {
  const cases = [
    { label: 'A-B-A', total: 60, straight: 0.2, direct: 0.3 },
    { label: 'A-B-C-A', total: 82, straight: 1.1, direct: 1.4 },
    { label: 'A-B-C-D', total: 64, straight: 41, direct: 58 },
    { label: 'out-and-back', total: 50, straight: 0.1, direct: 0.2 },
    { label: 'circular city route', total: 35, straight: 2, direct: 3 },
  ];
  for (const item of cases) {
    const result = applyWholeLegSanityGate({
      acceptedGpsKm: item.total,
      reconstructedGapKm: 0,
      calculatedKm: item.total,
      straightLineKm: item.straight,
      directRouteKm: item.direct,
      elapsedSeconds: 4 * 3600,
    });
    assert.notEqual(result.decision, KM_DECISION.MANUAL_REVIEW, item.label);
    assert.equal(result.payableKm, item.total, item.label);
  }
});

test('route mismatch remains blocking when reconstructed gaps dominate', () => {
  const result = applyWholeLegSanityGate({
    acceptedGpsKm: 5,
    reconstructedGapKm: 55,
    calculatedKm: 60,
    straightLineKm: 2,
    directRouteKm: 3,
    elapsedSeconds: 4 * 3600,
  });
  assert.equal(result.decision, KM_DECISION.MANUAL_REVIEW);
  assert.equal(result.payableKm, 0);
  assert.ok(result.riskFlags.includes('DIRECT_ROUTE_MISMATCH'));
  assert.ok(result.riskFlags.includes('GAP_DOMINANT'));
});

test('direct-route duration validates the route rather than a legitimate GPS detour', () => {
  const result = applyWholeLegSanityGate({
    acceptedGpsKm: 80,
    reconstructedGapKm: 0,
    calculatedKm: 80,
    straightLineKm: 35,
    directRouteKm: 50,
    routeDurationSeconds: 2400,
    elapsedSeconds: 3 * 3600,
  });
  assert.notEqual(result.decision, KM_DECISION.MANUAL_REVIEW);
  assert.equal(result.payableKm, 80);
});

test('short-window uncertainty cannot admit a meaningful impossible jump', () => {
  const short = applyWholeLegSanityGate({ calculatedKm: 0.24, elapsedSeconds: 5 });
  assert.equal(short.decision, KM_DECISION.ACCEPTED_WITH_WARNING);
  assert.equal(short.payableKm, 0.24);
  assert.ok(short.riskFlags.includes('SHORT_WINDOW_SPEED_UNCERTAIN'));

  const meaningful = applyWholeLegSanityGate({ calculatedKm: 5, elapsedSeconds: 5 });
  assert.equal(meaningful.decision, KM_DECISION.MANUAL_REVIEW);
  assert.equal(meaningful.payableKm, 0);
  assert.ok(meaningful.riskFlags.includes('IMPOSSIBLE_SPEED'));
});

test('undercovered GPS uses a trustworthy route only to support the cleaned trace', () => {
  const result = evaluateLegCoverage({
    acceptedGpsKm: 5.16,
    coverageTraceKm: 42.2369,
    straightLineKm: 39,
    routeEvidence: {
      trusted: true,
      exactWindow: true,
      distanceKm: 59.51,
      source: 'site_visit_exact_window_route',
    },
    elapsedSeconds: 6526,
    existingRiskFlags: ['OSCILLATION'],
  });
  assert.equal(result.classification, 'ROUTE_SUPPORTED');
  assert.equal(result.decision, KM_DECISION.ACCEPTED_WITH_WARNING);
  assert.equal(Number(result.selectedKm.toFixed(2)), 42.24);
  assert.equal(Number(result.reconstructedCoverageKm.toFixed(2)), 37.08);
  assert.ok(result.riskFlags.includes('GPS_UNDERCOVERED'));
  assert.ok(result.riskFlags.includes('ROUTE_SUPPORTED'));
  assert.notEqual(result.selectedKm, 59.51);
});

test('undercovered GPS without trusted exact-window evidence requires manual review', () => {
  for (const routeEvidence of [
    null,
    { trusted: false, exactWindow: true, distanceKm: 59 },
    { trusted: true, exactWindow: false, distanceKm: 59 },
    { trusted: true, exactWindow: true, distanceKm: 500 },
  ]) {
    const result = evaluateLegCoverage({
      acceptedGpsKm: 5,
      coverageTraceKm: 42,
      straightLineKm: 39,
      routeEvidence,
      elapsedSeconds: 3600,
    });
    assert.equal(result.decision, KM_DECISION.MANUAL_REVIEW);
    assert.equal(result.classification, 'MANUAL_REVIEW');
  }
});

test('complete GPS and legitimate long-distance GPS are not lowered to a route estimate', () => {
  const complete = evaluateLegCoverage({
    acceptedGpsKm: 40,
    coverageTraceKm: 40.2,
    straightLineKm: 35,
    routeEvidence: { trusted: true, exactWindow: true, distanceKm: 42 },
    elapsedSeconds: 3600,
  });
  assert.equal(complete.classification, 'GPS_COMPLETE');
  assert.equal(complete.selectedKm, 40);

  const long = evaluateLegCoverage({
    acceptedGpsKm: 320,
    coverageTraceKm: 322,
    straightLineKm: 260,
    routeEvidence: { trusted: true, exactWindow: true, distanceKm: 330 },
    elapsedSeconds: 8 * 3600,
  });
  assert.equal(long.classification, 'GPS_COMPLETE');
  assert.equal(long.selectedKm, 320);
});

test('coverage trace rejects impossible segments and raises the jitter floor for contaminated windows', () => {
  const points = [
    { latitude: 12, longitude: 77, capturedAt: at(0) },
    { latitude: 12.0001, longitude: 77, capturedAt: at(30) },
    { latitude: 12.0002, longitude: 77, capturedAt: at(60) },
    { latitude: 15, longitude: 75, capturedAt: at(90) },
  ];
  const normal = calculateGpsCoverageTrace(points);
  const contaminated = calculateGpsCoverageTrace(points, { contaminated: true });
  assert.equal(normal.impossibleSegments, 1);
  assert.equal(contaminated.impossibleSegments, 1);
  assert.ok(normal.distanceKm > contaminated.distanceKm);
});

test('QPMSAP2315 production-derived leg evidence totals 91.74 without paying route estimates', () => {
  const first = evaluateLegCoverage({
    acceptedGpsKm: 5.16,
    coverageTraceKm: 42.2369,
    straightLineKm: 39,
    routeEvidence: { trusted: true, exactWindow: true, distanceKm: 59.51 },
    elapsedSeconds: 6526,
    existingRiskFlags: ['OSCILLATION'],
  });
  const second = evaluateLegCoverage({
    acceptedGpsKm: 26.54,
    coverageTraceKm: 49.2138,
    straightLineKm: 38.5,
    routeEvidence: { trusted: true, exactWindow: true, distanceKm: 58.05 },
    elapsedSeconds: 8923,
  });
  const legs = [
    { payableKm: Number(first.selectedKm.toFixed(2)), payableAmount: Number((Number(first.selectedKm.toFixed(2)) * 4).toFixed(2)), acceptedGpsKm: 5.16, reconstructedGapKm: first.reconstructedCoverageKm, decision: first.decision },
    { payableKm: Number(second.selectedKm.toFixed(2)), payableAmount: Number((Number(second.selectedKm.toFixed(2)) * 4).toFixed(2)), acceptedGpsKm: 26.54, reconstructedGapKm: second.reconstructedCoverageKm, decision: second.decision },
    { payableKm: 0.05, payableAmount: 0.20, acceptedGpsKm: 0.05, decision: KM_DECISION.ACCEPTED },
    { payableKm: 0.24, payableAmount: 0.96, acceptedGpsKm: 0.24, decision: KM_DECISION.ACCEPTED_WITH_WARNING, riskFlags: ['SHORT_WINDOW_SPEED_UNCERTAIN'] },
  ];
  const result = calculateCanonicalKmV2({ legs });
  assert.deepEqual(legs.map((leg) => leg.payableKm), [42.24, 49.21, 0.05, 0.24]);
  assert.equal(result.payableKm, 91.74);
  assert.equal(result.reimbursement, 366.96);
});

test('no movement is accepted at zero while missing checkout requires review', () => {
  const stationary = applyWholeLegSanityGate({ calculatedKm: 0, elapsedSeconds: 600 });
  assert.equal(stationary.decision, KM_DECISION.ACCEPTED);
  assert.equal(stationary.payableKm, 0);
  const missing = applyWholeLegSanityGate({ calculatedKm: 4, elapsedSeconds: 900, missingCheckout: true });
  assert.equal(missing.decision, KM_DECISION.MANUAL_REVIEW);
  assert.equal(missing.payableKm, 0);
  assert.ok(missing.riskFlags.includes('MISSING_CHECKOUT'));
});

test('cross-midnight legitimate movement remains reviewable with warning', () => {
  const result = applyWholeLegSanityGate({
    calculatedKm: 40,
    straightLineKm: 35,
    directRouteKm: 42,
    elapsedSeconds: 3600,
    startedAt: '2026-09-30T23:30:00Z',
    endedAt: '2026-10-01T00:30:00Z',
  });
  assert.equal(result.decision, KM_DECISION.ACCEPTED_WITH_WARNING);
  assert.equal(result.payableKm, 40);
  assert.ok(result.riskFlags.includes('CROSS_MIDNIGHT'));
});

test('Google timeout, failure and zero-result evidence cannot become payable reconstruction', () => {
  const points = [
    { latitude: 12.9716, longitude: 77.5946, capturedAt: at(0) },
    { latitude: 13.0716, longitude: 77.6946, capturedAt: at(3600) },
  ];
  const plan = planGpsSegments(points);
  for (const errorCode of ['google_timeout', 'google_fetch_error', 'google_zero_results']) {
    const finalized = finalizeGpsSegments(plan, new Map([[1, { ok: false, errorCode }]]));
    assert.equal(finalized.reconstructedGapKm, 0);
    assert.equal(finalized.segments[0].reason, errorCode);
  }
});

test('normal Bike, Car, mixed and public-mode legs use historical leg rates', () => {
  const result = calculateCanonicalKmV2({
    legs: [
      { payableKm: 10, payableAmount: 40, acceptedGpsKm: 10, decision: KM_DECISION.ACCEPTED, travelMode: 'bike', ratePerKm: 4 },
      { payableKm: 5, payableAmount: 40, acceptedGpsKm: 5, decision: KM_DECISION.ACCEPTED, travelMode: 'car', ratePerKm: 8 },
      { payableKm: 0, payableAmount: 0, acceptedGpsKm: 12, decision: KM_DECISION.ACCEPTED, travelMode: 'train', ratePerKm: 0 },
    ],
  });
  assert.equal(result.calculationVersion, KM_ENGINE_VERSION);
  assert.equal(result.payableKm, 15);
  assert.equal(result.reimbursement, 80);
});

test('canonical digest and output are deterministic', () => {
  const input = { b: 2, a: [{ z: 1, y: 2 }] };
  assert.equal(canonicalKmInputDigest(input), canonicalKmInputDigest({ a: [{ y: 2, z: 1 }], b: 2 }));
  const first = calculateCanonicalKmV2({ legs: [] });
  const second = calculateCanonicalKmV2({ legs: [] });
  assert.deepEqual(first, second);
});
