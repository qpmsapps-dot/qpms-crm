import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const config = await readFile(new URL('../src/config/tenderDemo.js', import.meta.url), 'utf8');
const login = await readFile(new URL('../src/pages/TenderDemoLogin.jsx', import.meta.url), 'utf8');
const layout = await readFile(new URL('../src/layouts/TenderDemoLayout.jsx', import.meta.url), 'utf8');
const workspace = await readFile(new URL('../src/pages/TenderDemoWorkspace.jsx', import.meta.url), 'utf8');
const routes = await readFile(new URL('../src/routes/AppRoutes.jsx', import.meta.url), 'utf8');
const main = await readFile(new URL('../src/main.jsx', import.meta.url), 'utf8');
const demoData = await readFile(new URL('../src/data/tenderDemoData.js', import.meta.url), 'utf8');

test('correct tender demo credentials allow access through a sessionStorage session', () => {
  assert.match(config, /tenderDemoSessionKey\s*=\s*'myqpms_tender_demo_session'/);
  assert.match(config, /email:\s*'demo@myqpms\.com'/);
  assert.match(config, /password:\s*'MyQPMS@Demo'/);
  assert.match(login, /startTenderDemoSession\(\)/);
  assert.match(login, /navigate\('\/demo\/dashboard'/);
});

test('incorrect tender demo credentials show a generic error', () => {
  assert.match(login, /Invalid demo login details\./);
  assert.doesNotMatch(login, /email is incorrect|password is incorrect/i);
});

test('protected demo routes redirect to demo login without a session', () => {
  assert.match(layout, /!isTenderDemoModeEnabled\(\) \|\| !hasTenderDemoSession\(\)/);
  assert.match(layout, /<Navigate to="\/demo-login" replace \/>/);
});

test('logout removes only the demo session and returns to demo login', () => {
  assert.match(layout, /endTenderDemoSession\(\)/);
  assert.match(config, /storage\.removeItem\(tenderDemoSessionKey\)/);
  assert.match(layout, /navigate\('\/demo-login'/);
});

test('administration routes are not present in demo navigation', () => {
  assert.doesNotMatch(layout, /Store Master|Settings|User Management|Employee Management|Roles and Permissions|Access Management|Password tools|Integrations|Audit logs/);
  assert.match(demoData, /Store Master/);
  assert.match(demoData, /Settings/);
});

test('demo mode requires both explicit frontend environment flags', () => {
  assert.match(config, /VITE_APP_ENV[\s\S]*=== 'tender-demo'/);
  assert.match(config, /VITE_TENDER_DEMO[\s\S]*=== 'true'/);
  assert.match(routes, /isTenderDemoModeEnabled\(\) \? tenderDemoRoutes : productionRoutes/);
  assert.match(main, /isTenderDemoModeEnabled\(\) \?/);
});

test('demo workspace uses only frontend sample data and no production network clients', () => {
  assert.match(workspace, /buildTenderDemoRecords/);
  assert.doesNotMatch(workspace, /supabase|authenticatedFetch|axios|fetch\(/);
  assert.doesNotMatch(layout, /useAuth|supabase|authenticatedFetch|axios|fetch\(/);
  assert.doesNotMatch(login, /useAuth|supabase|authenticatedFetch|axios|fetch\(/);
});
