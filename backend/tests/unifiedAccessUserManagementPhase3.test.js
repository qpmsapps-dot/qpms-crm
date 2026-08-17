import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const server = readFileSync('backend/server.js', 'utf8');
const drawer = readFileSync('src/components/user-management/UserFormDrawer.jsx', 'utf8');
const details = readFileSync('src/components/user-management/EmployeeDetailsDrawer.jsx', 'utf8');
const api = readFileSync('src/services/api.js', 'utf8');

test('Invite User drawer exposes temporary QPMS employee and NIMS contact split', () => {
  for (const label of [
    'QPMS Employee',
    'NIMS Client Person',
    'Registered mobile only',
    'Hospital Supervisor',
    'Operations Executive',
    'Facility Manager',
    'Project Head',
    'Register Person',
    'Client',
  ]) {
    assert.match(drawer, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(drawer, /values\.user_type === 'nims_contact'/);
  assert.match(drawer, /Base\/Application Role/);
  assert.match(drawer, /Enable Hospital Ticketing/);
});

test('Invite User drawer uses live foundation to resolve NIMS client options', () => {
  assert.match(drawer, /getAccessFoundation\(\)/);
  assert.match(drawer, /foundation\.clients/);
  assert.match(drawer, /text\.includes\('nims'\)/);
  assert.doesNotMatch(drawer, /Reliance Retail Block A|Block A/);
});

test('Invite User payload keeps unified assignment separate from optional temporary password', () => {
  assert.match(drawer, /access_assignment/);
  assert.match(drawer, /business_vertical_id: values\.access_business_vertical_id/);
  assert.match(drawer, /module_id: values\.access_module_id/);
  assert.match(drawer, /role_id: values\.access_role_id/);
  assert.match(drawer, /scope_type: values\.access_scope_type/);
  assert.match(drawer, /Temporary Password/);
  assert.match(drawer, /payload\.temporary_password = values\.temporary_password/);
});

test('backend creates unified assignment, scope and audit through admin invite route', () => {
  assert.match(server, /createUnifiedAccessForProfile/);
  assert.match(server, /\.from\('access_user_assignments'\)[\s\S]*\.insert/);
  assert.match(server, /\.from\('access_user_scopes'\)[\s\S]*\.insert/);
  assert.match(server, /\.from\('access_audit_logs'\)\.insert/);
  assert.match(server, /requireSupabaseJwt,\s*\n\s*requireUserManagementPermission,\s*\n\s*async \(request, response\) =>/);
});

test('backend supports client-user roles without employee hierarchy', () => {
  assert.match(server, /CLIENT_CREATE_ROLE_KEYS/);
  assert.match(server, /Client User role must be Hospital Management \/ RMO or Doctor/);
  assert.match(server, /userType === 'client'[\s\S]*hierarchyFields: \{\}/);
  assert.match(server, /userType !== 'client'[\s\S]*saveHierarchy/);
  assert.match(server, /TEMPORARY_NIMS_INTERNAL_HOSPITAL_ROLES/);
  assert.match(server, /temporary_nims_profile_role: 'FO'/);
});

test('foundation endpoint returns module enablement mappings and scope endpoint is protected', () => {
  assert.match(server, /business_vertical_modules: verticalModules\.rows/);
  assert.match(server, /client_modules: clientModules\.rows/);
  assert.match(server, /'\/api\/access\/scope-options'/);
  assert.match(server, /'\/api\/access\/scope-options'[\s\S]*requireSupabaseJwt,\s*\n\s*requireUserManagementPermission/);
  assert.match(api, /getAccessScopeOptions/);
});

test('employee details drawer displays unified access summaries', () => {
  assert.match(details, /Unified Access/);
  assert.match(details, /Business Vertical/);
  assert.match(details, /Assignment status/);
  assert.match(details, /Effective dates/);
});
