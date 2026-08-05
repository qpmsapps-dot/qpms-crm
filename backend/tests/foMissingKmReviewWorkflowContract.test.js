import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const service = readFileSync('backend/foKmRecalculationService.js', 'utf8');
const server = readFileSync('backend/server.js', 'utf8');
const frontend = readFileSync('src/pages/FOActivities.jsx', 'utf8');

test('missing km review helper uses checkout open-window evidence, not final leg', () => {
  const helper = service.slice(
    service.indexOf('export async function refreshMissingKmReviewsForAttendance'),
    service.indexOf('export async function loadApprovedMissingKmSummary'),
  );
  assert.match(helper, /const windowStart = visitCheckInTime\(visit\)/);
  assert.match(helper, /const windowEnd = visitCheckOutTime\(visit\)/);
  assert.match(helper, /missingKmOriginForVisit\(visit\)/);
  assert.match(helper, /missingKmDestinationForVisit\(visit\)/);
  assert.match(helper, /overlapsCanonicalLegs\(windowStart, windowEnd, travelLegs\)/);
  assert.doesNotMatch(helper, /attendanceEndCoordinate/);
});

test('pending missing km suggestions are refreshed but not automatically approved', () => {
  const payload = service.slice(
    service.indexOf('function missingKmReviewPayloadFromCalculation'),
    service.indexOf('async function writeMissingKmReviewSummaryToVisit'),
  );
  assert.match(payload, /status: 'pending'/);
  assert.match(payload, /suggested_missing_km: roundedSuggestedKm/);
  assert.doesNotMatch(payload, /approved_missing_km:\s*roundedSuggestedKm/);
});

test('approved missing km is added separately from canonical route km', () => {
  const recalc = service.slice(
    service.indexOf('export async function recalculateFoKm('),
    service.indexOf('export async function reconcileFinalLegOnly'),
  );
  assert.match(recalc, /refreshMissingKmReviewsForAttendance/);
  assert.match(recalc, /loadApprovedMissingKmSummary/);
  assert.match(recalc, /total_route_km: calculatedPayableKm/);
  assert.match(recalc, /total_approved_km: approvedKm/);
  assert.match(recalc, /approved_missing_km_total: approvedMissingKm\.approvedKm/);
});

test('approval workflow syncs attendance totals and supports reject and clarification', () => {
  const decision = service.slice(
    service.indexOf('export async function decideMissingKmReview'),
    service.indexOf('export async function reconcileFinalLegOnlyBatch'),
  );
  assert.match(decision, /\['approve', 'reject', 'clarification'\]/);
  assert.match(decision, /syncAttendanceApprovedKmTotals/);
  assert.match(decision, /status = 'clarification_required'/);
  assert.match(decision, /Approved KM above suggestion requires elevated_override/);
});

test('checkout review endpoint resolves canonical review row and returns totals', () => {
  const route = server.slice(
    server.indexOf("'/api/fo/site-visits/:visitId/checkout-missing-km-review'"),
    server.indexOf("app.get('/api/fo/operations/summary'"),
  );
  assert.match(route, /from\('fo_missing_km_reviews'\)/);
  assert.match(route, /refreshMissingKmReviewsForAttendance/);
  assert.match(route, /decideMissingKmReview/);
  assert.match(route, /totals: result\.totals/);
  assert.doesNotMatch(route, /payable_application: 'not_connected_no_attendance_totals_changed'/);
});

test('timeline displays canonical travel-leg km and real missing km review status', () => {
  assert.match(frontend, /function canonicalTravelLegForVisit/);
  assert.match(frontend, /canonicalTravelKmForVisit\(lastAttendance, visit, index\)/);
  assert.match(frontend, /suggested_missing_checkout_evidence_quality/);
  assert.match(frontend, /suggested_missing_checkout_reason_code/);
  assert.match(frontend, /action: normalizedAction === "ask clarification" \? "clarification" : normalizedAction/);
});
