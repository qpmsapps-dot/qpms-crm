import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthSessionManager } from '../src/services/authSession.js';

function deferred() {
  let resolve;
  const promise = new Promise((next) => { resolve = next; });
  return { promise, resolve };
}

function session(token, expiresAt = 4102444800) {
  return { access_token: token, refresh_token: `refresh-${token}`, expires_at: expiresAt, user: { id: 'user-1' } };
}

function response(status) {
  return { status, ok: status >= 200 && status < 300 };
}

test('protected requests wait for the single initial auth bootstrap', async () => {
  const bootstrap = deferred();
  let getSessionCalls = 0;
  let requestCalls = 0;
  const manager = createAuthSessionManager({
    client: {
      auth: {
        getSession: () => { getSessionCalls += 1; return bootstrap.promise; },
        refreshSession: async () => ({ data: { session: session('refreshed') }, error: null }),
        signOut: async () => {},
      },
    },
  });
  const request = manager.authenticatedFetch(async () => { requestCalls += 1; return response(200); }, '/protected');
  await Promise.resolve();
  assert.equal(requestCalls, 0);
  bootstrap.resolve({ data: { session: session('initial') }, error: null });
  await request;
  assert.equal(getSessionCalls, 1);
  assert.equal(requestCalls, 1);
});

test('valid sessions attach the current Bearer token', async () => {
  const manager = createAuthSessionManager({ client: { auth: {} } });
  manager.setSession(session('current'));
  let authorization = '';
  await manager.authenticatedFetch(async (_input, init) => {
    authorization = init.headers.Authorization;
    return response(200);
  }, '/protected');
  assert.equal(authorization, 'Bearer current');
});

test('missing sessions never call a protected endpoint', async () => {
  let requestCalls = 0;
  const manager = createAuthSessionManager({
    client: { auth: { getSession: async () => ({ data: { session: null }, error: null }) } },
  });
  await assert.rejects(
    manager.authenticatedFetch(async () => { requestCalls += 1; return response(200); }, '/protected'),
    /session has expired/i,
  );
  assert.equal(requestCalls, 0);
});

test('five simultaneous 401 responses share one refresh and retry once each', async () => {
  let refreshCalls = 0;
  let requestCalls = 0;
  const refreshGate = deferred();
  const manager = createAuthSessionManager({
    client: {
      auth: {
        refreshSession: async () => { refreshCalls += 1; return refreshGate.promise; },
        signOut: async () => {},
      },
    },
  });
  manager.setSession(session('old'));
  const fetchImpl = async (_input, init) => {
    requestCalls += 1;
    return response(init.headers.Authorization === 'Bearer old' ? 401 : 200);
  };
  const requests = Array.from({ length: 5 }, () => manager.authenticatedFetch(fetchImpl, '/protected'));
  await Promise.resolve();
  refreshGate.resolve({ data: { session: session('new') }, error: null });
  await Promise.all(requests);
  assert.equal(refreshCalls, 1);
  assert.equal(requestCalls, 10);
});

test('a second 401 is not recursively retried', async () => {
  let requestCalls = 0;
  const manager = createAuthSessionManager({
    client: {
      auth: {
        refreshSession: async () => ({ data: { session: session('new') }, error: null }),
        signOut: async () => {},
      },
    },
  });
  manager.setSession(session('old'));
  await assert.rejects(
    manager.authenticatedFetch(async () => { requestCalls += 1; return response(401); }, '/protected'),
    /session has expired/i,
  );
  assert.equal(requestCalls, 2);
});

test('failed refresh clears local auth state and publishes session expiry', async () => {
  let signOutCalls = 0;
  const reasons = [];
  const manager = createAuthSessionManager({
    client: {
      auth: {
        refreshSession: async () => ({ data: { session: null }, error: { message: 'invalid refresh token', status: 400 } }),
        signOut: async () => { signOutCalls += 1; },
      },
    },
  });
  manager.setSession(session('old'));
  manager.subscribe((_nextSession, reason) => reasons.push(reason));
  await assert.rejects(
    manager.authenticatedFetch(async () => response(401), '/protected'),
    /session has expired/i,
  );
  assert.equal(manager.getSession(), null);
  assert.equal(signOutCalls, 1);
  assert.ok(reasons.some((reason) => /session has expired/i.test(reason)));
});

test('HTTP 429 sets a backoff and cannot create an immediate refresh loop', async () => {
  let refreshCalls = 0;
  const manager = createAuthSessionManager({
    client: {
      auth: {
        refreshSession: async () => {
          refreshCalls += 1;
          return { data: { session: null }, error: { message: 'rate limited', status: 429 } };
        },
        signOut: async () => {},
      },
    },
    now: () => 1000,
  });
  manager.setSession(session('old'));
  const fetchImpl = async () => response(401);
  await assert.rejects(manager.authenticatedFetch(fetchImpl, '/protected'));
  await assert.rejects(manager.authenticatedFetch(fetchImpl, '/protected'));
  assert.equal(refreshCalls, 1);
});
