import { test, expect } from '@playwright/test';
import { summarizeAttendance } from '../../backend/shared/retailAttendance.js';
import { attendanceTimeSource, summarizeAttendanceExceptions } from '../../backend/shared/retailAttendanceExceptions.js';
const date = '2026-11-21';
const stores = [{ id: 'tn', state: 'TN', store_code: '001', store_name: 'Synthetic TN', status: 'Active' }, { id: 'ap1', state: 'AP-1', store_code: '002', store_name: 'Synthetic AP1', status: 'Active' }];
const rows = stores.flatMap(s => ['HK', 'MEPC'].map((kind, i) => ({ employee_code: `${s.id}-${kind}`, employee_name: `Synthetic ${kind}`, retail_store_id: s.id, store_code_snapshot: s.store_code,
  store_name: s.store_name, source_state: s.state, state: s.state, class: kind, attendance_date: date, original_status: 'P', time_source: attendanceTimeSource(['In Time', 'Out Time', 'Man Hours'], ['09:00:00', i ? '17:00:00' : '', i ? '8:00:00' : '0:00:00']) })));
async function seed(page, legacy = false, failed = false) {
  await page.addInitScript(() => {
    localStorage.setItem('qpms-crm-auth-user', JSON.stringify({ id: 'synthetic-admin', name: 'Local Test Admin', role: 'Admin', rawRole: 'Admin', status: 'Active', isActive: true, webAccessEnabled: true, authProvider: 'demo-fixture', is_demo: true, isDemoReadOnly: true, read_only: false }));
    sessionStorage.setItem('qpms-crm-backend-token', 'synthetic-local-test-token');
  });
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url()), cutoff = url.searchParams.get('cutoff') || date, view = url.searchParams.get('view') || 'mtd', state = url.searchParams.get('state') || '';
    if (url.pathname.endsWith('/attendance/summary')) return route.fulfill({ json: { report: { ...summarizeAttendance({ stores: stores.filter(s => !state || s.state === state), attendance: [], aop: [], cutoff, view }), can_upload: true, available_states: ['TN', 'AP-1'], latest_imported_date: date } } });
    if (url.pathname.endsWith('/attendance/exceptions')) {
      if (failed) return route.fulfill({ status: 503, json: { message: 'Synthetic exception service unavailable' } });
      const records = rows.filter(r => !state || r.state === state).map(r => legacy ? { ...r, time_source: undefined } : r);
      return route.fulfill({ json: { report: { ...summarizeAttendanceExceptions(records, { from: view === 'daily' ? cutoff : cutoff.slice(0, 7) + '-01', to: cutoff }), view, state, note: 'N/A means unavailable time data or dates; counts do not change attendance credits.' } } });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto('/reliance-retail/attendance', { waitUntil: 'domcontentloaded' });
}
for (const width of [1440, 768, 390]) test(`exception cards, scoped employee drill-down and Excel export at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 }); await seed(page);
  await page.getByRole('tab', { name: 'Daily View' }).click();
  const section = page.getByRole('region', { name: 'Attendance exceptions', exact: true });
  const missing = section.getByRole('button', { name: /^Missing Checkout/ }), below = section.getByRole('button', { name: /^Below 9 Work Hours/ });
  await expect(missing).toContainText('HK: 2'); await expect(below).toContainText('MEPC: 2');
  expect(await missing.evaluate(node => node.querySelector('strong').getBoundingClientRect().top > node.querySelector('span').getBoundingClientRect().top)).toBe(true);
  await page.getByLabel('State filter').selectOption('TN');
  await expect(missing).toContainText('HK: 1');
  await missing.click(); await expect(section.getByRole('cell', { name: 'tn-HK', exact: true })).toBeVisible();
  await expect(section.getByRole('cell', { name: 'ap1-HK', exact: true })).toHaveCount(0);
  const download = page.waitForEvent('download'); await section.getByRole('button', { name: 'Export exception employees' }).click();
  const file = await download; expect(file.suggestedFilename()).toBe(`retail-attendance-exceptions-daily-${date}.xlsx`);
  const ExcelJS = (await import('exceljs')).default, book = new ExcelJS.Workbook(); await book.xlsx.readFile(await file.path());
  expect(book.worksheets[0].getCell('A5').value).toBe('tn-HK'); expect(book.worksheets[0].rowCount).toBe(5);
  await below.click(); await expect(section.getByRole('cell', { name: 'tn-MEPC', exact: true })).toBeVisible();
  await section.getByLabel('Exception category').selectOption('HK'); await expect(section.getByText(/No known affected records/)).toBeVisible();
  await page.screenshot({ path: info.outputPath(`attendance-exceptions-${width}.png`), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('tab', { name: 'Month-to-Date' }).click();
  await expect(section.getByText(/missing uploaded dates:/).first()).toBeVisible();
});
test('legacy imports and failed exception requests show unavailable cards, preserving original attendance report', async ({ page }) => {
  await seed(page, true); await page.getByRole('tab', { name: 'Daily View' }).click();
  const section = page.getByRole('region', { name: 'Attendance exceptions', exact: true });
  await expect(section.getByRole('button', { name: /^Missing Checkout/ })).toContainText('N/A');
  await expect(section.getByRole('button', { name: /^Below 9 Work Hours/ })).toContainText('N/A');
  await section.getByRole('button', { name: /Invalid \/ inconsistent/ }).click();
  await expect(section.getByText('Time validation issues — employee records')).toBeVisible();
});
test('exception service errors cannot become zero or hide original attendance KPIs', async ({ page }) => {
  await seed(page, false, true);
  const section = page.getByRole('region', { name: 'Attendance exceptions', exact: true });
  await expect(section.getByRole('alert')).toContainText('Synthetic exception service unavailable');
  await expect(section.getByRole('button', { name: /^Missing Checkout/ })).toBeDisabled();
  await expect(page.getByText('Actual Man-days', { exact: true })).toBeVisible();
});
