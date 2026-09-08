import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { assertMissingKmReviewerNotTarget } from '../foKmRecalculationService.js';
import {
  isProfileInOperationsCommandCenterScope,
} from '../services/foOperationalAccessService.js';

const kmServiceSource = readFileSync(new URL('../foKmRecalculationService.js', import.meta.url), 'utf8');

const active = (employee_code, role, state = 'TN', business = 'Reliance Retail', extra = {}) => ({
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

const configured = (employeeCode, role) => active(employeeCode, role, 'TN', 'Reliance Retail', {
  fo_access_config: {
    active: true,
    role,
    states: ['TN'],
    business_groups: ['reliance_retail'],
    businesses: ['Reliance Retail', 'Retail'],
    source: 'access_user_assignments',
  },
});

const gm = active('GM-001', 'GM');
const branchHead = configured('BH-001', 'Branch Head');
const operationsManager = active('OM-001', 'Operations Manager');
const kam = active('KAM-001', 'KAM');
const fo = active('FO-001', 'FO');
const peerBranchHead = active('BH-002', 'Branch Head');
const peerFo = active('FO-002', 'FO');
const wrongState = active('FO-KA', 'FO', 'KA', 'Reliance Retail');
const wrongBusiness = active('FO-TN-ST', 'FO', 'TN', 'Standalone');
const profiles = [gm, branchHead, operationsManager, kam, fo, peerBranchHead, peerFo, wrongState, wrongBusiness];
const hierarchy = [
  { employee_code: 'BH-001', manager_employee_code: 'GM-001', is_active: true },
  { employee_code: 'OM-001', manager_employee_code: 'BH-001', is_active: true },
  { employee_code: 'KAM-001', manager_employee_code: 'OM-001', is_active: true },
  { employee_code: 'FO-001', manager_employee_code: 'KAM-001', is_active: true },
  { employee_code: 'BH-002', manager_employee_code: 'GM-001', is_active: true },
  { employee_code: 'FO-002', manager_employee_code: 'BH-002', is_active: true },
  { employee_code: 'FO-KA', manager_employee_code: 'BH-001', is_active: true },
  { employee_code: 'FO-TN-ST', manager_employee_code: 'BH-001', is_active: true },
];

test('Branch Head, Operations Manager, and KAM cannot approve their own Missing KM review', () => {
  for (const actor of [branchHead, operationsManager, kam]) {
    assert.throws(
      () => assertMissingKmReviewerNotTarget({ employee_code: actor.employee_code }, actor),
      (error) => error.statusCode === 403 && /cannot approve your own/i.test(error.message),
      actor.role,
    );
  }
});

test('the authoritative Missing KM mutation checks self-approval before processing approval', () => {
  const decision = kmServiceSource.slice(
    kmServiceSource.indexOf('export async function decideMissingKmReview'),
    kmServiceSource.indexOf('export async function reconcileFinalLegOnlyBatch'),
  );
  assert.match(decision, /if \(normalizedAction === 'approve'\) \{\s*assertMissingKmReviewerNotTarget\(review, actor\);/);
  assert.match(decision, /\.update\(update\)/);
});

test('self-approval guard permits a different employee and preserves legitimate approval flow', () => {
  assert.doesNotThrow(() => assertMissingKmReviewerNotTarget({ employee_code: fo.employee_code }, branchHead));
  assert.equal(isProfileInOperationsCommandCenterScope(branchHead, operationsManager, profiles, hierarchy), true);
  assert.equal(isProfileInOperationsCommandCenterScope(branchHead, kam, profiles, hierarchy), true);
  assert.equal(isProfileInOperationsCommandCenterScope(branchHead, fo, profiles, hierarchy), true);
});

test('existing target scope still blocks ancestors, peers, other teams, state, and business', () => {
  for (const target of [gm, peerBranchHead, peerFo, wrongState, wrongBusiness]) {
    assert.equal(
      isProfileInOperationsCommandCenterScope(branchHead, target, profiles, hierarchy),
      false,
      target.employee_code,
    );
  }
});
