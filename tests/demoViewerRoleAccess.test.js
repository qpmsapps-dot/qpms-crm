import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { canAccessRoute, normalizeAppRole, normalizeCanonicalRole } from '../src/utils/authRoles.js';
import { isReadOnlyDemoUser, isReadOnlyUser } from '../src/utils/demoAccess.js';

const sidebarSource = await readFile(new URL('../src/components/Sidebar.jsx', import.meta.url), 'utf8');
const mainLayoutSource = await readFile(new URL('../src/layouts/MainLayout.jsx', import.meta.url), 'utf8');
const routesSource = await readFile(new URL('../src/routes/AppRoutes.jsx', import.meta.url), 'utf8');
const tasksSource = await readFile(new URL('../src/pages/Tasks.jsx', import.meta.url), 'utf8');
const sitesSource = await readFile(new URL('../src/pages/Sites.jsx', import.meta.url), 'utf8');
const foSource = await readFile(new URL('../src/pages/FOActivities.jsx', import.meta.url), 'utf8');
const feedbackSource = await readFile(new URL('../src/pages/HospitalFeedbackDashboard.jsx', import.meta.url), 'utf8');

const demoViewer = { role: 'DEMO_VIEWER', rawRole: 'DEMO_VIEWER' };

test('DEMO_VIEWER remains its own role and does not normalize to Admin', () => {
  assert.equal(normalizeCanonicalRole('DEMO_VIEWER'), 'DEMO_VIEWER');
  assert.equal(normalizeAppRole('DEMO_VIEWER'), 'DemoViewer');
  assert.notEqual(normalizeAppRole('DEMO_VIEWER'), 'Admin');
  assert.equal(isReadOnlyDemoUser(demoViewer), true);
  assert.equal(isReadOnlyUser(demoViewer), true);
});

test('DEMO_VIEWER can access allowed existing app routes', () => {
  [
    '/dashboard',
    '/crm',
    '/sites',
    '/site-monitoring',
    '/tasks',
    '/proposals',
    '/approvals',
    '/existing-business',
    '/fo-activities',
    '/tickets',
    '/operations/hospital-feedback/dashboard',
    '/fault-tracker',
    '/deep-cleaning',
    '/assets',
    '/reports',
  ].forEach((route) => assert.equal(canAccessRoute(demoViewer, route), true, route));
});

test('DEMO_VIEWER direct access to restricted routes is denied', () => {
  ['/store-master', '/settings', '/settings/user-management', '/employees'].forEach((route) => {
    assert.equal(canAccessRoute(demoViewer, route), false, route);
  });
});

test('DEMO_VIEWER sidebar hides restricted administration modules', () => {
  const demoNavStart = sidebarSource.indexOf('const tenderDemoNavGroups');
  const demoNavEnd = sidebarSource.indexOf('function navLabelForRole');
  const demoNav = sidebarSource.slice(demoNavStart, demoNavEnd);
  assert.match(demoNav, /Lead Management/);
  assert.match(demoNav, /Soft Services Feedback/);
  assert.doesNotMatch(demoNav, /Store Master|Settings|User Management|Employee Management|Roles and Permissions|Access Management|Password tools|Integrations|Audit logs/);
});

test('DEMO_VIEWER uses normal login and production routes, not the generic demo workspace', () => {
  const productionStart = routesSource.indexOf('const productionRoutes');
  const productionRoutes = routesSource.slice(productionStart);
  assert.match(productionRoutes, /path: 'login'/);
  assert.doesNotMatch(productionRoutes, /path: 'demo-login'|path: 'demo'/);
});

test('read-only demonstration banner is shown in the normal app layout', () => {
  assert.match(mainLayoutSource, /Read-only demonstration access/);
});

test('read-only action controls are hidden on focused workflow pages', () => {
  assert.match(tasksSource, /readOnlyDemo[\s\S]*Approve, reject, rework and escalation controls are disabled/);
  assert.match(sitesSource, /!readOnlyDemo[\s\S]*Export Survey Workbook/);
  assert.match(sitesSource, /!readOnlyDemo[\s\S]*Submit for Reviews/);
  assert.match(sitesSource, /!readOnlyDemo[\s\S]*Send Proposal Mail/);
  assert.match(foSource, /!readOnlyDemo[\s\S]*Export Travel Claim PDF/);
  assert.match(feedbackSource, /!readOnlyDemo[\s\S]*Export PDF/);
});
