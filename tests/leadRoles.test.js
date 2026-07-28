import test from 'node:test';
import assert from 'node:assert/strict';

import {
  canSendLeadMom,
  canAccessRoute,
  normalizeAppRole,
  normalizeCanonicalRole,
} from '../src/utils/authRoles.js';

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
    gm: 'GM',
    general_manager: 'GM',
    md: 'MD',
  };
  Object.entries(cases).forEach(([input, expected]) => assert.equal(normalizeCanonicalRole(input), expected));
});

test('web MOM access uses the approved canonical roles only', () => {
  for (const role of ['BD Executive', 'Admin', 'COO', 'GM', 'MD']) {
    assert.equal(canSendLeadMom({ role, rawRole: role }), true, role);
  }
  for (const role of ['BD Head', 'Business Head', 'Branch Head', 'Finance GM', 'FO']) {
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
