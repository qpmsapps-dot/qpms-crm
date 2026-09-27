import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { canAccessRoute, isPlatformAdmin } from '../src/utils/authRoles.js';

const sidebarSource = await readFile(new URL('../src/components/Sidebar.jsx', import.meta.url), 'utf8');

test('Platform Admin can open every legitimate protected application route', () => {
  const admin = { role: 'Admin', rawRole: 'Admin' };
  assert.equal(isPlatformAdmin(admin), true);
  for (const route of [
    '/pre-sales', '/site-survey-requests', '/sites', '/site-visit', '/fo-activities',
    '/proposals', '/approvals', '/tasks', '/reports', '/settings/user-management',
  ]) assert.equal(canAccessRoute(admin, route), true, route);
});

test('Admin navigation includes workflow workbenches without broadening normal roles', () => {
  const adminPreset = sidebarSource.slice(
    sidebarSource.indexOf('const adminDemoNavGroups'),
    sidebarSource.indexOf('const businessNavGroups'),
  );
  assert.match(adminPreset, /Site Survey Requests/);
  assert.match(adminPreset, /preSalesNavItem/);
  assert.match(sidebarSource, /isPlatformAdmin\(user\)/);

  assert.equal(canAccessRoute({ role: 'Pre-Sales' }, '/site-survey-requests'), false);
  assert.equal(canAccessRoute({ role: 'BD Executive' }, '/settings/user-management'), false);
  assert.equal(canAccessRoute({ role: 'FO' }, '/pre-sales'), false);
  assert.equal(canAccessRoute(null, '/pre-sales'), false);
});
