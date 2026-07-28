import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  createPostmanTestResetHandler,
  isPostmanTestResetEnabled,
  registerPostmanTestResetRoute,
  resetPostmanApprovalMatrixData,
} from '../services/postmanTestResetService.js';

function fakeApp() {
  const routes = [];
  return {
    routes,
    post(path, ...handlers) {
      routes.push({ method: 'POST', path, handlers });
    },
  };
}

function fakeResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

async function runHandlers(handlers, request) {
  const response = fakeResponse();
  let index = 0;
  async function next() {
    const handler = handlers[index++];
    if (handler) await handler(request, response, next);
  }
  await next();
  return response;
}

function testJwt(request, response, next) {
  const token = String(request.headers?.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token || token === 'invalid') {
    response.status(401).json({ ok: false, message: 'Invalid token.' });
    return;
  }
  request.profile = {
    role: token === 'admin-token' ? 'Admin' : 'COO',
  };
  return next();
}

function testAdmin(request, response, next) {
  if (request.profile?.role !== 'Admin') {
    response.status(403).json({ ok: false, message: 'Admin required.' });
    return;
  }
  return next();
}

function enabledRoute(resetHandler = async (request, response) => {
  response.json({ ok: true });
}) {
  const app = fakeApp();
  registerPostmanTestResetRoute({
    app,
    env: { NODE_ENV: 'test', ENABLE_TEST_RESET: 'true' },
    requireJwt: testJwt,
    requireAdmin: testAdmin,
    resetHandler,
  });
  return app.routes[0];
}

function mockClient({
  leads = [{ id: 'lead-test-1' }],
  visits = [{ id: 'visit-test-1' }],
  failDeleteTable = null,
} = {}) {
  const operations = [];
  return {
    operations,
    from(table) {
      return {
        select(columns) {
          return {
            async eq(column, value) {
              operations.push({
                type: 'select-eq',
                table,
                columns,
                column,
                value,
              });
              return { data: leads, error: null };
            },
            async in(column, values) {
              operations.push({
                type: 'select-in',
                table,
                columns,
                column,
                values,
              });
              return { data: visits, error: null };
            },
          };
        },
        delete() {
          return {
            async in(column, values) {
              operations.push({
                type: 'delete',
                table,
                column,
                values,
              });
              return {
                data: null,
                error: table === failDeleteTable
                  ? { code: 'TEST_DELETE_FAILED' }
                  : null,
              };
            },
          };
        },
      };
    },
  };
}

test('test reset is fail-closed for production and missing configuration', () => {
  const disabledCases = [
    {},
    { NODE_ENV: 'production' },
    { NODE_ENV: 'production', ENABLE_TEST_RESET: 'true' },
    { NODE_ENV: 'test' },
    { NODE_ENV: 'test', ENABLE_TEST_RESET: 'false' },
    { NODE_ENV: 'test', ENABLE_TEST_RESET: '1' },
    { NODE_ENV: 'test', ENABLE_TEST_RESET: 'yes' },
    { NODE_ENV: 'test', ENABLE_TEST_RESET: 'on' },
  ];

  for (const env of disabledCases) {
    const app = fakeApp();
    let resetCalled = false;
    const registered = registerPostmanTestResetRoute({
      app,
      env,
      requireJwt: testJwt,
      requireAdmin: testAdmin,
      resetHandler: () => {
        resetCalled = true;
      },
    });
    assert.equal(registered, false);
    assert.equal(app.routes.length, 0);
    assert.equal(resetCalled, false);
  }
});

test('server wires the guarded route to Supabase JWT and service-role cleanup', async () => {
  const server = await readFile(new URL('../server.js', import.meta.url), 'utf8');
  assert.match(
    server,
    /registerPostmanTestResetRoute\(\{[\s\S]*requireJwt:\s*requireSupabaseJwt,[\s\S]*getClient:\s*requireServiceRoleSupabase/,
  );
  assert.match(server, /requireAdmin:\s*requirePostmanTestResetAdmin/);
  assert.doesNotMatch(server, /app\.post\(['"]\/api\/test\/reset/);
  assert.doesNotMatch(server, /apiSessions\.clear\(\)/);
});

test('explicit supported non-production environments and exact true flag enable registration', () => {
  for (const nodeEnv of ['development', 'staging', 'test']) {
    assert.equal(isPostmanTestResetEnabled({
      NODE_ENV: nodeEnv,
      ENABLE_TEST_RESET: 'true',
    }), true);
  }
});

test('enabled reset requires JWT and exact canonical Admin role', async () => {
  const route = enabledRoute();

  const missing = await runHandlers(route.handlers, { headers: {} });
  assert.equal(missing.statusCode, 401);

  const invalid = await runHandlers(route.handlers, {
    headers: { authorization: 'Bearer invalid' },
  });
  assert.equal(invalid.statusCode, 401);

  const nonAdmin = await runHandlers(route.handlers, {
    headers: { authorization: 'Bearer coo-token' },
  });
  assert.equal(nonAdmin.statusCode, 403);

  const admin = await runHandlers(route.handlers, {
    headers: { authorization: 'Bearer admin-token' },
  });
  assert.equal(admin.statusCode, 200);
  assert.deepEqual(admin.body, { ok: true });
});

test('Admin reset uses fixed Postman targeting and checks every delete result', async () => {
  const client = mockClient();
  const result = await resetPostmanApprovalMatrixData({
    client,
    logger: { error() {} },
  });

  assert.deepEqual(result, { deletedLeadCount: 1 });
  assert.deepEqual(client.operations[0], {
    type: 'select-eq',
    table: 'leads',
    columns: 'id',
    column: 'created_by_name',
    value: 'postman_automation',
  });
  assert.deepEqual(
    client.operations.filter((operation) => operation.type === 'delete')
      .map((operation) => operation.table),
    [
      'approval_queue',
      'workflow_status',
      'workflow_events',
      'workflow_instances',
      'activity_logs',
      'approval_requests',
      'site_assessments',
      'site_mom',
      'site_visits',
      'activity_logs',
      'lead_mom',
      'lead_contacts',
      'leads',
    ],
  );
});

test('request body cannot change the fixed reset target', async () => {
  const client = mockClient();
  const handler = createPostmanTestResetHandler({
    getClient: () => client,
    logger: { error() {} },
  });
  const route = enabledRoute(handler);
  const response = await runHandlers(route.handlers, {
    headers: { authorization: 'Bearer admin-token' },
    body: {
      employee_code: 'caller-controlled',
      lead_id: 'caller-controlled',
      table: 'profiles',
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(client.operations[0].column, 'created_by_name');
  assert.equal(client.operations[0].value, 'postman_automation');
  assert.equal(
    client.operations.some((operation) => operation.table === 'profiles'),
    false,
  );
});

test('database deletion failure stops cleanup and never reports success', async () => {
  const client = mockClient({ failDeleteTable: 'workflow_status' });
  const logged = [];
  const handler = createPostmanTestResetHandler({
    getClient: () => client,
    logger: { error(message, detail) { logged.push({ message, detail }); } },
  });
  const route = enabledRoute(handler);
  const response = await runHandlers(route.handlers, {
    headers: { authorization: 'Bearer admin-token' },
  });

  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.body, {
    ok: false,
    message: 'Postman test data reset failed.',
  });
  assert.equal(logged[0].detail.table, 'workflow_status');
  assert.equal(
    client.operations.some((operation) => operation.table === 'leads'
      && operation.type === 'delete'),
    false,
  );
});

test('attendance without test-marked leads performs no deletes', async () => {
  const client = mockClient({ leads: [] });
  const result = await resetPostmanApprovalMatrixData({
    client,
    logger: { error() {} },
  });

  assert.deepEqual(result, { deletedLeadCount: 0 });
  assert.equal(
    client.operations.some((operation) => operation.type === 'delete'),
    false,
  );
});
