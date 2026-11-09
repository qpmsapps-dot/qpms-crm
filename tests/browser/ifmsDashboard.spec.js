import { test, expect } from '@playwright/test';
import { seed, revealAll } from './fixtures/retailExecutiveFixture.js';

const title = 'Reliance Retail — Executive Operations Report';
test('executive report is complete, bounded, filtered and keeps the shell intact', async ({ page }, info) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const requests = await seed(page);
  await page.goto('/reliance-retail');
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await expect(page.locator('.er-kpi-training strong')).toHaveAttribute('aria-label', '18');
  const sidebar = await page.locator('aside:has(nav)').innerHTML();
  await expect(page.locator('.er-kpis a')).toHaveCount(6);
  await expect(page.locator('.er-kpi-training')).not.toContainText('%');
  const calls = requests.filter(r => r.path.endsWith('/dashboard')).length;
  await page.getByLabel('Global reporting state').selectOption('TN');
  await expect(page.locator('.er-kpi-training strong')).toHaveAttribute('aria-label', '3');
  expect(requests.filter(r => r.path.endsWith('/dashboard')).length).toBe(calls);
  await expect(page.getByLabel('Reporting zone')).toBeDisabled();
  await page.getByLabel('Reporting store').selectOption('s0-0');
  await expect(page.locator('.er-kpi-training strong')).toHaveAttribute('aria-label', 'N/A');
  await page.getByLabel('Reporting store').selectOption('');
  await revealAll(page);
  await expect(page.locator('.er-card')).toHaveCount(15);
  expect(await page.locator('.retail-executive').evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThan(3000);
  expect(requests.filter(r => r.path === '/api/training/sessions').every(r => r.params.limit === '6')).toBe(true);
  expect(await page.locator('aside:has(nav)').innerHTML()).toBe(sidebar);
  const revealed = await page.locator('.er-visible').count();
  await page.screenshot({ path: info.outputPath('executive-desktop-full.png'), fullPage: true });
  await page.evaluate(() => scrollTo(0, 0));
  expect(await page.locator('.er-visible').count()).toBe(revealed);
  await page.screenshot({ path: info.outputPath('executive-desktop-top.png') });
  const hrefs = await page.locator('.er-kpis a').evaluateAll(nodes => nodes.map(n => n.getAttribute('href')));
  expect(hrefs).toEqual(['/reliance-retail/attendance', '/reliance-retail/thermography', '/reliance-retail/cmpm', '/reliance-retail/cmpm', '/reliance-retail/deep-cleaning', '/reliance-retail/training']);
  for (const [i, id] of ['attendance','thermography','cm','pm','cleaning','training'].entries()) {
    await page.locator('.er-kpi-' + id + ' a').click();
    await expect(page).toHaveURL(new RegExp(hrefs[i] + '$'));
    await page.goBack();
    await expect(page.getByLabel('Global reporting state')).toHaveValue('TN');
  }
});
test('responsive layout and reduced motion work without viewport overflow', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seed(page); await page.goto('/reliance-retail');
  await expect(page.locator('.er-kpi-training strong')).toHaveAttribute('aria-label', '18');
  for (const [width, height] of [[1440, 1000], [1127, 701], [768, 1024], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await revealAll(page);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 2);
    await expect(page.locator('.retail-executive')).toHaveAttribute('data-motion', 'reduced');
    expect(await page.locator('.er-reveal').first().evaluate(e => getComputedStyle(e).opacity)).toBe('1');
    await page.screenshot({ path: info.outputPath(`executive-${width}.png`), fullPage: true });
  }
});
test('partial coverage, empty reports and failure never manufacture percentages', async ({ page }) => {
  await seed(page, { partial: true }); await page.goto('/reliance-retail');
  await expect(page.locator('.er-kpi-attendance strong')).toHaveAttribute('aria-label', 'N/A');
  await expect(page.locator('.er-kpi-training strong')).toHaveAttribute('aria-label', '18');
  await expect(page.locator('.retail-executive')).not.toContainText(/NaN|Infinity|96\.2%/);
});
test('source failure remains explicit and disables export', async ({ page }) => {
  await seed(page, { failure: true }); await page.goto('/reliance-retail');
  await expect(page.getByRole('alert')).toContainText('Synthetic source unavailable');
  await expect(page.getByRole('button', { name: 'Export report', exact: true })).toBeDisabled();
  await expect(page.locator('.er-kpi-cleaning strong')).toHaveAttribute('aria-label', 'N/A');
});
test('empty sources show confirmed zero counts but no invented rates', async ({ page }) => {
  await seed(page, { empty: true }); await page.goto('/reliance-retail');
  await expect(page.locator('.er-kpi-training strong')).toHaveAttribute('aria-label', '0');
  await expect(page.locator('.er-kpi-attendance strong')).toHaveAttribute('aria-label', 'N/A');
  await expect(page.locator('.er-kpi-cleaning strong')).toHaveAttribute('aria-label', 'N/A');
});
test('daily Attendance selector preserves source gaps without new requests', async ({ page }) => {
  const requests = await seed(page); await page.goto('/reliance-retail');
  await expect(page.locator('.er-line-chart')).toHaveAttribute('aria-label', /2026-11-03: N\/A/);
  const reads = requests.filter(r => r.path.endsWith('/attendance/summary')).length;
  await page.getByLabel('Attendance class').selectOption('hk');
  await expect(page.locator('.er-line-chart')).toHaveAttribute('aria-label', /2026-11-01: 70%/);
  expect(requests.filter(r => r.path.endsWith('/attendance/summary')).length).toBe(reads);
});
test('rapid period changes cannot restore a stale report', async ({ page }) => {
  await seed(page);
  await page.route('**/module-reports/dashboard*', async route => {
    if (new URL(route.request().url()).searchParams.get('from') === '2026-10-01') await new Promise(resolve => setTimeout(resolve, 300));
    await route.fallback();
  });
  await page.goto('/reliance-retail');
  await expect(page.locator('.er-kpi-training strong')).toHaveAttribute('aria-label', '18');
  await page.getByLabel('Reporting month').fill('2026-10');
  await page.getByLabel('Reporting month').fill('2026-09');
  await expect(page.getByLabel('Reporting to')).toHaveValue('2026-09-30');
  await expect(page.locator('.er-kpi-training strong')).toHaveAttribute('aria-label', '12');
  await page.waitForTimeout(400);
  await expect(page.locator('.er-scope-note')).toContainText('2026-09-01 to 2026-09-30');
  await expect(page.locator('.er-kpi-training strong')).toHaveAttribute('aria-label', '12');
});
test('bounded private evidence is authorized on action and denial reveals no image', async ({ page }) => {
  const requests = await seed(page, { denyPhoto: true }); await page.goto('/reliance-retail');
  await expect(page.locator('.er-kpi-training strong')).toHaveAttribute('aria-label', '18');
  await revealAll(page);
  await page.getByRole('button', { name: 'View evidence for session' }).click();
  await expect(page.getByRole('alert')).toContainText('Synthetic evidence denied');
  await expect(page.locator('.er-evidence-grid img')).toHaveCount(0);
  expect(requests.filter(r => r.path.includes('/view-url'))).toHaveLength(1);
});
test('private photo preview closes with Escape and export retains source separation', async ({ page }) => {
  await seed(page); await page.goto('/reliance-retail');
  await expect(page.locator('.er-kpi-training strong')).toHaveAttribute('aria-label', '18');
  const promise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export report', exact: true }).click();
  const download = await promise; expect(download.suggestedFilename()).toBe('Retail_Executive_Operations.xlsx');
  const { default: ExcelJS } = await import('exceljs'); const book = new ExcelJS.Workbook(); await book.xlsx.readFile(await download.path());
  expect(book.getWorksheet('State summary').getRow(1).getCell(5).value).toBe('Source');
  expect(book.getWorksheet('Historical Excel separate')).toBeTruthy();
  await revealAll(page); await page.getByRole('button', { name: 'View evidence for session' }).click();
  await page.getByRole('button', { name: 'Synthetic training photo', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible(); await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('signed-out and other-business users cannot access the dashboard', async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ json: {} })); await page.goto('/reliance-retail');
  await expect(page).toHaveURL(/\/login$/); await expect(page.locator('.retail-executive')).toHaveCount(0);
});
test('other business scope is rejected before dashboard API reads', async ({ page }) => {
  const requests = await seed(page, { role: 'Technical MIS', business: 'Other' }); await page.goto('/reliance-retail');
  await expect(page.locator('.retail-executive')).toHaveCount(0);
  expect(requests.some(r => r.path.endsWith('/module-reports/dashboard'))).toBe(false);
});
