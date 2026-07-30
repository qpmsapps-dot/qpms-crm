import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  buildEmployeeRangeDataset,
  attachFallbackClaimsToAttendance,
  deriveVisitDurationMinutes,
  fetchEmployeeRangePages,
  kolkataPeriodBounds,
  loadOptionalExpenseClaims,
  recalculateEmployeeRange,
} from '../services/employeeRangeReportService.js';

function attendance(date, km, overrides = {}) {
  return {
    id: `attendance-${date}-${overrides.sequence || 1}`,
    employee_code: 'FO-TEST',
    attendance_date: date,
    login_time: `${date}T03:30:00.000Z`,
    logout_time: `${date}T12:30:00.000Z`,
    status: 'Completed',
    travel_mode: 'bike',
    rate_per_km: 4,
    total_route_km: km,
    eligible_km: km,
    total_approved_km: km,
    petrol_amount: km * 4,
    raw_gps_km: km + 1,
    filtered_gps_km: km,
    actual_travel_km: km,
    route_sync_status: 'canonical_end_day_recalculation',
    ...overrides,
  };
}

function travelLeg(attendanceId, mode, payableKm, ratePerKm, overrides = {}) {
  return {
    id: `${attendanceId}-${mode}-${overrides.sequence || 1}`,
    attendance_id: attendanceId,
    started_at: '2026-07-01T04:00:00.000Z',
    ended_at: '2026-07-01T05:00:00.000Z',
    travel_mode: mode,
    rate_per_km: ratePerKm,
    calculated_km: payableKm,
    payable_km: payableKm,
    payable_amount: payableKm * ratePerKm,
    status: 'completed',
    ...overrides,
  };
}

function claim(attendanceId, mode, amount, overrides = {}) {
  return {
    id: `${attendanceId}-${mode}-${overrides.sequence || 1}`,
    attendance_id: attendanceId,
    travel_mode: mode,
    fare_amount: amount,
    status: 'approved',
    claim_type: 'travel',
    created_at: '2026-07-01T06:00:00.000Z',
    ...overrides,
  };
}

function claimsClient(rows = [], error = null) {
  return {
    from(table) {
      assert.equal(table, 'fo_travel_expense_claims');
      const query = {
        select() { return query; },
        in() { return query; },
        order() { return query; },
        async range(from, to) {
          return {
            data: error ? null : rows.slice(from, to + 1),
            error,
          };
        },
      };
      return query;
    },
  };
}

test('employee_range_uses_inclusive_kolkata_boundaries', () => {
  assert.deepEqual(kolkataPeriodBounds('2026-07-01', '2026-07-26'), {
    from_date: '2026-07-01',
    to_date: '2026-07-26',
    from_iso: '2026-06-30T18:30:00.000Z',
    to_iso: '2026-07-26T18:29:59.999Z',
    timezone: 'Asia/Kolkata',
  });
});

function pagedQuery(rows) {
  return {
    async range(from, to) {
      return { data: rows.slice(from, to + 1), error: null };
    },
  };
}

test('employee_range_endpoint_paginates_all_attendance_rows', async () => {
  const rows = Array.from({ length: 2005 }, (_, index) => ({ id: `a-${index}` }));
  const result = await fetchEmployeeRangePages(() => pagedQuery(rows));
  assert.equal(result.length, 2005);
  assert.equal(result.at(-1).id, 'a-2004');
});

test('employee_range_endpoint_paginates_all_site_visits', async () => {
  const rows = Array.from({ length: 1748 }, (_, index) => ({ id: `v-${index}` }));
  const result = await fetchEmployeeRangePages(() => pagedQuery(rows));
  assert.equal(result.length, 1748);
  assert.equal(result.at(-1).id, 'v-1747');
});

test('employee_range_filters_before_pagination', async () => {
  const source = await readFile(
    new URL('../services/employeeRangeReportService.js', import.meta.url),
    'utf8',
  );
  const attendanceFilter = source.indexOf('.or(orFilter)');
  const attendancePagination = source.indexOf(
    'const attendances = await fetchEmployeeRangePages',
  );
  const visitFilter = source.indexOf(
    "fetchByAttendanceIds(client, 'fo_site_visits', attendanceIds",
  );
  assert.ok(attendancePagination >= 0 && attendanceFilter > attendancePagination);
  assert.ok(visitFilter >= 0);
  assert.doesNotMatch(source, /\.limit\((500|1000|5000)\)/);
});

test('report_includes_attendance_days_without_visits', () => {
  const dataset = buildEmployeeRangeDataset({
    employee: { employee_code: 'FO-TEST', full_name: 'Test FO' },
    period: kolkataPeriodBounds('2026-07-01', '2026-07-02'),
    attendances: [attendance('2026-07-01', 10), attendance('2026-07-02', 5)],
    visits: [{ id: 'visit-1', attendance_id: 'attendance-2026-07-02-1', check_in_time: '2026-07-02T05:00:00Z' }],
    travelLegs: [],
  });
  assert.equal(dataset.daily_summary.length, 2);
  assert.equal(dataset.daily_summary[0].visit_count, 0);
  assert.equal(dataset.daily_summary[1].visit_count, 1);
});

test('report_groups_visits_by_attendance_date', () => {
  const rows = [attendance('2026-07-01', 10), attendance('2026-07-02', 5)];
  const dataset = buildEmployeeRangeDataset({
    employee: { employee_code: 'FO-TEST' },
    period: kolkataPeriodBounds('2026-07-01', '2026-07-02'),
    attendances: rows,
    visits: [
      { id: 'v1', attendance_id: rows[0].id, check_in_time: '2026-07-01T05:00:00Z' },
      { id: 'v2', attendance_id: rows[1].id, check_in_time: '2026-07-02T05:00:00Z' },
    ],
    travelLegs: [],
  });
  assert.deepEqual(dataset.daily_summary.map((row) => row.visit_count), [1, 1]);
});

test('bike_car_and_ticket_modes_use_their_eligible_reimbursement_rules', () => {
  const row = attendance('2026-07-01', 8, { petrol_amount: 48 });
  const dataset = buildEmployeeRangeDataset({
    employee: { employee_code: 'FO-TEST' },
    period: kolkataPeriodBounds('2026-07-01', '2026-07-01'),
    attendances: [row],
    visits: [],
    travelLegs: [
      travelLeg(row.id, 'car', 4, 8),
      travelLeg(row.id, 'bike', 4, 4, { sequence: 2 }),
    ],
    expenseClaims: [
      claim(row.id, 'train', 100),
      claim(row.id, 'other', 30, {
        sequence: 2,
        claim_type: 'parking',
      }),
    ],
  });
  assert.deepEqual(dataset.daily_summary[0].modes, ['Car', 'Bike', 'Train']);
  assert.equal(dataset.daily_summary[0].kilometer, 8);
  assert.equal(dataset.daily_summary[0].distance_amount, 48);
  assert.equal(dataset.daily_summary[0].claim_amount, 130);
  assert.equal(dataset.daily_summary[0].amount, 178);
  assert.equal(dataset.period_summary.total_amount, 178);
});

for (const [mode, rate, expectedAmount] of [
  ['bike', 4, 40],
  ['car', 8, 80],
]) {
  test(`${mode}_only_10_km_uses_stored_rate_snapshot`, () => {
    const row = attendance('2026-07-01', 10, {
      travel_mode: mode,
      rate_per_km: rate,
      petrol_amount: expectedAmount,
    });
    const dataset = buildEmployeeRangeDataset({
      employee: { employee_code: 'FO-TEST' },
      period: kolkataPeriodBounds('2026-07-01', '2026-07-01'),
      attendances: [row],
      visits: [],
      travelLegs: [travelLeg(row.id, mode, 10, rate)],
    });
    assert.equal(dataset.daily_summary[0].kilometer, 10);
    assert.equal(dataset.daily_summary[0].amount, expectedAmount);
  });
}

for (const [mode, amount] of [
  ['train', 250],
  ['bus', 60],
  ['auto', 120],
  ['other', 75],
]) {
  test(`${mode}_claim_contributes_amount_but_zero_kilometer`, () => {
    const row = attendance('2026-07-01', 0, {
      travel_mode: mode,
      rate_per_km: 0,
      petrol_amount: 0,
    });
    const dataset = buildEmployeeRangeDataset({
      employee: { employee_code: 'FO-TEST' },
      period: kolkataPeriodBounds('2026-07-01', '2026-07-01'),
      attendances: [row],
      visits: [],
      travelLegs: [],
      expenseClaims: [claim(row.id, mode, amount)],
    });
    assert.equal(dataset.daily_summary[0].kilometer, 0);
    assert.equal(dataset.daily_summary[0].amount, amount);
  });
}

test('parking_claim_contributes_amount_but_zero_kilometer', () => {
  const row = attendance('2026-07-01', 0);
  const dataset = buildEmployeeRangeDataset({
    employee: { employee_code: 'FO-TEST' },
    period: kolkataPeriodBounds('2026-07-01', '2026-07-01'),
    attendances: [row],
    visits: [],
    travelLegs: [],
    expenseClaims: [
      claim(row.id, 'other', 50, {
        claim_type: 'parking',
        remarks: 'Parking Claim',
      }),
    ],
  });
  assert.equal(dataset.daily_summary[0].kilometer, 0);
  assert.equal(dataset.daily_summary[0].amount, 50);
});

test('attendance_with_no_expense_claims_returns_valid_report', () => {
  const row = attendance('2026-07-01', 10);
  const dataset = buildEmployeeRangeDataset({
    employee: { employee_code: 'FO-TEST' },
    period: kolkataPeriodBounds('2026-07-01', '2026-07-01'),
    attendances: [row],
    visits: [],
    travelLegs: [],
    expenseClaims: [],
  });
  assert.equal(dataset.expense_claims.length, 0);
  assert.equal(dataset.daily_summary[0].amount, 40);
});

test('null_optional_claim_fields_normalize_to_zero_without_crashing', () => {
  const row = attendance('2026-07-01', 0, {
    travel_mode: 'train',
    rate_per_km: 0,
    petrol_amount: 0,
  });
  const dataset = buildEmployeeRangeDataset({
    employee: { employee_code: 'FO-TEST' },
    period: kolkataPeriodBounds('2026-07-01', '2026-07-01'),
    attendances: [row],
    visits: [],
    travelLegs: [],
    expenseClaims: [{
      id: 'claim-null',
      attendance_id: row.id,
      employee_code: 'FO-TEST',
      travel_mode: 'train',
      claim_type: null,
      fare_amount: null,
      status: 'approved',
      created_at: null,
    }],
  });
  assert.equal(dataset.expense_claims[0].fare_amount, 0);
  assert.equal(dataset.daily_summary[0].claim_amount, 0);
});

test('malformed_individual_claim_amount_does_not_crash_employee_report', () => {
  const row = attendance('2026-07-01', 0, {
    travel_mode: 'auto',
    rate_per_km: 0,
    petrol_amount: 0,
  });
  const dataset = buildEmployeeRangeDataset({
    employee: { employee_code: 'FO-TEST' },
    period: kolkataPeriodBounds('2026-07-01', '2026-07-01'),
    attendances: [row],
    visits: [],
    travelLegs: [],
    expenseClaims: [{
      id: 'claim-malformed',
      attendance_id: row.id,
      employee_code: 'FO-TEST',
      travel_mode: 'auto',
      claim_type: 'travel',
      fare_amount: 'not-a-number',
      status: 'approved',
      created_at: '2026-07-01T06:00:00Z',
    }],
  });
  assert.equal(dataset.expense_claims[0].fare_amount, 0);
  assert.equal(dataset.daily_summary[0].amount, 0);
});

test('real_production_claim_columns_map_to_ticket_and_parking_amounts', () => {
  const row = attendance('2026-07-01', 0, {
    travel_mode: 'train',
    rate_per_km: 0,
    petrol_amount: 0,
  });
  const dataset = buildEmployeeRangeDataset({
    employee: { employee_code: 'FO-TEST' },
    period: kolkataPeriodBounds('2026-07-01', '2026-07-01'),
    attendances: [row],
    visits: [],
    travelLegs: [],
    expenseClaims: [
      {
        id: 'claim-train',
        attendance_id: row.id,
        employee_code: 'FO-TEST',
        fo_user_id: 'FO-TEST',
        travel_mode: 'train',
        claim_type: 'travel',
        fare_amount: 250,
        status: 'approved',
        created_at: '2026-07-01T06:00:00Z',
      },
      {
        id: 'claim-parking',
        attendance_id: row.id,
        employee_code: 'FO-TEST',
        travel_mode: 'other',
        claim_type: 'parking',
        fare_amount: 50,
        status: 'approved',
        created_at: '2026-07-01T07:00:00Z',
      },
    ],
  });
  assert.equal(dataset.daily_summary[0].claim_amount, 300);
  assert.equal(dataset.daily_summary[0].other_transport_amount, 250);
  assert.equal(dataset.daily_summary[0].parking_amount, 50);
  assert.equal(dataset.daily_summary[0].total_amount, 300);
  assert.equal(dataset.daily_summary[0].amount, 300);
});

test('claim_query_explicitly_includes_submitted_pending_and_approved_statuses', async () => {
  const source = await readFile(
    new URL('../services/employeeRangeReportService.js', import.meta.url),
    'utf8',
  );
  assert.match(source, /const EXPENSE_CLAIM_QUERY_STATUSES = \[\.\.\.INCLUDED_EXPENSE_CLAIM_STATUSES\]/);
  assert.match(source, /from\('fo_travel_expense_claims'\)[\s\S]*?\.in\('status', EXPENSE_CLAIM_QUERY_STATUSES\)/);
  assert.match(source, /'submitted'/);
  assert.match(source, /'pending_review'/);
  assert.match(source, /'approved'/);
});

test('ticket_and_parking_amounts_are_separate_and_reconcile', () => {
  const row = attendance('2026-07-01', 4, { petrol_amount: 16 });
  const dataset = buildEmployeeRangeDataset({
    employee: { employee_code: 'FO-TEST' },
    period: kolkataPeriodBounds('2026-07-01', '2026-07-01'),
    attendances: [row],
    expenseClaims: [
      claim(row.id, 'train', 100),
      claim(row.id, 'bus', 60, { sequence: 2 }),
      claim(row.id, 'auto', 40, { sequence: 3 }),
      claim(row.id, 'other', 25, { sequence: 4 }),
      claim(row.id, 'other', 30, { sequence: 5, claim_type: 'parking' }),
    ],
  });
  const daily = dataset.daily_summary[0];
  assert.equal(daily.kilometer, 4);
  assert.equal(daily.distance_amount, 16);
  assert.equal(daily.other_transport_amount, 225);
  assert.equal(daily.parking_amount, 30);
  assert.equal(daily.total_amount, 271);
  assert.equal(dataset.period_summary.total_amount, 271);
  assert.equal(dataset.period_summary.total_amount, dataset.period_summary.distance_amount + dataset.period_summary.other_transport_amount + dataset.period_summary.parking_amount);
});

test('azad_july_fixture_reconciles_submitted_ticket_claims', () => {
  const rows = [
    attendance('2026-07-17', 1604.78, { petrol_amount: 6419.12, travel_mode: 'bike' }),
    attendance('2026-07-20', 0, { travel_mode: 'bike', sequence: 2 }),
    attendance('2026-07-27', 0, { travel_mode: 'bike', sequence: 3 }),
    attendance('2026-07-28', 0, { travel_mode: 'bike', sequence: 4 }),
  ];
  const claims = [
    claim(rows[0].id, 'train', 80),
    claim(rows[1].id, 'train', 80),
    claim(rows[1].id, 'bus', 15, { sequence: 2 }),
    claim(rows[2].id, 'train', 65),
    claim(rows[2].id, 'bus', 28, { sequence: 2 }),
    claim(rows[2].id, 'bus', 25, { sequence: 3 }),
    claim(rows[2].id, 'auto', 50, { sequence: 4 }),
    claim(rows[2].id, 'train', 65, { sequence: 2 }),
    claim(rows[3].id, 'train', 80),
  ];
  const dataset = buildEmployeeRangeDataset({
    employee: { employee_code: 'QPMSKL1674', full_name: 'AZAD.H' },
    period: kolkataPeriodBounds('2026-07-01', '2026-07-30'),
    attendances: rows,
    expenseClaims: claims,
  });
  const byDate = new Map(dataset.daily_summary.map((row) => [row.attendance_date, row]));
  assert.equal(byDate.get('2026-07-17').other_transport_amount, 80);
  assert.deepEqual(byDate.get('2026-07-17').modes, ['Bike', 'Train']);
  assert.equal(byDate.get('2026-07-20').other_transport_amount, 95);
  assert.equal(byDate.get('2026-07-27').other_transport_amount, 233);
  assert.equal(byDate.get('2026-07-28').other_transport_amount, 80);
  assert.equal(dataset.period_summary.other_transport_amount, 488);
  assert.equal(dataset.period_summary.parking_amount, 0);
  assert.equal(dataset.period_summary.distance_amount, 6419.12);
  assert.equal(dataset.period_summary.total_amount, 6907.12);
  assert.equal(dataset.period_summary.total_amount, dataset.daily_summary.reduce((sum, row) => sum + row.total_amount, 0));
});

test('site_visit_duration_is_derived_without_mutating_source', () => {
  assert.equal(deriveVisitDurationMinutes({ checkIn: '2026-07-01T23:50:00+05:30', checkOut: '2026-07-02T00:39:00+05:30' }), 49);
  assert.equal(deriveVisitDurationMinutes({ checkIn: '2026-07-01T10:00:00Z', checkOut: '2026-07-01T10:00:30Z' }), 0);
  assert.equal(deriveVisitDurationMinutes({ checkIn: '2026-07-01T10:00:00Z', checkOut: '2026-07-01T09:59:00Z' }), null);
  assert.equal(deriveVisitDurationMinutes({ checkIn: '2026-07-01T10:00:00Z' }), null);
  const visit = { id: 'visit-1', attendance_id: 'attendance-1', check_in_time: '2026-07-01T10:00:00Z', check_out_time: '2026-07-01T10:49:00Z', visit_duration_minutes: null };
  const dataset = buildEmployeeRangeDataset({ employee: { employee_code: 'FO-TEST' }, period: kolkataPeriodBounds('2026-07-01', '2026-07-01'), attendances: [attendance('2026-07-01', 0, { id: 'attendance-1' })], visits: [visit] });
  assert.equal(dataset.site_visits[0].visit_duration_minutes, 49);
  assert.equal(visit.visit_duration_minutes, null);
});

test('claim_without_attendance_id_uses_only_unambiguous_employee_date_fallback', () => {
  const rows = [attendance('2026-07-01', 0, { id: 'attendance-1' })];
  const linked = attachFallbackClaimsToAttendance([
    { id: 'claim-1', employee_code: 'FO-TEST', created_at: '2026-07-01T06:00:00Z' },
  ], rows, 'FO-TEST');
  assert.equal(linked[0].attendance_id, 'attendance-1');
  const ambiguous = attachFallbackClaimsToAttendance([
    { id: 'claim-2', employee_code: 'FO-TEST', created_at: '2026-07-01T06:00:00Z' },
  ], [...rows, attendance('2026-07-01', 0, { id: 'attendance-2', sequence: 2 })], 'FO-TEST');
  assert.equal(ambiguous[0].attendance_id, undefined);
});

test('optional_claim_permission_failure_does_not_fail_employee_report', async () => {
  const result = await loadOptionalExpenseClaims(
    claimsClient([], {
      code: '42501',
      message: 'permission denied for table fo_travel_expense_claims',
    }),
    ['attendance-1'],
  );
  assert.deepEqual(result.rows, []);
  assert.equal(result.warning.code, 'EXPENSE_CLAIMS_UNAVAILABLE');
});

test('empty_claim_query_returns_empty_rows_without_warning', async () => {
  const result = await loadOptionalExpenseClaims(
    claimsClient([]),
    ['attendance-1'],
  );
  assert.deepEqual(result, { rows: [], warning: null });
});

test('unexpected_claim_query_error_is_not_silently_hidden', async () => {
  await assert.rejects(
    loadOptionalExpenseClaims(
      claimsClient([], { code: 'XX000', message: 'unexpected database error' }),
      ['attendance-1'],
    ),
    (error) => error.code === 'XX000',
  );
});

test('rejected_cancelled_and_duplicate_claims_are_excluded', () => {
  const row = attendance('2026-07-01', 0);
  const approved = claim(row.id, 'train', 100);
  const dataset = buildEmployeeRangeDataset({
    employee: { employee_code: 'FO-TEST' },
    period: kolkataPeriodBounds('2026-07-01', '2026-07-01'),
    attendances: [row],
    visits: [],
    travelLegs: [],
    expenseClaims: [
      approved,
      { ...approved },
      claim(row.id, 'bus', 60, { status: 'rejected', sequence: 2 }),
      claim(row.id, 'auto', 120, { status: 'cancelled', sequence: 3 }),
    ],
  });
  assert.equal(dataset.daily_summary[0].claim_amount, 100);
  assert.equal(dataset.expense_claims.length, 1);
});

test('completed_day_keeps_canonical_distance_amount_with_approved_adjustment', () => {
  const row = attendance('2026-07-01', 12, {
    total_route_km: 12,
    eligible_km: 12,
    total_approved_km: 12,
    petrol_amount: 48,
  });
  const dataset = buildEmployeeRangeDataset({
    employee: { employee_code: 'FO-TEST' },
    period: kolkataPeriodBounds('2026-07-01', '2026-07-01'),
    attendances: [row],
    visits: [],
    travelLegs: [travelLeg(row.id, 'bike', 10, 4)],
  });
  assert.equal(dataset.daily_summary[0].kilometer, 12);
  assert.equal(dataset.daily_summary[0].distance_amount, 48);
});

test('site_summary_contains_start_visits_and_end_in_chronological_order', () => {
  const row = attendance('2026-07-01', 10);
  const dataset = buildEmployeeRangeDataset({
    employee: { employee_code: 'FO-TEST' },
    period: kolkataPeriodBounds('2026-07-01', '2026-07-01'),
    attendances: [row],
    visits: [
      { id: 'v2', attendance_id: row.id, store_name: 'Second', check_in_time: '2026-07-01T06:00:00Z' },
      { id: 'v1', attendance_id: row.id, store_name: 'First', check_in_time: '2026-07-01T05:00:00Z' },
    ],
    travelLegs: [],
  });
  assert.deepEqual(
    dataset.site_visit_summary.map((item) => item.row_type),
    ['start_day', 'site_visit', 'site_visit', 'end_day'],
  );
  assert.deepEqual(
    dataset.site_visit_summary.map((item) => item.site_name),
    ['Start Day', 'First', 'Second', 'End Day'],
  );
  assert.equal(dataset.site_visit_summary.some((item) => 'latitude' in item), false);
});

test('legacy_attendance_displays_travel_leg_warning', () => {
  const dataset = buildEmployeeRangeDataset({
    employee: { employee_code: 'FO-TEST' },
    period: kolkataPeriodBounds('2026-07-01', '2026-07-01'),
    attendances: [attendance('2026-07-01', 10)],
    visits: [],
    travelLegs: [],
  });
  assert.equal(
    dataset.data_quality_warnings.some((warning) => warning.code === 'LEGACY_TRAVEL_LEGS_UNAVAILABLE'),
    true,
  );
});

test('prakasan_july_range_reconciles_1032_44_km', () => {
  const dates = [
    '01', '02', '03', '04', '06', '07', '08', '09', '10', '11',
    '13', '14', '15', '16', '18', '21', '22', '23', '24', '25',
  ];
  const values = [
    3.52, 0.01, 0, 8.31, 4.63, 0.01, 5.83, 44.41, 10.29, 0,
    17.19, 179.96, 6.21, 191.83, 31.17, 149.3, 48.05, 238.96, 58.51, 34.25,
  ];
  const rows = values.map((km, index) => attendance(`2026-07-${dates[index]}`, km));
  const dataset = buildEmployeeRangeDataset({
    employee: { employee_code: 'FO-FIXTURE' },
    period: kolkataPeriodBounds('2026-07-01', '2026-07-26'),
    attendances: rows,
    visits: [],
    travelLegs: [],
  });
  assert.equal(dataset.period_summary.attendance_count, 20);
  assert.equal(dataset.period_summary.canonical_payable_km, 1032.44);
  assert.equal(dataset.period_summary.canonical_petrol_amount, 4129.76);
  assert.deepEqual(
    dataset.daily_summary.map((row) => row.attendance_date.slice(-2)),
    dates,
  );
});

test('selected_period_recalculation_processes_all_completed_attendances', async () => {
  const rows = [
    attendance('2026-07-01', 10),
    attendance('2026-07-02', 5),
    attendance('2026-07-03', 0, { logout_time: null, status: 'Active' }),
  ];
  const called = [];
  const result = await recalculateEmployeeRange({
    attendances: rows,
    recalculate: async (row) => {
      called.push(row.id);
      return { attendance_id: row.id };
    },
  });
  assert.equal(result.found, 3);
  assert.equal(result.eligible, 2);
  assert.equal(result.updated, 2);
  assert.equal(result.skipped, 1);
  assert.deepEqual(called, rows.slice(0, 2).map((row) => row.id));
});

test('selected_period_recalculation_returns_partial_failures_by_day', async () => {
  const rows = [attendance('2026-07-01', 10), attendance('2026-07-02', 5)];
  const result = await recalculateEmployeeRange({
    attendances: rows,
    recalculate: async (row) => {
      if (row.attendance_date === '2026-07-02') throw new Error('provider unavailable');
      return { attendance_id: row.id };
    },
  });
  assert.equal(result.updated, 1);
  assert.equal(result.failed, 1);
  assert.deepEqual(result.results.map((row) => row.outcome), ['updated', 'failed']);
  assert.equal(result.results[1].reason, 'KM recalculation failed for this attendance.');
});
