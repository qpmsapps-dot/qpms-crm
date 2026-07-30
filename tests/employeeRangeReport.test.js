import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildEmployeeRangeExcelRows,
  employeeRangeQuery,
  employeeRangeMetric,
  reportReadiness,
} from '../src/utils/employeeRangeReport.js';

const dataset = {
  employee: { employee_code: 'FO-TEST', full_name: 'Test FO', state: 'KL' },
  period: { from_date: '2026-07-01', to_date: '2026-07-26', timezone: 'Asia/Kolkata' },
  period_summary: {
    attendance_count: 2,
    completed_count: 2,
    incomplete_count: 0,
    visit_count: 1,
    canonical_payable_km: 15,
    approved_missing_km: 0,
    canonical_petrol_amount: 60,
    kilometer: 15,
    distance_amount: 60,
    eligible_claim_amount: 0,
    other_transport_amount: 0,
    parking_amount: 0,
    eligible_ticket_parking_amount: 0,
    total_man_days: 2,
    attendance_records: 2,
    total_visits: 1,
    total_amount: 60,
    raw_gps_km: 17,
    filtered_gps_km: 14,
    actual_travel_km: 15,
  },
  attendance_days: [
    { id: 'a1', attendance_date: '2026-07-01', status: 'Completed', total_approved_km: 10, petrol_amount: 40 },
    { id: 'a2', attendance_date: '2026-07-02', status: 'Completed', total_approved_km: 5, petrol_amount: 20 },
  ],
  daily_summary: [
    { attendance_date: '2026-07-01', attendance_ids: ['a1'], visit_count: 0, kilometer: 10, distance_amount: 40, other_transport_amount: 0, parking_amount: 0, total_amount: 40 },
    { attendance_date: '2026-07-02', attendance_ids: ['a2'], visit_count: 1, kilometer: 5, distance_amount: 20, other_transport_amount: 0, parking_amount: 0, total_amount: 20 },
  ],
  site_visits: [{ id: 'v1', attendance_id: 'a2', attendance_date: '2026-07-02' }],
  travel_legs: [],
  missing_checkout_adjustments: [],
  data_quality_warnings: [{ code: 'LEGACY_TRAVEL_LEGS_UNAVAILABLE', attendance_date: '2026-07-01' }],
  site_visit_summary: [
    { attendance_date: '2026-07-01', row_type: 'start_day', site_name: 'Start Day' },
    { attendance_date: '2026-07-01', row_type: 'end_day', site_name: 'End Day' },
  ],
};

test('employee range request carries employee and date range', () => {
  const query = employeeRangeQuery({
    employeeIdentifier: 'FO-TEST',
    fromDate: '2026-07-01',
    toDate: '2026-07-26',
  });
  assert.match(query, /employee=FO-TEST/);
  assert.match(query, /date_from=2026-07-01/);
  assert.match(query, /date_to=2026-07-26/);
});

test('daily report excludes gps audit columns', () => {
  const sheets = buildEmployeeRangeExcelRows(dataset);
  assert.equal(Object.hasOwn(sheets.dailyAttendance[0], 'Raw GPS KM'), false);
  assert.equal(Object.hasOwn(sheets.dailyAttendance[0], 'Filtered GPS KM'), false);
});

test('excel_and_pdf_have_identical_counts_and_totals', () => {
  const sheets = buildEmployeeRangeExcelRows(dataset);
  assert.equal(sheets.dailyAttendance.length, dataset.daily_summary.length);
  assert.equal(sheets.siteVisits.length, dataset.site_visit_summary.length);
  assert.equal(sheets.periodSummary[0]['Kilometer'], 15);
  assert.equal(sheets.periodSummary[0]['Total Amount'], dataset.period_summary.total_amount);
  assert.equal(
    sheets.dailyAttendance.reduce((sum, row) => sum + row['Total Amount'], 0),
    sheets.periodSummary[0]['Total Amount'],
  );
  assert.deepEqual(Object.keys(sheets.siteVisits[0]), ['Attendance Date', 'Site / Client', 'Check-In', 'Check-Out', 'Duration']);
  assert.equal(sheets.travelClaims.length, 0);
});

test('removed report sections are absent from excel data', () => {
  const sheets = buildEmployeeRangeExcelRows(dataset);
  assert.equal(Object.hasOwn(sheets, 'travelEvidence'), false);
  assert.equal(Object.hasOwn(sheets, 'exceptions'), false);
});

test('excel_travel_claims_contains_each_eligible_claim_once', () => {
  const expenseClaims = Array.from({ length: 9 }, (_, index) => ({
    id: `claim-${index + 1}`,
    attendance_date: '2026-07-27',
    travel_mode: index % 2 ? 'bus' : 'train',
    claimed_amount: index + 1,
    eligible_amount: index + 1,
    parking_amount: 0,
    approval_status: 'submitted',
  }));
  const sheets = buildEmployeeRangeExcelRows({ ...dataset, expense_claims: expenseClaims });
  assert.equal(sheets.travelClaims.length, 9);
  assert.deepEqual(sheets.travelClaims.map((row) => row['Claim ID']), expenseClaims.map((claim) => claim.id));
});

test('pdf_waits_for_normalized_dataset', () => {
  assert.equal(reportReadiness({ loading: true, dataset }), 'loading');
  assert.equal(reportReadiness({ loading: false, dataset: null }), 'unavailable');
  assert.equal(reportReadiness({ loading: false, dataset }), 'ready');
});

test('failed_employee_range_request_does_not_create_false_zero_metrics', () => {
  assert.equal(employeeRangeMetric(null, 'kilometer'), null);
  assert.equal(employeeRangeMetric(undefined, 'total_amount'), null);
  assert.equal(employeeRangeMetric(dataset, 'kilometer'), 15);
  assert.equal(employeeRangeMetric(dataset, 'missing_metric'), null);
});
