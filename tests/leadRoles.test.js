import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  canAccessUserManagementAdmin,
  canManageHospitalFeedbackQr,
  canManageStoreMaster,
  canSendLeadMom,
  canAccessRoute,
  hasCooAuthority,
  hasCooWebVisibility,
  normalizeAppRole,
  normalizeCanonicalRole,
} from '../src/utils/authRoles.js';

const tasksSource = readFileSync(new URL('../src/pages/Tasks.jsx', import.meta.url), 'utf8');
const userFormSource = readFileSync(new URL('../src/components/user-management/UserFormDrawer.jsx', import.meta.url), 'utf8');

test('web canonical roles preserve BD and management distinctions', () => {
  const cases = {
    'bd executive': 'BD Executive',
    BUSINESS_DEVELOPMENT_EXECUTIVE: 'BD Executive',
    'bd head': 'BD Head',
    business_development_head: 'BD Head',
    business_head: 'Business Head',
    branch_head: 'Branch Head',
    admin: 'Admin',
    qpms_admin: 'QPMS Admin',
    dev: 'Developer',
    coo: 'COO',
    executive_assistant: 'Executive Assistant',
    gm: 'GM',
    general_manager: 'GM',
    md: 'MD',
  };
  Object.entries(cases).forEach(([input, expected]) => assert.equal(normalizeCanonicalRole(input), expected));
});

test('Executive Assistant is a distinct web visibility role, not COO identity', () => {
  const assistant = { role: 'Executive Assistant', rawRole: 'Executive Assistant' };
  assert.equal(normalizeCanonicalRole('Executive Assistant'), 'Executive Assistant');
  assert.equal(normalizeAppRole('Executive Assistant'), 'Management');
  assert.equal(hasCooWebVisibility(assistant), true);
  assert.equal(hasCooAuthority(assistant), false);
  assert.equal(hasCooWebVisibility({ role: 'COO', rawRole: 'COO' }), true);
  assert.equal(hasCooAuthority({ role: 'COO', rawRole: 'COO' }), true);
});

test('web MOM access uses the approved canonical roles only', () => {
  for (const role of ['BD Executive', 'Admin', 'COO', 'GM', 'MD']) {
    assert.equal(canSendLeadMom({ role, rawRole: role }), true, role);
  }
  for (const role of ['BD Head', 'Business Head', 'Branch Head', 'Finance GM', 'FO', 'Executive Assistant']) {
    assert.equal(canSendLeadMom({ role, rawRole: role }), false, role);
  }
});

test('route grouping keeps distinct canonical roles authorized for CRM', () => {
  assert.equal(normalizeAppRole('BD Executive'), 'BD');
  assert.equal(normalizeAppRole('BD Head'), 'BD');
  for (const role of ['BD Executive', 'BD Head', 'Business Head', 'Branch Head', 'Admin', 'QPMS Admin', 'Developer', 'COO', 'GM', 'MD']) {
    assert.equal(canAccessRoute({ role, rawRole: role }, '/crm'), true, role);
  }
  assert.equal(canAccessRoute({ role: 'FO', rawRole: 'FO' }, '/crm'), false);
});

test('Executive Assistant gets COO-equivalent web visibility without admin mutation routes', () => {
  const assistant = { role: 'Executive Assistant', rawRole: 'Executive Assistant' };
  [
    '/dashboard',
    '/crm',
    '/site-monitoring',
    '/proposals',
    '/approvals',
    '/tasks',
    '/existing-business',
    '/fo-activities',
    '/tickets',
    '/operations/hospital-feedback/dashboard',
    '/settings/hospital-feedback/qr-generator',
    '/fault-tracker',
    '/deep-cleaning',
    '/assets',
    '/reports',
    '/store-master',
    '/settings',
    '/employees',
  ].forEach((route) => assert.equal(canAccessRoute(assistant, route), true, route));
  assert.equal(canAccessRoute(assistant, '/settings/user-management'), false);
  assert.equal(canAccessUserManagementAdmin(assistant), false);
  assert.equal(canManageStoreMaster(assistant), false);
  assert.equal(canManageHospitalFeedbackQr(assistant), false);
});

test('Executive Assistant visibility does not show approval decision controls', () => {
  assert.match(tasksSource, /viewOnlyCooVisibility = hasCooWebVisibility\(user\) && !hasCooAuthority\(user\)/);
  assert.match(tasksSource, /const canDecideReview = !readOnlyDemo && !viewOnlyCooVisibility/);
  assert.match(tasksSource, /Approve, reject, rework and escalation controls are disabled/);
});

test('Executive Assistant can be selected with web-only defaults in User Management', () => {
  assert.match(userFormSource, /'MD', 'COO', 'Executive Assistant'/);
  assert.match(userFormSource, /mobile_access_enabled: value === 'Executive Assistant' \? false : current\.mobile_access_enabled/);
  assert.match(userFormSource, /web_access_enabled: value === 'Executive Assistant' \? true : current\.web_access_enabled/);
  assert.match(userFormSource, /payload\.designation = values\.user_type === 'client'[\s\S]*?: values\.designation \|\| null/);
});
