import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  assertHospitalFeedbackQrAccess,
  clearPublicFeedbackSessions,
  createPublicFeedbackSession,
  generateHospitalFeedbackQr,
  generatePublicQrToken,
  hashPublicQrToken,
  invalidQrResponse,
  resolvePublicHospitalFeedbackQr,
  verifyPublicFeedbackSession,
} from '../services/hospitalFeedbackQrService.js';

const migration = readFileSync(
  new URL('../../supabase/migrations_2_0/039_hospital_feedback_qr_foundation.sql', import.meta.url),
  'utf8',
);
const routes = readFileSync(new URL('../routes/hospitalFeedbackQrRoutes.js', import.meta.url), 'utf8');
const appRoutes = readFileSync(new URL('../../src/routes/AppRoutes.jsx', import.meta.url), 'utf8');
const publicPage = readFileSync(new URL('../../src/pages/PublicFeedbackQrPage.jsx', import.meta.url), 'utf8');
const api = readFileSync(new URL('../../src/services/api.js', import.meta.url), 'utf8');

const env = {
  HOSPITAL_FEEDBACK_PUBLIC_BASE_URL: 'https://myqpms.example',
  HOSPITAL_FEEDBACK_QR_TOKEN_PEPPER: 'pepper-for-tests',
  HOSPITAL_FEEDBACK_QR_ENCRYPTION_SECRET: 'secret-for-tests',
};

function locationRow(overrides = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    client_id: '22222222-2222-4222-8222-222222222222',
    block_id: '33333333-3333-4333-8333-333333333333',
    floor_id: '44444444-4444-4444-8444-444444444444',
    department_id: '55555555-5555-4555-8555-555555555555',
    location_name: 'Public Bathroom - B2',
    location_type: 'Washroom',
    is_active: true,
    floor_name: 'Second Floor',
    department_name: 'Public Area',
    client: { id: '22222222-2222-4222-8222-222222222222', client_name: 'Chengalpattu Medical College Hospital', is_active: true },
    block: { id: '33333333-3333-4333-8333-333333333333', block_name: 'Block B', is_active: true },
    floor: { id: '44444444-4444-4444-8444-444444444444', floor_name: 'Second Floor', is_active: true },
    department: { id: '55555555-5555-4555-8555-555555555555', department_name: 'Public Area', is_active: true },
    ...overrides,
  };
}

class FakeQuery {
  constructor(client, table) {
    this.client = client;
    this.table = table;
    this.filters = {};
    this.payload = null;
  }
  select() { return this; }
  order() { return this; }
  eq(key, value) { this.filters[key] = value; return this; }
  in() { return this; }
  or() { return this; }
  limit() { return this.client.resolve(this.table, this.filters, this.payload, 'limit'); }
  maybeSingle() { return this.client.resolve(this.table, this.filters, this.payload, 'maybeSingle'); }
  single() { return this.client.resolve(this.table, this.filters, this.payload, 'single'); }
  insert(payload) { this.payload = payload; return this; }
}

function fakeClient(resolver) {
  return {
    from(table) {
      return new FakeQuery({ resolve: resolver }, table);
    },
  };
}

test('secure QR token generation is non-sequential and hash-only lookup is deterministic', () => {
  const tokens = Array.from({ length: 20 }, () => generatePublicQrToken());
  assert.equal(new Set(tokens).size, tokens.length);
  assert.ok(tokens.every((token) => /^[A-Za-z0-9_-]{43}$/.test(token)));
  assert.notEqual(tokens[0], tokens[1]);
  assert.equal(hashPublicQrToken(tokens[0], env), hashPublicQrToken(tokens[0], env));
  assert.notEqual(hashPublicQrToken(tokens[0], env), hashPublicQrToken(tokens[1], env));
});

test('migration prevents duplicate active QR codes at database level', () => {
  assert.match(migration, /create table if not exists public\.hospital_feedback_qr_codes/);
  assert.match(migration, /references public\.hospital_locations\(id\)/);
  assert.match(migration, /ux_hospital_feedback_qr_one_active_per_location/);
  assert.match(migration, /where status = 'active'/);
  assert.match(migration, /status in \('active', 'inactive', 'replaced', 'revoked'\)/);
  assert.match(migration, /public_token_hash text not null/);
  assert.doesNotMatch(migration, /grant\s+select[\s\S]{0,120}to anon/i);
});

test('valid active token returns public-safe location data and a short session', async () => {
  clearPublicFeedbackSessions();
  const token = generatePublicQrToken();
  const client = fakeClient(async (table, filters) => {
    assert.equal(table, 'hospital_feedback_qr_codes');
    assert.equal(filters.status, 'active');
    assert.equal(filters.public_token_hash, hashPublicQrToken(token, env));
    return {
      data: {
        id: '66666666-6666-4666-8666-666666666666',
        status: 'active',
        location_id: locationRow().id,
        location: locationRow(),
      },
      error: null,
    };
  });

  const result = await resolvePublicHospitalFeedbackQr({ client, token, environment: env });
  assert.equal(result.valid, true);
  assert.deepEqual(result.location, {
    hospitalName: 'Chengalpattu Medical College Hospital',
    blockName: 'Block B',
    floorName: 'Second Floor',
    departmentName: 'Public Area',
    locationName: 'Public Bathroom - B2',
    locationType: 'Washroom',
  });
  assert.ok(result.session.token);
  assert.equal('id' in result.location, false);
  assert.equal('token_hash' in result, false);
});

test('invalid, inactive, replaced and revoked tokens return the same generic error', async () => {
  const client = fakeClient(async () => ({ data: null, error: null }));
  const invalid = await resolvePublicHospitalFeedbackQr({ client, token: 'not a valid token!', environment: env });
  assert.deepEqual(invalid, invalidQrResponse());
  for (const status of ['inactive', 'replaced', 'revoked']) {
    const response = await resolvePublicHospitalFeedbackQr({
      client,
      token: generatePublicQrToken(),
      environment: { ...env, status },
    });
    assert.deepEqual(response, invalidQrResponse());
  }
});

test('unauthenticated public resolution is routed without auth, but generation requires auth', () => {
  assert.match(routes, /router\.get\('\/public\/qr\/:token', noStoreNoIndex, publicQrRateLimit/);
  assert.match(routes, /router\.get\('\/qr\/:token', noStoreNoIndex, publicQrRateLimit/);
  assert.match(routes, /router\.post\('\/qr', requireAuth/);
  assert.match(routes, /router\.get\('\/qr\/locations', requireAuth/);
});

test('unauthorized authenticated users and out-of-scope hospital users cannot generate QR codes', async () => {
  const client = fakeClient(async (table) => {
    if (table.startsWith('access_')) {
      const error = new Error('missing table');
      error.code = '42P01';
      return { data: null, error };
    }
    if (table === 'hospital_ticket_users') {
      return { data: { id: 'user-a', client_id: locationRow().client_id, role_code: 'operations_executive', is_active: true }, error: null };
    }
    if (table === 'hospital_ticket_user_scopes') {
      return {
        data: [{
          client_id: locationRow().client_id,
          scope_type: 'block',
          block_id: '99999999-9999-4999-8999-999999999999',
          can_view: true,
          can_create: true,
          can_update: true,
        }],
        error: null,
      };
    }
    return { data: null, error: null };
  });

  await assert.rejects(
    () => assertHospitalFeedbackQrAccess({
      client,
      authUser: { id: 'auth-a' },
      profile: { role: 'Operations' },
      location: locationRow(),
      permission: 'generate',
    }),
    /permission/,
  );
});

test('QR generation reuses existing active QR and QR PNG uses the canonical public URL', async () => {
  let capturedUrl = '';
  const client = fakeClient(async (table, filters, payload, mode) => {
    if (table === 'hospital_locations') return { data: locationRow(), error: null };
    if (table === 'hospital_feedback_qr_codes' && mode === 'maybeSingle') return { data: null, error: null };
    if (table === 'hospital_feedback_qr_codes' && mode === 'single') {
      assert.equal(payload.location_id, locationRow().id);
      assert.equal(payload.status, 'active');
      return { data: { id: 'qr-a', status: 'active', version: 1, generated_at: payload.generated_at }, error: null };
    }
    return { data: [], error: null };
  });

  const result = await generateHospitalFeedbackQr({
    client,
    authUser: { id: 'auth-admin' },
    profile: { id: 'profile-admin', role: 'Admin' },
    locationId: locationRow().id,
    environment: env,
    createQrPng: async (url) => {
      capturedUrl = url;
      return 'data:image/png;base64,TEST';
    },
  });
  assert.match(result.public_url, /^https:\/\/myqpms\.example\/public-feedback\/q\//);
  assert.equal(capturedUrl, result.public_url);
  assert.equal(result.qr_png_data_url, 'data:image/png;base64,TEST');
});

test('public session is generated only after success and expired sessions are rejected', () => {
  clearPublicFeedbackSessions();
  const now = new Date('2026-07-31T10:00:00Z');
  const session = createPublicFeedbackSession({ qrId: 'qr-a', locationId: 'loc-a' }, env, now);
  assert.equal(verifyPublicFeedbackSession(session.token, new Date('2026-07-31T10:05:00Z')).valid, true);
  assert.equal(verifyPublicFeedbackSession(session.token, new Date('2026-07-31T10:30:00Z')).valid, false);
  assert.equal(verifyPublicFeedbackSession('missing').valid, false);
});

test('public frontend route has no directory, noindex meta and scan instruction', () => {
  assert.match(appRoutes, /path: 'public-feedback'/);
  assert.match(appRoutes, /path: 'public-feedback\/q\/:token'/);
  assert.match(publicPage, /Please scan the QR code displayed at the hospital location/);
  assert.match(publicPage, /noindex, nofollow/);
  assert.doesNotMatch(publicPage, /hospitalId|locationId|blockId/);
});

test('public API bypasses authenticated interceptor and client input cannot choose location', () => {
  assert.match(api, /const publicApi = axios\.create/);
  assert.match(api, /\/api\/public\/hospital-feedback\/qr\//);
  assert.match(api, /resolvePublicHospitalFeedbackQr\(token\)/);
  assert.doesNotMatch(api, /resolvePublicHospitalFeedbackQr\(token, .*location/i);
  assert.match(routes, /Cache-Control/);
  assert.match(routes, /X-Robots-Tag/);
  assert.match(routes, /HOSPITAL_FEEDBACK_QR_RATE_LIMIT_MAX/);
});
