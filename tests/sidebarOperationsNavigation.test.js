import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  canAccessFoCommandCenter,
  canAccessNavRoute,
  canAccessRoute,
  usesOperationsSidebar,
} from '../src/utils/authRoles.js';

const user = (role) => ({ role, rawRole: role });
const sidebarSource = await readFile(new URL('../src/components/Sidebar.jsx', import.meta.url), 'utf8');

test('Branch Head receives the Operations sidebar and can open the Command Center', () => {
  const branchHead = user('Branch Head');

  assert.equal(usesOperationsSidebar(branchHead), true);
  assert.equal(canAccessRoute(branchHead, '/fo-activities'), true);
  assert.equal(canAccessNavRoute(branchHead, '/fo-activities'), true);
  assert.match(sidebarSource, /usesOperationsSidebar\(user\) \|\| isExistingBusinessOperations\(user\)[\s\S]*\? operationsNavGroups/);
  assert.match(sidebarSource, /label: 'Operations', to: '\/fo-activities'/);
});

test('Command Center navigation stops at Branch Head while operational employees keep reviewer navigation', () => {
  for (const role of ['Business Head', 'Branch Head', 'South Head']) {
    assert.equal(usesOperationsSidebar(user(role)), true, role);
  }
  for (const role of ['Operations Team', 'Operations Manager', 'KAM', 'FO', 'Manager', 'Commercial Reviewer', 'HR Reviewer', 'Finance Reviewer']) {
    assert.equal(usesOperationsSidebar(user(role)), false, role);
  }
  for (const role of ['Admin', 'GM', 'COO', 'Executive Assistant']) {
    assert.equal(usesOperationsSidebar(user(role)), false, role);
    assert.equal(canAccessRoute(user(role), '/fo-activities'), true, role);
  }
  assert.equal(canAccessRoute(user('Commercial Reviewer'), '/fo-activities'), false);
});

test('Command Center route actor access is separate from operational employee roles', () => {
  for (const role of ['Admin', 'GM', 'South Head', 'Business Head', 'Branch Head', 'COO', 'Executive Assistant']) {
    assert.equal(canAccessFoCommandCenter(user(role)), true, role);
    assert.equal(canAccessRoute(user(role), '/fo-activities'), true, role);
  }
  for (const role of ['Operations', 'Operations Team', 'Operations Manager', 'KAM', 'FO', 'Field Officer']) {
    assert.equal(canAccessFoCommandCenter(user(role)), false, role);
    assert.equal(canAccessRoute(user(role), '/fo-activities'), false, role);
    assert.equal(canAccessNavRoute(user(role), '/fo-activities'), false, role);
  }
});

test('Operations sidebar remains filtered by route authorization and keeps Fault Tracker append logic', () => {
  assert.match(sidebarSource, /items\.filter\(\(item\) => \{[\s\S]*TEMPORARILY_HIDDEN_NAV_ROUTES\.has\(routePath\)[\s\S]*canAccessNavRoute\(user, routePath\)/);
  assert.match(sidebarSource, /const canSeeFaultTracker = canAccessNavRoute\(user, '\/fault-tracker'\)/);
  assert.match(sidebarSource, /canSeeFaultTracker && !authorizedNavGroups\.some/);
  assert.equal(canAccessNavRoute(user('Branch Head'), '/store-master'), false);
  assert.equal(canAccessNavRoute(user('Branch Head'), '/fo-activities'), true);
});

test('unfinished modules are centrally hidden from every sidebar preset', () => {
  const hiddenRoutesSource = sidebarSource.match(/const TEMPORARILY_HIDDEN_NAV_ROUTES = new Set\(\[([\s\S]*?)\]\);/)?.[1] || '';

  for (const route of [
    '/existing-business',
    '/tickets',
    '/operations/hospital-feedback/dashboard',
    '/assets',
    '/reports',
  ]) {
    assert.match(hiddenRoutesSource, new RegExp(`['\"]${route.replaceAll('/', '\\/')}['\"]`));
  }

  for (const retainedRoute of ['/dashboard', '/fo-activities', '/fault-tracker', '/deep-cleaning', '/settings']) {
    assert.doesNotMatch(hiddenRoutesSource, new RegExp(`['\"]${retainedRoute.replaceAll('/', '\\/')}['\"]`));
  }
});

test('Admin sidebar preserves unrelated modules while Pre-Sales remains a single item', () => {
  const adminPreset = sidebarSource.slice(
    sidebarSource.indexOf('const adminDemoNavGroups'),
    sidebarSource.indexOf('const businessNavGroups'),
  );
  const preSalesDefinition = sidebarSource.slice(
    sidebarSource.indexOf('const preSalesNavItem'),
    sidebarSource.indexOf('function insertHospitalTicketingGroup'),
  );

  for (const label of [
    'Dashboard', 'Site Visit + Estimation', 'HR Review', 'Commercial Review',
    'Finance Review', 'Proposals', 'Approvals', 'Operations', 'Fault Tracker',
  ]) assert.match(adminPreset, new RegExp(`label: '${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`));

  assert.match(adminPreset, /preSalesNavItem/);
  assert.match(preSalesDefinition, /label: 'Pre-Sales'/);
  assert.doesNotMatch(preSalesDefinition, /Leads|Follow-ups|Meetings|Handover|Reports/);
  assert.doesNotMatch(adminPreset, /label: 'Lead Management'/);
  assert.match(sidebarSource, /title: 'Hospital Ticketing System'/);
  assert.match(sidebarSource, /label: 'NIMS Ticketing System', to: '\/hospital-ticketing\/nims\/qpms'/);
  assert.match(sidebarSource, /hasStaticHospitalTicketingAccess = isAdmin\(user\)/);
});

test('Pre-Sales and non-Pre-Sales role presets retain their established scope', () => {
  assert.equal(canAccessNavRoute(user('Pre-Sales'), '/pre-sales'), true);
  assert.equal(canAccessNavRoute(user('Pre-Sales Executive'), '/pre-sales'), true);
  assert.equal(canAccessNavRoute(user('Pre-Sales Executive'), '/fo-activities'), false);
  for (const path of ['/sites', '/fo-activities', '/fault-tracker', '/hospital-ticketing/nims/qpms', '/tasks', '/settings', '/settings/user-management']) {
    assert.equal(canAccessNavRoute(user('Pre-Sales'), path), false, path);
    assert.equal(canAccessNavRoute(user('Pre-Sales Manager'), path), false, `${path} legacy alias`);
  }
  assert.equal(canAccessNavRoute(user('Commercial Reviewer'), '/pre-sales'), false);
  assert.equal(canAccessNavRoute(user('Commercial Reviewer'), '/tasks'), true);
  assert.equal(canAccessNavRoute(user('Branch Head'), '/fo-activities'), true);
});
