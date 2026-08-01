import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PDFParse } from 'pdf-parse';
import {
  buildConsolidatedTravelClaimReport,
  buildConsolidatedTravelClaimReportDataset,
  classifyTravelClaim,
  normalizeTravelClaimReportState,
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

test('state aliases normalize without splitting KL Kerala and preserve AP split conventions', () => {
  assert.deepEqual(normalizeTravelClaimReportState('KL'), {
    state_name: 'Kerala',
    state_code: 'KL',
    state_key: 'KL',
  });
  assert.deepEqual(normalizeTravelClaimReportState('Kerala'), {
    state_name: 'Kerala',
    state_code: 'KL',
    state_key: 'KL',
  });
  assert.deepEqual(normalizeTravelClaimReportState('TG'), {
    state_name: 'Telangana',
    state_code: 'TG',
    state_key: 'TG',
  });
  assert.deepEqual(normalizeTravelClaimReportState('AP-1'), {
    state_name: 'AP-1',
    state_code: 'AP-1',
    state_key: 'AP-1',
  });
});

test('multiple states produce sorted sections with one employee row per state employee', () => {
  const report = buildConsolidatedTravelClaimReportDataset({
    actor: admin,
    profiles: [
      { employee_code: 'KL-A', full_name: 'Able Kerala', role: 'FO', state: 'KL', business: 'HDFC', status: 'active', is_active: true },
      { employee_code: 'KL-B', full_name: 'Beta Kerala', role: 'FO', state: 'Kerala', business: 'HDFC', status: 'active', is_active: true },
      { employee_code: 'TN-A', full_name: 'Alpha Tamil', role: 'FO', state: 'Tamil Nadu', business: 'HDFC', status: 'active', is_active: true },
      { employee_code: 'TG-A', full_name: 'Alpha Telangana', role: 'FO', state: 'TG', business: 'HDFC', status: 'active', is_active: true },
    ],
    hierarchyRows: [],
    liveRows: [],
    attendances: [
      attendance('a-kl-a-1', 'KL-A', '2026-08-01', 10, 40),
      attendance('a-kl-a-2', 'KL-A', '2026-08-02', 5, 20),
      attendance('a-kl-b-1', 'KL-B', '2026-08-01', 3, 12),
      attendance('a-tn-a-1', 'TN-A', '2026-08-01', 7, 28),
      attendance('a-tg-a-1', 'TG-A', '2026-08-01', 4, 16),
    ],
    claims: [
      claim('c-kl-a', 'a-kl-a-1', 50),
      claim('c-kl-b', 'a-kl-b-1', 25, { claim_type: 'parking', remarks: 'parking' }),
      claim('c-tn-a', 'a-tn-a-1', 70),
      claim('c-tg-a', 'a-tg-a-1', 15),
    ],
    filters: { date_from: '2026-08-01', date_to: '2026-08-31', state: null, business: 'HDFC', status: null },
    generatedBy: admin,
    generatedAt: new Date('2026-08-31T10:00:00.000Z'),
  });
  assert.deepEqual(report.state_sections.map((section) => section.state_name), ['Kerala', 'Tamil Nadu', 'Telangana']);
  const kerala = report.state_sections.find((section) => section.state_code === 'KL');
  assert.deepEqual(kerala.rows.map((row) => row.employee_code), ['KL-A', 'KL-B']);
  assert.equal(new Set(report.rows.map((row) => row.employee_code)).size, report.rows.length);
  assert.equal(kerala.totals.employee_count, 2);
  assert.equal(kerala.totals.total_km_travelled, 18);
  assert.equal(kerala.totals.distance_reimbursement, 72);
  assert.equal(kerala.totals.other_transport_mode_amount, 50);
  assert.equal(kerala.totals.parking_amount, 25);
  assert.equal(kerala.totals.total_claim, 147);
  const sectionTotalClaim = report.state_sections.reduce((sum, section) => sum + section.totals.total_claim, 0);
  assert.equal(report.totals.total_claim, sectionTotalClaim);
});

test('selected state filter uses normalized state convention', () => {
  const report = buildConsolidatedTravelClaimReportDataset({
    actor: admin,
    profiles: [
      { employee_code: 'KL-A', full_name: 'Able Kerala', role: 'FO', state: 'Kerala', business: 'HDFC', status: 'active', is_active: true },
      { employee_code: 'TN-A', full_name: 'Alpha Tamil', role: 'FO', state: 'TN', business: 'HDFC', status: 'active', is_active: true },
    ],
    hierarchyRows: [],
    liveRows: [],
    attendances: [
      attendance('a-kl-a-1', 'KL-A', '2026-08-01', 10, 40),
      attendance('a-tn-a-1', 'TN-A', '2026-08-01', 7, 28),
    ],
    claims: [],
    filters: { date_from: '2026-08-01', date_to: '2026-08-31', state: 'KL', business: null, status: null },
    generatedBy: admin,
    generatedAt: new Date('2026-08-31T10:00:00.000Z'),
  });
  assert.deepEqual(report.state_sections.map((section) => section.state_code), ['KL']);
  assert.deepEqual(report.rows.map((row) => row.employee_code), ['KL-A']);
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

async function extractPdfPages(buffer) {
  const infoParser = new PDFParse({ data: buffer });
  const info = await infoParser.getInfo({ parsePageInfo: true });
  await infoParser.destroy();
  const pages = [];
  for (let page = 1; page <= info.total; page += 1) {
    const parser = new PDFParse({ data: buffer });
    const extracted = await parser.getText({ partial: [page] });
    await parser.destroy();
    pages.push(extracted.text);
  }
  return { total: info.total, pages };
}

function travelClaimRowsForState(state, count) {
  const profileRows = [];
  const attendanceRows = [];
  const claimRows = [];
  for (let index = 1; index <= count; index += 1) {
    const suffix = String(index).padStart(2, '0');
    const employeeCode = `${state}-${suffix}`;
    profileRows.push({
      id: `p-${employeeCode}`,
      employee_code: employeeCode,
      full_name: `${state} Employee ${suffix}`,
      role: 'FO',
      state,
      business: 'HDFC',
      status: 'active',
      is_active: true,
    });
    attendanceRows.push(attendance(`a-${employeeCode}`, employeeCode, '2026-07-15', 10 + index, 40 + index));
    claimRows.push(claim(`c-${employeeCode}`, `a-${employeeCode}`, 20 + index, { travel_mode: 'bus' }));
  }
  return { profileRows, attendanceRows, claimRows };
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

test('PDF text extraction preserves rupee symbol and does not render currency as ¹', async () => {
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
  const parser = new PDFParse({ data: result.buffer });
  const extracted = await parser.getText();
  await parser.destroy();
  assert.match(extracted.text, /₹\s*40\.00/);
  assert.match(extracted.text, /₹\s*110\.00/);
  assert.doesNotMatch(extracted.text, /¹\s*(40|110)\.00/);
});

test('PDF creates one page per state section plus final all-state summary page', async () => {
  const source = await readFile(
    new URL('../services/consolidatedTravelClaimPdfService.js', import.meta.url),
    'utf8',
  );
  const client = mockClient({
    profiles: [
      { id: 'p-kl', employee_code: 'KL-A', full_name: 'Able Kerala', role: 'FO', state: 'KL', business: 'HDFC', status: 'active', is_active: true },
      { id: 'p-tn', employee_code: 'TN-A', full_name: 'Alpha Tamil', role: 'FO', state: 'TN', business: 'HDFC', status: 'active', is_active: true },
    ],
    employee_hierarchy: [],
    fo_live_status: [],
    fo_attendance: [
      attendance('a-kl-a-1', 'KL-A', '2026-08-01', 10, 40),
      attendance('a-tn-a-1', 'TN-A', '2026-08-01', 7, 28),
    ],
    fo_travel_expense_claims: [
      claim('c-kl-a', 'a-kl-a-1', 50),
      claim('c-tn-a', 'a-tn-a-1', 70),
    ],
  });
  const result = await buildConsolidatedTravelClaimPdf(client, admin, {
    date_from: '2026-08-01',
    date_to: '2026-08-31',
    state: 'All States',
    business: 'All Business',
    status: 'All Status',
  }, '2026-08-31');
  assert.equal(result.dataset.state_sections.length, 2);
  assert.match(source, /dataset\.state_sections\.forEach\(\(section, index\) => \{[\s\S]*?if \(index > 0\) \{[\s\S]*?doc\.addPage\(\);/);
  assert.match(source, /doc\.addPage\(\);\s*drawAllStateSummary\(doc, dataset, fontName, rupeeFontName\);/);
  assert.equal(result.buffer.subarray(0, 4).toString(), '%PDF');
  assert.equal(result.dataset.totals.total_claim, 188);
});

test('PDF compact layout keeps small states and totals together without removed header metadata', async () => {
  const stateData = [
    travelClaimRowsForState('AP', 8),
    travelClaimRowsForState('KA', 8),
    travelClaimRowsForState('KL', 8),
    travelClaimRowsForState('TG', 8),
    travelClaimRowsForState('TN', 32),
  ];
  const client = mockClient({
    profiles: stateData.flatMap((item) => item.profileRows),
    employee_hierarchy: [],
    fo_live_status: [],
    fo_attendance: stateData.flatMap((item) => item.attendanceRows),
    fo_travel_expense_claims: stateData.flatMap((item) => item.claimRows),
  });
  const result = await buildConsolidatedTravelClaimPdf(client, admin, {
    date_from: '2026-07-01',
    date_to: '2026-07-31',
    state: 'All States',
    business: 'All Business',
    status: 'All Status',
  }, '2026-07-31');
  const { total, pages } = await extractPdfPages(result.buffer);
  const fullText = pages.join('\n');

  assert.equal(result.dataset.state_sections.length, 5);
  assert.ok(total < 16);
  assert.ok(total <= 8, `expected compact PDF to be 8 pages or fewer, got ${total}`);
  assert.doesNotMatch(fullText, /Generated By:/);
  assert.doesNotMatch(fullText, /Generated At:/);
  assert.doesNotMatch(fullText, /Claim Statuses Included:/);
  assert.equal(result.dataset.totals.total_claim, result.dataset.rows.reduce((sum, row) => sum + row.total_claim, 0));

  for (const stateName of ['Andhra Pradesh', 'Karnataka', 'Kerala', 'Telangana']) {
    const statePages = pages.filter((pageText) => pageText.includes(`State: ${stateName}`));
    assert.equal(statePages.length, 1, `${stateName} should fit on one page`);
    assert.match(statePages[0], /State Total/);
  }

  const tamilPages = pages.filter((pageText) => pageText.includes('State: Tamil Nadu'));
  assert.ok(tamilPages.length <= 2);
  assert.ok(tamilPages.some((pageText) => pageText.includes('Continued')) || tamilPages.length === 1);

  pages.forEach((pageText) => {
    assert.ok(pageText.trim().length > 20, 'blank page detected');
    if (pageText.includes('State Total') && !pageText.includes('All-State Consolidated Summary')) {
      assert.match(pageText, /\b(AP|KA|KL|TG|TN)-\d{2}\b/, 'state total page must include at least one employee row');
    }
  });
  assert.match(pages.at(-1), /All-State Consolidated Summary/);
  assert.match(pages.at(-1), /Grand Total/);
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

test('attendance query uses only real fo_attendance columns', async () => {
  const source = await readFile(
    new URL('../services/operationsSummaryService.js', import.meta.url),
    'utf8',
  );
  assert.match(source, /from\('fo_attendance'\)[\s\S]*?\.select\('id,fo_user_id,employee_code,display_name,username,attendance_date,status,logout_time,total_approved_km,eligible_km,total_route_km,actual_km,petrol_amount,rate_per_km,travel_mode'\)/);
  assert.doesNotMatch(source, /fo_attendance'[\s\S]*?\.select\('[^']*full_name/);
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
