import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  ALL_BUSINESSES_SCOPE,
  ALL_STATES_SCOPE,
  businessScopeAllows,
  normalizeBusinessScopeValue,
  normalizeStateScopeValue,
  stateScopeAllows,
} from '../services/workMappingScope.js';
import { foOperationalAllowedEmployeeCodes } from '../services/foOperationalAccessService.js';

test('work mapping stores explicit canonical All values without treating blanks as All', () => {
  assert.equal(normalizeStateScopeValue('all'), ALL_STATES_SCOPE);
  assert.equal(normalizeBusinessScopeValue('ALL_BUSINESS'), ALL_BUSINESSES_SCOPE);
  assert.equal(normalizeStateScopeValue(''), '');
  assert.equal(normalizeBusinessScopeValue(null), '');
  assert.equal(stateScopeAllows('', 'TN'), false);
  assert.equal(businessScopeAllows('', 'Standalone'), false);
});

test('state scope supports canonical codes, display names, legacy AP, and All States', () => {
  assert.equal(stateScopeAllows('TN', 'Tamil Nadu'), true);
  assert.equal(stateScopeAllows('TN', 'KA'), false);
  assert.equal(stateScopeAllows('AP-1', 'Andhra Pradesh - 1'), true);
  assert.equal(stateScopeAllows('AP-2', 'Andhra Pradesh - 1'), false);
  assert.equal(stateScopeAllows('AP', 'Andhra Pradesh - 2'), true);
  assert.equal(stateScopeAllows(ALL_STATES_SCOPE, 'TG'), true);
});

test('business scope skips only its own predicate for All Businesses', () => {
  assert.equal(businessScopeAllows('Reliance Retail', 'Reliance Retail'), true);
  assert.equal(businessScopeAllows('Reliance Retail', 'Standalone'), false);
  assert.equal(businessScopeAllows(ALL_BUSINESSES_SCOPE, 'Private Clients'), true);
});

test('User Management offers explicit All options first and preserves existing custom mappings', () => {
  const source = readFileSync('src/components/user-management/UserFormDrawer.jsx', 'utf8');
  assert.match(source, /const stateOptions = \['All States', 'TN', 'KL', 'KA', 'TG', 'AP-1', 'AP-2'\]/);
  assert.match(source, /const businessOptions = \[\s*'All Businesses',\s*'Standalone'/);
  assert.match(source, /return exists \? stateOptions : \[\.\.\.stateOptions, current\]/);
  assert.match(source, /return exists \? businessOptions : \[\.\.\.businessOptions, current\]/);
  assert.match(source, /options=\{resolvedStateOptions\}/);
  assert.match(source, /options=\{resolvedBusinessOptions\}/);
});

test('profiles state and business storage is unconstrained nullable text so no migration is required', () => {
  const profiles = readFileSync('supabase/migrations_2_0/001_profiles_auth.sql', 'utf8');
  const registration = readFileSync('supabase/migrations_2_0/006_registration_structure.sql', 'utf8');
  assert.match(profiles, /state text/);
  assert.match(registration, /add column if not exists business text/);
  assert.doesNotMatch(`${profiles}\n${registration}`, /check\s*\([^)]*(state|business)/i);
});

test('lead create and update enforce work mapping before their atomic RPCs', () => {
  const server = readFileSync('backend/server.js', 'utf8');
  const createStart = server.indexOf('async function createLeadManagement');
  const updateStart = server.indexOf('async function updateLeadManagement');
  const createSource = server.slice(createStart, updateStart);
  const updateSource = server.slice(updateStart, server.indexOf('async function listLeadAssignees', updateStart));
  assert.ok(createSource.indexOf('leadMatchesActorWorkMapping') < createSource.indexOf("client.rpc('rpc_create_bd_lead_atomic'"));
  assert.ok(updateSource.indexOf('leadMatchesActorWorkMapping') < updateSource.indexOf("client.rpc('rpc_update_bd_lead_atomic'"));
  assert.match(createSource, /lead_work_mapping_denied/);
  assert.match(updateSource, /lead_work_mapping_denied/);
});

test('Operations Manager All States keeps reporting hierarchy and applies a specific business', () => {
  const actor = {
    employee_code: 'OM-1', role: 'Operations Manager', state: 'All States', business: 'Reliance Retail',
    is_active: true, status: 'Active',
  };
  const profiles = [
    actor,
    { employee_code: 'FO-TN', role: 'FO', state: 'TN', business: 'Reliance Retail', is_active: true, status: 'Active' },
    { employee_code: 'FO-KA', role: 'FO', state: 'KA', business: 'Reliance Retail', is_active: true, status: 'Active' },
    { employee_code: 'FO-OTHER', role: 'FO', state: 'TN', business: 'Standalone', is_active: true, status: 'Active' },
    { employee_code: 'FO-UNRELATED', role: 'FO', state: 'KL', business: 'Reliance Retail', is_active: true, status: 'Active' },
  ];
  const hierarchy = [
    { employee_code: 'FO-TN', manager_employee_code: 'OM-1', is_active: true },
    { employee_code: 'FO-KA', manager_employee_code: 'OM-1', is_active: true },
    { employee_code: 'FO-OTHER', manager_employee_code: 'OM-1', is_active: true },
    { employee_code: 'FO-UNRELATED', manager_employee_code: 'OM-2', is_active: true },
  ];
  assert.deepEqual(
    [...foOperationalAllowedEmployeeCodes(actor, profiles, hierarchy)].sort(),
    ['FO-KA', 'FO-TN', 'OM-1'],
  );
});
