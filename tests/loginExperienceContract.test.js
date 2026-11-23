import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const login = await readFile(new URL('../src/pages/Login.jsx', import.meta.url), 'utf8');
const routes = await readFile(new URL('../src/routes/AppRoutes.jsx', import.meta.url), 'utf8');
const layout = await readFile(new URL('../src/layouts/MainLayout.jsx', import.meta.url), 'utf8');

test('login retains existing authentication and immediate return route', () => {
  assert.match(login, /await loginWithPassword\(normalizedUsername, password\)/);
  assert.match(login, /requiresPasswordChange/);
  assert.match(login, /returnLocation\?\.pathname/);
  assert.doesNotMatch(login, /window\.setTimeout/);
});

test('remember email stores no password and is explicitly opt-in', () => {
  assert.match(login, /if \(rememberEmail\) localStorage\.setItem\('qpms-remembered-email', normalizedUsername\)/);
  assert.match(login, /localStorage\.removeItem\('qpms-remembered-email'\)/);
  assert.doesNotMatch(login, /localStorage\.setItem\([^\n]*password/i);
});

test('password reset uses the existing password setup route and generic message', () => {
  assert.match(login, /supabase\.auth\.resetPasswordForEmail\(email/);
  assert.match(login, /new URL\('\/set-password', window\.location\.origin\)/);
  assert.match(login, /If an account exists/);
});

test('major workspace pages are deferred behind a layout loading state', () => {
  assert.match(routes, /const Dashboard = lazy\(/);
  assert.match(routes, /const RetailDashboard = lazy\(/);
  assert.match(layout, /<Suspense fallback=/);
});
