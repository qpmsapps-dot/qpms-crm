import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  canAccessLeadModule,
  canAssignLead,
  canCreateLead,
  canEditLead,
  canManageLeadMom,
  canViewLead,
  leadActor,
  normalizeLeadRole,
} from '../services/leadManagementService.js';
import {
  canAccessOperationsSummary,
  operationsSummaryAllowedEmployeeCodes,
} from '../services/operationsSummaryService.js';
import { authorizeFoKmRecalculation } from '../services/foKmRecalculationAuthorizationService.js';
import { assertHospitalFeedbackQrAccess } from '../services/hospitalFeedbackQrService.js';
import {
  hasCooAuthority,
  hasCooWebVisibility,
} from '../services/webRoleAccessService.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const serverSource = fs.readFileSync(path.join(root, 'backend/server.js'), 'utf8');
const migrationSource = fs.readFileSync(
  path.join(root, 'supabase/migrations_2_0/068_add_executive_assistant_web_role.sql'),
  'utf8',
);
const mobileRolesSource = fs.readFileSync(
  path.join(root, 'Mobile_FO_V2/lib/utils/mobile_roles.dart'),
  'utf8',
);
const qrPageSource = fs.readFileSync(
  path.join(root, 'src/pages/HospitalFeedbackQrGenerator.jsx'),
  'utf8',
);
const qrServiceSource = fs.readFileSync(
  path.join(root, 'backend/services/hospitalFeedbackQrService.js'),
  'utf8',
);

const activeProfile = (role, overrides = {}) => ({
  id: `profile-${role}`,
  auth_user_id: `auth-${role}`,
  employee_code: `EMP-${role}`,
  full_name: role,
  email: `${role.replace(/\s/g, '').toLowerCase()}@qpms.test`,
  role,
  status: 'Active',
  is_active: true,
  web_access_enabled: true,
  mobile_access_enabled: false,
  state: 'TN',
  business: 'Reliance Retail',
  ...overrides,
});

function fakeAttendanceClient(attendance) {
  const query = {
    select() { return query; },
    eq() { return query; },
    order() { return query; },
    limit() { return query; },
    async maybeSingle() { return { data: attendance, error: null }; },
  };
  return {
    from(table) {
      assert.equal(table, 'fo_attendance');
      return query;
    },
  };
}

test('Executive Assistant remains a distinct web visibility role', () => {
  assert.equal(hasCooWebVisibility('COO'), true);
  assert.equal(hasCooWebVisibility('Executive Assistant'), true);
  assert.equal(hasCooAuthority('COO'), true);
  assert.equal(hasCooAuthority('Executive Assistant'), false);
});

test('Executive Assistant can read Lead Management but cannot mutate leads', () => {
  const lead = { assigned_bd_email: 'someone@qpms.test', created_by_user_id: 'auth-other' };
  const actor = leadActor(activeProfile('Executive Assistant'));
  assert.equal(normalizeLeadRole('Executive Assistant'), 'Executive Assistant');
  assert.equal(canAccessLeadModule(actor), true);
  assert.equal(canViewLead(actor, lead), true);
  assert.equal(canCreateLead(actor), false);
  assert.equal(canAssignLead(actor), false);
  assert.equal(canEditLead(actor, lead), false);
  assert.equal(canManageLeadMom(actor, lead), false);
});

test('existing COO Lead Management authority remains unchanged', () => {
  const lead = { assigned_bd_email: 'someone@qpms.test', created_by_user_id: 'auth-other' };
  const actor = leadActor(activeProfile('COO'));
  assert.equal(canAccessLeadModule(actor), true);
  assert.equal(canViewLead(actor, lead), true);
  assert.equal(canCreateLead(actor), true);
  assert.equal(canAssignLead(actor), true);
  assert.equal(canEditLead(actor, lead), true);
  assert.equal(canManageLeadMom(actor, lead), true);
});

test('Executive Assistant can read operations reports but cannot recalculate another employee KM', async () => {
  const assistant = activeProfile('Executive Assistant', { employee_code: 'EA-1' });
  const profiles = [
    activeProfile('FO', { employee_code: 'FO-1' }),
    activeProfile('KAM', { employee_code: 'KAM-1' }),
  ];
  assert.equal(canAccessOperationsSummary(assistant), true);
  const allowedCodes = operationsSummaryAllowedEmployeeCodes(assistant, profiles, []);
  assert.equal(allowedCodes.has('FO-1'), true);
  assert.equal(allowedCodes.has('KAM-1'), true);
  await assert.rejects(
    authorizeFoKmRecalculation({
      client: fakeAttendanceClient({
        id: 'attendance-1',
        employee_code: 'FO-1',
        fo_user_id: 'FO-1',
        attendance_date: '2026-08-01',
      }),
      payload: { attendance_id: 'attendance-1' },
      profile: assistant,
    }),
    (error) => error.statusCode === 403,
  );
});

test('Executive Assistant has hospital feedback QR read visibility only', async () => {
  const assistant = activeProfile('Executive Assistant');
  const read = await assertHospitalFeedbackQrAccess({
    client: {},
    authUser: { id: 'auth-ea' },
    profile: assistant,
    location: { id: 'location-1', client_id: 'client-1', block_id: 'block-1' },
    permission: 'view',
  });
  assert.equal(read.allowed, true);
  assert.equal(read.source, 'platform_visibility');
  const qrAdminBlock = qrServiceSource.slice(
    qrServiceSource.indexOf('function isPlatformQrAdmin'),
    qrServiceSource.indexOf('function hasPlatformQrReadVisibility'),
  );
  assert.doesNotMatch(qrAdminBlock, /EXECUTIVEASSISTANT|Executive Assistant/);
});

test('server source keeps Executive Assistant out of User Management and Store Master mutation authority', () => {
  const userManagementRoles = serverSource.slice(
    serverSource.indexOf('const USER_MANAGEMENT_ROLE_KEYS'),
    serverSource.indexOf('function normalizePermissionRole'),
  );
  assert.doesNotMatch(userManagementRoles, /EXECUTIVEASSISTANT|Executive Assistant/);
  assert.match(serverSource, /app\.post\('\/api\/store-master', requireSupabaseJwtOrDemoApiRead, requireStoreMasterManagePermission/);
  assert.match(serverSource, /app\.patch\('\/api\/store-master\/:id', requireSupabaseJwtOrDemoApiRead, requireStoreMasterManagePermission/);
  assert.match(serverSource, /'EXECUTIVEASSISTANT'/);
});

test('Executive Assistant profile payloads force mobile access disabled', () => {
  assert.match(
    serverSource,
    /mobile_access_enabled:\s*normalizePermissionRole\(role\) === 'EXECUTIVEASSISTANT'[\s\S]*?\?\s*false/,
  );
  assert.match(
    serverSource,
    /normalizePermissionRole\(effectiveRole\) === 'EXECUTIVEASSISTANT'[\s\S]*?payload\.mobile_access_enabled = false/,
  );
});

test('Executive Assistant migration is additive and does not alter mobile login RPCs', () => {
  assert.match(migrationSource, /'Executive Assistant'/);
  assert.match(migrationSource, /profiles_role_check/);
  assert.doesNotMatch(migrationSource, /rpc_resolve_mobile_login_profile/);
  assert.doesNotMatch(migrationSource, /hospital_ticket_users_role_code_check/);
});

test('Executive Assistant is absent from Mobile FO role allowlists', () => {
  assert.doesNotMatch(mobileRolesSource, /Executive Assistant|EXECUTIVEASSISTANT/i);
});

test('QR generator hides reprint and delete actions behind manage authority', () => {
  assert.match(qrPageSource, /canManageHospitalFeedbackQr\(user\)/);
  assert.match(qrPageSource, /canManageQr \? \(/);
});
