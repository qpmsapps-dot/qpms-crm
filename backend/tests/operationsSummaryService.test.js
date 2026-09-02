import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildOperationsSummary,
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

test('normal payable Bike attendance contributes stored KM and petrol', () => {
  const result = summarizeOperationsRows({
    actor,
    profiles: [
      { employee_code: 'BIKE1', role: 'FO', state: 'KA', business: 'OPS', status: 'active', is_active: true },
    ],
    hierarchyRows: [],
    liveRows: [],
    attendances: [
      {
        employee_code: 'BIKE1',
        attendance_date: '2026-08-10',
        status: 'Completed',
        travel_mode: 'bike',
        payable_km_allowed: true,
        total_approved_km: 42.5,
        eligible_km: 42.5,
        total_route_km: 50,
        petrol_amount: 170,
        rate_per_km: 4,
      },
    ],
    filters: { date_from: '2026-08-01', date_to: '2026-08-31', state: null, business: null, status: null },
  });

  assert.equal(result.payable_km, 42.5);
  assert.equal(result.petrol_amount, 170);
});

test('normal payable Car attendance contributes stored KM and petrol', () => {
  const result = summarizeOperationsRows({
    actor,
    profiles: [
      { employee_code: 'CAR1', role: 'KAM', state: 'KA', business: 'OPS', status: 'active', is_active: true },
    ],
    hierarchyRows: [],
    liveRows: [],
    attendances: [
      {
        employee_code: 'CAR1',
        attendance_date: '2026-08-10',
        status: 'Completed',
        travel_mode: 'car',
        payable_km_allowed: true,
        total_approved_km: 20,
        eligible_km: 20,
        total_route_km: 20,
        petrol_amount: 160,
        rate_per_km: 8,
      },
    ],
    filters: { date_from: '2026-08-01', date_to: '2026-08-31', state: null, business: null, status: null },
  });

  assert.equal(result.payable_km, 20);
  assert.equal(result.petrol_amount, 160);
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
  assert.equal(storedAttendancePetrolAmount({ petrol_amount: 0, rate_per_km: 4 }, 15), 0);
  assert.equal(storedAttendancePetrolAmount({ petrol_amount: null, rate_per_km: 4 }, 15), 60);
  assert.equal(storedAttendancePetrolAmount({ rate_per_km: 4 }, 15), 60);
});

test('payable_km_allowed=false contributes zero even with historical route KM and metadata', () => {
  const row = {
    payable_km_allowed: false,
    total_approved_km: 0,
    eligible_km: 0,
    total_route_km: 117,
    petrol_amount: 0,
    rate_per_km: 4,
    metadata: {
      shared_travel_adjustment: true,
      shared_travel_original_km: 117,
      shared_travel_original_amount: 468,
    },
  };

  assert.equal(storedAttendancePayableKm(row), 0);
  assert.equal(storedAttendancePetrolAmount(row), 0);
});

test('travel-leg-shaped metadata does not override attendance non-payable state', () => {
  const result = summarizeOperationsRows({
    actor,
    profiles: [
      { employee_code: 'PASSENGER1', role: 'FO', state: 'KA', business: 'OPS', status: 'active', is_active: true },
    ],
    hierarchyRows: [],
    liveRows: [],
    attendances: [
      {
        employee_code: 'PASSENGER1',
        attendance_date: '2026-08-22',
        status: 'Completed',
        payable_km_allowed: false,
        total_approved_km: 0,
        eligible_km: 0,
        total_route_km: 117,
        petrol_amount: 0,
        rate_per_km: 4,
        metadata: {
          shared_travel_adjustment: true,
          shared_travel_original_km: 117,
          shared_travel_original_amount: 468,
          travel_legs: [{ payable_km: 117, payable_amount: 468 }],
        },
      },
    ],
    filters: { date_from: '2026-08-01', date_to: '2026-08-31', state: null, business: null, status: null },
  });

  assert.equal(result.payable_km, 0);
  assert.equal(result.petrol_amount, 0);
});

test('mixed date state business status summary uses canonical attendance payable fields', () => {
  const result = summarizeOperationsRows({
    actor,
    profiles: [
      { employee_code: 'KA1', role: 'FO', state: 'KA', business: 'OPS', status: 'active', is_active: true },
      { employee_code: 'KA2', role: 'FO', state: 'KA', business: 'OPS', status: 'active', is_active: true },
      { employee_code: 'TN2', role: 'FO', state: 'TN', business: 'OPS', status: 'active', is_active: true },
    ],
    hierarchyRows: [],
    liveRows: [],
    attendances: [
      { employee_code: 'KA1', attendance_date: '2026-08-10', status: 'Active', total_approved_km: 10, petrol_amount: 40, payable_km_allowed: true },
      { employee_code: 'KA2', attendance_date: '2026-08-10', status: 'Active', total_approved_km: 0, eligible_km: 0, total_route_km: 80, petrol_amount: 0, rate_per_km: 4, payable_km_allowed: false },
      { employee_code: 'KA1', attendance_date: '2026-09-01', status: 'Active', total_approved_km: 90, petrol_amount: 360, payable_km_allowed: true },
      { employee_code: 'TN2', attendance_date: '2026-08-10', status: 'Active', total_approved_km: 30, petrol_amount: 120, payable_km_allowed: true },
      { employee_code: 'KA1', attendance_date: '2026-08-11', status: 'Completed', total_approved_km: 50, petrol_amount: 200, payable_km_allowed: true },
    ],
    filters: { date_from: '2026-08-01', date_to: '2026-08-31', state: 'KA', business: 'OPS', status: 'Active' },
  });

  assert.equal(result.payable_km, 10);
  assert.equal(result.petrol_amount, 40);
  assert.equal(result.matching_attendance_count, 2);
  assert.equal(result.matching_employee_count, 2);
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

test('DEMO_ADMIN can read all approved operations summary totals', () => {
  const demoActor = { role: 'DEMO_ADMIN', status: 'active', is_active: true, is_demo: true, read_only: true };
  assert.equal(canAccessOperationsSummary(demoActor), true);
  const result = summarizeOperationsRows({
    actor: demoActor,
    profiles,
    hierarchyRows: [],
    liveRows: [],
    attendances,
    filters: {
      date_from: '2026-07-01', date_to: '2026-07-14', state: null, business: null, status: null,
    },
  });
  assert.equal(result.payable_km, 135);
  assert.equal(result.petrol_amount, 545);
});

test('TENDER_DEMO is normalized as a full-visibility read actor', () => {
  const demoActor = { role: 'TENDER_DEMO', status: 'active', is_active: true, is_demo: true, read_only: true };
  const codes = operationsSummaryAllowedEmployeeCodes(demoActor, profiles, []);
  assert.equal(codes.has('KL1'), true);
  assert.equal(codes.has('KL2'), true);
  assert.equal(codes.has('TN1'), true);
});

test('live status resolves profile id to employee code using current_status', () => {
  const result = summarizeOperationsRows({
    actor,
    profiles: [
      { id: 'profile-kl1', employee_code: 'KL1', role: 'FO', state: 'KL', business: 'HDFC', status: 'active', is_active: true },
    ],
    hierarchyRows: [],
    liveRows: [
      { fo_user_id: 'profile-kl1', current_status: 'On Travel', is_tracking: true, active_site_visit_id: null },
    ],
    attendances: [
      { employee_code: 'KL1', attendance_date: '2026-07-14', status: 'Active', total_approved_km: 20, petrol_amount: 80 },
    ],
    filters: {
      date_from: '2026-07-14', date_to: '2026-07-14', state: 'KL', business: null, status: 'ON_TRAVEL',
    },
  });
  assert.equal(result.matching_attendance_count, 1);
  assert.equal(result.payable_km, 20);
});

test('live status query uses fo_user_id and never selects missing employee_code or status columns', async () => {
  const selections = new Map();
  const inFilters = new Map();
  const rowsByTable = {
    profiles: [
      { id: 'profile-kl1', employee_code: 'KL1', role: 'FO', state: 'KL', business: 'HDFC', status: 'active', is_active: true },
    ],
    employee_hierarchy: [],
    fo_attendance: [],
    fo_live_status: [],
  };
  const client = {
    from(table) {
      const queryBuilder = {
        select(columns) {
          selections.set(table, columns);
          return queryBuilder;
        },
        eq() { return queryBuilder; },
        gte() { return queryBuilder; },
        lte() { return queryBuilder; },
        order() { return queryBuilder; },
        in(column, values) {
          inFilters.set(table, { column, values });
          return queryBuilder;
        },
        async range() {
          return { data: rowsByTable[table] || [], error: null };
        },
      };
      return queryBuilder;
    },
  };

  const result = await buildOperationsSummary(client, actor, {
    date_from: '2026-07-14', date_to: '2026-07-14', state: 'All States', business: 'All Business', status: 'All Status',
  }, '2026-07-14');

  const liveSelection = selections.get('fo_live_status');
  assert.match(selections.get('fo_attendance'), /payable_km_allowed/);
  assert.equal(liveSelection, 'fo_user_id,current_status,is_tracking,active_site_visit_id');
  assert.doesNotMatch(liveSelection, /(^|,)employee_code(,|$)/);
  assert.doesNotMatch(liveSelection, /(^|,)status(,|$)/);
  assert.deepEqual(inFilters.get('fo_live_status'), {
    column: 'fo_user_id',
    values: ['profile-kl1', 'KL1'],
  });
  assert.equal(result.payable_km, 0);
  assert.equal(result.petrol_amount, 0);
  assert.equal(result.matching_attendance_count, 0);
});
