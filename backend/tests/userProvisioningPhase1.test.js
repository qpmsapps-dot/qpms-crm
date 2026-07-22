import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(path, 'utf8');

test('mobile production login does not expose public registration', () => {
  const login = read('Mobile_FO_V2/lib/auth/login_screen.dart');
  const register = read('Mobile_FO_V2/lib/auth/register_screen.dart');

  assert.equal(login.includes('Register for Mobile Access'), false);
  assert.match(login, /Account access is provided by your organisation\./);
  assert.match(register, /Accounts are created by your organisation administrator/);
  assert.equal(register.includes('Create Account'), false);
});

test('mobile service registration fails closed before Supabase signup', () => {
  const service = read('Mobile_FO_V2/lib/services/supabase_service.dart');
  const registerStart = service.indexOf('static Future<FoUser> register');
  const loginStart = service.indexOf('static Future<FoUser> login');
  assert.ok(registerStart > -1, 'register method exists for compatibility');
  assert.ok(loginStart > registerStart, 'login method follows register method');
  const registerBody = service.slice(registerStart, loginStart);

  assert.match(registerBody, /throw UnsupportedError/);
  assert.equal(registerBody.includes('client.auth.signUp'), false);
  assert.equal(registerBody.includes(".from('profiles').upsert"), false);
});

test('client and web apps have no public signup path', () => {
  const clientLogin = read('Client_Ticketing_App/lib/features/auth/login_screen.dart');
  const webLogin = read('src/pages/Login.jsx');
  const routes = read('src/routes/AppRoutes.jsx');

  assert.equal(/sign\s*up|create account/i.test(clientLogin), false);
  assert.equal(/sign\s*up|create account/i.test(webLogin), false);
  assert.equal(routes.includes('signup'), false);
  assert.equal(routes.includes('register'), false);
});

test('backend admin provisioning rejects password-bearing payloads', () => {
  const server = read('backend/server.js');

  assert.match(server, /Admins cannot set user passwords\. Use Invite User/);
  assert.match(server, /Admins cannot set user passwords\. Use Resend Invitation/);
  assert.equal(server.includes('client.auth.admin.createUser({'), false);
  assert.equal(/password,\s*email_confirm:\s*true/.test(server), false);
});

test('web user management does not request or display admin-entered passwords', () => {
  const drawer = read('src/components/user-management/EmployeeDetailsDrawer.jsx');
  const page = read('src/pages/settings/UserManagement.jsx');

  assert.equal(drawer.includes('Temporary Password'), false);
  assert.equal(drawer.includes('temporary_password'), false);
  assert.match(drawer, /Resend Invitation/);
  assert.equal(page.includes('messageLink'), false);
});
