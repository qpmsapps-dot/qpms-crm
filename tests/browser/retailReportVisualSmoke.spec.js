import { test, expect } from '@playwright/test';

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
  today: '2026-11-03',
  stores: [],
  events: [],
  total: { scheduled: 0, awaiting: 0, approved: 0, overdue: 0 },
  states: [],
  rows: [],
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
  { name: 'Deep Cleaning', path: '/reliance-retail/deep-cleaning', title: 'Reliance Retail Deep Cleaning', actions: ['Schedule Deep Cleaning', 'Refresh', 'Export cleaning report'] },
  { name: 'CM PM', path: '/reliance-retail/cmpm', title: 'CM / PM Calls', actions: ['Record CM/PM Call', 'Refresh', 'Export Excel'] },
  { name: 'Thermography', path: '/reliance-retail/thermography', title: 'Thermography', actions: ['Schedule Thermography', 'Refresh', 'Export Excel'] },
];

for (const report of reports) {
  test(`${report.name} reporting remains accessible at desktop, tablet and mobile`, async ({ page }, testInfo) => {
    await seed(page);
    await page.goto(report.path, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: report.title, exact: true })).toBeVisible();
    for (const label of report.actions) {
      await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible();
    }
    for (const [name, width, height] of views) {
      await page.setViewportSize({ width, height });
      await expect(page.locator('section.retail-report')).toBeVisible();
      if (width < 1024) {
        await expect.poll(() => page.locator('aside').evaluate(el => el.getBoundingClientRect().right)).toBeLessThanOrEqual(1);
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
      await expect.poll(() => page.locator('aside').evaluate(el => el.getBoundingClientRect().right)).toBeLessThanOrEqual(1);
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
