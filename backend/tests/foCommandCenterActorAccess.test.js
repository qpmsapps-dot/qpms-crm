import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  canAccessFoOperations,
  canAccessOperationsCommandCenter,
  operationsCommandCenterAllowedEmployeeCodes,
} from '../services/foOperationalAccessService.js';

const profile = (role, employeeCode = role.replace(/\W+/g, '-').toUpperCase(), extra = {}) => ({
  id: employeeCode,
  employee_code: employeeCode,
  full_name: employeeCode,
  role,
  state: 'TN',
  business: 'Reliance Retail',
  status: 'Active',
  is_active: true,
  web_access_enabled: true,
  ...extra,
});

test('Command Center actor access stops at Branch Head', () => {
  for (const role of ['Admin', 'MD', 'COO', 'Executive Assistant', 'GM', 'South Head', 'Business Head', 'Branch Head', 'DEMO_VIEWER']) {
    assert.equal(canAccessOperationsCommandCenter(profile(role)), true, role);
  }
  for (const role of ['Operations Manager', 'Operations Team', 'KAM', 'FO', 'Field Officer']) {
    assert.equal(canAccessOperationsCommandCenter(profile(role)), false, role);
  }
});

test('operational employees remain data subjects after their actor access is removed', () => {
  for (const role of ['Operations Manager', 'KAM', 'FO']) {
    assert.equal(canAccessFoOperations(profile(role)), true, role);
  }

  const branchHead = profile('Branch Head', 'BH-001', {
    fo_access_config: {
      active: true,
      role: 'Branch Head',
      states: ['TN'],
      business_groups: ['reliance_retail'],
      businesses: ['Reliance Retail'],
    },
  });
  const profiles = [
    branchHead,
    profile('Operations Manager', 'OM-001'),
    profile('KAM', 'KAM-001'),
    profile('FO', 'FO-001'),
    profile('Branch Head', 'BH-002'),
    profile('FO', 'FO-OTHER'),
    profile('FO', 'FO-KA', { state: 'KA' }),
    profile('FO', 'FO-STANDALONE', { business: 'Standalone' }),
  ];
  const hierarchy = [
    { employee_code: 'OM-001', manager_employee_code: 'BH-001', is_active: true },
    { employee_code: 'KAM-001', manager_employee_code: 'OM-001', is_active: true },
    { employee_code: 'FO-001', manager_employee_code: 'KAM-001', is_active: true },
    { employee_code: 'FO-OTHER', manager_employee_code: 'BH-002', is_active: true },
    { employee_code: 'FO-KA', manager_employee_code: 'BH-001', is_active: true },
    { employee_code: 'FO-STANDALONE', manager_employee_code: 'BH-001', is_active: true },
  ];

  assert.deepEqual(
    [...operationsCommandCenterAllowedEmployeeCodes(branchHead, profiles, hierarchy)].sort(),
    ['BH-001', 'FO-001', 'KAM-001', 'OM-001'],
  );
});

test('every web Command Center read and export route uses the actor middleware', async () => {
  const source = await readFile(new URL('../server.js', import.meta.url), 'utf8');
  for (const route of [
    '/api/fo/operations/summary',
    '/api/fo/operations/employee-range',
    '/api/fo/reports/consolidated-travel-claims/pdf',
    '/api/fo/operations/dashboard',
    '/api/fo/operations/demo-date-range',
  ]) {
    const index = source.indexOf(`'${route}'`);
    assert.notEqual(index, -1, route);
    assert.match(source.slice(index, index + 240), /requireFoOperationsCommandCenter/, route);
  }
  const drilldownIndex = source.indexOf("'/api/fo/operations/employee-drilldown'");
  assert.notEqual(drilldownIndex, -1);
  assert.match(source.slice(drilldownIndex, drilldownIndex + 320), /requireFoOperationsCommandCenter/);
  assert.match(source, /function requireFoOperationsCommandCenter[\s\S]*canAccessOperationsCommandCenter\(request\.profile \|\| \{\}\)[\s\S]*response\.status\(403\)/);
});
