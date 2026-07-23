import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const server = readFileSync('backend/server.js', 'utf8');
const drawer = readFileSync('src/components/user-management/UserFormDrawer.jsx', 'utf8');
const details = readFileSync('src/components/user-management/EmployeeDetailsDrawer.jsx', 'utf8');
const api = readFileSync('src/services/api.js', 'utf8');

test('Invite User drawer exposes unified access selectors and user type split', () => {
  for (const label of [
    'Internal User',
    'Client User',
    'Business Vertical',
    'Client',
    'Module',
    'Scope Type',
    'Scope Value',
    'Unified Module Access',
  ]) {
    assert.match(drawer, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(drawer, /values\.user_type !== 'client' \? <section/);
  assert.match(drawer, /Reporting Hierarchy/);
});

test('Invite User drawer uses live access foundation and scope options', () => {
  assert.match(drawer, /getAccessFoundation\(\)/);
  assert.match(drawer, /getAccessScopeOptions/);
  assert.match(drawer, /business_vertical_modules/);
  assert.match(drawer, /client_modules/);
  assert.doesNotMatch(drawer, /NIMS Hyderabad|Reliance Retail Block A|Block A/);
});

test('Invite User payload includes one unified assignment and scope without passwords', () => {
  assert.match(drawer, /access_assignment/);
  assert.match(drawer, /business_vertical_id: values\.access_business_vertical_id/);
  assert.match(drawer, /module_id: values\.access_module_id/);
  assert.match(drawer, /role_id: values\.access_role_id/);
  assert.match(drawer, /scope_type: values\.access_scope_type/);
  assert.doesNotMatch(drawer, /temporary_password/);
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
