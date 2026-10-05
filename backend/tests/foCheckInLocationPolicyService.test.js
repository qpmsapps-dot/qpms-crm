import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  evaluateFoCheckInLocation,
  foCheckInDistanceMeters,
  validateFoCheckInLocation,
} from '../services/foCheckInLocationPolicyService.js';

const latitude = 15.4508028;
const longitude = 75.0107111;

function pointNorth(meters) {
  return {
    latitude: latitude + meters / 6_371_000 * 180 / Math.PI,
    longitude,
  };
}

function payload(overrides = {}) {
  return {
    latitude,
    longitude,
    accuracy: 10,
    gps_timestamp: '2026-10-03T12:00:00.000Z',
    ...overrides,
  };
}

const now = new Date('2026-10-03T12:00:05.000Z');

test('backend recomputes 118 m and applies 25 m boundary tolerance', () => {
  const evidence = evaluateFoCheckInLocation(
    payload({ accuracy: 25 }),
    pointNorth(118),
    { now },
  );
  assert.ok(Math.abs(evidence.calculated_distance_meters - 118) < 0.1);
  assert.ok(Math.abs(evidence.minimum_plausible_distance_meters - 93) < 0.1);
  assert.equal(evidence.radius_outcome, 'normal');
});

test('backend warning bands preserve 150 m, 700 m, and 1.2 km policy', () => {
  assert.equal(
    evaluateFoCheckInLocation(payload(), pointNorth(150), { now }).radius_outcome,
    'warning_100m_to_1km',
  );
  assert.equal(
    evaluateFoCheckInLocation(payload(), pointNorth(700), { now }).radius_outcome,
    'warning_100m_to_1km',
  );
  assert.equal(
    evaluateFoCheckInLocation(payload(), pointNorth(1200), { now }).radius_outcome,
    'strong_warning_over_1km',
  );
});

test('backend rejects poor accuracy and stale positions before radius messaging', () => {
  assert.throws(
    () => evaluateFoCheckInLocation(payload({ accuracy: 120 }), pointNorth(50), { now }),
    (error) => error.code === 'gps_accuracy_too_poor',
  );
  assert.throws(
    () => evaluateFoCheckInLocation(
      payload({ gps_timestamp: '2026-10-03T11:58:00.000Z' }),
      pointNorth(50),
      { now },
    ),
    (error) => error.code === 'stale_gps_fix',
  );
});

test('backend loads current site coordinates instead of trusting client site coordinates', async () => {
  const currentSite = { id: 'site-1', status: 'Active', ...pointNorth(150), updated_at: '2026-10-03T11:59:00Z' };
  const client = {
    from(table) {
      assert.equal(table, 'store_master');
      return {
        select() { return this; },
        eq(column, value) {
          assert.equal(column, 'id');
          assert.equal(value, 'site-1');
          return this;
        },
        async maybeSingle() { return { data: currentSite, error: null }; },
      };
    },
  };
  const evidence = await validateFoCheckInLocation(
    client,
    { store_id: 'site-1', ...payload(), site_latitude: latitude, site_longitude: longitude },
    { now },
  );
  assert.equal(evidence.site_latitude, currentSite.latitude);
  assert.equal(evidence.radius_outcome, 'warning_100m_to_1km');
});

test('backend returns a typed 404 when the selected site does not exist', async () => {
  const client = {
    from(table) {
      assert.equal(table, 'store_master');
      return {
        select() { return this; },
        eq() { return this; },
        async maybeSingle() { return { data: null, error: null }; },
      };
    },
  };

  await assert.rejects(
    validateFoCheckInLocation(client, { store_id: 'missing-site', ...payload() }, { now }),
    (error) => error.statusCode === 404 && error.code === 'site_not_found',
  );
});

test('Haversine result matches the mobile policy reference within rounding tolerance', () => {
  const site = pointNorth(700);
  assert.ok(Math.abs(foCheckInDistanceMeters(latitude, longitude, site.latitude, site.longitude) - 700) < 0.1);
});

test('validation endpoint requires a verified Supabase session', () => {
  const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const route = server.indexOf("'/api/fo/site-visits/validate-checkin-location'");
  const nextRoute = server.indexOf("'/api/fo/site-visits/:visitId/force-checkout'", route);
  assert.ok(route >= 0);
  assert.ok(nextRoute > route);
  const block = server.slice(route, nextRoute);
  assert.match(block, /requireSupabaseJwt/);
  assert.match(block, /validateFoCheckInLocation/);
  assert.match(block, /response\.json\(\{ ok: true, evidence \}\)/);
  assert.match(block, /response\.status\(status\)\.json/);
});
