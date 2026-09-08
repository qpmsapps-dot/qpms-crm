import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildFieldOperationsAccessPreview,
  canFoUser,
  isProfileInOperationsCommandCenterScope,
  operationsCommandCenterAllowedEmployeeCodes,
} from '../services/foOperationalAccessService.js';

const active = (employee_code, role, state, business, extra = {}) => ({
  id: employee_code,
  employee_code,
  full_name: employee_code,
  role,
  state,
  business,
  status: 'Active',
  is_active: true,
  web_access_enabled: true,
  ...extra,
});

const configuredBranchHead = active('SENTHIL', 'Branch Head', 'TN', 'Reliance Retail', {
  fo_access_config: {
    active: true,
    role: 'branch_head',
    states: ['TN'],
    business_groups: ['reliance_retail'],
    businesses: ['Reliance Retail', 'Retail'],
    source: 'access_user_assignments',
  },
});

const profiles = [
  configuredBranchHead,
  active('DIRECT_OM', 'Operations Manager', 'TN', 'Reliance Retail'),
  active('INDIRECT_KAM', 'KAM', 'TN', 'Retail'),
  active('INDIRECT_FO', 'FO', 'TN', 'Reliance Retail'),
  active('PEER_BH', 'Branch Head', 'TN', 'Reliance Retail'),
  active('PEER_FO', 'FO', 'TN', 'Reliance Retail'),
  active('ARUN', 'South Head', 'TN', 'Reliance Retail'),
  active('COO', 'COO', 'TN', 'Reliance Retail'),
  active('MD', 'MD', 'TN', 'Reliance Retail'),
  active('TN_STANDALONE', 'FO', 'TN', 'Standalone'),
  active('KA_RR', 'FO', 'KA', 'Reliance Retail'),
];

const hierarchy = [
  { employee_code: 'SENTHIL', manager_employee_code: 'ARUN', is_active: true },
  { employee_code: 'DIRECT_OM', manager_employee_code: 'SENTHIL', is_active: true },
  { employee_code: 'INDIRECT_KAM', manager_employee_code: 'DIRECT_OM', is_active: true },
  { employee_code: 'INDIRECT_FO', manager_employee_code: 'INDIRECT_KAM', is_active: true },
  { employee_code: 'PEER_BH', manager_employee_code: 'ARUN', is_active: true },
  { employee_code: 'PEER_FO', manager_employee_code: 'PEER_BH', is_active: true },
  { employee_code: 'ARUN', manager_employee_code: 'COO', is_active: true },
  { employee_code: 'COO', manager_employee_code: 'MD', is_active: true },
  { employee_code: 'TN_STANDALONE', manager_employee_code: 'SENTHIL', is_active: true },
  { employee_code: 'KA_RR', manager_employee_code: 'SENTHIL', is_active: true },
  { employee_code: 'CYCLE', manager_employee_code: 'INDIRECT_FO', is_active: true },
  { employee_code: 'SENTHIL', manager_employee_code: 'CYCLE', is_active: true },
];

test('configured Branch Head keeps Command Center capability', () => {
  assert.equal(canFoUser(configuredBranchHead, 'MAP_VIEW'), true);
});

test('configured Branch Head scope intersects state/business with recursive descendants', () => {
  const allowed = operationsCommandCenterAllowedEmployeeCodes(configuredBranchHead, profiles, hierarchy);

  assert.deepEqual([...allowed].sort(), ['DIRECT_OM', 'INDIRECT_FO', 'INDIRECT_KAM', 'SENTHIL']);
  assert.equal(isProfileInOperationsCommandCenterScope(configuredBranchHead, profiles[1], profiles, hierarchy), true);
  assert.equal(isProfileInOperationsCommandCenterScope(configuredBranchHead, profiles[3], profiles, hierarchy), true);
  for (const denied of profiles.slice(4)) {
    assert.equal(isProfileInOperationsCommandCenterScope(configuredBranchHead, denied, profiles, hierarchy), false);
  }
});

test('configured Branch Head preview uses the same hierarchy-scoped employee set', () => {
  const preview = buildFieldOperationsAccessPreview(configuredBranchHead, profiles, hierarchy);

  assert.equal(preview.visible_employee_count, 4);
  assert.deepEqual(
    preview.visible_employees.map((employee) => employee.employee_code).sort(),
    ['DIRECT_OM', 'INDIRECT_FO', 'INDIRECT_KAM', 'SENTHIL'],
  );
});

test('configured GM scope behavior remains state/business based pending separate hierarchy review', () => {
  const gm = active('GM1', 'GM', 'TN', 'Reliance Retail', {
    fo_access_config: {
      active: true,
      role: 'gm',
      states: ['TN'],
      business_groups: ['reliance_retail'],
      businesses: ['Reliance Retail', 'Retail'],
      source: 'access_user_assignments',
    },
  });
  const allowed = operationsCommandCenterAllowedEmployeeCodes(gm, [...profiles, gm], []);

  assert.equal(allowed.has('DIRECT_OM'), true);
  assert.equal(allowed.has('PEER_BH'), true);
  assert.equal(allowed.has('TN_STANDALONE'), false);
});
