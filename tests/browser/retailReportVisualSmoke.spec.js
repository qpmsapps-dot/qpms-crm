import { test, expect } from '@playwright/test';

test('Thermography retains current-main Dashboard month/state/store/KPI context and restores return scope',async({page})=>{
 const {seedCombined}=await import('./fixtures/retailCombinedFixture.js');await seedCombined(page);
 await page.route('**/api/reliance-retail/mis/thermography/dashboard*',route=>{
  expect(route.request().method()).toBe('GET');const u=new URL(route.request().url());
  expect(u.searchParams.get('month')).toBe('2026-10');expect(u.searchParams.get('state')).toBe('TN');expect(u.searchParams.get('store')).toBe('s0-0');
  return route.fulfill({json:{ok:true,result:{contract:'thermography.v2',scope_digest:'synthetic-navigation',today:'2026-11-18',month:'2026-10',from:'2026-10-01',to:'2026-10-31',kpi_from:'2026-10-01',kpi_to:'2026-10-09',summary:{scheduled:0,completed:0,percentage:0},monthly:{total:0,completed:0,scheduled:0},chart:[],rows:[],total:0,page:0,limit:25,max_bytes:10000000,can_upload:false,can_schedule:false,stores:[{id:'s0-0',store_code:'0001',store_name:'SYNTHETIC TN',state:'TN'}]}}});
 });
 await page.goto('/reliance-retail');await expect(page.locator('.er-kpi-training strong')).toHaveAttribute('aria-label','18');
 await page.getByLabel('Reporting month').fill('2026-10');await page.getByLabel('Reporting to',{exact:true}).fill('2026-10-09');await page.getByLabel('Global reporting state').selectOption('TN');await page.getByLabel('Reporting store').selectOption('s0-0');
 await page.locator('.er-kpi-thermography a').click();await expect(page.getByLabel('Month',{exact:true})).toHaveValue('2026-10');await expect(page.locator('.thv2-filters select').nth(0)).toHaveValue('TN');await expect(page.locator('.thv2-filters select').nth(1)).toHaveValue('s0-0');await expect(page.getByLabel('KPI start date')).toHaveValue('2026-10-01');await expect(page.getByLabel('KPI end date')).toHaveValue('2026-10-09');await expect(page.locator('.thv2-scheduled strong')).toHaveText('0');
 await page.goBack();await expect(page.getByLabel('Reporting month')).toHaveValue('2026-10');await expect(page.getByLabel('Reporting store')).toHaveValue('s0-0');
});

// Visual smoke tests use synthetic API responses only. No production data or writes.
const emptyMaintenanceModule = {
  status: 'ready',
  total: { eligible: 0, completed: 0, remaining: 0 },
  stores: [],
  rows: [],
  window: { start: '2026-11-01', end: '2026-11-15', open: false, status: 'Closed' },
};
const operationsFixture = {
  today: '2026-11-03',
  stores: [],
  events: [],
  modules: { cm: emptyMaintenanceModule, pm: emptyMaintenanceModule },
};
const thermoFixture = {
  contract: 'thermography.v2', scope_digest: 'synthetic-thermography-v2',
  summary: { scheduled: 0, completed: 0, percentage: 0 },
  monthly: { total: 0, completed: 0, scheduled: 0 },
  max_bytes: 10000000, page: 0, limit: 25, can_upload: false, can_schedule: false,
  month: '2026-11', from: '2026-11-01', to: '2026-11-30',
  kpi_from: '2026-11-01', kpi_to: '2026-11-03', today: '2026-11-03',
  stores: [], chart: [], total: 0, rows: [],
};

async function seed(page) {
  await page.addInitScript(() => {
    localStorage.setItem('qpms-crm-auth-user', JSON.stringify({
      id: 'synthetic-admin', profileId: 'synthetic-profile', name: 'Local UI Test',
      role: 'Admin', rawRole: 'Admin', business: 'Reliance Retail',
      status: 'Active', isActive: true, webAccessEnabled: true,
      authProvider: 'demo-fixture', is_demo: true, isDemoReadOnly: true, read_only: false,
    }));
    sessionStorage.setItem('qpms-crm-backend-token', 'synthetic-local-test-token');
  });
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== 'GET') {
      throw new Error('Visual smoke test attempted an API mutation: ' + path);
    }
    if (path.endsWith('/module-reports/training')) return route.fulfill({ json: { report: { rows: [] } } });
    if (path.endsWith('/module-reports/deep-cleaning')) return route.fulfill({
      json: { report: {
        stores: [], schedules: [], submissions: [], exceptions: [],
        totals: { scheduled: 0, completed: 0, pending: 0, not_completed: 0 },
      } },
    });
    if (path.endsWith('/operations/maintenance')) return route.fulfill({ json: { result: operationsFixture } });
    if (path.endsWith('/operations/thermography')) return route.fulfill({ json: { result: thermoFixture } });
    if (path.endsWith('/mis/thermography/dashboard')) return route.fulfill({ json: { result: { ...thermoFixture, total: 0 } } });
    if (path.endsWith('/stores')) return route.fulfill({ json: { rows: [], total: 0 } });
    if (path.endsWith('/zones')) return route.fulfill({ json: { zones: [] } });
    return route.fulfill({ json: { stores: [], zones: [], fos: [], snapshot: { stores: [], zones: [], fos: [] } } });
  });
}
const views = [
  ['desktop', 1440, 900],
  ['tablet', 768, 950],
  ['mobile', 390, 844],
];
const reports = [
  { name: 'Training', path: '/reliance-retail/training', title: 'HK & MEPC Training', actions: ['Refresh', 'Export Training review'] },
  { name: 'Deep Cleaning', path: '/reliance-retail/deep-cleaning', title: 'Deep Cleaning', actions: ['Refresh', 'Export Report'] },
  { name: 'CM PM', path: '/reliance-retail/cmpm', title: 'CM / PM Calls', actions: ['Record CM/PM Call', 'Refresh', 'Export Excel'] },
  { name: 'Thermography', path: '/reliance-retail/thermography', title: 'Thermography', actions: ['Upload Schedule (Excel)', 'Download Template', 'Export Excel', 'Schedule History', 'Instructions'] },
];

for (const report of reports) {
  test(`${report.name} reporting remains accessible at desktop, tablet and mobile`, async ({ page }, testInfo) => {
    await seed(page);
    await page.goto(report.path, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: report.title, exact: true })).toBeVisible();
    for (const label of report.actions) {
      await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible();
    }
    if (report.name === 'Thermography') {
      await expect(page.locator('.thv2-scheduled strong')).toHaveText('0');
      await expect(page.locator('.thv2-completed strong')).toHaveText('0');
      await expect(page.getByRole('button', { name: 'Export Excel', exact: true })).toBeEnabled();
      await expect(page.getByRole('button', { name: 'Upload Schedule (Excel)', exact: true })).toBeDisabled();
    }
    if (report.name === 'Deep Cleaning') {
      const schedule = page.locator('.dc-schedule-menu summary');
      await expect(schedule).toBeVisible();
      await schedule.click();
      await expect(page.getByRole('button', { name: 'Schedule a visit', exact: true })).toBeVisible();
      await schedule.click();
    }
    for (const [name, width, height] of views) {
      await page.setViewportSize({ width, height });
      await expect(page.locator(report.name === 'Thermography' ? 'main.thermo-v2' : 'section.retail-report')).toBeVisible();
      if (width < 1024) {
        await expect.poll(() => page.locator('aside:has(nav)').evaluate(el => el.getBoundingClientRect().right)).toBeLessThanOrEqual(1);
      }
      const size = await page.evaluate(() => ({
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      }));
      expect(size.documentWidth, `${report.name} ${name} document overflow`).toBeLessThanOrEqual(size.viewportWidth + 2);
      await page.screenshot({ path: testInfo.outputPath(`${report.name.replaceAll(' ', '-')}-${name}.png`), fullPage: true });
    }
  });
}

test('Store Master retains all seven tabs and core store controls across breakpoints', async ({ page }, testInfo) => {
  await seed(page);
  await page.goto('/reliance-retail/store-master', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Store Master', exact: true })).toBeVisible();
  const tabs = ['Unified Management', 'Batch Submission & Approval', 'Stores', 'Provisional MIS Review', 'Zones', 'FO Mapping', 'Manpower'];
  const tabGroup = page.getByRole('group', { name: 'Store Master sections' });
  for (const name of tabs) await expect(tabGroup.getByRole('button', { name, exact: true })).toBeVisible();
  await tabGroup.getByRole('button', { name: 'Stores', exact: true }).click();
  await expect(page.getByPlaceholder('Search Store Code or Store Name')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add Store' })).toBeVisible();
  for (const [name, width, height] of views) {
    await page.setViewportSize({ width, height });
    if (width < 1024) {
      await expect.poll(() => page.locator('aside:has(nav)').evaluate(el => el.getBoundingClientRect().right)).toBeLessThanOrEqual(1);
    }
    const size = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    }));
    expect(size.documentWidth, `Store Master ${name} document overflow`).toBeLessThanOrEqual(size.viewportWidth + 2);
    await page.screenshot({ path: testInfo.outputPath(`store-master-${name}.png`), fullPage: true });
  }
  await tabGroup.getByRole('button', { name: 'Manpower', exact: true }).click();
  await expect(page.getByText('HK Budget', { exact: true })).toBeVisible();
});
