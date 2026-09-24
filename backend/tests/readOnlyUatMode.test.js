import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  READ_ONLY_UAT_DISABLED_WORKERS,
  createRequireWritablePreSalesEnvironment,
  isReadOnlyUatMode,
  startAutomaticBackgroundWorkers,
} from '../services/readOnlyUatMode.js';
import { registerPreSalesRoutes } from '../routes/preSalesRoutes.js';

const serverUrl = new URL('../server.js', import.meta.url);

function workerSpies() {
  const calls = [];
  return {
    calls,
    workers: Object.fromEntries(
      READ_ONLY_UAT_DISABLED_WORKERS.map((name) => [name, () => calls.push(name)]),
    ),
  };
}

test('read-only UAT mode is opt-in and accepts normalized true values', () => {
  assert.equal(isReadOnlyUatMode({}), false);
  assert.equal(isReadOnlyUatMode({ READ_ONLY_UAT_MODE: 'false' }), false);
  assert.equal(isReadOnlyUatMode({ READ_ONLY_UAT_MODE: 'unexpected' }), false);
  for (const value of ['true', ' TRUE ', '1', 'yes', 'on']) {
    assert.equal(isReadOnlyUatMode({ READ_ONLY_UAT_MODE: value }), true);
  }
});

test('default mode starts every existing automatic worker category', () => {
  const spies = workerSpies();
  const result = startAutomaticBackgroundWorkers({
    environment: {},
    workers: spies.workers,
    logger: { warn: () => assert.fail('default mode must not emit the UAT warning') },
  });

  assert.equal(result.readOnlyUatMode, false);
  assert.deepEqual(spies.calls, READ_ONLY_UAT_DISABLED_WORKERS);
  assert.deepEqual(result.startedWorkers, READ_ONLY_UAT_DISABLED_WORKERS);
});

test('read-only UAT mode starts no database or dispatch worker', () => {
  const spies = workerSpies();
  const warnings = [];
  const result = startAutomaticBackgroundWorkers({
    environment: { READ_ONLY_UAT_MODE: 'true' },
    workers: spies.workers,
    logger: { warn: (...args) => warnings.push(args) },
  });

  assert.equal(result.readOnlyUatMode, true);
  assert.deepEqual(spies.calls, []);
  assert.deepEqual(result.startedWorkers, []);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0][0], /automatic background writes and dispatch workers are disabled/i);
  assert.deepEqual(warnings[0][1].disabledWorkers, READ_ONLY_UAT_DISABLED_WORKERS);
});

function invokePreSalesGuard(environment, method) {
  const result = { nextCalled: false, status: null, body: null };
  const response = {
    status(value) {
      result.status = value;
      return this;
    },
    json(value) {
      result.body = value;
      return this;
    },
  };
  createRequireWritablePreSalesEnvironment(environment)(
    { method },
    response,
    () => { result.nextCalled = true; },
  );
  return result;
}

test('read-only UAT mode allows Pre-Sales read methods', () => {
  for (const method of ['GET', 'HEAD', 'OPTIONS']) {
    const result = invokePreSalesGuard({ READ_ONLY_UAT_MODE: 'true' }, method);
    assert.equal(result.nextCalled, true, `${method} must continue`);
    assert.equal(result.status, null);
  }
});

test('read-only UAT mode blocks every Pre-Sales mutation method with a safe response', () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const result = invokePreSalesGuard({ READ_ONLY_UAT_MODE: 'true' }, method);
    assert.equal(result.nextCalled, false, `${method} must not continue`);
    assert.equal(result.status, 423);
    assert.deepEqual(result.body, {
      ok: false,
      error: 'READ_ONLY_UAT_MODE',
      code: 'read_only_uat_mode',
      message: 'Pre-Sales changes are disabled during read-only UAT.',
    });
  }
});

test('default mode leaves Pre-Sales mutation routing unchanged', () => {
  for (const environment of [{}, { READ_ONLY_UAT_MODE: 'false' }]) {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      assert.equal(invokePreSalesGuard(environment, method).nextCalled, true);
    }
  }
});

function capturePreSalesRoutes({ createLeadHandler = () => assert.fail('mutation handler must not run') } = {}) {
  const routes = [];
  const app = Object.fromEntries(
    ['get', 'post', 'patch', 'put', 'delete'].map((method) => [method, (path, ...callbacks) => {
      routes.push({ method: method.toUpperCase(), path, callbacks });
    }]),
  );
  registerPreSalesRoutes({
    app,
    requireJwt: (request, response, next) => {
      request.testAuthChecks = (request.testAuthChecks || 0) + 1;
      next();
    },
    requireLeadAccess: (request, response, next) => {
      request.testAccessChecks = (request.testAccessChecks || 0) + 1;
      next();
    },
    getClient: () => assert.fail('database client must not be requested'),
    createLeadHandler,
    updateLeadHandler: () => assert.fail('mutation handler must not run'),
  });
  return routes;
}

function executeMiddlewareStack(route) {
  const request = { method: route.method };
  const result = { request, status: null, body: null };
  const response = {
    status(value) {
      result.status = value;
      return this;
    },
    json(value) {
      result.body = value;
      return this;
    },
  };
  let index = 0;
  const next = () => {
    const callback = route.callbacks[index];
    index += 1;
    if (callback) callback(request, response, next);
  };
  next();
  return result;
}

test('all registered Pre-Sales mutation routes authenticate and then stop at the UAT guard', () => {
  const previous = process.env.READ_ONLY_UAT_MODE;
  process.env.READ_ONLY_UAT_MODE = 'true';
  try {
    const routes = capturePreSalesRoutes();
    const mutations = routes.filter((route) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(route.method));
    assert.equal(mutations.length, 9);
    for (const route of mutations) {
      const result = executeMiddlewareStack(route);
      assert.equal(result.request.testAuthChecks, 1, `${route.method} ${route.path} must authenticate`);
      assert.equal(result.request.testAccessChecks, 1, `${route.method} ${route.path} must authorize`);
      assert.equal(result.status, 423, `${route.method} ${route.path} must be blocked`);
      assert.equal(result.body?.error, 'READ_ONLY_UAT_MODE');
    }
    assert.equal(routes.some((route) => route.method === 'DELETE'), false, 'no Pre-Sales DELETE route currently exists');
  } finally {
    if (previous === undefined) delete process.env.READ_ONLY_UAT_MODE;
    else process.env.READ_ONLY_UAT_MODE = previous;
  }
});

test('registered Pre-Sales create route reaches its existing handler when UAT mode is off', () => {
  const previous = process.env.READ_ONLY_UAT_MODE;
  delete process.env.READ_ONLY_UAT_MODE;
  let handlerCalled = false;
  try {
    const routes = capturePreSalesRoutes({
      createLeadHandler: () => { handlerCalled = true; },
    });
    const route = routes.find(({ method, path }) => method === 'POST' && path === '/api/pre-sales/leads');
    const result = executeMiddlewareStack(route);
    assert.equal(result.request.testAuthChecks, 1);
    assert.equal(result.request.testAccessChecks, 1);
    assert.equal(result.status, null);
    assert.equal(handlerCalled, true);
  } finally {
    if (previous === undefined) delete process.env.READ_ONLY_UAT_MODE;
    else process.env.READ_ONLY_UAT_MODE = previous;
  }
});

test('HTTP, health, authentication, and guarded Pre-Sales routes remain outside the worker gate', async () => {
  const source = await readFile(serverUrl, 'utf8');

  assert.match(source, /app\.get\('\/health'/);
  assert.match(source, /async function requireSupabaseJwt\(/);
  assert.match(source, /registerPreSalesRoutes\(\{[\s\S]*requireJwt: requireSupabaseJwt,[\s\S]*requireLeadAccess: requireLeadManagementAccess/);
  assert.match(source, /app\.listen\(port, \(\) => \{[\s\S]*startAutomaticBackgroundWorkers\(/);
  assert.doesNotMatch(source, /READ_ONLY_UAT_MODE[\s\S]*response\.status\(200\)/);
});

test('server registers all autonomous side effects through the centralized worker gate', async () => {
  const source = await readFile(serverUrl, 'utf8');
  const startup = source.slice(source.indexOf('app.listen(port'));

  assert.match(startup, /hospital_ticket_sla_scheduler: \(\) => startHospitalSlaScheduler/);
  assert.match(startup, /smtp_transport_verification: verifyMailTransporter/);
  assert.match(startup, /daily_operations_report_scheduler: startDailyOperationsReportScheduler/);
  assert.match(startup, /end_day_km_auto_recalculation: startEndDayKmAutoRecalcScheduler/);
  assert.match(startup, /fo_stale_session_cleanup: startFoStaleSessionCleanupScheduler/);
  assert.equal((source.match(/runFoStaleSessionCleanup\('startup'\)/g) || []).length, 1);
});
