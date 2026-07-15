import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canAccessOperationsSummary,
  normalizeOperationsSummaryFilters,
  operationsSummaryAllowedEmployeeCodes,
  storedAttendancePayableKm,
  storedAttendancePetrolAmount,
  summarizeOperationsRows,
} from '../services/operationsSummaryService.js';

const actor = { employee_code: 'ADMIN1', role: 'Admin', status: 'active', is_active: true };
const profiles = [
  { employee_code: 'KL1', role: 'FO', state: 'KL', business: 'HDFC', status: 'active', is_active: true },
  { employee_code: 'KL2', role: 'KAM', state: 'KL', business: 'JIO', status: 'active', is_active: true },
  { employee_code: 'TN1', role: 'FO', state: 'TN', business: 'HDFC', status: 'active', is_active: true },
];
const attendances = [
  { id: '1', employee_code: 'KL1', attendance_date: '2026-07-01', status: 'Completed', total_approved_km: 10, eligible_km: 99, petrol_amount: 40 },
  { id: '2', employee_code: 'KL1', attendance_date: '2026-07-14', status: 'Active', total_approved_km: 20, petrol_amount: 80 },
  { id: '3', employee_code: 'KL2', attendance_date: '2026-07-14', status: 'Completed', total_approved_km: 5, petrol_amount: 25 },
  { id: '4', employee_code: 'TN1', attendance_date: '2026-07-14', status: 'Completed', total_approved_km: 100, petrol_amount: 400 },
];

function summary(overrides = {}) {
  return summarizeOperationsRows({
    actor,
    profiles,
    hierarchyRows: [],
    liveRows: [],
    attendances,
    filters: {
      date_from: '2026-07-01', date_to: '2026-07-14', state: null, business: null, status: null,
      ...overrides,
    },
  });
}

test('KL inclusive date range returns only KL stored totals', () => {
  const result = summary({ state: 'KL' });
  assert.equal(result.payable_km, 35);
  assert.equal(result.petrol_amount, 145);
  assert.equal(result.matching_attendance_count, 3);
});

test('state and business filters combine', () => {
  assert.equal(summary({ state: 'KL', business: 'HDFC' }).payable_km, 30);
});

test('status filters matching attendance rows', () => {
  assert.equal(summary({ state: 'KL', status: 'Active' }).payable_km, 20);
});

test('From and To dates are inclusive and Kolkata-safe date strings', () => {
  const filters = normalizeOperationsSummaryFilters({ date_from: '2026-07-01', date_to: '2026-07-14' }, '2026-07-15');
  assert.equal(filters.date_from, '2026-07-01');
  assert.equal(filters.date_to, '2026-07-14');
  assert.equal(summary().matching_attendance_count, 4);
});

test('reset/default filters restore all authorized totals', () => {
  assert.equal(summary().payable_km, 135);
});

test('restricted Branch Head cannot obtain another state totals', () => {
  const branchHead = { employee_code: 'BH1', role: 'Branch Head', state: 'KL', status: 'active', is_active: true };
  const codes = operationsSummaryAllowedEmployeeCodes(branchHead, profiles, []);
  assert.equal(codes.has('KL1'), true);
  assert.equal(codes.has('KL2'), true);
  assert.equal(codes.has('TN1'), false);
});

test('stored final approved payable value wins without adjustment duplication', () => {
  assert.equal(storedAttendancePayableKm({ total_approved_km: 18, eligible_km: 15, total_route_km: 12 }), 18);
  assert.equal(storedAttendancePayableKm({ total_approved_km: null, eligible_km: 15, total_route_km: 12 }), 15);
});

test('stored petrol wins and rate fallback applies only when stored petrol is absent', () => {
  assert.equal(storedAttendancePetrolAmount({ petrol_amount: 61, rate_per_km: 4 }, 15), 61);
  assert.equal(storedAttendancePetrolAmount({ petrol_amount: null, rate_per_km: 4 }, 15), 60);
  assert.equal(storedAttendancePetrolAmount({ rate_per_km: 4 }, 15), 60);
});

test('inactive and non-operations manager profiles cannot access totals', () => {
  assert.equal(canAccessOperationsSummary({ role: 'Operations Manager', is_active: false }), false);
  assert.equal(canAccessOperationsSummary({ role: 'Manager', department: 'Finance', is_active: true }), false);
  assert.equal(canAccessOperationsSummary({ role: 'Manager', department: 'Operations', is_active: true }), true);
});

test('empty result returns zero totals', () => {
  const result = summary({ state: 'KA' });
  assert.equal(result.payable_km, 0);
  assert.equal(result.petrol_amount, 0);
  assert.equal(result.matching_employee_count, 0);
});
