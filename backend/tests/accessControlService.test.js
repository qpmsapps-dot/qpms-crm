import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateUnifiedAssignments,
  legacyHospitalAccessFromRows,
  resolveCurrentUserAccess,
  accessResponseForClient,
} from '../services/accessControlService.js';

const now = new Date('2026-07-22T08:00:00.000Z');
const authUserId = '00000000-0000-4000-8000-000000000001';
const profileId = '00000000-0000-4000-8000-000000000002';
const verticalId = '00000000-0000-4000-8000-000000000010';
const otherVerticalId = '00000000-0000-4000-8000-000000000011';
const clientId = '00000000-0000-4000-8000-000000000020';
const otherClientId = '00000000-0000-4000-8000-000000000021';
const moduleId = '00000000-0000-4000-8000-000000000030';
const roleId = '00000000-0000-4000-8000-000000000040';
const permissionId = '00000000-0000-4000-8000-000000000050';
const assignmentId = '00000000-0000-4000-8000-000000000060';
const locationId = '00000000-0000-4000-8000-000000000080';

function baseRows(overrides = {}) {
  const assignment = {
    id: assignmentId,
    auth_user_id: authUserId,
    profile_id: profileId,
    business_vertical_id: verticalId,
    client_id: clientId,
    module_id: moduleId,
    role_id: roleId,
    active: true,
    verification_status: 'verified',
    effective_from: '2026-01-01T00:00:00.000Z',
    effective_to: null,
    source: 'test',
    ...overrides.assignment,
  };
  return {
    authUserId,
    profile: { id: profileId, auth_user_id: authUserId, employee_code: 'EMP-001', is_active: true, status: 'active' },
    assignments: [assignment],
    scopes: [{
      id: '00000000-0000-4000-8000-000000000070',
      user_assignment_id: assignment.id,
      scope_type: 'location',
      scope_id: locationId,
      allowed: true,
      ...overrides.scope,
    }],
    roles: [{ id: roleId, code: 'hospital_management', name: 'Hospital Management', user_type: 'client', active: true }],
    permissions: [{ id: permissionId, code: 'hospital_ticket.create', name: 'Create Ticket', module_id: moduleId, action: 'create', resource: 'hospital_ticket', active: true }],
    rolePermissions: [{ role_id: roleId, permission_id: permissionId, allowed: true }],
    modules: [{ id: moduleId, code: 'client_ticketing', name: 'Client Ticketing', active: true }],
    clients: [{ id: clientId, business_vertical_id: verticalId, code: 'hospital_client', name: 'Hospital Client', active: true }],
    businessVerticals: [{ id: verticalId, code: 'hospital', name: 'Hospital', active: true }],
    verticalModules: [{ business_vertical_id: verticalId, module_id: moduleId, enabled: true, effective_from: '2026-01-01T00:00:00.000Z' }],
    clientModules: [{ client_id: clientId, module_id: moduleId, enabled: true, effective_from: '2026-01-01T00:00:00.000Z' }],
    requestedModule: 'client_ticketing',
    requestedPermission: 'hospital_ticket.create',
    requestedClientId: clientId,
    requestedScopes: { location: locationId, client_id: clientId },
    now,
    ...overrides.root,
  };
}

function evaluate(overrides = {}) {
  return evaluateUnifiedAssignments(baseRows(overrides));
}

function legacyUserRow() {
  return {
    id: 'legacy-user',
    auth_user_id: authUserId,
    role_code: 'doctor',
    profile_type: 'client',
    client_id: clientId,
    is_active: true,
  };
}

function makeQuery(data, error = null) {
  const query = {
    select() { return query; },
    eq() { return query; },
    or() { return query; },
    in() { return query; },
    limit() { return query; },
    maybeSingle() {
      return Promise.resolve({
        data: Array.isArray(data) ? data[0] || null : data,
        error,
      });
    },
    then(resolve) {
      return Promise.resolve({ data, error }).then(resolve);
    },
  };
  return query;
}

function mockClient({ unifiedRows = [], tableMissing = false, legacyUser = legacyUserRow() } = {}) {
  return {
    from(table) {
      if (table.startsWith('access_') && tableMissing) {
        return makeQuery(null, { code: '42P01', message: 'relation does not exist' });
      }
      if (table === 'access_user_assignments') return makeQuery(unifiedRows);
      if (table === 'access_user_scopes') return makeQuery([{ user_assignment_id: assignmentId, scope_type: 'location', scope_id: locationId, allowed: true }]);
      if (table === 'access_roles') return makeQuery([{ id: roleId, code: 'hospital_management', user_type: 'client', active: true }]);
      if (table === 'access_modules') return makeQuery([{ id: moduleId, code: 'client_ticketing', active: true }]);
      if (table === 'access_clients') return makeQuery([{ id: clientId, business_vertical_id: verticalId, code: 'hospital_client', name: 'Hospital Client', active: true }]);
      if (table === 'access_business_verticals') return makeQuery([{ id: verticalId, code: 'hospital', name: 'Hospital', active: true }]);
      if (table === 'access_business_vertical_modules') return makeQuery([{ business_vertical_id: verticalId, module_id: moduleId, enabled: true }]);
      if (table === 'access_client_modules') return makeQuery([{ client_id: clientId, module_id: moduleId, enabled: true }]);
      if (table === 'access_role_permissions') return makeQuery([{ role_id: roleId, permission_id: permissionId, allowed: true }]);
      if (table === 'access_permissions') return makeQuery([{ id: permissionId, code: 'hospital_ticket.create', module_id: moduleId, active: true }]);
      if (table === 'hospital_ticket_users') return makeQuery(legacyUser);
      if (table === 'hospital_ticket_user_scopes') return makeQuery([{ scope_type: 'location', location_id: locationId, can_view: true, can_create: true }]);
      if (table === 'hospital_clients') return makeQuery([{ id: clientId, client_code: 'QPMS_HOSPITAL_UAT', client_name: 'QPMS Hospital UAT' }]);
      return makeQuery([]);
    },
  };
}

async function resolveWith({ unifiedRows = [], tableMissing = false, legacyUser = legacyUserRow() } = {}) {
  return resolveCurrentUserAccess({
    client: mockClient({ unifiedRows, tableMissing, legacyUser }),
    authUser: { id: authUserId, email: 'user@example.test' },
    profile: { id: profileId, auth_user_id: authUserId, is_active: true, status: 'active' },
    requestedModule: 'client_ticketing',
    requestedPermission: 'hospital_ticket.create',
    requestedClientId: clientId,
    requestedScopes: { location: locationId, client_id: clientId },
    now,
  });
}

test('valid unified assignment grants access and does not expose raw assignment id', () => {
  const result = evaluate();
  assert.equal(result.granted, true);
  assert.equal(result.totalAssignmentRowsFound, 1);
  assert.equal(result.assignments[0].id, undefined);
  assert.deepEqual(result.assignments[0].permissions, ['hospital_ticket.create']);
});

test('invalid unified assignments are invalid and counted separately from valid grants', () => {
  for (const assignment of [
    { active: false },
    { verification_status: 'draft' },
    { verification_status: 'rejected' },
    { verification_status: 'inactive' },
    { effective_to: '2026-07-01T00:00:00.000Z' },
    { effective_from: '2026-08-01T00:00:00.000Z' },
  ]) {
    const result = evaluate({ assignment });
    assert.equal(result.granted, false);
    assert.equal(result.totalAssignmentRowsFound, 1);
  }
});

test('disabled foundation rows deny unified access', () => {
  assert.equal(evaluate({ root: { roles: [{ id: roleId, code: 'hospital_management', user_type: 'client', active: false }] } }).granted, false);
  assert.equal(evaluate({ root: { clients: [{ id: clientId, business_vertical_id: verticalId, code: 'hospital_client', active: false }] } }).granted, false);
  assert.equal(evaluate({ root: { businessVerticals: [{ id: verticalId, code: 'hospital', active: false }] } }).granted, false);
  assert.equal(evaluate({ root: { verticalModules: [{ business_vertical_id: verticalId, module_id: moduleId, enabled: false }] } }).granted, false);
  assert.equal(evaluate({ root: { clientModules: [{ client_id: clientId, module_id: moduleId, enabled: false }] } }).granted, false);
});

test('legacy fallback occurs only for zero unified rows or unavailable access tables', async () => {
  assert.equal((await resolveWith({ unifiedRows: [] })).source, 'legacy_hospital');
  assert.equal((await resolveWith({ tableMissing: true })).source, 'legacy_hospital');
  const noAccess = await resolveWith({ unifiedRows: [], legacyUser: null });
  assert.equal(noAccess.source, 'none');
  assert.equal(noAccess.access_granted, false);
});

test('valid unified row wins over valid legacy access without union', async () => {
  const result = await resolveWith({ unifiedRows: baseRows().assignments });
  assert.equal(result.source, 'unified');
  assert.equal(result.assignments.length, 1);
  assert.equal(result.assignments[0].assignment_source, 'unified');
});

test('invalid, revoked or disabled unified rows deny and never fall back to legacy', async () => {
  const invalidRows = [
    { ...baseRows().assignments[0], active: false },
    { ...baseRows().assignments[0], verification_status: 'draft' },
    { ...baseRows().assignments[0], verification_status: 'rejected' },
    { ...baseRows().assignments[0], verification_status: 'inactive' },
    { ...baseRows().assignments[0], effective_to: '2026-07-01T00:00:00.000Z' },
    { ...baseRows().assignments[0], effective_from: '2026-08-01T00:00:00.000Z' },
    { ...baseRows().assignments[0], role_id: 'missing-role' },
    { ...baseRows().assignments[0], client_id: 'missing-client' },
    { ...baseRows().assignments[0], business_vertical_id: 'missing-vertical' },
  ];
  for (const row of invalidRows) {
    const result = await resolveWith({ unifiedRows: [row] });
    assert.equal(result.source, 'unified_denied');
    assert.equal(result.access_granted, false);
    assert.equal(result.assignments.length, 0);
  }
});

test('empty scopes deny scoped requests and global requires explicit global scope', () => {
  assert.equal(evaluate({ root: { scopes: [] } }).granted, false);
  assert.equal(evaluate({ root: { scopes: [{ user_assignment_id: assignmentId, scope_type: 'global', allowed: true }] } }).granted, true);
});

test('unknown, blank and malformed scopes deny access', () => {
  assert.equal(evaluate({ scope: { scope_type: 'unknown', scope_id: locationId } }).granted, false);
  assert.equal(evaluate({ scope: { scope_type: 'location', scope_id: '   ' } }).granted, false);
  assert.equal(evaluate({ scope: { scope_type: 'location', scope_id: "bad\u0000value" } }).granted, false);
});

test('business_vertical scope matches only vertical resource and does not overmatch client/location', () => {
  assert.equal(evaluate({
    scope: { scope_type: 'business_vertical', scope_id: verticalId },
    root: { requestedScopes: { business_vertical: verticalId } },
  }).granted, true);
  assert.equal(evaluate({
    scope: { scope_type: 'business_vertical', scope_id: verticalId },
    root: { requestedScopes: { client_id: clientId } },
  }).granted, false);
});

test('client and all_client scopes are bounded to the assignment client', () => {
  assert.equal(evaluate({ scope: { scope_type: 'client', scope_id: clientId }, root: { requestedScopes: { client_id: clientId } } }).granted, true);
  assert.equal(evaluate({ scope: { scope_type: 'client', scope_id: clientId }, root: { requestedScopes: { client_id: otherClientId }, requestedClientId: otherClientId } }).granted, false);
  assert.equal(evaluate({ scope: { scope_type: 'all_client', scope_id: null }, root: { requestedScopes: { client_id: clientId, location: locationId } } }).granted, true);
  assert.equal(evaluate({ scope: { scope_type: 'all_client', scope_id: null }, root: { requestedScopes: { client_id: otherClientId }, requestedClientId: otherClientId } }).granted, false);
});

test('state, branch, site, store, hospital block, floor, location, department and assigned-ticket scopes require exact resource matches', () => {
  for (const [scopeType, value] of [
    ['state', 'TG'],
    ['branch', 'HYD-01'],
    ['site', 'site-1'],
    ['store', 'store-1'],
    ['hospital_block', 'block-1'],
    ['floor', 'floor-1'],
    ['location', locationId],
    ['department', 'dept-1'],
    ['assigned_ticket', 'ticket-1'],
  ]) {
    assert.equal(evaluate({ scope: { scope_type: scopeType, scope_code: value, scope_id: null }, root: { requestedScopes: { [scopeType]: value } } }).granted, true);
    assert.equal(evaluate({ scope: { scope_type: scopeType, scope_code: value, scope_id: null }, root: { requestedScopes: { [scopeType]: 'other' } } }).granted, false);
  }
});

test('employee_self scope allows only the current authenticated/profile/employee identity', () => {
  assert.equal(evaluate({ scope: { scope_type: 'employee_self', scope_id: null }, root: { requestedScopes: { auth_user_id: authUserId } } }).granted, true);
  assert.equal(evaluate({ scope: { scope_type: 'employee_self', scope_id: null }, root: { requestedScopes: { profile_id: profileId } } }).granted, true);
  assert.equal(evaluate({ scope: { scope_type: 'employee_self', scope_id: null }, root: { requestedScopes: { employee_code: 'EMP-001' } } }).granted, true);
  assert.equal(evaluate({ scope: { scope_type: 'employee_self', scope_id: null }, root: { requestedScopes: { employee_code: 'EMP-002' } } }).granted, false);
});

test('scope cannot grant a permission the role does not have', () => {
  assert.equal(evaluate({
    root: { requestedPermission: 'hospital_ticket.resolve' },
  }).granted, false);
});

test('legacy hospital fallback maps existing roles without over-granting', () => {
  const clientAssignment = legacyHospitalAccessFromRows({
    user: { id: 'legacy-user', role_code: 'doctor', profile_type: 'client', client_id: clientId, is_active: true },
    scopes: [{ scope_type: 'location', location_id: locationId, can_view: true, can_create: true }],
    client: { id: clientId, client_code: 'QPMS_HOSPITAL_UAT', client_name: 'QPMS Hospital UAT' },
  });
  assert.equal(clientAssignment.module.code, 'client_ticketing');
  assert(clientAssignment.permissions.includes('hospital_ticket.create'));
  assert(!clientAssignment.permissions.includes('hospital_ticket.resolve'));
});

test('/api/access/me response helper redacts database ids and internal fields', () => {
  const response = accessResponseForClient({
    ok: true,
    source: 'unified',
    unifiedAvailable: true,
    missingProfile: false,
    identity: {
      auth_user_id: authUserId,
      email: 'user@example.test',
      app_metadata: { provider: 'email' },
      user_metadata: { hidden: true },
    },
    assignments: [{
      id: assignmentId,
      module: { id: moduleId, code: 'client_ticketing' },
      permissions: ['hospital_ticket.view'],
      scopes: [{ id: 'scope-id', scope_type: 'location', scope_id: locationId }],
      metadata: { hidden: true },
    }],
  });
  assert.equal(response.ok, true);
  assert.equal(response.access_granted, true);
  assert.deepEqual(response.enabled_modules, ['client_ticketing']);
  assert.equal(response.assignments[0].id, undefined);
  assert.equal(response.assignments[0].metadata, undefined);
  assert.equal(response.assignments[0].scopes[0].id, undefined);
  assert.equal(response.identity.app_metadata, undefined);
  assert.equal(response.identity.user_metadata, undefined);
});
