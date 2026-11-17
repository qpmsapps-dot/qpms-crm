import { test, expect } from '@playwright/test';
import ExcelJS from 'exceljs';
import { indiaToday } from '../../backend/shared/retailAttendance.js';

// Synthetic responses only: validates the actual HK-MIS route, not production credentials.
const today = indiaToday();
const monthStart = today.slice(0, 7) + '-01';
const permittedStore = { id: 'tn-store', store_code: 'TN100', store_name: 'Synthetic TN Store', state: 'TN' };
const attendance = {
  rows: [{ retail_store_id: 'tn-store', attendance_date: today, class: 'HK', credit: 1 }],
  stores: [permittedStore],
  aop: [{ retail_store_id: 'tn-store', effective_from: monthStart, effective_to: null, hk_count: 2, mepc_count: 0 }],
  summary: {
    cutoff: today,
    total: { hk_pct: null, hk_actual: 1, hk_target: 2, complete: false },
    stores: [{ ...permittedStore, hk_actual: 1, hk_target: 2, hk_pct: null, complete: false }],
  },
};
const training = {
  counts: { completed_sessions: 1 },
  rows: [{ id: 'training-tn-1', store_code: 'TN100', store_name: 'Synthetic TN Store',
    state: 'TN', training_date: today, topic_names: ['Housekeeping'], trainer_name_snapshot: 'Trainer',
    status: 'submitted' }],
  evidence: [],
};
const cleaning = {
  rows: [{ id: 'cleaning-tn-1', store_code: 'TN100', store_name: 'Synthetic TN Store',
    state: 'TN', deep_cleaning_date: today, status: 'submitted', source_kind: 'independent' }],
  evidence: [],
};
const operations = {
  date: today, states: ['TN'], read_only: true, location_type: 'last_known',
  officers: [{ employee_code: 'FO-TN-01', name: 'Synthetic TN FO', state: 'TN', active_today: true,
    online: true, day_status: 'Active Today', start_time: today + 'T09:00:00+05:30',
    end_time: null, last_seen_at: today + 'T09:30:00+05:30',
    latitude: 13.05, longitude: 80.2, visited_count: 1,
    visits: [{ site_name: 'Synthetic TN Store', site_code: 'TN100',
      check_in_time: today + 'T09:30:00+05:30', check_out_time: null, status: 'Checked In' }] }],
};
async function seed(page, states = ['TN']) {
  const requests = [];
  await page.addInitScript(() => {
    localStorage.setItem('qpms-crm-auth-user', JSON.stringify({
      id: 'synthetic-hk', profileId: 'synthetic-hk-profile', name: 'Synthetic HK MIS',
      role: 'MIS_HK', rawRole: 'MIS_HK', business: 'Reliance Retail',
      status: 'Active', isActive: true, webAccessEnabled: true,
      authProvider: 'demo-fixture', is_demo: true, isDemoReadOnly: true, read_only: false,
    }));
    sessionStorage.setItem('qpms-crm-backend-token', 'synthetic-local-test-token');
  });
  await page.route('**/api/**', route => {
    const req = route.request(), url = new URL(req.url());
    requests.push({ method: req.method(), path: url.pathname, state: url.searchParams.get('state') });
    if (req.method() !== 'GET') throw Error('HK MIS attempted a mutation: ' + req.method() + ' ' + url.pathname);
    if (url.pathname.endsWith('/mis/access')) return route.fulfill({ json: {
      result: { role: 'MIS_HK', active: true, states, modules: ['dashboard', 'operations', 'attendance-hk', 'training-hk', 'cleaning'] },
    }});
    if (url.pathname.endsWith('/mis/hk-operations')) return route.fulfill({ json: { result: operations } });
    if (url.pathname.endsWith('/mis/report/attendance-hk')) return route.fulfill({
      status: states.includes(url.searchParams.get('state')) ? 200 : 403,
      json: states.includes(url.searchParams.get('state')) ? { result: attendance } : { message: 'Outside assigned state.' },
    });
    if (url.pathname.endsWith('/mis/report/training-hk')) return route.fulfill({
      status: states.includes(url.searchParams.get('state')) ? 200 : 403,
      json: states.includes(url.searchParams.get('state')) ? { result: training } : { message: 'Outside assigned state.' },
    });
    if (url.pathname.endsWith('/mis/report/cleaning')) return route.fulfill({
      status: states.includes(url.searchParams.get('state')) ? 200 : 403,
      json: states.includes(url.searchParams.get('state')) ? { result: cleaning } : { message: 'Outside assigned state.' },
    });
    return route.fulfill({ json: { result: {} } });
  });
  return requests;
}
test('HK MIS sees only the five Reliance Retail pages, reports and nonfinancial FO operations', async ({ page }) => {
  const requests = await seed(page);
  await page.goto('/reliance-retail/mis/dashboard');
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  const nav = page.locator('aside nav');
  for (const title of ['Dashboard', 'Operations', 'Attendance', 'Training', 'Deep Cleaning']) {
    await expect(nav.getByRole('link', { name: title, exact: true })).toBeVisible();
  }
  await expect(page.getByRole('heading', { name: 'Daily HK attendance %' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Deep Cleaning submissions by date' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'HK Training sessions by date' })).toBeVisible();
  await expect(page.getByLabel('Authorized State')).toHaveValue('TN');
  expect(await page.getByLabel('Authorized State').locator('option').allTextContents()).toEqual(['TN']);
  await page.goto('/reliance-retail/mis/operations');
  await expect(page.getByRole('heading', { name: 'Operations' })).toBeVisible();
  await expect(page.getByText('Synthetic TN FO', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('Synthetic TN Store', { exact: false }).first()).toBeVisible();
  await expect(page.getByText(/Sites Visited Today/)).toBeVisible();
  expect((await page.locator('body').innerText()).toLowerCase()).not.toMatch(/petrol|reimbursement|conveyance|payable km|rate per km/);
  await page.goto('/reliance-retail/mis/attendance-hk');
  await expect(page.getByRole('heading', { name: 'Attendance', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Daily HK attendance %' })).toBeVisible();
  await page.goto('/reliance-retail/mis/training-hk');
  await expect(page.getByRole('heading', { name: 'Training', exact: true })).toBeVisible();
  await page.goto('/reliance-retail/mis/cleaning');
  await expect(page.getByRole('heading', { name: 'Deep Cleaning', exact: true })).toBeVisible();
  expect(requests.filter(x => x.path.includes('/mis/report/')).every(x => x.state === 'TN')).toBe(true);
  expect(requests.every(x => x.method === 'GET')).toBe(true);
});
test('HK MIS state-only Excel and PPT reports retain the permitted store and never financial fields', async ({ page }) => {
  await seed(page);
  await page.goto('/reliance-retail/mis/attendance-hk');
  await expect(page.getByRole('heading', { name: 'Attendance', exact: true })).toBeVisible();
  const excelDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Excel' }).click();
  const file = await excelDownload;
  expect(file.suggestedFilename()).toMatch(/Retail_HK_MIS_TN_attendance-hk\.xlsx$/);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(await file.path());
  const data = wb.worksheets[0].getSheetValues().flat().filter(x => x != null).join('|');
  expect(data).toContain('TN100');
  expect(data).not.toMatch(/payable|petrol|kilometre|kilometer|rate_per_km/i);
  await page.goto('/reliance-retail/mis/training-hk');
  await expect(page.getByRole('heading', { name: 'Training', exact: true })).toBeVisible();
  const pptDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PowerPoint' }).click();
  expect((await pptDownload).suggestedFilename()).toMatch(/Retail_HK_MIS_TN_training-hk\.pptx$/);
  await page.goto('/reliance-retail/mis/cleaning');
  await expect(page.getByRole('heading', { name: 'Deep Cleaning', exact: true })).toBeVisible();
  const cleaningPpt = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PowerPoint' }).click();
  expect((await cleaningPpt).suggestedFilename()).toMatch(/Retail_HK_MIS_TN_cleaning\.pptx$/);
});
test('HK MIS unknown module and missing authorized states fail closed', async ({ page }) => {
  await seed(page, []);
  await page.goto('/reliance-retail/mis/dashboard');
  await expect(page.getByRole('alert').filter({ hasText: 'Verified HK MIS assignment required' })).toBeVisible();
  await page.goto('/reliance-retail/mis/pest');
  await expect(page.getByText('This page is not available for HK MIS.')).toBeVisible();
});
