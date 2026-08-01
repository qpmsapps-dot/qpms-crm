import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  buildConsolidatedTravelClaimReport,
  buildConsolidatedTravelClaimReportDataset,
  classifyTravelClaim,
} from '../services/operationsSummaryService.js';
import {
  buildConsolidatedTravelClaimPdf,
  consolidatedTravelClaimPdfFilename,
} from '../services/consolidatedTravelClaimPdfService.js';

const admin = { employee_code: 'ADMIN1', role: 'Admin', status: 'active', is_active: true, full_name: 'Admin User' };
const branchHead = { employee_code: 'BH-KL', role: 'Branch Head', state: 'KL', business: 'HDFC', status: 'active', is_active: true };
const profiles = [
  { id: 'p-bike', employee_code: 'BIKE1', full_name: 'Bike Employee', role: 'FO', state: 'KL', business: 'HDFC', status: 'active', is_active: true },
  { id: 'p-train', employee_code: 'TRAIN1', full_name: 'Train Employee', role: 'FO', state: 'KL', business: 'HDFC', status: 'active', is_active: true },
  { id: 'p-mix', employee_code: 'MIX1', full_name: 'Mixed Employee', role: 'FO', state: 'KL', business: 'HDFC', status: 'active', is_active: true },
  { id: 'p-tn', employee_code: 'TN1', full_name: 'Tamil Nadu Employee', role: 'FO', state: 'TN', business: 'HDFC', status: 'active', is_active: true },
  { id: 'p-jio', employee_code: 'JIO1', full_name: 'Jio Employee', role: 'FO', state: 'KL', business: 'JIO', status: 'active', is_active: true },
];
const hierarchyRows = [
  { employee_code: 'BIKE1', manager_employee_code: 'BH-KL', is_active: true },
  { employee_code: 'TRAIN1', manager_employee_code: 'BH-KL', is_active: true },
  { employee_code: 'MIX1', manager_employee_code: 'BH-KL', is_active: true },
  { employee_code: 'JIO1', manager_employee_code: 'OTHER-BH', is_active: true },
];

function attendance(id, employeeCode, date, km, petrolAmount, overrides = {}) {
  return {
    id,
    employee_code: employeeCode,
    display_name: `${employeeCode} Name`,
    attendance_date: date,
    status: 'Completed',
    logout_time: `${date}T12:30:00.000Z`,
    travel_mode: 'bike',
    rate_per_km: 4,
    total_approved_km: km,
    eligible_km: 999,
    actual_km: 777,
    petrol_amount: petrolAmount,
    ...overrides,
  };
}

function claim(id, attendanceId, amount, overrides = {}) {
  return {
    id,
    attendance_id: attendanceId,
    employee_code: overrides.employee_code || null,
    travel_mode: overrides.travel_mode || 'train',
    fare_amount: amount,
    status: overrides.status || 'approved',
    claim_type: overrides.claim_type ?? 'transport',
    remarks: overrides.remarks || '',
    created_at: overrides.created_at || '2026-08-01T08:00:00.000Z',
    ...overrides,
  };
}

function dataset(overrides = {}) {
  return buildConsolidatedTravelClaimReportDataset({
    actor: admin,
    profiles,
    hierarchyRows,
    liveRows: [],
    attendances: [
      attendance('a-bike-1', 'BIKE1', '2026-08-01', 10, 40),
      attendance('a-bike-2', 'BIKE1', '2026-08-02', 5, 20),
      attendance('a-train-1', 'TRAIN1', '2026-08-01', 0, 0, { travel_mode: 'train', rate_per_km: 0, eligible_km: 0 }),
      attendance('a-mix-1', 'MIX1', '2026-08-01', 8, 32),
      attendance('a-tn-1', 'TN1', '2026-08-01', 100, 400),
      attendance('a-jio-1', 'JIO1', '2026-08-01', 7, 28),
    ],
    claims: [
      claim('c-train', 'a-train-1', 250, { travel_mode: 'train' }),
      claim('c-mix-train', 'a-mix-1', 100, { travel_mode: 'train' }),
      claim('c-mix-bus', 'a-mix-1', 60, { travel_mode: 'bus', sequence: 2 }),
      claim('c-mix-auto', 'a-mix-1', 40, { travel_mode: 'auto', sequence: 3 }),
      claim('c-mix-parking', 'a-mix-1', 30, { claim_type: 'parking', remarks: 'Parking receipt', sequence: 4 }),
      claim('c-tn', 'a-tn-1', 80),
      claim('c-jio', 'a-jio-1', 90),
    ],
    filters: { date_from: '2026-08-01', date_to: '2026-08-31', state: null, business: null, status: null },
    generatedBy: admin,
    generatedAt: new Date('2026-08-31T10:00:00.000Z'),
    ...overrides,
  });
}

test('bike-only attendance produces distance reimbursement without other transport', () => {
  const report = dataset({ filters: { date_from: '2026-08-01', date_to: '2026-08-31', state: 'KL', business: 'HDFC', status: null } });
  const row = report.rows.find((item) => item.employee_code === 'BIKE1');
  assert.equal(row.total_km_travelled, 15);
  assert.equal(row.distance_reimbursement, 60);
  assert.equal(row.other_transport_mode_amount, 0);
  assert.equal(row.total_claim, 60);
});

test('train-only claim contributes other transport and zero kilometers', () => {
  const row = dataset().rows.find((item) => item.employee_code === 'TRAIN1');
  assert.equal(row.total_km_travelled, 0);
  assert.equal(row.distance_reimbursement, 0);
  assert.equal(row.other_transport_mode_amount, 250);
  assert.equal(row.total_claim, 250);
});

test('bike plus train and parking consolidate into one employee row', () => {
  const row = dataset().rows.find((item) => item.employee_code === 'MIX1');
  assert.equal(row.total_km_travelled, 8);
  assert.equal(row.distance_reimbursement, 32);
  assert.equal(row.other_transport_mode_amount, 200);
  assert.equal(row.parking_amount, 30);
  assert.equal(row.total_claim, 262);
});

test('multiple attendance days consolidate by employee_code', () => {
  const row = dataset().rows.find((item) => item.employee_code === 'BIKE1');
  assert.equal(row.attendance_count, 2);
  assert.equal(dataset().rows.filter((item) => item.employee_code === 'BIKE1').length, 1);
});

test('multiple claims attached to one attendance do not duplicate petrol amount', () => {
  const row = dataset().rows.find((item) => item.employee_code === 'MIX1');
  assert.equal(row.distance_reimbursement, 32);
  assert.equal(row.other_transport_mode_amount, 200);
  assert.equal(row.parking_amount, 30);
});

test('parking classification uses claim_type and legacy remarks fallback', () => {
  assert.equal(classifyTravelClaim({ claim_type: 'parking', remarks: '' }), 'parking');
  assert.equal(classifyTravelClaim({ claim_type: null, remarks: 'airport Parking bill' }), 'parking');
  assert.equal(classifyTravelClaim({ claim_type: null, remarks: 'train fare' }), 'transport');
});

test('state business and status filters are applied', () => {
  const report = dataset({
    filters: { date_from: '2026-08-01', date_to: '2026-08-31', state: 'KL', business: 'HDFC', status: 'ENDED' },
  });
  assert.deepEqual(report.rows.map((row) => row.employee_code).sort(), ['BIKE1', 'MIX1', 'TRAIN1']);
});

test('state and business restrictions are enforced by actor scope', () => {
  const report = dataset({
    actor: branchHead,
    filters: { date_from: '2026-08-01', date_to: '2026-08-31', state: null, business: null, status: null },
  });
  assert.equal(report.rows.some((row) => row.employee_code === 'TN1'), false);
  assert.equal(report.rows.some((row) => row.employee_code === 'JIO1'), false);
  assert.equal(report.rows.some((row) => row.employee_code === 'BIKE1'), true);
});

test('empty result and grand totals are safe', () => {
  const report = dataset({
    filters: { date_from: '2026-08-01', date_to: '2026-08-31', state: 'KA', business: null, status: null },
  });
  assert.equal(report.rows.length, 0);
  assert.equal(report.totals.employee_count, 0);
  assert.equal(report.totals.total_claim, 0);
});

test('grand totals match row totals', () => {
  const report = dataset();
  const totalClaim = report.rows.reduce((sum, row) => sum + row.total_claim, 0);
  assert.equal(report.totals.total_claim, totalClaim);
  assert.equal(
    report.totals.total_claim,
    report.totals.distance_reimbursement + report.totals.other_transport_mode_amount + report.totals.parking_amount,
  );
});

function mockClient(rowsByTable) {
  return {
    from(table) {
      const query = {
        select() { return query; },
        eq() { return query; },
        gte() { return query; },
        lte() { return query; },
        in() { return query; },
        order() { return query; },
        async range(from, to) {
          return { data: (rowsByTable[table] || []).slice(from, to + 1), error: null };
        },
      };
      return query;
    },
  };
}

test('service loads authorized rows and generates a PDF buffer', async () => {
  const client = mockClient({
    profiles,
    employee_hierarchy: hierarchyRows,
    fo_live_status: [],
    fo_attendance: [attendance('a-bike-1', 'BIKE1', '2026-08-01', 10, 40)],
    fo_travel_expense_claims: [claim('c-bus', 'a-bike-1', 70, { travel_mode: 'bus' })],
  });
  const result = await buildConsolidatedTravelClaimPdf(client, admin, {
    date_from: '2026-08-01',
    date_to: '2026-08-31',
    state: 'All States',
    business: 'All Business',
    status: 'All Status',
  }, '2026-08-31');
  assert.equal(result.dataset.rows[0].total_claim, 110);
  assert.equal(result.buffer.subarray(0, 4).toString(), '%PDF');
  assert.equal(result.filename, 'QPMS_Consolidated_Travel_Claims_2026_08_01_to_2026_08_31.pdf');
});

test('empty PDF endpoint result rejects with structured no-data error', async () => {
  const client = mockClient({
    profiles,
    employee_hierarchy: hierarchyRows,
    fo_live_status: [],
    fo_attendance: [],
    fo_travel_expense_claims: [],
  });
  await assert.rejects(
    buildConsolidatedTravelClaimPdf(client, admin, {
      date_from: '2026-08-01',
      date_to: '2026-08-31',
    }, '2026-08-31'),
    (error) => error.statusCode === 404 && error.code === 'NO_TRAVEL_CLAIM_DATA',
  );
});

test('unauthorized actor is rejected', async () => {
  await assert.rejects(
    buildConsolidatedTravelClaimReport(mockClient({}), { role: 'Finance', is_active: true }, {
      date_from: '2026-08-01',
      date_to: '2026-08-31',
    }, '2026-08-31'),
    (error) => error.statusCode === 403,
  );
});

test('PDF route requires Supabase authentication and Excel export remains in the web page', async () => {
  const [serverSource, pageSource] = await Promise.all([
    readFile(new URL('../server.js', import.meta.url), 'utf8'),
    readFile(new URL('../../src/pages/FOActivities.jsx', import.meta.url), 'utf8'),
  ]);
  assert.match(serverSource, /app\.get\('\/api\/fo\/reports\/consolidated-travel-claims\/pdf', requireSupabaseJwt,/);
  assert.match(pageSource, /Export Excel/);
  assert.match(pageSource, /Export Travel Claim PDF/);
});

test('PDF filename uses the report period', () => {
  assert.equal(
    consolidatedTravelClaimPdfFilename({ date_from: '2026-08-01', date_to: '2026-08-31' }),
    'QPMS_Consolidated_Travel_Claims_2026_08_01_to_2026_08_31.pdf',
  );
});

test('migration backfills only null claim_type values using parking remarks fallback', async () => {
  const sql = await readFile(
    new URL('../../supabase/migrations_2_0/040_backfill_travel_claim_type_for_pdf_report.sql', import.meta.url),
    'utf8',
  );
  assert.match(sql, /where claim_type is null/i);
  assert.match(sql, /lower\(coalesce\(remarks, ''\)\) like '%parking%'/i);
  assert.match(sql, /then 'parking'/i);
  assert.match(sql, /else 'transport'/i);
});
