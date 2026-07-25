import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { authorizeFoKmRecalculation } from '../services/foKmRecalculationAuthorizationService.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const serverSource = fs.readFileSync(path.join(root, 'backend/server.js'), 'utf8');
const mobileSource = fs.readFileSync(
  path.join(root, 'Mobile_FO_V2/lib/services/supabase_service.dart'),
  'utf8',
);
const webSource = fs.readFileSync(path.join(root, 'src/pages/FOActivities.jsx'), 'utf8');

function fakeClient(attendance) {
  const state = { filters: {} };
  const query = {
    select() {
      return query;
    },
    eq(column, value) {
      state.filters[column] = value;
      return query;
    },
    order() {
      return query;
    },
    limit() {
      return query;
    },
    async maybeSingle() {
      if (!attendance) return { data: null, error: null };
      const matches = Object.entries(state.filters).every(
        ([column, value]) => String(attendance[column]) === String(value),
      );
      return { data: matches ? attendance : null, error: null };
    },
  };
  return {
    from(table) {
      assert.equal(table, 'fo_attendance');
      return query;
    },
  };
}

const ownAttendance = {
  id: '11111111-1111-4111-8111-111111111111',
  fo_user_id: 'FO-001',
  employee_code: 'FO-001',
  attendance_date: '2026-07-25',
  login_time: '2026-07-25T03:30:00Z',
};

const activeProfile = {
  employee_code: 'FO-001',
  role: 'FO',
  is_active: true,
  status: 'Active',
};

test('missing token returns 401 before FO KM recalculation', () => {
  assert.match(
    serverSource,
    /app\.post\('\/api\/fo\/km\/recalculate',\s*requireSupabaseJwt,/,
  );
  assert.match(
    serverSource,
    /if \(!accessToken\) \{\s*response\.status\(401\)/,
  );
});

test('FO recalculating another FO returns 403', async () => {
  await assert.rejects(
    authorizeFoKmRecalculation({
      client: fakeClient({ ...ownAttendance, employee_code: 'FO-002', fo_user_id: 'FO-002' }),
      payload: { attendance_id: ownAttendance.id },
      profile: activeProfile,
    }),
    (error) => error.statusCode === 403,
  );
});

test('FO recalculating own attendance succeeds', async () => {
  const result = await authorizeFoKmRecalculation({
    client: fakeClient(ownAttendance),
    payload: {
      attendance_id: ownAttendance.id,
      employee_code: 'IMPERSONATION-IGNORED',
    },
    profile: activeProfile,
  });

  assert.equal(result.attendance.id, ownAttendance.id);
  assert.equal(result.payload.employee_code, 'FO-001');
  assert.equal(result.payload.fo_user_id, 'FO-001');
});

test('authorised management recalculation succeeds', async () => {
  const result = await authorizeFoKmRecalculation({
    client: fakeClient(ownAttendance),
    payload: { attendance_id: ownAttendance.id },
    profile: {
      employee_code: 'MANAGER-001',
      role: 'Operations Manager',
      is_active: true,
      status: 'Active',
    },
  });

  assert.equal(result.attendance.id, ownAttendance.id);
});

test('management without web access cannot recalculate another employee attendance', async () => {
  await assert.rejects(
    authorizeFoKmRecalculation({
      client: fakeClient(ownAttendance),
      payload: { attendance_id: ownAttendance.id },
      profile: {
        employee_code: 'MANAGER-001',
        role: 'Operations Manager',
        is_active: true,
        status: 'Active',
        web_access_enabled: false,
      },
    }),
    (error) => error.statusCode === 403,
  );
});

test('missing attendance returns 404', async () => {
  await assert.rejects(
    authorizeFoKmRecalculation({
      client: fakeClient(null),
      payload: { attendance_id: ownAttendance.id },
      profile: activeProfile,
    }),
    (error) => error.statusCode === 404,
  );
});

test('mobile and web callers send the current Supabase JWT', () => {
  assert.match(
    mobileSource,
    /currentAccessToken[\s\S]*authorizationHeader,\s*'Bearer \$token'/,
  );
  assert.match(
    webSource,
    /authenticatedFetch\(`\$\{API_BASE_URL\}\/api\/fo\/km\/recalculate`/,
  );
});
