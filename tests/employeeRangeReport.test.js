import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildEmployeeRangeExcelRows,
  employeeRangeQuery,
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
    raw_gps_km: 17,
    filtered_gps_km: 14,
    actual_travel_km: 15,
  },
  attendance_days: [
    { id: 'a1', attendance_date: '2026-07-01', status: 'Completed', total_approved_km: 10, petrol_amount: 40 },
    { id: 'a2', attendance_date: '2026-07-02', status: 'Completed', total_approved_km: 5, petrol_amount: 20 },
  ],
  daily_summary: [
    { attendance_date: '2026-07-01', attendance_ids: ['a1'], visit_count: 0, payable_km: 10, petrol_amount: 40 },
    { attendance_date: '2026-07-02', attendance_ids: ['a2'], visit_count: 1, payable_km: 5, petrol_amount: 20 },
  ],
  site_visits: [{ id: 'v1', attendance_id: 'a2', attendance_date: '2026-07-02' }],
  travel_legs: [],
  missing_checkout_adjustments: [],
  data_quality_warnings: [{ code: 'LEGACY_TRAVEL_LEGS_UNAVAILABLE', attendance_date: '2026-07-01' }],
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

test('report_uses_range_gps_totals_not_latest_day', () => {
  const sheets = buildEmployeeRangeExcelRows(dataset);
  assert.equal(sheets.periodSummary[0]['Raw GPS KM'], 17);
  assert.equal(sheets.periodSummary[0]['Actual Travel KM'], 15);
});

test('excel_and_pdf_have_identical_counts_and_totals', () => {
  const sheets = buildEmployeeRangeExcelRows(dataset);
  assert.equal(sheets.dailyAttendance.length, dataset.daily_summary.length);
  assert.equal(sheets.siteVisits.length, dataset.site_visits.length);
  assert.equal(sheets.periodSummary[0]['Canonical Payable KM'], dataset.period_summary.canonical_payable_km);
  assert.equal(sheets.periodSummary[0]['Canonical Petrol Amount'], dataset.period_summary.canonical_petrol_amount);
});

test('pdf_waits_for_normalized_dataset', () => {
  assert.equal(reportReadiness({ loading: true, dataset }), 'loading');
  assert.equal(reportReadiness({ loading: false, dataset: null }), 'unavailable');
  assert.equal(reportReadiness({ loading: false, dataset }), 'ready');
});
