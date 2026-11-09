import { test, expect } from '@playwright/test';
import { seedCombined } from './fixtures/retailCombinedFixture.js';
import { revealAll } from './fixtures/retailExecutiveFixture.js';
import fs from 'node:fs';

test('Dashboard transfers period/state/store to Training and restores return scope', async ({ page }) => {
  await seedCombined(page); await page.goto('/reliance-retail');
  await expect(page.locator('.er-kpi-training strong')).toHaveAttribute('aria-label', '18');
  await page.getByLabel('Reporting month').fill('2026-10');
  await page.getByLabel('Reporting to', { exact: true }).fill('2026-10-09');
  await page.getByLabel('Global reporting state').selectOption('TN');
  await page.getByLabel('Reporting store').selectOption('s0-0');
  await page.locator('.er-kpi-training a').click();
  await expect(page.getByLabel('Training from', { exact: true })).toHaveValue('2026-10-01');
  await expect(page.getByLabel('Training to', { exact: true })).toHaveValue('2026-10-09');
  await expect(page.getByLabel('Training State', { exact: true })).toHaveValue('TN');
  await expect(page.getByLabel('Training Store', { exact: true })).toHaveValue('s0-0');
  await page.goBack();
  await expect(page.getByLabel('Reporting month')).toHaveValue('2026-10');
  await expect(page.getByLabel('Reporting store')).toHaveValue('s0-0');
});
for (const kind of ['CM', 'PM']) test('Dashboard opens ' + kind + ' with the existing window rules intact', async ({ page }) => {
  await seedCombined(page); await page.goto('/reliance-retail');
  await expect(page.locator('.er-kpi-training strong')).toHaveAttribute('aria-label', '18');
  await page.getByLabel('Global reporting state').selectOption('TN');
  await page.locator('.er-kpi-' + kind.toLowerCase() + ' a').click();
  await expect(page.getByLabel('Maintenance kind')).toHaveValue(kind);
  await expect(page.getByText('Opened from Dashboard', { exact: false })).toBeVisible();
  await expect(page.getByText(kind === 'PM' ? /2026-11-16 through 2026-11-30/ : /2026-11-01 through 2026-11-15/)).toBeVisible();
});
test('actual Training period projection is unknown metadata, with mixed covered topic detail', async ({ page }) => {
  const requests = await seedCombined(page); await page.goto('/reliance-retail/training');
  await expect(page.locator('.dc-kpi').first().locator('strong')).toHaveText('1');
  await expect(page.locator('.dc-insights')).toContainText('Topics unknown: 1; Metadata gaps: 0');
  expect(requests.some(r => r.path.endsWith('/ifms-history'))).toBe(false);
  await page.getByRole('button', { name: 'View Training evidence for SYN00' }).click();
  await expect(page.locator('.dc-facts')).toContainText('2 selected / 1 covered');
  await expect(page.locator('.tv-drawer')).not.toContainText('Topics Covered');
});
test('mobile drawer traps keyboard focus, inerts background and restores it on close', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedCombined(page); await page.goto('/reliance-retail/training');
  await page.getByRole('button', { name: 'View Training evidence for SYN00' }).click();
  const drawer = page.getByRole('dialog', { name: 'Training Details', exact: true });
  await expect(drawer).toBeVisible();
  expect(await page.locator('.dc-main').evaluate(e => e.inert)).toBe(true);
  await page.getByRole('button', { name: 'Close Training details', exact: true }).focus();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: 'Refresh details', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Close Training details', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Load photo', exact: true }).first().click();
  await page.getByRole('button', { name: 'Preview Synthetic topic photo', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Training photo preview' })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(drawer).toBeVisible();
  await page.keyboard.press('Escape'); await expect(drawer).toHaveCount(0);
  expect(await page.locator('.dc-main').evaluate(e => e.inert)).toBe(false);
  await expect(page.getByRole('button', { name: 'View Training evidence for SYN00' })).toBeFocused();
});
test('route-order CSS, deep return scroll and reduced motion survive combined pages', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.emulateMedia({ reducedMotion: 'reduce' });
  await seedCombined(page); await page.goto('/reliance-retail'); await revealAll(page);
  await page.getByRole('region', { name: 'Module-wise Detailed Performance', exact: true }).getByRole('link', { name: 'Manpower', exact: true }).click();
  await page.goBack(); await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(1000);
  await page.evaluate(() => scrollTo(0, 0)); await page.locator('.er-kpi-training a').click();
  await page.getByRole('button', { name: 'View Training evidence for SYN00' }).click();
  for (const [width, height] of [[1127, 701], [768, 1024], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 2);
    await page.screenshot({ path: info.outputPath('combined-training-' + width + '.png') });
  }
  await page.keyboard.press('Escape'); await page.goBack();
  await expect(page.locator('.retail-executive')).toHaveAttribute('data-motion', 'reduced');
});
test('malformed Training report does not become zero sessions', async ({ page }) => {
  await seedCombined(page, { malformed: true }); await page.goto('/reliance-retail/training');
  await expect(page.getByRole('alert')).toContainText('Training report is incomplete.');
  await expect(page.locator('.dc-kpi').first().locator('strong')).toHaveText('N/A');
});
test('unavailable ownership metadata never becomes zero scoped Training sessions', async ({ page }) => {
  await seedCombined(page);
  await page.route('**/api/reliance-retail/unified-master*', route => route.fulfill({ status: 503, json: { message: 'Synthetic ownership unavailable' } }));
  await page.goto('/reliance-retail');
  await expect(page.locator('.er-kpi-training strong')).toHaveAttribute('aria-label', '18');
  await page.getByLabel('Reporting store').selectOption('s0-0');
  await page.locator('.er-kpi-training a').click();
  await expect(page.getByText('Zone/FO ownership unavailable', { exact: false })).toBeVisible();
  await expect(page.locator('.dc-kpi').first().locator('strong')).toHaveText('N/A');
  await expect(page.getByText('No authorized Training records match these filters.', { exact: true })).toHaveCount(0);
});
test('rapid Training period changes cannot restore a stale earlier response', async ({ page }) => {
  await seedCombined(page, { delayTraining: true }); await page.goto('/reliance-retail/training');
  await expect(page.locator('.dc-kpi').first().locator('strong')).toHaveText('1');
  await page.getByLabel('Training from', { exact: true }).fill('2026-10-01');
  await page.getByLabel('Training from', { exact: true }).fill('2026-11-01');
  await expect(page.locator('.dc-work')).toContainText('2026-11-03');
  await page.waitForTimeout(350); await expect(page.locator('.dc-work')).not.toContainText('2026-10-03');
});
test('large Training dataset stays paginated and local filters do not refetch', async ({ page }, info) => {
  const requests = await seedCombined(page);
  const stores = Array.from({ length: 2000 }, (_, i) => ({ id: 'store-' + i, store_code: 'PERF' + i, store_name: 'Synthetic performance store ' + i, state: i % 2 ? 'TN' : 'KN' }));
  const rows = Array.from({ length: 10000 }, (_, i) => ({ id: 'perf-' + i, category: { code: 'hk' }, store: stores[i % stores.length], trainer_name: 'Synthetic trainer', training_date: '2026-11-03', status: 'submitted' }));
  await page.route('**/api/reliance-retail/module-reports/training*', route => { requests.push({ path: '/profile-training' }); return route.fulfill({ json: { report: { from: '2026-11-01', to: '2026-11-09', complete: true, rows } } }); });
  await page.route('**/api/reliance-retail/unified-master*', route => route.fulfill({ json: { result: { stores, zones: [], fos: [], assignments: [], store_zone_history: [], epoch_at: '2026-01-01', permissions: [], admin: false, aop: [], attendance: [], proposals: [], saved_rows: [], source_rows: [], provisional: [], saved_store_rows: [] } } }));
  const started = Date.now(); await page.goto('/reliance-retail/training');
  await expect(page.locator('.dc-kpi').first().locator('strong')).toHaveText('10,000');
  const loadedMs = Date.now() - started;
  await expect(page.locator('.dc-work tbody tr')).toHaveCount(25);
  const before = requests.filter(r => r.path === '/profile-training').length;
  const filteredAt = Date.now(); await page.getByLabel('Training State', { exact: true }).selectOption('TN');
  await expect(page.locator('.dc-kpi').first().locator('strong')).toHaveText('5,000');
  const filterMs = Date.now() - filteredAt;
  expect(requests.filter(r => r.path === '/profile-training').length).toBe(before);
  await expect(page.locator('.dc-work tbody tr')).toHaveCount(25);
  fs.writeFileSync(info.outputPath('large-dataset-profile.json'), JSON.stringify({ synthetic: true, sessions: 10000, stores: 2000, loadedMs, filterMs, renderedRows: 25, note: 'Local Chromium wall time; not office-laptop or production latency.' }, null, 2));
});
