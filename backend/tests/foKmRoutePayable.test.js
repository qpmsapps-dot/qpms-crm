import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateCanonicalRoutePayableKm,
  calculateFoKmHistoricalImpact,
} from '../foKmRecalculationService.js';

const attendance = (overrides = {}) => ({
  id: 'fdd10c5b-7d63-4ee6-8784-323cb9c36384',
  employee_code: 'QPMSKL1674',
  attendance_date: '2026-07-14',
  logout_time: '2026-07-14T13:02:20.957Z',
  status: 'Completed',
  travel_mode: 'bike',
  payable_km_allowed: true,
  eligible_km: 78.28,
  rate_per_km: 4,
  ...overrides,
});

const visit = (id, routeKm, metadata = {}) => ({
  id,
  employee_code: 'QPMSKL1674',
  check_in_time: '2026-07-14T06:33:23.875Z',
  check_out_time: '2026-07-14T07:34:15.032Z',
  status: 'Checked Out',
  route_km: routeKm,
  metadata,
});

const visits = () => [visit('visit-1', 76), visit('visit-2', 1.3)];

const googleFinal = (km = 76.46) => ({
  km,
  calculated: true,
  includedInPayable: true,
  provider: km === 0 ? 'none' : 'google_directions',
  status: 'calculated',
  reason: km === 0 ? 'same_or_near_same_location' : null,
});

const gpsLeg = (type, km, overrides = {}) => ({
  type,
  km,
  status: 'calculated',
  source: 'GPS_BASED',
  gps_log_count: 24,
  valid_points: 20,
  rejected_points: 4,
  ...overrides,
});

const qpmsGpsLegs = () => [
  gpsLeg('start_to_first_checkin', 76.23),
  gpsLeg('site_checkout_to_next_checkin', 1.32),
  gpsLeg('last_checkout_to_end_day', 0.73),
];

test('QPMSKL1674 uses the long valid Google final route instead of tiny GPS final evidence', () => {
  const result = calculateCanonicalRoutePayableKm({
    attendance: attendance(),
    visits: visits(),
    finalReturnLeg: googleFinal(),
    gpsTravelLegs: qpmsGpsLegs(),
  });

  assert.equal(result.siteVisitRouteKm, 77.3);
  assert.equal(result.finalReturnPayableKm, 76.46);
  assert.equal(result.payableBeforeAdjustmentKm, 153.76);
  assert.equal(result.calculatedPayableKm, 153.76);
  assert.equal(result.petrolAmount, 615.04);
  assert.equal(result.finalReturnGpsAuditKm, 0.73);
  assert.equal(result.finalReturnSourceComparison.suspicious, true);
  assert.ok(result.reviewFlags.includes('FINAL_RETURN_GPS_ROUTE_MISMATCH_REVIEW'));
});

test('valid completed site routes and final route form the canonical payable total', () => {
  const result = calculateCanonicalRoutePayableKm({
    attendance: attendance(),
    visits: [visit('one', 10), visit('two', 5.25), visit('open', 99, { ignored: true })],
    finalReturnLeg: googleFinal(7.5),
    gpsTravelLegs: [gpsLeg('last_checkout_to_end_day', 7.4)],
  });
  // Mark the third visit open so it is not a valid completed route leg.
  const corrected = calculateCanonicalRoutePayableKm({
    attendance: attendance(),
    visits: [
      visit('one', 10),
      visit('two', 5.25),
      { ...visit('open', 99), check_out_time: null, checkout_time: null, status: 'Checked In' },
    ],
    finalReturnLeg: googleFinal(7.5),
    gpsTravelLegs: result.auditTravelLegs,
  });
  assert.equal(corrected.siteVisitRouteKm, 15.25);
  assert.equal(corrected.calculatedPayableKm, 22.75);
});

test('no final return movement adds zero and remains a valid route calculation', () => {
  const result = calculateCanonicalRoutePayableKm({
    attendance: attendance(),
    visits: visits(),
    finalReturnLeg: googleFinal(0),
    gpsTravelLegs: [gpsLeg('last_checkout_to_end_day', 0, { gps_log_count: 20, valid_points: 18 })],
  });
  assert.equal(result.finalReturnPayableKm, 0);
  assert.equal(result.finalReturnIncluded, true);
  assert.equal(result.calculatedPayableKm, 77.3);
});

test('route failure uses a final GPS fallback only when existing quality checks pass', () => {
  const result = calculateCanonicalRoutePayableKm({
    attendance: attendance(),
    visits: visits(),
    finalReturnLeg: { calculated: false, includedInPayable: false, reason: 'google_route_unavailable' },
    gpsTravelLegs: [gpsLeg('last_checkout_to_end_day', 12.4)],
  });
  assert.equal(result.finalReturnPayableSource, 'gps_quality_checked_fallback');
  assert.equal(result.finalReturnPayableKm, 12.4);
  assert.equal(result.calculatedPayableKm, 89.7);
  assert.equal(result.auditTravelLegs[0].payable, true);
});

test('route failure with poor GPS evidence does not silently add the final leg', () => {
  const result = calculateCanonicalRoutePayableKm({
    attendance: attendance(),
    visits: visits(),
    finalReturnLeg: { calculated: false, includedInPayable: false, reason: 'google_route_unavailable' },
    gpsTravelLegs: [gpsLeg('last_checkout_to_end_day', 12.4, { gps_log_count: 4, valid_points: 3 })],
  });
  assert.equal(result.finalReturnPayableSource, 'none');
  assert.equal(result.finalReturnPayableKm, 0);
  assert.equal(result.calculatedPayableKm, 77.3);
  assert.ok(result.reviewFlags.includes('FINAL_RETURN_ROUTE_AND_GPS_UNAVAILABLE_REVIEW'));
});

test('no-site sourcing attendance stays outside the route-based formula', () => {
  const noSiteAttendance = attendance({ eligible_km: 42.5 });
  const impact = calculateFoKmHistoricalImpact({
    attendance: noSiteAttendance,
    visits: [],
    finalReturnLeg: { calculated: false },
    gpsTravelLegs: [gpsLeg('full_day', 42.5)],
  });
  assert.equal(impact.calculation.routeBasedSelected, false);
  assert.equal(impact.corrected_route_based_payable_km, 42.5);
  assert.equal(impact.difference_km, 0);
});

test('approved missing-checkout adjustment is included exactly once', () => {
  const approvedMetadata = {
    checkout_review_status: 'approved',
    approved_missing_checkout_km: 4.5,
    approved_missing_checkout_adjustment_km: 4.5,
  };
  const duplicateVisit = visit('visit-2', 1.3, approvedMetadata);
  const result = calculateCanonicalRoutePayableKm({
    attendance: attendance(),
    visits: [visit('visit-1', 76), duplicateVisit],
    finalReturnLeg: googleFinal(),
    gpsTravelLegs: qpmsGpsLegs(),
  });
  assert.equal(result.approvedAdjustmentKm, 4.5);
  assert.equal(result.payableBeforeAdjustmentKm, 153.76);
  assert.equal(result.calculatedPayableKm, 158.26);
  assert.equal(result.petrolAmount, 633.04);
});

test('non-bike attendance remains governed by the existing non-payable policy', () => {
  const nonBike = attendance({ travel_mode: 'bus', payable_km_allowed: false, eligible_km: 0 });
  const impact = calculateFoKmHistoricalImpact({
    attendance: nonBike,
    visits: visits(),
    finalReturnLeg: googleFinal(),
    gpsTravelLegs: qpmsGpsLegs(),
  });
  assert.equal(impact.calculation.routeBasedSelected, false);
  assert.equal(impact.calculation.payableKmAllowed, false);
  assert.equal(impact.corrected_route_based_payable_km, 0);

  const ownVehicle = calculateFoKmHistoricalImpact({
    attendance: attendance({ travel_mode: 'own_vehicle', eligible_km: 81.5 }),
    visits: visits(),
    finalReturnLeg: googleFinal(),
    gpsTravelLegs: qpmsGpsLegs(),
  });
  assert.equal(ownVehicle.calculation.routeBasedSelected, false);
  assert.equal(ownVehicle.corrected_route_based_payable_km, 81.5);
});

test('route total reconciles to payable before separately identified adjustments', () => {
  const result = calculateCanonicalRoutePayableKm({
    attendance: attendance(),
    visits: visits(),
    finalReturnLeg: googleFinal(),
    gpsTravelLegs: qpmsGpsLegs(),
  });
  assert.equal(result.payableBeforeAdjustmentKm, result.siteVisitRouteKm + result.finalReturnPayableKm);
  assert.equal(result.calculatedPayableKm, result.payableBeforeAdjustmentKm + result.approvedAdjustmentKm);
});

test('metadata contract truthfully identifies the actual payable and GPS audit sources', () => {
  const result = calculateCanonicalRoutePayableKm({
    attendance: attendance(),
    visits: visits(),
    finalReturnLeg: googleFinal(),
    gpsTravelLegs: qpmsGpsLegs(),
  });
  assert.equal(result.payableKmSource, 'route_based_completed_site_day');
  assert.match(result.payableKmFormula, /site_visit_route_km/);
  assert.equal(result.finalReturnIncluded, true);
  assert.equal(result.finalReturnPayableSource, 'google_directions');
  assert.equal(result.gpsTravelLegTotal, 78.28);
  assert.ok(result.auditTravelLegs.every((leg) => leg.payable === false));
});

test('re-running the canonical calculation is deterministic and does not duplicate adjustments', () => {
  const input = {
    attendance: attendance(),
    visits: [
      visit('visit-1', 76),
      visit('visit-2', 1.3, { checkout_review_status: 'approved', approved_missing_checkout_km: 2 }),
    ],
    finalReturnLeg: googleFinal(),
    gpsTravelLegs: qpmsGpsLegs(),
  };
  const first = calculateCanonicalRoutePayableKm(input);
  const second = calculateCanonicalRoutePayableKm(input);
  assert.deepEqual(second, first);
  assert.equal(second.approvedAdjustmentKm, 2);
  assert.equal(second.calculatedPayableKm, 155.76);
});

test('pre-site sourcing evidence remains intact but is audit-only for a valid route-based day', () => {
  const preSite = gpsLeg('start_to_first_checkin', 90, {
    source: 'PRE_SITE_GPS_SOURCING',
    payable_km_source_reason: 'pre_site_sourcing_raw_gps_used_because_filtered_gps_was_much_lower',
  });
  const result = calculateCanonicalRoutePayableKm({
    attendance: attendance(),
    visits: visits(),
    finalReturnLeg: googleFinal(),
    gpsTravelLegs: [preSite, gpsLeg('last_checkout_to_end_day', 0.73)],
  });
  assert.equal(result.auditTravelLegs[0].source, 'PRE_SITE_GPS_SOURCING');
  assert.equal(result.auditTravelLegs[0].payable_km_source_reason, preSite.payable_km_source_reason);
  assert.equal(result.auditTravelLegs[0].payable_status, 'audit_only_route_based_formula_selected');
  assert.equal(result.calculatedPayableKm, 153.76);
});

test('historical impact helper is read-only and reports the corrected difference', () => {
  const originalAttendance = attendance();
  const snapshot = structuredClone(originalAttendance);
  const impact = calculateFoKmHistoricalImpact({
    attendance: originalAttendance,
    visits: visits(),
    finalReturnLeg: googleFinal(),
    gpsTravelLegs: qpmsGpsLegs(),
  });
  assert.equal(impact.dry_run, true);
  assert.equal(impact.current_stored_payable_km, 78.28);
  assert.equal(impact.corrected_route_based_payable_km, 153.76);
  assert.equal(impact.difference_km, 75.48);
  assert.equal(impact.corrected_petrol_amount, 615.04);
  assert.equal(impact.affected_reason, 'stored_payable_differs_from_canonical_route_based_formula');
  assert.deepEqual(originalAttendance, snapshot);
});
