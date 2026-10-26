import test from 'node:test';
import assert from 'node:assert/strict';
import { storedAttendancePayableKm, storedAttendancePetrolAmount, buildConsolidatedTravelClaimReportDataset } from '../services/operationsSummaryService.js';
import { buildEmployeeRangeDataset, kolkataPeriodBounds } from '../services/employeeRangeReportService.js';
import { overlayRecoveryRows } from '../services/foOctoberRecoveryReportingService.js';

function assertMixedModeReports(row, km, amount) {
  assert.equal(storedAttendancePayableKm(row), km);
  assert.equal(storedAttendancePetrolAmount(row), amount);
  const range = buildEmployeeRangeDataset({ employee: { employee_code: row.employee_code }, period: kolkataPeriodBounds(row.attendance_date, row.attendance_date), attendances: [row] });
  assert.equal(range.period_summary.canonical_payable_km, km);
  assert.equal(range.period_summary.canonical_petrol_amount, amount);
  assert.equal(range.daily_summary[0].payable_km, km);
  assert.equal(range.daily_summary[0].petrol_amount, amount);
  const monthly = buildConsolidatedTravelClaimReportDataset({
    attendances: [row], profiles: [{ id: 'profile', employee_code: row.employee_code, role: 'FO', state: 'KL', is_active: true, status: 'active' }],
    actor: { role: 'Admin', employee_code: 'ADMIN', is_active: true, status: 'active' },
    filters: { date_from: '2026-10-01', date_to: '2026-10-31' },
  });
  assert.equal(monthly.rows[0].total_km_travelled, km);
  assert.equal(monthly.rows[0].distance_reimbursement, amount);
  return range;
}

const canonical = {
  id: 'attendance', employee_code: 'MIXED_FO', attendance_date: '2026-10-13',
  travel_mode: 'train', payable_km_allowed: false, rate_per_km: 0,
  total_approved_km: 6.25, eligible_km: 6.25, total_route_km: 106.25, petrol_amount: 25,
  route_sync_status: 'canonical_v2_incremental_persisted',
  metadata: { shared_km_last_receipt: '12345678-1234-1234-1234-123456789abc' },
};

test('receipt-backed 6.25 Bike KM survives Train day label in daily, monthly and export datasets', () => {
  const range = assertMixedModeReports(canonical, 6.25, 25);
  assert.equal(range.attendance_days[0].metadata.shared_km_last_receipt, canonical.metadata.shared_km_last_receipt);
});

test('Train/Bus/Auto/Other/Unknown do not become payable from route KM or leg-shaped metadata', () => {
  for (const travel_mode of ['train', 'bus', 'auto', 'other', 'unknown']) {
    for (const overrides of [{ metadata: {} }, { route_sync_status: 'pending' }, { metadata: { shared_km_last_receipt: 'invalid' } }]) {
      assertMixedModeReports({ ...canonical, travel_mode, ...overrides }, 0, 0);
    }
    assertMixedModeReports({ ...canonical, travel_mode, total_approved_km: 0, petrol_amount: 0 }, 0, 0);
  }
});

test('mixed rates use persisted segment amount, preserving existing approved baseline', () => {
  // 2 Car KM at 8 + 6.25 Bike KM at 4; no day-level rate multiplication.
  assertMixedModeReports({ ...canonical, total_approved_km: 8.25, petrol_amount: 41, rate_per_km: 99 }, 8.25, 41);
  assertMixedModeReports({ ...canonical, total_approved_km: 16.25, petrol_amount: 65 }, 16.25, 65);
});

test('applied receipts are not added twice; settled supplements retain their separate overlay', () => {
  const receipt = { id: 'credit', employee_code: canonical.employee_code, attendance_date: canonical.attendance_date, status: 'approved', approved_additional_km: 6.25, additional_amount: 25, applied_to_attendance: true };
  assertMixedModeReports(overlayRecoveryRows([canonical], [receipt, receipt])[0], 6.25, 25);
  const supplement = { ...receipt, id: 'settled', applied_to_attendance: false };
  const row = overlayRecoveryRows([canonical], [receipt, supplement, supplement])[0];
  assert.equal(storedAttendancePayableKm(row), 12.5);
  assert.equal(storedAttendancePetrolAmount(row), 50);
});

test('incomplete canonical totals never derive petrol from final day mode', () => {
  for (const overrides of [{ petrol_amount: null }, { total_approved_km: null }, { petrol_amount: 'NaN' }, { total_approved_km: -1 }]) {
    assert.equal(storedAttendancePayableKm({ ...canonical, ...overrides }), 0);
    assert.equal(storedAttendancePetrolAmount({ ...canonical, ...overrides }), 0);
  }
});
