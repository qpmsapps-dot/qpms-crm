import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  buildFoAccessMatrix,
  buildFieldOperationsAccessPreview,
  canFoUser,
  foOperationalAllowedEmployeeCodes,
  isProfileInOperationsCommandCenterScope,
  normalizeFoOperationalRole,
  operationsCommandCenterAllowedEmployeeCodes,
  resolveOperationsCommandCenterScope,
  resolveFoDataScope,
} from '../services/foOperationalAccessService.js';

const active = (overrides) => ({
  id: overrides.employee_code || overrides.role,
  status: 'Active',
  is_active: true,
  web_access_enabled: true,
  ...overrides,
});

test('normalizes FO Operations role aliases to canonical keys', () => {
  assert.equal(normalizeFoOperationalRole('Operations Manager'), 'OPERATIONSMANAGER');
  assert.equal(normalizeFoOperationalRole('OPERATIONS_MANAGER'), 'OPERATIONSMANAGER');
  assert.equal(normalizeFoOperationalRole('Operation Manager'), 'OPERATIONSMANAGER');
  assert.equal(normalizeFoOperationalRole('OM'), 'OPERATIONSMANAGER');
  assert.equal(normalizeFoOperationalRole('Branch Head'), 'BRANCHHEAD');
  assert.equal(normalizeFoOperationalRole('BH'), 'BRANCHHEAD');
  assert.equal(normalizeFoOperationalRole('QPMS Admin'), 'QPMSADMIN');
});

test('admin legacy scope remains global for active operational employees', () => {
  const profiles = [
    active({ employee_code: 'QPMSKA0001', role: 'FO', state: 'KA', business: 'Reliance Retail' }),
    active({ employee_code: 'QPMSTN0002', role: 'KAM', state: 'TN', business: 'Standalone' }),
    active({ employee_code: 'INACTIVE1', role: 'FO', state: 'KA', business: 'Reliance Retail', is_active: false }),
  ];

  const scope = resolveFoDataScope(active({ employee_code: 'ADMIN1', role: 'Admin' }), profiles, []);

  assert.equal(scope.scopeMode, 'LEGACY');
  assert.equal(scope.visibilityType, 'GLOBAL');
  assert.deepEqual(scope.employeeCodes, ['QPMSKA0001', 'QPMSTN0002']);
});

test('branch head legacy scope follows current state, business, and optional branch matching', () => {
  const actor = active({ employee_code: 'BHKA1', role: 'Branch Head', state: 'KA', business: 'Reliance Retail', branch: 'Bengaluru' });
  const profiles = [
    active({ employee_code: 'BHKA1', role: 'Branch Head', state: 'KA', business: 'Reliance Retail', branch: 'Bengaluru' }),
    active({ employee_code: 'FO1', role: 'FO', state: 'KA', business: 'Reliance Retail', branch: 'Bengaluru' }),
    active({ employee_code: 'FO2', role: 'FO', state: 'KA', business: 'Reliance Retail', branch: 'Mysuru' }),
    active({ employee_code: 'FO3', role: 'FO', state: 'TG', business: 'Reliance Retail', branch: 'Hyderabad' }),
  ];

  const codes = [...foOperationalAllowedEmployeeCodes(actor, profiles, [])].sort();

  assert.deepEqual(codes, ['BHKA1', 'FO1']);
});

test('operations manager legacy scope resolves reporting descendants plus self', () => {
  const actor = active({ employee_code: 'OM1', role: 'Operations Manager', state: 'KA', business: 'Reliance Retail' });
  const profiles = [
    actor,
    active({ employee_code: 'FO1', role: 'FO', state: 'KA', business: 'Reliance Retail' }),
    active({ employee_code: 'FO2', role: 'FO', state: 'KA', business: 'Reliance Retail' }),
  ];
  const hierarchy = [
    { employee_code: 'FO1', manager_employee_code: 'OM1', is_active: true },
    { employee_code: 'FO2', manager_employee_code: 'OM2', is_active: true },
  ];

  const scope = resolveFoDataScope(actor, profiles, hierarchy);

  assert.equal(scope.visibilityType, 'REPORTING_TREE');
  assert.deepEqual(scope.employeeCodes, ['FO1', 'OM1']);
});

test('FO legacy scope resolves to self only', () => {
  const actor = active({ employee_code: 'FO1', role: 'FO', state: 'KA', business: 'Reliance Retail' });
  const profiles = [
    actor,
    active({ employee_code: 'FO2', role: 'FO', state: 'KA', business: 'Reliance Retail' }),
  ];

  const scope = resolveFoDataScope(actor, profiles, []);

  assert.equal(scope.visibilityType, 'REPORTING_TREE');
  assert.deepEqual(scope.employeeCodes, ['FO1']);
});

test('executive assistant keeps COO-equivalent FO read visibility but not user write permission', () => {
  const actor = active({ employee_code: 'EA1', role: 'Executive Assistant' });
  const profiles = [
    active({ employee_code: 'FO1', role: 'FO', state: 'KA', business: 'Reliance Retail' }),
    active({ employee_code: 'KAM1', role: 'KAM', state: 'TN', business: 'Standalone' }),
  ];

  const scope = resolveFoDataScope(actor, profiles, []);

  assert.equal(scope.visibilityType, 'GLOBAL');
  assert.deepEqual(scope.employeeCodes, ['FO1', 'KAM1']);
  assert.equal(canFoUser(actor, 'MAP_VIEW'), true);
  assert.equal(canFoUser(actor, 'USER_CREATE'), false);
});

const commandCenterProfiles = [
  active({ employee_code: 'AP_RR', role: 'FO', state: 'AP', business: 'Reliance Retail' }),
  active({ employee_code: 'KA_RR', role: 'FO', state: 'KA', business: 'Reliance Retail' }),
  active({ employee_code: 'KL_RR', role: 'FO', state: 'KL', business: 'Retail' }),
  active({ employee_code: 'TG_RR', role: 'FO', state: 'TG', business: 'Reliance Retail' }),
  active({ employee_code: 'TN_RR', role: 'FO', state: 'TN', business: 'Reliance Retail' }),
  active({ employee_code: 'TN_ST', role: 'FO', state: 'TN', business: 'Standalone' }),
  active({ employee_code: 'KA_ST', role: 'FO', state: 'KA', business: 'Standalone' }),
  active({ employee_code: 'TG_ST', role: 'FO', state: 'TG', business: 'Standalone' }),
  active({ employee_code: 'NIMS1', role: 'FO', state: 'TG', business: 'Hospitals', metadata: { client_name: 'NIMS Hyderabad' } }),
];

test('Arun Prasad Command Center override sees Reliance Retail in all five states only', () => {
  const actor = active({ employee_code: 'QPMSTNC16972', role: 'GM', state: 'TN', business: 'Reliance Retail' });
  const codes = operationsCommandCenterAllowedEmployeeCodes(actor, commandCenterProfiles, []);
  const scope = resolveOperationsCommandCenterScope(actor);

  assert.equal(scope.scopeType, 'RELIANCE_RETAIL_ALL_STATES');
  assert.equal(codes.has('AP_RR'), true);
  assert.equal(codes.has('KA_RR'), true);
  assert.equal(codes.has('KL_RR'), true);
  assert.equal(codes.has('TG_RR'), true);
  assert.equal(codes.has('TN_RR'), true);
  assert.equal(codes.has('TN_ST'), false);
  assert.equal(codes.has('KA_ST'), false);
  assert.equal(codes.has('NIMS1'), false);
});

test('Suresh B Command Center override sees TN Standalone only', () => {
  const actor = active({ employee_code: 'QPMSTN3082', role: 'OPERATIONS_MANAGER', state: 'TN', business: 'Standalone' });
  const codes = operationsCommandCenterAllowedEmployeeCodes(actor, commandCenterProfiles, []);

  assert.equal(codes.has('TN_ST'), true);
  assert.equal(codes.has('TN_RR'), false);
  assert.equal(codes.has('KA_ST'), false);
});

test('future TN Reliance Retail Branch Head Command Center scope is generic', () => {
  const actor = active({
    employee_code: 'TEST_TN_RR_BRANCH_HEAD',
    role: 'Branch Head',
    state: 'TN',
    business: 'Reliance Retail',
  });
  const codes = operationsCommandCenterAllowedEmployeeCodes(actor, commandCenterProfiles, []);
  const scope = resolveOperationsCommandCenterScope(actor);

  assert.equal(scope.scopeType, 'TN_RELIANCE_RETAIL');
  assert.equal(codes.has('TN_RR'), true);
  assert.equal(codes.has('TN_ST'), false);
  assert.equal(codes.has('TG_RR'), false);
  assert.equal(codes.has('NIMS1'), false);
});

test('KA Branch Head Command Center scope includes KA Standalone and Reliance only', () => {
  const actor = active({ employee_code: 'KA_BH', role: 'Branch Head', state: 'KA', business: 'Airport' });
  const codes = operationsCommandCenterAllowedEmployeeCodes(actor, commandCenterProfiles, []);

  assert.equal(codes.has('KA_ST'), true);
  assert.equal(codes.has('KA_RR'), true);
  assert.equal(codes.has('TN_ST'), false);
  assert.equal(codes.has('TG_RR'), false);
  assert.equal(codes.has('NIMS1'), false);
});

test('Admin and COO Command Center visibility remains global', () => {
  const adminCodes = operationsCommandCenterAllowedEmployeeCodes(active({ employee_code: 'ADMIN1', role: 'Admin' }), commandCenterProfiles, []);
  const cooCodes = operationsCommandCenterAllowedEmployeeCodes(active({ employee_code: 'COO1', role: 'COO' }), commandCenterProfiles, []);

  assert.equal(adminCodes.has('AP_RR'), true);
  assert.equal(adminCodes.has('TN_ST'), true);
  assert.equal(adminCodes.has('NIMS1'), true);
  assert.equal(cooCodes.has('KA_RR'), true);
  assert.equal(cooCodes.has('TG_ST'), true);
});

test('feature authorization helper separates permission from scope', () => {
  const admin = active({ employee_code: 'ADMIN1', role: 'Admin' });
  const fo = active({ employee_code: 'FO1', role: 'FO' });
  const branchHead = active({ employee_code: 'BH1', role: 'Branch Head' });

  assert.equal(canFoUser(admin, 'KM_RECALCULATE'), true);
  assert.equal(canFoUser(fo, 'KM_RECALCULATE'), false);
  assert.equal(canFoUser(branchHead, 'KM_APPROVE'), true);
  assert.equal(canFoUser(branchHead, 'KM_AUDIT_VIEW'), false);
});

test('Branch Head Missing KM approval target must be inside Command Center scope', () => {
  const actor = active({ employee_code: 'BH_KL', role: 'Branch Head', state: 'KL', business: 'Standalone' });
  const scopedProfiles = [
    actor,
    active({ employee_code: 'KL_ST_FO', role: 'FO', state: 'KL', business: 'Standalone' }),
    active({ employee_code: 'TN_ST_FO', role: 'FO', state: 'TN', business: 'Standalone' }),
    active({ employee_code: 'KL_NIMS_FO', role: 'FO', state: 'KL', business: 'Hospitals', metadata: { client_name: 'NIMS Hyderabad' } }),
  ];

  assert.equal(
    isProfileInOperationsCommandCenterScope(actor, { employee_code: 'KL_ST_FO' }, scopedProfiles, []),
    true,
  );
  assert.equal(
    isProfileInOperationsCommandCenterScope(actor, { fo_user_id: 'KL_ST_FO' }, scopedProfiles, []),
    true,
  );
  assert.equal(
    isProfileInOperationsCommandCenterScope(actor, { employee_code: 'TN_ST_FO' }, scopedProfiles, []),
    false,
  );
  assert.equal(
    isProfileInOperationsCommandCenterScope(actor, { employee_code: 'KL_NIMS_FO' }, scopedProfiles, []),
    false,
  );
});

test('Field Operations access preview is read-only and calculated by backend resolver', () => {
  const actor = active({ employee_code: 'QPMSTN3082', role: 'OPERATIONS_MANAGER', state: 'TN', business: 'Standalone' });
  const preview = buildFieldOperationsAccessPreview(actor, commandCenterProfiles, []);

  assert.equal(preview.employee.employee_code, 'QPMSTN3082');
  assert.equal(preview.read_only, undefined);
  assert.equal(preview.capabilities.command_center_view, true);
  assert.equal(preview.capabilities.missing_km_approve, true);
  assert.equal(preview.effective_scope.scope_type, 'TN_STANDALONE_OVERRIDE');
  assert.equal(preview.visible_employee_count, 1);
  assert.deepEqual(preview.visible_employees.map((employee) => employee.employee_code), ['TN_ST']);
});

test('configured Field Operations access overrides legacy profile scope without changing profile fields', () => {
  const actor = active({
    employee_code: 'BH_TN_ST_LEGACY',
    role: 'Branch Head',
    state: 'TN',
    business: 'Standalone',
    fo_access_config: {
      role: 'branch_head',
      states: ['AP', 'KA'],
      business_groups: ['reliance_retail'],
      businesses: ['Reliance Retail', 'Retail'],
      source: 'access_user_assignments',
    },
  });
  const codes = operationsCommandCenterAllowedEmployeeCodes(actor, commandCenterProfiles, []);
  const preview = buildFieldOperationsAccessPreview(actor, commandCenterProfiles, []);

  assert.equal(preview.effective_scope.configured, true);
  assert.equal(preview.effective_scope.source, 'access_user_assignments');
  assert.deepEqual(preview.effective_scope.states, ['AP', 'KA']);
  assert.equal(codes.has('AP_RR'), true);
  assert.equal(codes.has('KA_RR'), true);
  assert.equal(codes.has('TN_ST'), false);
  assert.equal(codes.has('NIMS1'), false);
});

test('invalid configured Field Operations access fails closed instead of falling back to legacy', () => {
  const actor = active({
    employee_code: 'BH_TN_ST_LEGACY',
    role: 'Branch Head',
    state: 'TN',
    business: 'Standalone',
    fo_access_config: {
      role: 'branch_head',
      invalid: true,
      reason: 'configured_scope_invalid',
      source: 'access_user_assignments',
    },
  });
  const codes = operationsCommandCenterAllowedEmployeeCodes(actor, commandCenterProfiles, []);
  const scope = resolveOperationsCommandCenterScope(actor);

  assert.equal(scope.scopeType, 'CONFIGURED_INVALID');
  assert.equal(scope.legacyFallback, false);
  assert.equal(scope.configured, true);
  assert.equal(codes.size, 0);
});

test('diagnostic matrix is legacy/shadow-compatible and normalized is not active', () => {
  const matrix = buildFoAccessMatrix();

  assert.equal(matrix.mode, 'legacy');
  assert.equal(matrix.normalized_active, false);
  assert.equal(matrix.migrationReady, false);
  assert.ok(matrix.features.some((feature) => feature.key === 'MAP_VIEW'));
  assert.ok(matrix.knownMismatches.some((item) => item.code === 'ACCESS_FRAMEWORK_NOT_FO_AUTHORITY'));
});

test('admin FO matrix route is read-only and protected by JWT plus user-management permission', () => {
  const serverPath = path.resolve('server.js');
  const serverSource = fs.readFileSync(serverPath, 'utf8');

  assert.match(serverSource, /'\/api\/admin\/access\/fo-matrix'[\s\S]*requireSupabaseJwt[\s\S]*requireUserManagementPermission/);
  assert.match(serverSource, /buildFoAccessMatrix\(\)/);
  assert.match(serverSource, /'OPERATIONSMANAGER'/);
  assert.doesNotMatch(serverSource, /'OPERATIONS_MANAGER'/);
});

test('employee-range KM recalculation route requires privileged recalculation permission', () => {
  const serverPath = path.resolve('server.js');
  const serverSource = fs.readFileSync(serverPath, 'utf8');

  assert.match(
    serverSource,
    /app\.post\('\/api\/fo\/km\/recalculate-employee-range',\s*requireSupabaseJwt,\s*requireFoKmBatchRecalculationPermission/,
  );
});

test('checkout Missing KM review route enforces resolved Command Center scope', () => {
  const serverPath = path.resolve('server.js');
  const serverSource = fs.readFileSync(serverPath, 'utf8');

  assert.match(serverSource, /'\/api\/fo\/site-visits\/:visitId\/checkout-missing-km-review'[\s\S]*requireCheckoutMissingKmReviewPermission/);
  assert.match(serverSource, /isProfileInOperationsCommandCenterScope\(actor,\s*scopedTarget/);
  assert.match(serverSource, /outside your Field Operations scope/);
});

test('Field Operations access management endpoints use access foundation tables without profile writes', () => {
  const serverPath = path.resolve('server.js');
  const serverSource = fs.readFileSync(serverPath, 'utf8');

  assert.match(serverSource, /'\/api\/admin\/access\/field-operations\/users'[\s\S]*requireSupabaseJwt[\s\S]*requireUserManagementPermission/);
  assert.match(serverSource, /'\/api\/admin\/access\/field-operations\/preview-team'[\s\S]*requireSupabaseJwt[\s\S]*requireUserManagementPermission/);
  assert.match(serverSource, /'\/api\/admin\/access\/field-operations\/:profileId'[\s\S]*requireSupabaseJwt[\s\S]*requireUserManagementPermission/);
  assert.match(serverSource, /\.from\('access_user_assignments'\)[\s\S]*\.insert/);
  assert.match(serverSource, /\.from\('access_user_scopes'\)[\s\S]*\.insert/);
  assert.match(serverSource, /\.from\('access_user_assignments'\)[\s\S]*\.update\(\{\s*active:\s*false,\s*verification_status:\s*'inactive'/);
  assert.match(serverSource, /Only active non-Hospital GM or Branch Head profiles can receive Field Operations management access/);
  assert.match(serverSource, /profiles_modified:\s*false/);
  const routeStart = serverSource.indexOf("'/api/admin/access/field-operations/:profileId'");
  const routeEnd = serverSource.indexOf("app.get('/api/profile/me'", routeStart);
  const routeSource = serverSource.slice(routeStart, routeEnd);
  assert.doesNotMatch(
    routeSource,
    /\.from\('profiles'\)\s*\.update/,
  );
});
