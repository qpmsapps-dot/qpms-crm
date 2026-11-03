import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOctoberKmAudit, loadOctoberKmAudit } from '../services/foOctoberKmAuditSummaryService.js';

const code = 'QPMSKL1403';
const attendance = (date, gps, approved, petrol, travel_mode = 'bike', id = date) => ({
  id, employee_code: code, display_name: 'PRAKASAN', attendance_date: date,
  travel_mode, filtered_gps_km: String(gps), total_approved_km: String(approved),
  petrol_amount: String(petrol),
});
const leg = (day, travel_mode, payable_km, payable_amount, extra = {}) => ({
  id: day + travel_mode + payable_km, employee_code: code,
  started_at: day + 'T06:00:00+05:30', travel_mode,
  payable_km, payable_amount, superseded_at: null, ...extra,
});

test('October evidence review handles Bike/Train, missing KM and no-activity exclusions', () => {
  const rows = [
    attendance('2026-10-01', 54.72, 208.06, 832.24),
    attendance('2026-10-02', 60, 10, 40),
    attendance('2026-10-03', 120, 0, 0, 'train'),
    attendance('2026-10-04', 0, 40, 160),
    attendance('2026-10-05', 0, 0, 0),
    attendance('2026-10-06', 0, 0, 0), // has a site visit, even though no KM
    attendance('2026-10-07', 0, 0, 0), // no activity, excluded
    attendance('2026-10-08', 0, 0, 0, 'bus'), // saved Bus leg: transport evidence
    attendance('2026-09-30', 5, 200, 800),
  ];
  const legs = [
    leg('2026-10-01', 'bike', 199.09, 796.36),
    leg('2026-10-01', 'train', 0, 0),
    leg('2026-10-01', 'bike', 8.97, 35.88),
    leg('2026-10-03', 'train', 0, 0),
    leg('2026-10-08', 'bus', 0, 0),
    leg('2026-10-02', 'train', 0, 0, { superseded_at: '2026-10-03T00:00:00Z' }),
  ];
  const before = JSON.stringify({ rows, legs });
  const result = buildOctoberKmAudit(rows, legs,
    [{ employee_code: code, full_name: 'PRAKASAN', role: 'FO', state: 'KL' }],
    new Set(['2026-10-06']));
  assert.equal(result.summary.attendance_records, 6);
  assert.equal(result.summary.employees, 1);
  assert.equal(result.summary.roles.FO, 1);
  assert.equal(result.summary.calculated_petrol_rupees, 1032.24);
  assert.equal(result.summary.possible_missing_cases, 1);
  assert.equal(result.summary.possible_missing_gps_gap_km, 50);
  assert.equal(result.summary.possible_excess_cases, 2);
  assert.equal(result.summary.possible_excess_gps_gap_km, 193.34);
  assert.equal(result.summary.insufficient_gps_cases, 1);
  assert.equal(result.summary.bike_train_days, 1);
  assert.equal(result.summary.bike_train_payable_cases, 1);
  assert.equal(result.summary.bike_train_payable_rupees_at_issue, 832.24);
  assert.equal(result.summary.verified_addition_rupees, null);
  assert.equal(result.summary.verified_deduction_rupees, null);
  assert.equal(result.processing_status, 'READ_ONLY_REVIEW');
  assert.equal(result.cases.length, 3);
  assert.deepEqual(result.cases[0].flags, ['BIKE_PAID_AND_TRAIN_RECORDED', 'PAYABLE_ABOVE_GPS_REVIEW']);
  assert.equal(result.cases[0].disposition, 'EVIDENCE_REVIEW_REQUIRED');
  assert.equal(result.cases[0].state, 'KL');
  assert.equal(result.cases.find(c => c.date === '2026-10-02').missing_gps_gap_km, 50);
  assert.ok(!result.cases.some(c => c.date === '2026-10-03'), 'Train distance is not a petrol entitlement');
  assert.ok(!result.cases.some(c => c.date === '2026-10-05'), 'A zero-activity row must not appear');
  assert.equal(JSON.stringify({ rows, legs }), before, 'audit must not mutate source evidence');
});

test('Mode grouping uses Asia/Kolkata day and skips superseded travel legs', () => {
  const legs = [
    { ...leg('2026-10-01', 'train', 0, 0), started_at: '2026-09-30T19:30:00Z' },
    { ...leg('2026-10-01', 'bike', 20, 80), started_at: '2026-09-30T19:35:00Z' },
    { ...leg('2026-10-01', 'train', 0, 0), started_at: '2026-10-01T03:00:00Z', superseded_at: '2026-10-02T00:00:00Z' },
  ];
  const result = buildOctoberKmAudit([attendance('2026-10-01', 10, 20, 80)], legs);
  assert.equal(result.summary.bike_train_days, 1);
  assert.equal(result.summary.bike_train_payable_cases, 1);
});

test('Read path pages 505 attendances and scopes site visits by attendance ID', async () => {
  const rows = Array.from({ length: 505 }, (_, i) => ({
    ...attendance('2026-10-01', 0, 0, 0), id: String(i).padStart(5, '0'),
  }));
  const inputs = {
    fo_attendance: rows,
    fo_travel_legs: [],
    fo_site_visits: [{ id: 'visit-1', attendance_id: '00503' }],
    profiles: [{ employee_code: code, state: 'KL', full_name: 'PRAKASAN' }],
  };
  const calls = [];
  class Query {
    constructor(table) { this.table = table; this.rows = [...inputs[table]]; }
    select(fields) { calls.push([this.table, 'select', fields]); return this; }
    gte(key, value) { this.rows = this.rows.filter(r => r[key] >= value); return this; }
    lte(key, value) { this.rows = this.rows.filter(r => r[key] <= value); return this; }
    lt(key, value) { this.rows = this.rows.filter(r => r[key] < value); return this; }
    is(key, value) { this.rows = this.rows.filter(r => r[key] === value); return this; }
    order(key) { this.rows.sort((a, b) => String(a[key]).localeCompare(String(b[key]))); return this; }
    in(key, values) { this.rows = this.rows.filter(r => values.includes(r[key])); return this; }
    range(from, to) { calls.push([this.table, 'range', from, to]); return Promise.resolve({ data: this.rows.slice(from, to + 1), error: null }); }
    then(resolve, reject) { return Promise.resolve({ data: this.rows, error: null }).then(resolve, reject); }
  }
  const client = { from(table) { assert.ok(inputs[table], table); return new Query(table); } };
  const report = await loadOctoberKmAudit(client);
  assert.equal(report.summary.attendance_records, 1, 'only attended site-visit row counts');
  assert.equal(report.summary.employees, 1);
  assert.ok(calls.some(c => c[0] === 'fo_attendance' && c[1] === 'range' && c[2] === 500));
  assert.ok(calls.some(c => c[0] === 'fo_site_visits' && c[1] === 'select'));
  assert.ok(calls.every(c => ['select', 'range'].includes(c[1])), 'read only: no inserts/updates/deletes');
});

test('all KM-active roles are included: FO, KAM, Operations Manager, Branch Head and others', () => {
  const roles = ['FO', 'KAM', 'Operations Manager', 'Branch Head', 'Business Head', 'Admin'];
  const attendanceRows = roles.map((role, i) => ({
    ...attendance('2026-10-16', i === 5 ? 0 : 25, i === 5 ? 0 : 12, i === 5 ? 0 : 48),
    id: 'active-' + i, employee_code: 'EMP-' + i,
  }));
  const profileRows = roles.map((role, i) => ({
    employee_code: 'EMP-' + i, full_name: 'Employee ' + i, role, state: 'TN',
  }));
  const result = buildOctoberKmAudit(attendanceRows, [], profileRows);
  assert.equal(result.summary.employees, 5);
  assert.equal(result.summary.attendance_records, 5);
  assert.equal(result.summary.roles.FO, 1);
  assert.equal(result.summary.roles.KAM, 1);
  assert.equal(result.summary.roles['Operations Manager'], 1);
  assert.equal(result.summary.roles['Branch Head'], 1);
  assert.equal(result.summary.roles['Business Head'], 1);
  assert.equal(result.summary.roles.Admin, undefined);
  assert.ok(result.cases.some(c => c.role === 'KAM'));
  assert.ok(result.cases.some(c => c.role === 'Operations Manager'));
  assert.ok(result.cases.some(c => c.role === 'Branch Head'));
  assert.ok(result.cases.some(c => c.role === 'Business Head'));
  const withAdminSiteVisit = buildOctoberKmAudit(attendanceRows, [], profileRows, new Set(['active-5']));
  assert.equal(withAdminSiteVisit.summary.roles.Admin, 1);
  assert.equal(withAdminSiteVisit.summary.employees, 6);
});
