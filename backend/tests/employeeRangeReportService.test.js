import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  buildEmployeeRangeDataset,
  fetchEmployeeRangePages,
  kolkataPeriodBounds,
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
