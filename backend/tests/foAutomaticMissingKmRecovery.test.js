import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { classifyAutomaticMissingKmLeg } from '../services/foAutomaticMissingKmRecoveryService.js';

const persisted = {
  id: 'leg-1',
  calculated_km: 0,
  payable_km: 0,
  payable_amount: 0,
  fare_amount: 0,
};
const completeLeg = {
  type: 'last_checkout_to_end_day',
  source: 'GPS_BASED',
  gps_coverage_classification: 'GPS_COMPLETE',
  payable: true,
  payable_km: 19.4,
  rate_per_km: 4,
};
const emptyState = { applies: new Map(), correction: null, settlement: null };

test('GPS_COMPLETE zero-financial canonical travel leg is automatically eligible', () => {
  assert.deepEqual(
    classifyAutomaticMissingKmLeg({}, completeLeg, persisted, emptyState),
    { status: 'AUTO_ELIGIBLE' },
  );
});

test('insufficient GPS, Haversine, and normal distance do not bypass evidence policy', () => {
  const undercovered = classifyAutomaticMissingKmLeg({}, {
    ...completeLeg,
    gps_coverage_classification: 'MANUAL_REVIEW',
    fallback_reason: 'gps_undercoverage_requires_manual_review',
  }, persisted, emptyState);
  assert.equal(undercovered.status, 'MANUAL_REVIEW');
  assert.equal(undercovered.reason, 'gps_undercoverage_requires_manual_review');

  const haversine = classifyAutomaticMissingKmLeg({}, {
    ...completeLeg,
    source: 'HAVERSINE_ROUTE_FALLBACK',
  }, persisted, emptyState);
  assert.equal(haversine.status, 'MANUAL_REVIEW');

  const longNormalLeg = classifyAutomaticMissingKmLeg({}, {
    ...completeLeg,
    type: 'site_checkout_to_next_checkin',
    payable_km: 25,
  }, persisted, emptyState);
  assert.equal(longNormalLeg.status, 'AUTO_ELIGIBLE');
});

test('existing payable KM and prior financial protection are never auto-modified', () => {
  assert.equal(classifyAutomaticMissingKmLeg({}, completeLeg, {
    ...persisted,
    payable_km: 3,
  }, emptyState).status, 'ALREADY_PAYABLE');
  assert.equal(classifyAutomaticMissingKmLeg({}, completeLeg, persisted, {
    ...emptyState,
    correction: { id: 'correction-1' },
  }).status, 'FINANCE_RECONCILIATION');
  assert.equal(classifyAutomaticMissingKmLeg({}, completeLeg, persisted, {
    ...emptyState,
    settlement: { id: 'settlement-1' },
  }).status, 'FINANCE_RECONCILIATION');
});

test('route and UI use fixed JWT middleware and the new endpoint only', () => {
  const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const frontend = readFileSync(new URL('../../src/pages/FOActivities.jsx', import.meta.url), 'utf8');
  assert.match(server, /automatic-missing-km\/recalculate-range', requireSupabaseJwt, requireFoKmBatchRecalculationPermission/);
  assert.doesNotMatch(server, /automatic-missing-km\/recalculate-range', requireSupabaseJwtWithUserScopedProfile/);
  assert.match(frontend, /automatic-missing-km\/recalculate-range/);
  assert.doesNotMatch(frontend, /recalculate-employee-range/);
  assert.doesNotMatch(frontend, /onFinalLegRecoveryAction/);
});

test('Migration 208 remains fail closed and service-role-only', () => {
  const sql = readFileSync(new URL('../../supabase/migrations_2_0/208_fo_gps_complete_automatic_missing_km.sql', import.meta.url), 'utf8');
  assert.match(sql, /financial_writes_enabled is true[\s\S]*auto_missing_km_requires_global_financial_gate_closed/);
  assert.match(sql, /gpsCoverageClassification',''\) <> 'GPS_COMPLETE'/);
  assert.match(sql, /source not in \('GPS_BASED','GPS_ROUTE_SUPPORTED'\)/);
  assert.match(sql, /grant execute on function public\.rpc_apply_fo_gps_complete_missing_leg_v1[\s\S]*to service_role/);
  assert.match(sql, /revoke all on function public\.rpc_apply_fo_gps_complete_missing_leg_v1[\s\S]*from public,anon,authenticated/);
});
