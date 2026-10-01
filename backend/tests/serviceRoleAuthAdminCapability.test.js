import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createServiceRoleAuthAdminCapabilityValidator } from '../services/serviceRoleAuthAdminCapability.js';

function deferred() {
  let resolve;
  const promise = new Promise((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

test('first capability check validates and later checks reuse the successful result', async () => {
  const client = {};
  let calls = 0;
  const validator = createServiceRoleAuthAdminCapabilityValidator({
    validate: async () => {
      calls += 1;
      return { success: true, reason: null };
    },
  });

  assert.equal((await validator.ensure(client)).success, true);
  assert.equal((await validator.ensure(client)).success, true);
  assert.equal(calls, 1);
  assert.equal(validator.isValidated(client), true);
  assert.equal(validator.validationAttempts(client), 1);
});

test('concurrent first checks share one in-flight validation', async () => {
  const client = {};
  const pending = deferred();
  let calls = 0;
  const validator = createServiceRoleAuthAdminCapabilityValidator({
    validate: async () => {
      calls += 1;
      return pending.promise;
    },
  });

  const first = validator.ensure(client);
  const second = validator.ensure(client);
  await Promise.resolve();
  assert.equal(calls, 1);
  pending.resolve({ success: true, reason: null });
  assert.equal((await first).success, true);
  assert.equal((await second).success, true);
  assert.equal(calls, 1);
});

test('failed validation is fail-closed and is not cached as successful', async () => {
  const client = {};
  let calls = 0;
  const validator = createServiceRoleAuthAdminCapabilityValidator({
    validate: async () => {
      calls += 1;
      return calls === 1
        ? { success: false, reason: 'service_role_auth_admin_failed' }
        : { success: true, reason: null };
    },
  });

  assert.equal((await validator.ensure(client)).success, false);
  assert.equal(validator.isValidated(client), false);
  assert.equal((await validator.ensure(client)).success, true);
  assert.equal(calls, 2);
  assert.equal(validator.isValidated(client), true);
});

test('capability state is isolated per service-role client', async () => {
  const firstClient = {};
  const secondClient = {};
  const calls = new Map();
  const validator = createServiceRoleAuthAdminCapabilityValidator({
    validate: async (client) => {
      calls.set(client, (calls.get(client) || 0) + 1);
      return { success: true, reason: null };
    },
  });

  await validator.ensure(firstClient);
  await validator.ensure(secondClient);
  await validator.ensure(firstClient);
  assert.equal(calls.get(firstClient), 1);
  assert.equal(calls.get(secondClient), 1);
});

test('protected-request source keeps secure user validation and request-scoped profile resolution', async () => {
  const [server, capability] = await Promise.all([
    readFile(new URL('../server.js', import.meta.url), 'utf8'),
    readFile(new URL('../services/serviceRoleAuthAdminCapability.js', import.meta.url), 'utf8'),
  ]);
  const start = server.indexOf('async function requireSupabaseJwt(request, response, next)');
  const end = server.indexOf('function requireFoOperationsCommandCenter', start);
  const middleware = server.slice(start, end);

  assert.match(middleware, /supabaseAnon\.auth\.getUser\(accessToken\)/);
  assert.match(middleware, /await assertServiceRoleAuthAdminAccess\(adminClient\)/);
  assert.match(middleware, /\.eq\('auth_user_id', authData\.user\.id\)/);
  assert.match(middleware, /request\.authUser = authData\.user/);
  assert.match(middleware, /request\.profile = profile/);
  assert.match(middleware, /if \(!accessToken\)[\s\S]*response\.status\(401\)/);
  assert.doesNotMatch(middleware, /request\.(?:body|query).*role/);
  assert.doesNotMatch(capability, /authUser|accessToken|profile/);
});
