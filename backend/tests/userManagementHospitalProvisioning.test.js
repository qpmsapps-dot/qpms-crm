import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const server = readFileSync('backend/server.js', 'utf8');
const drawer = readFileSync('src/components/user-management/UserFormDrawer.jsx', 'utf8');
const page = readFileSync('src/pages/settings/UserManagement.jsx', 'utf8');
const api = readFileSync('src/services/api.js', 'utf8');

test('backend bridges User Management Hospital access into Hospital Ticketing tables', () => {
  assert.match(server, /createHospitalTicketAccessForProfile/);
  assert.match(server, /\.from\('hospital_ticket_users'\)[\s\S]*\.insert/);
  assert.match(server, /\.from\('hospital_ticket_user_scopes'\)[\s\S]*\.insert/);
  assert.match(server, /can_create: profileType === 'internal' \? false : hospitalRoleAllowsCreate\(roleCode\)/);
  assert.match(server, /can_update: hospitalRoleAllowsUpdate\(roleCode\)/);
  assert.match(server, /scope_type: 'client'/);
  assert.match(server, /cug_number: cugNumber/);
  assert.match(server, /cug_number_display: textOrNull\(profile\.mobile\) \|\| cugNumber/);
  assert.match(server, /duty_status: existingByAuth\?\.duty_status \|\| 'off_duty'/);
  assert.match(server, /Hospital Ticketing scope must be Entire Client, Specific Block, or Specific Location/);
});

test('backend validates Hospital scope ownership and handles duplicate access cleanly', () => {
  assert.match(server, /Selected block is not active for the selected Hospital client/);
  assert.match(server, /Selected location is not active for the selected Hospital client/);
  assert.match(server, /This email already has access to this Hospital client/);
  assert.match(server, /This account already has Hospital Ticketing access for another client/);
  assert.match(server, /Mobile number already exists in an active profile/);
  assert.match(server, /Profile identity already exists/);
});

test('temporary password path uses secure Supabase Admin createUser without auditing plaintext', () => {
  assert.match(server, /validateTemporaryPassword/);
  assert.match(server, /client\.auth\.admin\.createUser\(\{/);
  assert.match(server, /email_confirm: true/);
  assert.match(server, /temporaryPassword: textOrNull\(body\.temporary_password\)/);
  assert.match(server, /usedTemporaryPassword/);
  assert.match(server, /requires_password_change: usedTemporaryPassword/);
  const helperStart = server.indexOf('async function createInvitedAuthUser');
  const helperEnd = server.indexOf('async function markProfileAuthSyncFailure', helperStart);
  const helperBody = server.slice(helperStart, helperEnd);
  assert.doesNotMatch(helperBody, /metadata:.*temporary_password/i);
  assert.doesNotMatch(helperBody, /console\.(log|info|warn|error)\([^)]*password/i);
});

test('existing profile module-access route does not patch primary employee profile', () => {
  assert.match(server, /'\/api\/admin\/users\/:profileId\/module-access'/);
  assert.match(server, /action: 'ADD_MODULE_ACCESS'/);
  assert.match(server, /profile_role_unchanged: profile\.role/);
  const routeStart = server.indexOf("'\/api\/admin\/users\/:profileId\/module-access'");
  const routeEnd = server.indexOf("app.get(", routeStart);
  const routeBody = server.slice(routeStart, routeEnd);
  assert.doesNotMatch(routeBody, /\.from\('profiles'\)[\s\S]*\.update/);
  assert.match(routeBody, /directNimsHospitalAccess/);
  assert.match(routeBody, /profile_role_unchanged: profile\.role/);
});

test('Invite User UI keeps QPMS base role separate from Hospital role', () => {
  assert.match(drawer, /QPMS Employee/);
  assert.match(drawer, /Who are you creating\?/);
  assert.match(drawer, /Existing account found/);
  assert.match(drawer, /lookupAdminUserByEmail/);
  assert.match(drawer, /Enable Hospital Ticketing/);
  assert.match(drawer, /Base\/Application Role/);
  assert.match(drawer, /hospital_role_code/);
  assert.match(drawer, /Hospital Supervisor/);
  assert.match(drawer, /Scope: NIMS client-wide/);
  assert.match(drawer, /Temporary Password/);
  assert.doesNotMatch(drawer, /Client User Code/);
});

test('backend supports temporary NIMS contact registration and mobile identify', () => {
  assert.match(server, /hospital_client_contacts/);
  assert.match(server, /'\/api\/admin\/hospital-client-contacts'/);
  assert.match(server, /'\/api\/hospital-client\/identify'/);
  assert.match(server, /mobile_not_registered/);
  assert.match(server, /auth_user_created: false/);
  assert.match(api, /createHospitalClientContact/);
});

test('frontend can add module access to an existing profile without creating a user', () => {
  assert.match(api, /lookupAdminUserByEmail/);
  assert.match(api, /addAdminUserModuleAccess/);
  assert.match(page, /payload\.existing_profile_id/);
  assert.match(page, /Module access added to existing user\. Employee profile was not changed/);
});

test('edit and deactivate paths keep Hospital access separate from base profile role', () => {
  assert.match(server, /body\.hospital_access/);
  assert.match(server, /createHospitalTicketAccessForProfile\(/);
  assert.match(server, /hospital_access_disabled/);
  assert.match(server, /HOSPITAL_ACCESS_DEACTIVATE_FAILED/);
  assert.match(server, /duty_status: 'off_duty'/);
  assert.match(server, /hospital_access_reactivated_if_previously_active/);
  assert.match(drawer, /Hospital Ticketing Access/);
  assert.match(page, /hospitalTicketingAccess/);
});

test('details drawer shows Hospital Ticketing separately from unified access', () => {
  const details = readFileSync('src/components/user-management/EmployeeDetailsDrawer.jsx', 'utf8');
  assert.match(details, /Hospital Ticketing/);
  assert.match(details, /Hospital role/);
  assert.match(details, /CUG \/ Mobile/);
  assert.match(details, /Client-wide/);
});
