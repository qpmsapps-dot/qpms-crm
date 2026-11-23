import { test, expect } from '@playwright/test';

const fakeEmail = 'test@example.invalid';
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET, OPTIONS' };

async function mockAuth(page, { recoveryFails = false } = {}) {
  const calls = [];
  await page.route('http://127.0.0.1:4998/**', async route => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const url = new URL(request.url());
    calls.push({ path: url.pathname, method: request.method(), redirect: url.searchParams.get('redirect_to') });
    if (url.pathname.endsWith('/recover')) {
      return route.fulfill({ status: recoveryFails ? 429 : 200, headers: cors, json: recoveryFails ? { message: 'Synthetic failure' } : {} });
    }
    return route.fulfill({ status: 400, headers: cors, json: { message: 'Invalid login credentials' } });
  });
  return calls;
}

test('login controls are accessible, responsive and clear remembered email when opted out', async ({ page }) => {
  await mockAuth(page);
  await page.addInitScript(email => localStorage.setItem('qpms-remembered-email', email), fakeEmail);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/login');
  await expect(page.getByRole('textbox', { name: 'Email', exact: true })).toHaveValue(fakeEmail);
  await expect(page.getByRole('checkbox', { name: 'Remember email' })).toBeChecked();
  await page.getByRole('checkbox', { name: 'Remember email' }).uncheck();
  expect(await page.evaluate(() => localStorage.getItem('qpms-remembered-email'))).toBeNull();
  const password = page.locator('input[autocomplete="current-password"]');
  await expect(password).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Show password' }).click();
  await expect(password).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Hide password' }).click();
  await expect(password).toHaveAttribute('type', 'password');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(392);
});

test('reset validates email and sends only a mocked request with a generic response', async ({ page }) => {
  const calls = await mockAuth(page);
  await page.goto('/login');
  await page.getByRole('button', { name: 'Forgot password?' }).click();
  await expect(page.getByRole('alert')).toContainText('Enter your work email');
  expect(calls.filter(call => call.path.endsWith('/recover'))).toHaveLength(0);
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(fakeEmail);
  await page.getByRole('button', { name: 'Forgot password?' }).click();
  await expect(page.getByRole('status')).toContainText('If an account exists');
  expect(calls.filter(call => call.path.endsWith('/recover'))).toEqual([{ path: '/auth/v1/recover', method: 'POST', redirect: 'http://127.0.0.1:4175/set-password' }]);
});

test('reset and login errors remain visible without sending requests to production', async ({ page }) => {
  const calls = await mockAuth(page, { recoveryFails: true });
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(fakeEmail);
  await page.getByRole('button', { name: 'Forgot password?' }).click();
  await expect(page.getByRole('alert')).toContainText('Unable to request a reset');
  await page.locator('input[autocomplete="current-password"]').fill('synthetic-only');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toContainText('Invalid login credentials');
  expect(calls.some(call => call.path.endsWith('/token'))).toBe(true);
});
