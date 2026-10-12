import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const serverSource = await readFile(new URL('../server.js', import.meta.url), 'utf8');
const preSalesRouteSource = await readFile(new URL('../routes/preSalesRoutes.js', import.meta.url), 'utf8');

function sourceBetween(startMarker, endMarker) {
  const start = serverSource.indexOf(startMarker);
  const end = serverSource.indexOf(endMarker, start);
  assert.ok(start >= 0, `Missing source marker: ${startMarker}`);
  assert.ok(end > start, `Missing source marker: ${endMarker}`);
  return serverSource.slice(start, end);
}

function responseRecorder() {
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

function loadRequireSupabaseJwt({ authResult, profileResult, profileFailure } = {}) {
  const middlewareSource = sourceBetween(
    'async function requireSupabaseJwt(request, response, next)',
    'function requireFoOperationsCommandCenter',
  );
  const profileQuery = {
    select() { return this; },
    eq() { return this; },
    async maybeSingle() {
      if (profileFailure) throw profileFailure;
      return profileResult || { data: { id: 'profile-1', employee_code: 'QPMSFO1', role: 'FO' }, error: null };
    },
  };
  const context = vm.createContext({
    console: { log() {}, warn() {}, error() {} },
    getBearerToken: () => 'test-token',
    supabaseAnon: { auth: { getUser: async () => authResult || { data: { user: { id: 'auth-1' } }, error: null } } },
    requireServiceRoleSupabase: () => ({ from: () => profileQuery }),
    assertServiceRoleAuthAdminAccess: async () => {},
    sanitizeSupabaseDiagnosticError: (error) => ({ message: error.message, code: error.code || null }),
    blockDemoReadOnlyMutation: () => false,
  });
  vm.runInContext(`${middlewareSource}\nglobalThis.middleware = requireSupabaseJwt;`, context);
  return context.middleware;
}

test('valid Supabase JWT authenticates and attaches the verified profile', async () => {
  const middleware = loadRequireSupabaseJwt();
  const request = { headers: {}, path: '/api/pre-sales/leads' };
  const response = responseRecorder();
  let nextCalls = 0;

  await middleware(request, response, () => { nextCalls += 1; });

  assert.equal(nextCalls, 1);
  assert.equal(response.body, null);
  assert.equal(request.authUser.id, 'auth-1');
  assert.equal(request.profile.id, 'profile-1');
  assert.equal(request.employeeCode, 'QPMSFO1');
  assert.equal(request.userRole, 'FO');
  assert.equal('userScopedSupabase' in request, false);
});

test('invalid or expired Supabase JWT remains an HTTP 401', async () => {
  const middleware = loadRequireSupabaseJwt({
    authResult: { data: { user: null }, error: { code: 'bad_jwt', message: 'expired' } },
  });
  const response = responseRecorder();
  let nextCalls = 0;

  await middleware({ headers: {}, path: '/api/fo/site-visits/validate-checkin-location' }, response, () => { nextCalls += 1; });

  assert.equal(nextCalls, 0);
  assert.equal(response.statusCode, 401);
  assert.equal(response.body.message, 'Invalid or expired Supabase access token.');
});

test('valid FO Check-In JWT reaches the protected location-validation handler', async () => {
  const middleware = loadRequireSupabaseJwt();
  const response = responseRecorder();
  let locationValidationReached = false;

  await middleware(
    { headers: {}, path: '/api/fo/site-visits/validate-checkin-location' },
    response,
    () => { locationValidationReached = true; },
  );

  assert.equal(locationValidationReached, true);
  assert.equal(response.body, null);
});

test('internal JWT middleware exceptions return HTTP 500 instead of false token expiry', async () => {
  const middleware = loadRequireSupabaseJwt({ profileFailure: new ReferenceError('internal defect') });
  const response = responseRecorder();
  let nextCalls = 0;

  await middleware({ headers: {}, path: '/api/pre-sales/leads' }, response, () => { nextCalls += 1; });

  assert.equal(nextCalls, 0);
  assert.equal(response.statusCode, 500);
  assert.equal(response.body.code, 'supabase_jwt_verification_failed');
  assert.match(response.body.message, /failed internally/i);
});

test('protected web and FO Check-In routes retain authentication and authorization guards', () => {
  const preSalesRegistration = sourceBetween('registerPreSalesRoutes({', '// Backward-compatible mobile aliases');
  const checkInRoute = sourceBetween("'/api/fo/site-visits/validate-checkin-location'", "'/api/fo/site-visits/:visitId/force-checkout'");
  const userScopedMiddleware = sourceBetween(
    'async function requireSupabaseJwtWithUserScopedProfile',
    'const USER_MANAGEMENT_ROLE_KEYS',
  );

  assert.match(preSalesRegistration, /requireJwt: requireSupabaseJwt/);
  assert.match(preSalesRegistration, /requireLeadAccess: requireLeadManagementAccess/);
  assert.match(preSalesRouteSource, /app\.get\('\/api\/pre-sales\/leads', \.\.\.guards/);
  assert.match(checkInRoute, /requireSupabaseJwt/);
  assert.match(checkInRoute, /validateFoCheckInLocation/);
  assert.match(userScopedMiddleware, /const userScopedSupabase = createClient\(supabaseUrl, supabaseAnonKey/);
  assert.match(userScopedMiddleware, /request\.userScopedSupabase = userScopedSupabase/);
});
