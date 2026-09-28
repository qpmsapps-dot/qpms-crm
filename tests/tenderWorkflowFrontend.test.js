import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canAccessRoute, normalizeCanonicalRole, routeAllowedRoles } from '../src/utils/authRoles.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const page = read('../src/pages/TenderWorkspace.jsx');
const sidebar = read('../src/components/Sidebar.jsx');
const routes = read('../src/routes/AppRoutes.jsx');
const userForm = read('../src/components/user-management/UserFormDrawer.jsx');

test('Tender is canonical, selectable, routed, and has a top-level Tender/Admin workspace only', () => {
  assert.equal(normalizeCanonicalRole('Tender'), 'Tender');
  assert.deepEqual(routeAllowedRoles('/tender'), ['Admin', 'Tender', 'BD', 'HR', 'Commercial', 'Finance', 'FinanceLeadership']);
  assert.equal(canAccessRoute({ role: 'Tender' }, '/tender'), true);
  assert.equal(canAccessRoute({ role: 'Pre-Sales' }, '/tender'), false);
  assert.match(sidebar, /label: 'Tender', to: '\/tender'/);
  assert.match(sidebar, /canonicalRole === 'Tender'/);
  assert.match(routes, /path: 'tender', element: <TenderWorkspace/);
  assert.match(userForm, /'Tender'/);
  assert.doesNotMatch(userForm, /Tender Head/);
});

test('Tender workspace exposes controlled queues, ownership, versioning, preview, review and tracking', () => {
  for (const label of ['New Queue', 'My Work', 'Rework', 'Submitted for Approval', 'Approval Tracking', 'Completed', 'Take Task', 'Upload New Version', 'Submit for Approval', 'View Excel', 'Download Excel', 'Approve']) {
    assert.match(page, new RegExp(label), label);
  }
  assert.match(page, /XLSX\.read/);
  assert.match(page, /worksheet|SheetNames/i);
  assert.match(page, /rework_remarks|required|window\.prompt/i);
  assert.match(page, /Tender Owner/);
  assert.match(page, /BD Owner/);
  assert.match(page, /Pending With/);
});
