import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
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

test('managerial Operations roles use the Operations sidebar without changing other role presets', () => {
  for (const role of ['Operations Manager', 'Business Head', 'Branch Head', 'South Head', 'KAM']) {
    assert.equal(usesOperationsSidebar(user(role)), true, role);
  }
  for (const role of ['Operations Team', 'Manager', 'Commercial Reviewer', 'HR Reviewer', 'Finance Reviewer']) {
    assert.equal(usesOperationsSidebar(user(role)), false, role);
  }
  for (const role of ['Admin', 'GM', 'COO', 'Executive Assistant']) {
    assert.equal(usesOperationsSidebar(user(role)), false, role);
    assert.equal(canAccessRoute(user(role), '/fo-activities'), true, role);
  }
  assert.equal(canAccessRoute(user('Commercial Reviewer'), '/fo-activities'), false);
});

test('Operations sidebar remains filtered by route authorization and keeps Fault Tracker append logic', () => {
  assert.match(sidebarSource, /items\.filter\(\(item\) => \{[\s\S]*canAccessNavRoute\(user, routePath\)/);
  assert.match(sidebarSource, /const canSeeFaultTracker = canAccessNavRoute\(user, '\/fault-tracker'\)/);
  assert.match(sidebarSource, /canSeeFaultTracker && !baseNavGroups\.some/);
  assert.equal(canAccessNavRoute(user('Branch Head'), '/store-master'), false);
  assert.equal(canAccessNavRoute(user('Branch Head'), '/fo-activities'), true);
});
