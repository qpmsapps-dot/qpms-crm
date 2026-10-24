import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { normalizeWebRoleKey } from '../services/webRoleAccessService.js';

const source = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
function section(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a);
  return source.slice(a, b);
}
function harness(extra = {}) {
  const context = vm.createContext({
    Object, normalizeWebRoleKey,
    isPlatformAdmin: p => ['ADMIN', 'QPMSADMIN', 'DEVELOPER', 'DEV'].includes(normalizeWebRoleKey(p?.role)),
    userManagementHttpError: (statusCode, message) => Object.assign(new Error(message), { statusCode }),
    passwordSetupRedirectUrl: () => 'https://example.invalid/set-password',
    safeAuthError: () => ({ message: 'Sanitized Auth failure' }),
    normalizeEmail: s => String(s || '').trim().toLowerCase(),
    ...extra,
  });
  vm.runInContext(section('function assertInvitationOnlyPayload(', '\nasync function markProfileAuthSyncFailure('), context);
  vm.runInContext(section('const USER_MANAGEMENT_ROLE_KEYS =', '\nfunction hasDailyReportPermission('), context);
  vm.runInContext(section('async function ensureUniqueAuthEmail(', '\nconst CREATE_USER_ROLE_OPTIONS'), context);
  return context;
}
for (const field of ['password', 'temporary_password', 'temporaryPassword', 'new_password']) {
  test(`shared helper rejects ${field} before contacting Auth, including empty/null values`, async () => {
    let calls = 0;
    const client = { auth: { admin: new Proxy({}, { get() { calls++; throw Error('Auth must not be called'); } }) } };
    for (const value of ['LocalFixture1234', '', null, false]) {
      await assert.rejects(harness().createInvitedAuthUser(client, { email: 'fixture@example.invalid', [field]: value }), { statusCode: 400 });
    }
    assert.equal(calls, 0);
  });
}
test('authorized creation uses only invitation email and cannot set password or confirmation', async () => {
  const calls = [];
  const client = { auth: { admin: {
    inviteUserByEmail: async (...args) => { calls.push(args); return { data: { user: { id: 'invited-local' } }, error: null }; },
    createUser: () => { throw Error('Forbidden confirmed-account bypass'); },
  } } };
  const result = await harness().createInvitedAuthUser(client, { email: 'fixture@example.invalid', authMetadata: { employee_code: 'LOCAL' } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].redirectTo, 'https://example.invalid/set-password');
  assert.deepEqual(Object.keys(calls[0][1]).sort(), ['data', 'redirectTo']);
  assert.equal(result.usedTemporaryPassword, false);
  assert.equal(result.invite.email_sent, true);
  assert.equal(result.invite.setup_link, null);
  assert.doesNotMatch(source, /client\.auth\.admin\.createUser\(/);
  assert.doesNotMatch(source, /email_confirm:\s*true/);
});
for (const failure of ['smtp_failure', 'email_exists', 'rate_limit', 'expired_token']) {
  test(`Auth ${failure} fails closed without fallback account creation`, async () => {
    let calls = 0;
    const client = { auth: { admin: { inviteUserByEmail: async () => { calls++; return { data: null, error: { message: failure } }; } } } };
    await assert.rejects(harness().createInvitedAuthUser(client, { email: 'fixture@example.invalid' }), { statusCode: 503 });
    assert.equal(calls, 1);
  });
}
test('duplicate existing invitation/account is rejected without modifying existing user', async () => {
  let calls = 0;
  const client = { auth: { admin: { listUsers: async () => { calls++; return { data: { users: [{ email: 'Fixture@example.invalid' }] }, error: null }; } } } };
  await assert.rejects(harness().ensureUniqueAuthEmail(client, 'fixture@example.invalid'), { statusCode: 409 });
  assert.equal(calls, 1);
});
test('permission middleware denies HK MIS, FO, inactive and missing identities', () => {
  const h = harness();
  for (const profile of [null, { role: 'MIS', designation: 'HK MIS', business: 'Reliance Retail', is_active: true }, { role: 'FO', is_active: true }, { role: 'Admin', is_active: false }, { role: 'Admin', is_active: true, web_access_enabled: false }]) {
    let status = 0, next = false;
    h.requireUserManagementPermission({ profile }, { status(s) { status = s; return this; }, json() {} }, () => { next = true; });
    assert.equal(status, 403); assert.equal(next, false);
  }
  for (const role of ['Admin', 'MD', 'COO', 'HR', 'Finance GM']) {
    let next = false;
    h.requireUserManagementPermission({ profile: { role, is_active: true, status: 'Active' } }, { status() { throw Error('Authorized role denied'); } }, () => { next = true; });
    assert.equal(next, true);
  }
});
for (const route of ['/api/admin/users', '/api/admin/users/:employeeCode/enable-login']) {
  test(`${route} registered handler rejects password-bearing payload before any write`, async () => {
    let registered, writes = 0;
    const h = harness({
      app: { post: (...args) => { registered = args; } },
      requireSupabaseJwt: () => {},
      requireServiceRoleSupabase: () => ({ from() { writes++; throw Error('No database mutation permitted'); } }),
      assertUserManagementFoundation: async () => {},
      normalizeEmployeeCode: v => String(v || ''), textOrNull: v => v || null,
      respondUserManagementError: (res, e) => res.status(e.statusCode).json({ message: e.message }),
    });
    const a = source.indexOf(`app.post(\n  '${route}',`), b = source.indexOf('\n);', a);
    assert.ok(a >= 0 && b > a);
    vm.runInContext(source.slice(a, b + 4), h);
    for (const field of ['password', 'temporary_password', 'temporaryPassword', 'new_password']) {
      let status = 0;
      const response = { status(s) { status = s; return this; }, json() {} };
      await registered.at(-1)({ body: { [field]: 'LocalFixture1234' }, params: {} }, response);
      assert.equal(status, 400);
    }
    assert.equal(writes, 0);
    assert.equal(registered[1], h.requireSupabaseJwt);
    assert.equal(registered[2], h.requireUserManagementPermission);
  });
}
test('expired invitation UX stays fail-closed and requires an authenticated session before password update', () => {
  const page = readFileSync(new URL('../../src/pages/SetPassword.jsx', import.meta.url), 'utf8');
  const a = page.indexOf('function passwordSaveMessage('), b = page.indexOf('\nexport default', a);
  const h = vm.createContext({ expiredInviteMessage: 'EXPIRED', genericPasswordError: 'ERROR' });
  vm.runInContext(page.slice(a, b), h);
  for (const message of ['Token expired', 'Invalid JWT', 'Auth session missing']) assert.equal(h.passwordSaveMessage({ message }), 'EXPIRED');
  assert.match(page, /exchangeCodeForSession\(code\)/);
  assert.ok(page.indexOf('if (!sessionData.session)') < page.indexOf('supabase.auth.updateUser({ password })'));
});
