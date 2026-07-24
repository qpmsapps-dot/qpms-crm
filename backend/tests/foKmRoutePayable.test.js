import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateCanonicalRoutePayableKm,
  calculateFoKmHistoricalImpact,
  calculateTravelLegKm,
  recalculateAttendanceTravelLegs,
  resolveEffectiveAttendanceEnd,
} from '../foKmRecalculationService.js';

const attendance = (overrides = {}) => ({
  id: 'attendance-1',
  fo_user_id: 'profile-1',
  employee_code: 'QPMSADMIN',
  attendance_date: '2026-07-16',
  login_time: '2026-07-16T04:30:00.000Z',
  logout_time: '2026-07-16T16:28:05.000Z',
  status: 'Completed',
  travel_mode: 'bike',
  payable_km_allowed: true,
  eligible_km: 20.5,
  rate_per_km: 4,
  metadata: {},
  ...overrides,
});

const gpsLeg = (type, km, overrides = {}) => ({
  type,
  from_time: '2026-07-16T12:41:20.000Z',
  to_time: '2026-07-16T16:28:05.000Z',
  km,
  status: 'calculated',
  source: 'GPS_BASED',
  payable: true,
  gps_log_count: 513,
  valid_points: 497,
  rejected_points: 16,
  raw_gps_km: km,
  accepted_gps_km: km,
  reconstructed_gap_km: 0,
  google_direct_route_km: 12.42,
  review_flags: [],
  ...overrides,
});

function gpsRows({ count = 12, start = '2026-07-16T12:41:20.000Z', accuracy = 10, mocked = false } = {}) {
  const startMs = new Date(start).getTime();
  return Array.from({ length: count }, (_, index) => ({
    id: `gps-${index}`,
    attendance_id: 'attendance-1',
    fo_user_id: 'profile-1',
    latitude: 13.028 + index * 0.0002,
    longitude: 80.248 - index * 0.0002,
    accuracy,
    is_mocked: mocked,
    source: 'mobile',
    captured_at: new Date(startMs + index * 10000).toISOString(),
    metadata: {},
  }));
}

class Query {
  constructor(rows) {
    this.rows = [...rows];
  }
  select() { return this; }
  eq(column, value) { this.rows = this.rows.filter((row) => row[column] === value); return this; }
  gt(column, value) { this.rows = this.rows.filter((row) => new Date(row[column]) > new Date(value)); return this; }
  gte(column, value) { this.rows = this.rows.filter((row) => new Date(row[column]) >= new Date(value)); return this; }
  lte(column, value) { this.rows = this.rows.filter((row) => new Date(row[column]) <= new Date(value)); return this; }
  order(column, { ascending = true } = {}) { this.rows.sort((a, b) => (a[column] > b[column] ? 1 : -1) * (ascending ? 1 : -1)); return this; }
  limit(value) { this.rows = this.rows.slice(0, value); return Promise.resolve({ data: this.rows, error: null }); }
  single() { return Promise.resolve({ data: this.rows[0] || null, error: null }); }
  maybeSingle() { return Promise.resolve({ data: this.rows[0] || null, error: null }); }
}

function clientWith(rows, { attendanceRow = attendance(), visits = [], travelLegs = [] } = {}) {
  return {
    from(table) {
      if (table === 'fo_location_logs') return new Query(rows);
      if (table === 'fo_attendance') return new Query([attendanceRow]);
      if (table === 'fo_site_visits') return new Query(visits);
      if (table === 'fo_travel_legs') return new Query(travelLegs);
      throw new Error(`Unexpected table ${table}`);
    },
  };
}

test('QPMSADMIN final sourcing detour keeps cleaned GPS instead of shorter direct route', () => {
  const result = calculateCanonicalRoutePayableKm({
    attendance: attendance(),
    gpsTravelLegs: [gpsLeg('start_to_first_checkin', 8.1), gpsLeg('last_checkout_to_end_day', 25.14)],
  });
  assert.equal(result.finalReturnPayableKm, 25.14);
  assert.equal(result.finalReturnPayableSource, 'GPS_BASED');
  assert.equal(result.finalReturnGoogleKm, 12.42);
  assert.equal(result.calculatedPayableKm, 33.24);
  assert.equal(result.petrolAmount, 132.96);
  assert.equal(result.payableKmSource, 'gps_travel_leg_based');
});

test('all eligible GPS travel windows are summed and checked-in distance is absent', () => {
  const legs = [
    gpsLeg('start_to_first_checkin', 8.1),
    gpsLeg('site_checkout_to_next_checkin', 4.2),
    gpsLeg('last_checkout_to_end_day', 25.14),
  ];
  const result = calculateCanonicalRoutePayableKm({ attendance: attendance(), gpsTravelLegs: legs });
  assert.equal(result.gpsTravelLegTotal, 37.44);
  assert.equal(result.auditTravelLegs.length, 3);
  assert.ok(result.auditTravelLegs.every((leg) => leg.payable));
});

test('valid GPS remains payable when it is greater than Google comparison', () => {
  const result = calculateCanonicalRoutePayableKm({
    attendance: attendance(),
    gpsTravelLegs: [gpsLeg('last_checkout_to_end_day', 25.14)],
  });
  assert.equal(result.calculatedPayableKm, 25.14);
  assert.equal(result.finalReturnSourceComparison.difference_km, 12.72);
});

test('GPS leg calculation uses cleaned chronological points and anchors', async () => {
  const rows = gpsRows();
  const result = await calculateTravelLegKm({
    client: clientWith(rows),
    attendance: attendance(),
    fromTime: rows[0].captured_at,
    toTime: rows.at(-1).captured_at,
    fromLat: rows[0].latitude,
    fromLng: rows[0].longitude,
    toLat: rows.at(-1).latitude,
    toLng: rows.at(-1).longitude,
  });
  assert.equal(result.legSource, 'GPS_BASED');
  assert.equal(result.payable, true);
  assert.equal(result.gpsLogCount, 11);
  assert.ok(result.legKm > 0);
});

test('poor accuracy and mock logs fail GPS quality', async () => {
  for (const rows of [gpsRows({ accuracy: 75 }), gpsRows({ mocked: true })]) {
    const result = await calculateTravelLegKm({
      client: clientWith(rows),
      attendance: attendance(),
      fromTime: rows[0].captured_at,
      toTime: rows.at(-1).captured_at,
      fromLat: rows[0].latitude,
      fromLng: rows[0].longitude,
      toLat: rows.at(-1).latitude,
      toLng: rows.at(-1).longitude,
      options: { maxGoogleDirectionsCalls: 0 },
    });
    assert.equal(result.legSource, 'HAVERSINE_ROUTE_FALLBACK');
    assert.ok(result.reviewFlags.includes('GOOGLE_ROUTE_FAILED_USED_HAVERSINE'));
  }
});

test('insufficient GPS uses exact-window Google fallback', async (t) => {
  const previousEnabled = process.env.ENABLE_GOOGLE_DIRECTIONS;
  const previousFetch = global.fetch;
  process.env.ENABLE_GOOGLE_DIRECTIONS = 'true';
  global.fetch = async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({ status: 'OK', routes: [{ legs: [{ distance: { value: 12420 } }] }] }),
  });
  t.after(() => {
    if (previousEnabled === undefined) delete process.env.ENABLE_GOOGLE_DIRECTIONS;
    else process.env.ENABLE_GOOGLE_DIRECTIONS = previousEnabled;
    global.fetch = previousFetch;
  });
  const rows = gpsRows({ count: 4 });
  const result = await calculateTravelLegKm({
    client: clientWith(rows),
    attendance: attendance(),
    fromTime: rows[0].captured_at,
    toTime: rows.at(-1).captured_at,
    fromLat: rows[0].latitude,
    fromLng: rows[0].longitude,
    toLat: rows.at(-1).latitude,
    toLng: rows.at(-1).longitude,
    options: { googleMapsApiKey: 'test-key' },
  });
  assert.equal(result.legSource, 'GOOGLE_ROUTE_FALLBACK');
  assert.equal(result.legKm, 12.42);
});

test('approved adjustment is excluded when GPS covers the exact window', () => {
  const leg = gpsLeg('last_checkout_to_end_day', 25.14);
  const result = calculateCanonicalRoutePayableKm({
    attendance: attendance({ metadata: { approved_adjustments: [{
      type: 'final_window_detour',
      status: 'approved',
      approved_km: 5,
      from_time: leg.from_time,
      to_time: leg.to_time,
    }] } }),
    gpsTravelLegs: [leg],
  });
  assert.equal(result.approvedAdjustmentKm, 0);
  assert.equal(result.adjustmentAudits[0].exclusion_reason, 'gps_already_covers_window');
});

test('approved adjustment is added once only for an uncovered exact window', () => {
  const uncovered = gpsLeg('last_checkout_to_end_day', 0, { status: 'skipped', source: 'SKIPPED', payable: false });
  const input = {
    attendance: attendance({ metadata: { approved_adjustments: [{
      type: 'missing_checkout', status: 'approved', approved_km: 5,
      from_time: uncovered.from_time, to_time: uncovered.to_time,
    }] } }),
    gpsTravelLegs: [uncovered],
  };
  const first = calculateCanonicalRoutePayableKm(input);
  const second = calculateCanonicalRoutePayableKm(input);
  assert.equal(first.approvedAdjustmentKm, 5);
  assert.equal(first.calculatedPayableKm, 5);
  assert.deepEqual(second, first);
});

test('route fallback coverage also prevents adjustment double counting', () => {
  const leg = gpsLeg('last_checkout_to_end_day', 12.42, { source: 'GOOGLE_ROUTE_FALLBACK' });
  const result = calculateCanonicalRoutePayableKm({
    attendance: attendance({ metadata: { approved_adjustments: [{
      status: 'approved', approved_km: 5, from_time: leg.from_time, to_time: leg.to_time,
    }] } }),
    gpsTravelLegs: [leg],
  });
  assert.equal(result.approvedAdjustmentKm, 0);
  assert.equal(result.adjustmentAudits[0].exclusion_reason, 'route_fallback_already_covers_window');
});

test('non-bike attendance remains non-payable', () => {
  const result = calculateCanonicalRoutePayableKm({
    attendance: attendance({ travel_mode: 'bus', payable_km_allowed: false }),
    gpsTravelLegs: [gpsLeg('full_day_no_site', 42.5, { source: 'FULL_DAY_GPS_NO_SITE' })],
  });
  assert.equal(result.calculatedPayableKm, 0);
  assert.equal(result.payableKmAllowed, false);
});

test('car travel is payable at eight rupees per km', () => {
  const result = calculateCanonicalRoutePayableKm({
    attendance: attendance({ travel_mode: 'Car', payable_km_allowed: true, rate_per_km: 8 }),
    gpsTravelLegs: [gpsLeg('start_to_first_checkin', 10, { travel_mode: 'CAR' })],
  });

  assert.equal(result.calculatedPayableKm, 10);
  assert.equal(result.petrolAmount, 80);
  assert.equal(result.auditTravelLegs[0].travel_mode, 'car');
  assert.equal(result.auditTravelLegs[0].rate_per_km, 8);
  assert.equal(result.auditTravelLegs[0].payable_amount, 80);
});

test('mixed bike and car legs keep their own rates and amounts', () => {
  const result = calculateCanonicalRoutePayableKm({
    attendance: attendance({ travel_mode: 'car', payable_km_allowed: true, rate_per_km: 8 }),
    gpsTravelLegs: [
      gpsLeg('start_to_first_checkin', 10, { travel_mode: 'bike', rate_per_km: 4 }),
      gpsLeg('site_checkout_to_next_checkin', 15, { travel_mode: 'car', rate_per_km: 8 }),
    ],
  });

  assert.equal(result.calculatedPayableKm, 25);
  assert.equal(result.petrolAmount, 160);
  assert.deepEqual(
    result.auditTravelLegs.map((leg) => ({
      mode: leg.travel_mode,
      km: leg.payable_km,
      rate: leg.rate_per_km,
      amount: leg.payable_amount,
    })),
    [
      { mode: 'bike', km: 10, rate: 4, amount: 40 },
      { mode: 'car', km: 15, rate: 8, amount: 120 },
    ],
  );
});

test('null and unknown travel modes retain the legacy bike fallback', () => {
  const nullMode = calculateCanonicalRoutePayableKm({
    attendance: attendance({ travel_mode: null, payable_km_allowed: null, rate_per_km: null }),
    gpsTravelLegs: [gpsLeg('start_to_first_checkin', 10)],
  });
  const unknownMode = calculateCanonicalRoutePayableKm({
    attendance: attendance({ travel_mode: 'spaceship', payable_km_allowed: null, rate_per_km: null }),
    gpsTravelLegs: [gpsLeg('start_to_first_checkin', 10)],
  });

  assert.equal(nullMode.calculatedPayableKm, 10);
  assert.equal(nullMode.petrolAmount, 40);
  assert.equal(unknownMode.calculatedPayableKm, 10);
  assert.equal(unknownMode.petrolAmount, 40);
});

test('no-site full-day GPS leg is a payable canonical window', () => {
  const result = calculateCanonicalRoutePayableKm({
    attendance: attendance(),
    visits: [],
    gpsTravelLegs: [gpsLeg('full_day_no_site', 42.5, { source: 'FULL_DAY_GPS_NO_SITE' })],
  });
  assert.equal(result.calculatedPayableKm, 42.5);
  assert.equal(result.auditTravelLegs[0].payable, true);
});

test('historical impact helper stays read-only', () => {
  const original = attendance();
  const snapshot = structuredClone(original);
  const impact = calculateFoKmHistoricalImpact({
    attendance: original,
    gpsTravelLegs: [gpsLeg('last_checkout_to_end_day', 25.14)],
  });
  assert.equal(impact.dry_run, true);
  assert.equal(impact.current_stored_payable_km, 20.5);
  assert.equal(impact.corrected_route_based_payable_km, 25.14);
  assert.equal(impact.difference_km, 4.64);
  assert.deepEqual(original, snapshot);
});

test('auto-ended attendance resolves to the last valid same-day mobile GPS point', async () => {
  const rows = gpsRows({ start: '2026-07-16T12:41:20.000Z' });
  const autoEnded = attendance({
    status: 'Stale Auto Ended',
    metadata: { auto_ended: true },
    logout_time: '2026-07-16T18:29:00.000Z',
  });
  const resolved = await resolveEffectiveAttendanceEnd(clientWith(rows, { attendanceRow: autoEnded }), autoEnded);
  assert.equal(resolved.source, 'last_mobile_gps_before_auto_end');
  assert.equal(resolved.time.toISOString(), rows.at(-1).captured_at);
  assert.deepEqual(resolved.coordinate, {
    latitude: rows.at(-1).latitude,
    longitude: rows.at(-1).longitude,
  });
});

test('auto-ended open visit without confirmed departure produces a zero reviewed final leg', async () => {
  const stationary = gpsRows().map((row, index) => ({
    ...row,
    latitude: 13.028 + index * 0.000001,
    longitude: 80.248 + index * 0.000001,
  }));
  const autoEnded = attendance({ status: 'Stale Auto Ended', metadata: { auto_ended: true } });
  const openVisit = {
    id: 'visit-open', attendance_id: autoEnded.id, check_in_time: stationary[0].captured_at,
    check_out_time: null, check_in_latitude: 13.028, check_in_longitude: 80.248,
    status: 'Checked In', metadata: {},
  };
  const result = await recalculateAttendanceTravelLegs(
    clientWith(stationary, { attendanceRow: autoEnded, visits: [openVisit] }),
    autoEnded.id,
    { persist: false, auditDelayedCheckout: false, maxGoogleDirectionsCalls: 0 },
  );
  const final = result.travel_legs.find((leg) => leg.type === 'last_checkout_to_end_day');
  assert.equal(final.status, 'skipped');
  assert.equal(final.reason, 'no_confirmed_departure_from_open_site');
  assert.ok(final.review_flags.includes('AUTO_END_OPEN_SITE_NO_CONFIRMED_DEPARTURE_REVIEW'));
});

test('auto-ended open visit counts only after two-point confirmed departure', async () => {
  const rows = gpsRows().map((row, index) => ({
    ...row,
    latitude: index < 2 ? 13.028 : 13.03 + index * 0.0002,
    longitude: index < 2 ? 80.248 : 80.25 + index * 0.0002,
  }));
  const autoEnded = attendance({ status: 'Stale Auto Ended', metadata: { auto_ended: true } });
  const openVisit = {
    id: 'visit-open', attendance_id: autoEnded.id, check_in_time: rows[0].captured_at,
    check_out_time: null, check_in_latitude: 13.028, check_in_longitude: 80.248,
    status: 'Checked In', metadata: {},
  };
  const result = await recalculateAttendanceTravelLegs(
    clientWith(rows, { attendanceRow: autoEnded, visits: [openVisit] }),
    autoEnded.id,
    { persist: false, auditDelayedCheckout: false, maxGoogleDirectionsCalls: 0 },
  );
  const final = result.travel_legs.find((leg) => leg.type === 'last_checkout_to_end_day');
  assert.equal(final.status, 'calculated');
  assert.ok(final.review_flags.includes('AUTO_END_OPEN_SITE_CONFIRMED_DEPARTURE'));
  assert.ok(final.km > 0);
});

test('historical missing attendance binding safely falls back to employee and time window', async () => {
  const rows = gpsRows().map((row) => ({ ...row, attendance_id: null }));
  const result = await calculateTravelLegKm({
    client: clientWith(rows), attendance: attendance(),
    fromTime: rows[0].captured_at, toTime: rows.at(-1).captured_at,
    fromLat: rows[0].latitude, fromLng: rows[0].longitude,
    toLat: rows.at(-1).latitude, toLng: rows.at(-1).longitude,
  });
  assert.equal(result.legSource, 'GPS_BASED');
  assert.equal(result.gpsLogBindingSource, 'employee_time_window_fallback');
});

test('travel-window construction excludes every checked-in GPS interval without reusing points', async () => {
  const timedRows = (start, prefix) => gpsRows({ start }).map((row, index) => ({ ...row, id: `${prefix}-${index}` }));
  const rows = [
    ...timedRows('2026-07-16T04:35:00.000Z', 'before-first'),
    ...timedRows('2026-07-16T05:10:00.000Z', 'inside-first'),
    ...timedRows('2026-07-16T06:05:00.000Z', 'between-sites'),
    ...timedRows('2026-07-16T06:40:00.000Z', 'inside-second'),
    ...timedRows('2026-07-16T07:05:00.000Z', 'after-last'),
  ];
  const row = attendance({
    login_time: '2026-07-16T04:30:00.000Z', logout_time: '2026-07-16T08:00:00.000Z',
    start_latitude: 13.028, start_longitude: 80.248,
    end_latitude: 13.031, end_longitude: 80.245,
  });
  const visits = [
    {
      id: 'visit-1', attendance_id: row.id,
      check_in_time: '2026-07-16T05:00:00.000Z', check_out_time: '2026-07-16T06:00:00.000Z',
      check_in_latitude: 13.03, check_in_longitude: 80.246,
      check_out_latitude: 13.03, check_out_longitude: 80.246,
      status: 'Completed', metadata: {},
    },
    {
      id: 'visit-2', attendance_id: row.id,
      check_in_time: '2026-07-16T06:30:00.000Z', check_out_time: '2026-07-16T07:00:00.000Z',
      check_in_latitude: 13.031, check_in_longitude: 80.245,
      check_out_latitude: 13.031, check_out_longitude: 80.245,
      status: 'Completed', metadata: {},
    },
  ];
  const result = await recalculateAttendanceTravelLegs(
    clientWith(rows, { attendanceRow: row, visits }), row.id,
    { persist: false, auditDelayedCheckout: false, maxGoogleDirectionsCalls: 0 },
  );
  assert.deepEqual(result.travel_legs.map((leg) => leg.type), [
    'start_to_first_checkin', 'site_checkout_to_next_checkin', 'last_checkout_to_end_day',
  ]);
  assert.equal(result.gps_log_count, 36);
  assert.ok(result.travel_legs.every((leg) => leg.gps_log_count === 12));
  assert.equal(result.travel_legs.some((leg) => String(leg.from_time).includes('05:10')), false);
});

test('travel-leg recalculation preserves persisted bike and car leg snapshots', async () => {
  const timedRows = (start, prefix) => gpsRows({ start }).map((row, index) => ({ ...row, id: `${prefix}-${index}` }));
  const rows = [
    ...timedRows('2026-07-16T04:35:00.000Z', 'before-first'),
    ...timedRows('2026-07-16T06:05:00.000Z', 'between-sites'),
    ...timedRows('2026-07-16T07:05:00.000Z', 'after-last'),
  ];
  const row = attendance({
    travel_mode: 'car',
    rate_per_km: 8,
    login_time: '2026-07-16T04:30:00.000Z',
    logout_time: '2026-07-16T08:00:00.000Z',
    start_latitude: 13.028,
    start_longitude: 80.248,
    end_latitude: 13.031,
    end_longitude: 80.245,
  });
  const visits = [
    {
      id: 'visit-1',
      attendance_id: row.id,
      check_in_time: '2026-07-16T05:00:00.000Z',
      check_out_time: '2026-07-16T06:00:00.000Z',
      check_in_latitude: 13.03,
      check_in_longitude: 80.246,
      check_out_latitude: 13.03,
      check_out_longitude: 80.246,
      status: 'Completed',
      metadata: {},
    },
    {
      id: 'visit-2',
      attendance_id: row.id,
      check_in_time: '2026-07-16T06:30:00.000Z',
      check_out_time: '2026-07-16T07:00:00.000Z',
      check_in_latitude: 13.031,
      check_in_longitude: 80.245,
      check_out_latitude: 13.031,
      check_out_longitude: 80.245,
      status: 'Completed',
      metadata: {},
    },
  ];
  const travelLegs = [
    {
      id: 'leg-bike',
      attendance_id: row.id,
      travel_mode: 'bike',
      payable_km_allowed: true,
      started_at: '2026-07-16T04:30:00.000Z',
      ended_at: '2026-07-16T05:00:00.000Z',
      rate_per_km: 4,
      status: 'completed',
    },
    {
      id: 'leg-car',
      attendance_id: row.id,
      travel_mode: 'car',
      payable_km_allowed: true,
      started_at: '2026-07-16T06:00:00.000Z',
      ended_at: '2026-07-16T06:30:00.000Z',
      rate_per_km: 8,
      status: 'completed',
    },
  ];

  const result = await recalculateAttendanceTravelLegs(
    clientWith(rows, { attendanceRow: row, visits, travelLegs }),
    row.id,
    { persist: false, auditDelayedCheckout: false, maxGoogleDirectionsCalls: 0 },
  );

  assert.deepEqual(
    result.travel_legs.slice(0, 2).map((leg) => ({
      mode: leg.travel_mode,
      rate: leg.rate_per_km,
    })),
    [
      { mode: 'bike', rate: 4 },
      { mode: 'car', rate: 8 },
    ],
  );
  assert.equal(
    result.petrol_amount,
    Number(result.travel_legs.reduce((sum, leg) => sum + Number(leg.payable_amount || 0), 0).toFixed(2)),
  );
});

test('a GPS row on a shared travel-window boundary is counted only once', async () => {
  const before = gpsRows({ start: '2026-07-16T04:50:00.000Z' })
    .slice(0, 10)
    .map((row, index) => ({ ...row, id: `before-${index}` }));
  const boundary = {
    ...before.at(-1),
    id: 'shared-boundary',
    captured_at: '2026-07-16T05:00:00.000Z',
  };
  const after = gpsRows({ start: '2026-07-16T05:00:10.000Z' })
    .slice(0, 10)
    .map((row, index) => ({ ...row, id: `after-${index}` }));
  const rows = [...before, boundary, ...after];
  const client = clientWith(rows);
  const common = {
    client,
    attendance: attendance(),
    fromLat: 13.028,
    fromLng: 80.248,
    toLat: 13.031,
    toLng: 80.245,
    options: { maxGoogleDirectionsCalls: 0 },
  };
  const first = await calculateTravelLegKm({
    ...common,
    fromTime: '2026-07-16T04:49:00.000Z',
    toTime: '2026-07-16T05:00:00.000Z',
  });
  const second = await calculateTravelLegKm({
    ...common,
    fromTime: '2026-07-16T05:00:00.000Z',
    toTime: '2026-07-16T05:10:00.000Z',
  });
  assert.equal(first.gpsLogCount, 11);
  assert.equal(second.gpsLogCount, 10);
  assert.equal(first.gpsLogCount + second.gpsLogCount, rows.length);
});
