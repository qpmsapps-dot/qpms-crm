import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import sharp from 'sharp';

import {
  assertHospitalFeedbackQrAccess,
  aggregateHospitalFeedbackDashboardRows,
  clearPublicFeedbackSessions,
  createPublicFeedbackSession,
  deleteHospitalFeedbackQr,
  encryptPublicQrToken,
  generateBrandedQrPngBuffer,
  generateHospitalFeedbackQr,
  generatePlainQrPngBuffer,
  generatePublicQrToken,
  hashPublicQrToken,
  invalidQrResponse,
  listHospitalFeedbackQrs,
  previewHospitalFeedbackQr,
  QR_ERROR_CORRECTION_LEVEL,
  QR_PNG_WIDTH,
  reprintHospitalFeedbackQr,
  resolvePublicHospitalFeedbackQr,
  submitPublicHospitalFeedback,
  verifyPublicFeedbackSession,
} from '../services/hospitalFeedbackQrService.js';

const migration = readFileSync(
  new URL('../../supabase/migrations_2_0/039_hospital_feedback_qr_foundation.sql', import.meta.url),
  'utf8',
);
const dmeMigration = readFileSync(
  new URL('../../supabase/migrations_2_0/044_dme_hospital_feedback_hierarchy_submissions.sql', import.meta.url),
  'utf8',
);
const nameCommentMigration = readFileSync(
  new URL('../../supabase/migrations_2_0/045_hospital_feedback_respondent_name_comments.sql', import.meta.url),
  'utf8',
);
const routes = readFileSync(new URL('../routes/hospitalFeedbackQrRoutes.js', import.meta.url), 'utf8');
const appRoutes = readFileSync(new URL('../../src/routes/AppRoutes.jsx', import.meta.url), 'utf8');
const publicPage = readFileSync(new URL('../../src/pages/PublicFeedbackQrPage.jsx', import.meta.url), 'utf8');
const dashboardPage = readFileSync(new URL('../../src/pages/HospitalFeedbackDashboard.jsx', import.meta.url), 'utf8');
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
    location_code: 'LOC-B2',
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
  gte(key, value) { this.filters[`${key}__gte`] = value; return this; }
  lte(key, value) { this.filters[`${key}__lte`] = value; return this; }
  lt(key, value) { this.filters[`${key}__lt`] = value; return this; }
  in() { return this; }
  or() { return this; }
  limit() { return this.client.resolve(this.table, this.filters, this.payload, 'limit'); }
  maybeSingle() { return this.client.resolve(this.table, this.filters, this.payload, 'maybeSingle'); }
  single() { return this.client.resolve(this.table, this.filters, this.payload, 'single'); }
  insert(payload) { this.payload = payload; return this; }
  update(payload) { this.payload = payload; return this; }
  delete() { this.payload = { __delete: true }; return this; }
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


test('branded QR PNG contains the canonical public URL contract and uses high error correction', async () => {
  const publicUrl = 'https://myqpms.example/public-feedback/q/test-token-123';
  const branded = await generateBrandedQrPngBuffer(publicUrl);
  const plain = await generatePlainQrPngBuffer(publicUrl);
  const metadata = await sharp(branded).metadata();

  assert.equal(QR_ERROR_CORRECTION_LEVEL, 'H');
  assert.equal(metadata.format, 'png');
  assert.equal(metadata.width, QR_PNG_WIDTH);
  assert.equal(metadata.height, QR_PNG_WIDTH);
  assert.notEqual(Buffer.compare(branded, plain), 0);
});

test('QR generation falls back to a plain PNG when the QPMS logo cannot be loaded', async () => {
  const publicUrl = 'https://myqpms.example/public-feedback/q/fallback-token-123';
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args);
  try {
    const fallback = await generateBrandedQrPngBuffer(publicUrl, { logoPath: 'missing-qpms-logo.png' });
    const plain = await generatePlainQrPngBuffer(publicUrl);
    const metadata = await sharp(fallback).metadata();

    assert.equal(metadata.width, QR_PNG_WIDTH);
    assert.equal(Buffer.compare(fallback, plain), 0);
    assert.match(String(warnings[0]?.[0] || ''), /Unable to apply QPMS logo/);
    assert.doesNotMatch(JSON.stringify(warnings), /fallback-token-123/);
  } finally {
    console.warn = originalWarn;
  }
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
    clientName: null,
    parentClientId: null,
    parentClientCode: null,
    parentClientName: null,
    hospitalCode: '',
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
  assert.match(routes, /router\.get\('\/qr', requireAuth/);
  assert.match(routes, /router\.post\('\/qr', requireAuth/);
  assert.match(routes, /router\.get\('\/qr\/:qrId\/preview', requireAuth/);
  assert.match(routes, /router\.post\('\/qr\/:qrId\/reprint', requireAuth/);
  assert.match(routes, /router\.delete\('\/qr\/:qrId', requireAuth/);
  assert.match(routes, /router\.get\('\/qr\/locations', requireAuth/);
});

test('DME hierarchy migration creates parent client RGGH blocks floors toilets and submissions table', () => {
  assert.match(dmeMigration, /create table if not exists public\.hospital_parent_clients/);
  assert.match(dmeMigration, /add column if not exists parent_client_id uuid/);
  assert.match(dmeMigration, /create table if not exists public\.hospital_feedback_submissions/);
  assert.match(dmeMigration, /client_code,\s*client_name,[\s\S]*'DME'/);
  assert.match(dmeMigration, /'RGGH'/);
  assert.match(dmeMigration, /generate_series\(1, 10\)/);
  assert.match(dmeMigration, /generate_series\(1, 6\)/);
  assert.match(dmeMigration, /v_block_count <> 3/);
  assert.match(dmeMigration, /v_floor_count <> 30/);
  assert.match(dmeMigration, /v_location_count <> 180/);
  assert.match(dmeMigration, /rating between 1 and 5/);
  assert.match(dmeMigration, /language in \('en', 'ta'\)/);
  assert.match(dmeMigration, /submission_key/);
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


test('existing active QR token is reused without changing token security fields', async () => {
  const token = generatePublicQrToken();
  const expectedPublicUrl = resultPublicUrl(token);
  let insertAttempted = false;
  const client = fakeClient(async (table, filters, payload, mode) => {
    if (table === 'hospital_locations') return { data: locationRow(), error: null };
    if (table === 'hospital_feedback_qr_codes' && mode === 'maybeSingle') {
      return {
        data: {
          id: 'qr-existing',
          status: 'active',
          version: 3,
          generated_at: '2026-07-31T10:00:00.000Z',
          public_token_hash: hashPublicQrToken(token, env),
          public_token_encrypted: encryptPublicQrToken(token, env),
        },
        error: null,
      };
    }
    if (table === 'hospital_feedback_qr_codes' && mode === 'single') insertAttempted = true;
    return { data: [], error: null };
  });

  const result = await generateHospitalFeedbackQr({
    client,
    authUser: { id: 'auth-admin' },
    profile: { id: 'profile-admin', role: 'Admin' },
    locationId: locationRow().id,
    environment: env,
    createQrPng: async (url) => {
      assert.equal(url, expectedPublicUrl);
      return 'data:image/png;base64,EXISTING';
    },
  });

  assert.equal(result.existing, true);
  assert.equal(result.public_url, expectedPublicUrl);
  assert.equal(result.qr_png_data_url, 'data:image/png;base64,EXISTING');
  assert.equal(insertAttempted, false);
});

function resultPublicUrl(token) {
  return `https://myqpms.example/public-feedback/q/${encodeURIComponent(token)}`;
}

function qrRow(overrides = {}) {
  return {
    id: '77777777-7777-4777-8777-777777777777',
    location_id: locationRow().id,
    status: 'active',
    version: 1,
    generated_at: '2026-07-31T10:00:00.000Z',
    last_printed_at: null,
    print_count: 0,
    public_token_encrypted: encryptPublicQrToken(generatePublicQrToken(), env),
    location: locationRow(),
    generated_by_profile: { full_name: 'QR Admin' },
    ...overrides,
  };
}

test('QR registry list returns authorized paginated records without token fields', async () => {
  const rows = [
    qrRow({ id: '77777777-7777-4777-8777-777777777777', generated_at: '2026-07-31T10:00:00.000Z' }),
    qrRow({
      id: '88888888-8888-4888-8888-888888888888',
      generated_at: '2026-07-30T10:00:00.000Z',
      location: locationRow({ location_name: 'Ward Lobby', location_code: 'LOBBY-1' }),
    }),
  ];
  const client = fakeClient(async (table, filters) => {
    assert.equal(table, 'hospital_feedback_qr_codes');
    assert.equal(filters.status, 'active');
    return { data: rows, error: null };
  });

  const result = await listHospitalFeedbackQrs({
    client,
    authUser: { id: 'auth-admin' },
    profile: { id: 'profile-admin', role: 'Admin' },
    filters: { search: 'bathroom', status: 'active', page: 1, pageSize: 1 },
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.pagination.total, 1);
  assert.equal(result.pagination.pageSize, 1);
  assert.equal(result.items[0].locationName, 'Public Bathroom - B2');
  assert.equal(result.items[0].locationCode, 'LOC-B2');
  assert.equal('public_token_encrypted' in result.items[0], false);
  assert.equal('public_token_hash' in result.items[0], false);
  assert.equal('token' in result.items[0], false);
});

test('QR registry list applies hospital and date filters', async () => {
  const allowedLocation = locationRow();
  const otherLocation = locationRow({
    id: '99999999-9999-4999-8999-999999999999',
    client_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    block_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    location_name: 'Other Ward',
  });
  const client = fakeClient(async (table, filters) => {
    if (table === 'hospital_locations') {
      assert.equal(filters.client_id, allowedLocation.client_id);
      return { data: [allowedLocation], error: null };
    }
    if (table === 'hospital_feedback_qr_codes') {
      assert.equal(filters.generated_at__gte, '2026-07-01T00:00:00.000Z');
      assert.equal(filters.generated_at__lte, '2026-07-31T23:59:59.999Z');
      return {
        data: [
          qrRow({ id: '77777777-7777-4777-8777-777777777777', location: allowedLocation }),
          qrRow({ id: '88888888-8888-4888-8888-888888888888', location: otherLocation }),
        ],
        error: null,
      };
    }
    return { data: null, error: null };
  });

  const result = await listHospitalFeedbackQrs({
    client,
    authUser: { id: 'auth-admin' },
    profile: { id: 'profile-admin', role: 'Admin' },
    filters: { hospitalId: allowedLocation.client_id, dateFrom: '2026-07-01', dateTo: '2026-07-31' },
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].hospitalId, allowedLocation.client_id);
});

test('QR preview and reprint reuse the encrypted token and branded QR without inserting a row', async () => {
  const token = generatePublicQrToken();
  let insertAttempted = false;
  let updatePayload = null;
  const row = qrRow({
    public_token_encrypted: encryptPublicQrToken(token, env),
    print_count: 2,
    last_printed_at: null,
  });
  const client = fakeClient(async (table, filters, payload, mode) => {
    if (table === 'hospital_feedback_qr_codes' && mode === 'maybeSingle') {
      assert.equal(filters.id, row.id);
      return { data: row, error: null };
    }
    if (table === 'hospital_feedback_qr_codes' && mode === 'single') {
      updatePayload = payload;
      return { data: { ...row, ...payload }, error: null };
    }
    if (table === 'hospital_feedback_qr_codes' && payload?.location_id) insertAttempted = true;
    return { data: null, error: null };
  });

  const preview = await previewHospitalFeedbackQr({
    client,
    authUser: { id: 'auth-admin' },
    profile: { id: 'profile-admin', role: 'Admin' },
    qrId: row.id,
    environment: env,
    createQrPng: async (url) => {
      assert.equal(url, resultPublicUrl(token));
      return 'data:image/png;base64,PREVIEW';
    },
  });
  const reprint = await reprintHospitalFeedbackQr({
    client,
    authUser: { id: 'auth-admin' },
    profile: { id: 'profile-admin', role: 'Admin' },
    qrId: row.id,
    environment: env,
    now: new Date('2026-08-01T10:00:00.000Z'),
    createQrPng: async (url) => {
      assert.equal(url, resultPublicUrl(token));
      return 'data:image/png;base64,REPRINT';
    },
  });

  assert.equal(preview.qr.publicUrl, resultPublicUrl(token));
  assert.equal(preview.qr.qrPngDataUrl, 'data:image/png;base64,PREVIEW');
  assert.equal(reprint.qr.publicUrl, resultPublicUrl(token));
  assert.equal(reprint.qr.printCount, 3);
  assert.equal(updatePayload.print_count, 3);
  assert.equal(updatePayload.last_printed_at, '2026-08-01T10:00:00.000Z');
  assert.equal(insertAttempted, false);
});

test('QR reprint rejects inactive replaced and revoked QR codes', async () => {
  for (const status of ['inactive', 'replaced', 'revoked']) {
    const row = qrRow({ status, public_token_encrypted: encryptPublicQrToken(generatePublicQrToken(), env) });
    const client = fakeClient(async () => ({ data: row, error: null }));
    await assert.rejects(
      () => reprintHospitalFeedbackQr({
        client,
        authUser: { id: 'auth-admin' },
        profile: { id: 'profile-admin', role: 'Admin' },
        qrId: row.id,
        environment: env,
      }),
      /active/,
    );
  }
});

test('QR reprint rejects authenticated users without hospital QR scope', async () => {
  const row = qrRow({ public_token_encrypted: encryptPublicQrToken(generatePublicQrToken(), env) });
  const client = fakeClient(async (table, _filters, _payload, mode) => {
    if (table === 'hospital_feedback_qr_codes' && mode === 'maybeSingle') return { data: row, error: null };
    if (table.startsWith('access_')) {
      const error = new Error('missing table');
      error.code = '42P01';
      return { data: null, error };
    }
    if (table === 'hospital_ticket_users') return { data: null, error: null };
    return { data: [], error: null };
  });

  await assert.rejects(
    () => reprintHospitalFeedbackQr({
      client,
      authUser: { id: 'auth-denied' },
      profile: { role: 'Operations' },
      qrId: row.id,
      environment: env,
    }),
    /permission/,
  );
});

test('authorized user can delete exactly one QR without returning token fields', async () => {
  const row = qrRow();
  let deleteCount = 0;
  const client = fakeClient(async (table, filters, payload, mode) => {
    if (table === 'hospital_feedback_qr_codes' && mode === 'maybeSingle' && !payload) {
      assert.equal(filters.id, row.id);
      return { data: row, error: null };
    }
    if (table === 'hospital_feedback_qr_codes' && mode === 'maybeSingle' && payload?.__delete) {
      deleteCount += 1;
      assert.equal(filters.id, row.id);
      return { data: { id: row.id }, error: null };
    }
    return { data: null, error: null };
  });

  const result = await deleteHospitalFeedbackQr({
    client,
    authUser: { id: 'auth-admin' },
    profile: { id: 'profile-admin', role: 'Admin' },
    qrId: row.id,
  });

  assert.equal(result.success, true);
  assert.equal(result.deletedQrId, row.id);
  assert.equal(deleteCount, 1);
  assert.equal('public_token_encrypted' in result, false);
  assert.equal('public_token_hash' in result, false);
  assert.equal('token' in result, false);
});

test('QR delete rejects unauthorized users and other hospital scope', async () => {
  const row = qrRow();
  const client = fakeClient(async (table, _filters, _payload, mode) => {
    if (table === 'hospital_feedback_qr_codes' && mode === 'maybeSingle') return { data: row, error: null };
    if (table.startsWith('access_')) {
      const error = new Error('missing table');
      error.code = '42P01';
      return { data: null, error };
    }
    if (table === 'hospital_ticket_users') {
      return { data: { id: 'hospital-user-b', client_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', role_code: 'operations_executive', is_active: true }, error: null };
    }
    if (table === 'hospital_ticket_user_scopes') {
      return {
        data: [{
          client_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          scope_type: 'client',
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
    () => deleteHospitalFeedbackQr({
      client,
      authUser: { id: 'auth-other' },
      profile: { role: 'Operations' },
      qrId: row.id,
    }),
    /permission/,
  );
});

test('QR delete returns not found invalid id and conflict safely', async () => {
  const missingClient = fakeClient(async () => ({ data: null, error: null }));
  await assert.rejects(
    () => deleteHospitalFeedbackQr({
      client: missingClient,
      authUser: { id: 'auth-admin' },
      profile: { id: 'profile-admin', role: 'Admin' },
      qrId: '77777777-7777-4777-8777-777777777777',
    }),
    /not found/i,
  );
  await assert.rejects(
    () => deleteHospitalFeedbackQr({
      client: missingClient,
      authUser: { id: 'auth-admin' },
      profile: { id: 'profile-admin', role: 'Admin' },
      qrId: 'not-a-uuid',
    }),
    /valid UUID/,
  );

  const row = qrRow();
  const conflictClient = fakeClient(async (table, _filters, payload, mode) => {
    if (table === 'hospital_feedback_qr_codes' && mode === 'maybeSingle' && !payload) return { data: row, error: null };
    if (table === 'hospital_feedback_qr_codes' && mode === 'maybeSingle' && payload?.__delete) {
      const error = new Error('foreign key violation');
      error.code = '23503';
      return { data: null, error };
    }
    return { data: null, error: null };
  });
  await assert.rejects(
    () => deleteHospitalFeedbackQr({
      client: conflictClient,
      authUser: { id: 'auth-admin' },
      profile: { id: 'profile-admin', role: 'Admin' },
      qrId: row.id,
    }),
    /blocked/,
  );
});

test('deleted QR leaves registry and public token resolution unavailable while location can generate again', async () => {
  const token = generatePublicQrToken();
  let deleted = false;
  let inserted = false;
  const row = qrRow({ public_token_encrypted: encryptPublicQrToken(token, env) });
  const client = fakeClient(async (table, filters, payload, mode) => {
    if (table === 'hospital_feedback_qr_codes' && mode === 'maybeSingle' && payload?.__delete) {
      deleted = true;
      return { data: { id: row.id }, error: null };
    }
    if (table === 'hospital_feedback_qr_codes' && mode === 'maybeSingle' && filters.id) {
      return { data: deleted ? null : row, error: null };
    }
    if (table === 'hospital_feedback_qr_codes' && mode === 'maybeSingle' && filters.public_token_hash) {
      return { data: deleted ? null : row, error: null };
    }
    if (table === 'hospital_feedback_qr_codes' && mode === 'maybeSingle' && filters.location_id) {
      return { data: deleted ? null : row, error: null };
    }
    if (table === 'hospital_feedback_qr_codes' && mode === 'limit') {
      return { data: deleted ? [] : [row], error: null };
    }
    if (table === 'hospital_locations') return { data: locationRow(), error: null };
    if (table === 'hospital_feedback_qr_codes' && mode === 'single' && payload?.location_id) {
      inserted = true;
      return { data: { id: 'new-qr', status: 'active', version: 1, generated_at: payload.generated_at }, error: null };
    }
    return { data: null, error: null };
  });

  await deleteHospitalFeedbackQr({
    client,
    authUser: { id: 'auth-admin' },
    profile: { id: 'profile-admin', role: 'Admin' },
    qrId: row.id,
  });
  const registry = await listHospitalFeedbackQrs({
    client,
    authUser: { id: 'auth-admin' },
    profile: { id: 'profile-admin', role: 'Admin' },
  });
  const publicResult = await resolvePublicHospitalFeedbackQr({ client, token, environment: env });
  const generated = await generateHospitalFeedbackQr({
    client,
    authUser: { id: 'auth-admin' },
    profile: { id: 'profile-admin', role: 'Admin' },
    locationId: locationRow().id,
    environment: env,
    createQrPng: async () => 'data:image/png;base64,NEW',
  });

  assert.equal(registry.items.length, 0);
  assert.deepEqual(publicResult, invalidQrResponse());
  assert.equal(inserted, true);
  assert.equal(generated.existing, false);
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



test('public Phase 2 demo flow is bilingual, local-only and starts at language selection', () => {
  assert.ok(publicPage.includes('Welcome!'));
  assert.ok(publicPage.includes('\u0bb5\u0bb0\u0bb5\u0bc7\u0bb1\u0bcd\u0b95\u0bbf\u0bb1\u0bcb\u0bae\u0bcd!'));
  assert.ok(publicPage.includes("hospital-feedback-qr:${token || 'missing'}:language"));
  assert.ok(publicPage.includes("setCurrentStep('language')"));
  assert.ok(publicPage.includes("setCurrentStep('location')"));
  assert.ok(publicPage.includes("setCurrentStep('rating')"));
  assert.ok(publicPage.includes("setCurrentStep('thankYou')"));
  assert.ok(publicPage.includes("setCurrentStep('complete')"));
  assert.ok(publicPage.includes('Location identified successfully.'));
  assert.ok(publicPage.includes('\u0b87\u0b9f\u0bae\u0bcd \u0bb5\u0bc6\u0bb1\u0bcd\u0bb1\u0bbf\u0b95\u0bb0\u0bae\u0bbe\u0b95 \u0b95\u0ba3\u0bcd\u0b9f\u0bb1\u0bbf\u0baf\u0baa\u0bcd\u0baa\u0b9f\u0bcd\u0b9f\u0ba4\u0bc1.'));
  assert.ok(publicPage.includes('How was your experience?'));
  assert.ok(publicPage.includes('\u0b89\u0b99\u0bcd\u0b95\u0bb3\u0bcd \u0b85\u0ba9\u0bc1\u0baa\u0bb5\u0bae\u0bcd \u0b8e\u0baa\u0bcd\u0baa\u0b9f\u0bbf \u0b87\u0bb0\u0bc1\u0ba8\u0bcd\u0ba4\u0ba4\u0bc1?'));
  assert.ok(publicPage.includes('Thank you!'));
  assert.ok(publicPage.includes('\u0ba8\u0ba9\u0bcd\u0bb1\u0bbf!'));
  assert.ok(publicPage.includes('verifyPublicHospitalFeedbackSession'));
  assert.ok(publicPage.includes('submitPublicHospitalFeedback'));
  assert.ok(publicPage.includes('selectedRating ? ('));
  assert.ok(publicPage.includes('Please select one rating to continue.'));
  assert.ok(publicPage.includes('\u0bae\u0bbf\u0b95\u0bb5\u0bc1\u0bae\u0bcd \u0bae\u0bcb\u0b9a\u0bae\u0bcd'));
  assert.doesNotMatch(publicPage, /createHospitalTicket|createTicket|ticket_number|ticketNumber|feedbackApi|api\.post|publicApi\.post/);
});

test('public QR page preserves safe error states and public-safe location rendering', () => {
  assert.ok(publicPage.includes('Invalid QR Code'));
  assert.ok(publicPage.includes('\u0ba4\u0bb5\u0bb1\u0bbe\u0ba9 QR \u0b95\u0bc1\u0bb1\u0bbf\u0baf\u0bc0\u0b9f\u0bc1'));
  assert.ok(publicPage.includes('Session expired'));
  assert.ok(publicPage.includes('\u0b85\u0bae\u0bb0\u0bcd\u0bb5\u0bc1 \u0b95\u0bbe\u0bb2\u0bbe\u0bb5\u0ba4\u0bbf\u0baf\u0bbe\u0ba9\u0ba4\u0bc1'));
  assert.ok(publicPage.includes('onRetry={loadQr}'));
  assert.ok(publicPage.includes('[t.department, location.departmentName]'));
  assert.ok(publicPage.includes('.filter(([, value]) => Boolean(value))'));
  assert.doesNotMatch(publicPage, /hospitalId|blockId|floorId|locationId|employee|supervisor|ticketConfig/);
});

test('internal QR generator preview and download use the same branded PNG data URL', () => {
  const generatorPage = readFileSync(new URL('../../src/pages/HospitalFeedbackQrGenerator.jsx', import.meta.url), 'utf8');
  assert.match(generatorPage, /<img src={qr.qr_png_data_url}/);
  assert.match(generatorPage, /link.href = qr.qr_png_data_url/);
  assert.match(generatorPage, /Active/);
  assert.match(generatorPage, /Client Feedback QR Generator/);
  assert.match(generatorPage, /Client/);
  assert.match(generatorPage, /Hospital/);
  assert.match(generatorPage, /Block/);
  assert.match(generatorPage, /Floor/);
  assert.match(generatorPage, /Location/);
});

test('public feedback submission stores rating idempotently and flags below four', async () => {
  clearPublicFeedbackSessions();
  const session = createPublicFeedbackSession({ qrId: '66666666-6666-4666-8666-666666666666', locationId: locationRow().id }, env, new Date('2026-07-31T10:00:00Z'));
  let insertedPayload = null;
  const dmeLocation = locationRow({
    client: {
      id: locationRow().client_id,
      client_code: 'RGGH',
      client_name: 'RGGH',
      parent_client_id: '99999999-9999-4999-8999-999999999999',
      is_active: true,
      parent_client: { id: '99999999-9999-4999-8999-999999999999', client_code: 'DME', client_name: 'DME', is_active: true },
    },
  });
  const client = fakeClient(async (table, filters, payload, mode) => {
    if (table === 'hospital_feedback_submissions' && mode === 'maybeSingle') return { data: null, error: null };
    if (table === 'hospital_feedback_qr_codes') {
      assert.equal(filters.id, '66666666-6666-4666-8666-666666666666');
      assert.equal(filters.location_id, dmeLocation.id);
      assert.equal(filters.status, 'active');
      return { data: { id: filters.id, status: 'active', location_id: dmeLocation.id, location: dmeLocation }, error: null };
    }
    if (table === 'hospital_feedback_submissions' && mode === 'single') {
      insertedPayload = payload;
      return { data: { rating: payload.rating, needs_attention: payload.needs_attention, submitted_at: payload.submitted_at }, error: null };
    }
    return { data: null, error: null };
  });

  const result = await submitPublicHospitalFeedback({
    client,
    now: new Date('2026-07-31T10:01:00Z'),
    payload: {
      session_token: session.token,
      submission_key: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      rating: 2,
      language: 'en',
      respondent_name: '  Lakshmi  ',
      comments: '  Needs cleaning near entrance.  ',
      needs_attention: false,
      answers: {},
    },
  });

  assert.equal(result.submission.submitted, true);
  assert.equal(result.submission.rating, 2);
  assert.equal(result.submission.needsAttention, true);
  assert.equal(result.submission.respondentName, undefined);
  assert.equal(result.submission.comments, undefined);
  assert.equal(insertedPayload.respondent_name, 'Lakshmi');
  assert.equal(insertedPayload.comments, 'Needs cleaning near entrance.');
  assert.equal(insertedPayload.needs_attention, true);
  assert.equal(insertedPayload.parent_client_id, '99999999-9999-4999-8999-999999999999');
  assert.equal(insertedPayload.hospital_id, dmeLocation.client_id);
  assert.equal(insertedPayload.location_id, dmeLocation.id);
});

test('public feedback submission returns existing row only for an identical retry', async () => {
  clearPublicFeedbackSessions();
  const qrId = '66666666-6666-4666-8666-666666666666';
  const submissionKey = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const session = createPublicFeedbackSession({ qrId, locationId: locationRow().id }, env, new Date('2026-07-31T10:00:00Z'));
  let insertCount = 0;
  const client = fakeClient(async (table, filters, payload, mode) => {
    if (table === 'hospital_feedback_qr_codes') {
      return { data: { id: qrId, status: 'active', location_id: locationRow().id, location: locationRow() }, error: null };
    }
    if (table === 'hospital_feedback_submissions' && mode === 'maybeSingle') {
      assert.equal(filters.submission_key, submissionKey);
      return {
        data: {
          qr_code_id: qrId,
          location_id: locationRow().id,
          rating: 4,
          language: 'en',
          respondent_name: 'Ravi',
          comments: 'Clean',
          answers: { b: 2, a: 1 },
          needs_attention: false,
          submitted_at: '2026-07-31T10:01:00.000Z',
        },
        error: null,
      };
    }
    if (table === 'hospital_feedback_submissions' && mode === 'single') insertCount += 1;
    return { data: null, error: null };
  });

  const result = await submitPublicHospitalFeedback({
    client,
    now: new Date('2026-07-31T10:01:00Z'),
    payload: {
      session_token: session.token,
      submission_key: submissionKey,
      rating: 4,
      language: 'en',
      respondent_name: '  Ravi  ',
      comments: '  Clean  ',
      answers: { a: 1, b: 2 },
    },
  });

  assert.equal(result.submission.rating, 4);
  assert.equal(result.submission.needsAttention, false);
  assert.equal(insertCount, 0);
});

test('public feedback submission blocks reused key across locations without leaking details', async () => {
  clearPublicFeedbackSessions();
  const qrId = '66666666-6666-4666-8666-666666666666';
  const session = createPublicFeedbackSession({ qrId, locationId: locationRow().id }, env, new Date('2026-07-31T10:00:00Z'));
  const client = fakeClient(async (table, filters, payload, mode) => {
    if (table === 'hospital_feedback_qr_codes') {
      return { data: { id: qrId, status: 'active', location_id: locationRow().id, location: locationRow() }, error: null };
    }
    if (table === 'hospital_feedback_submissions' && mode === 'maybeSingle') {
      return {
        data: {
          qr_code_id: '77777777-7777-4777-8777-777777777777',
          location_id: '88888888-8888-4888-8888-888888888888',
          rating: 1,
          language: 'ta',
          comments: 'private',
          answers: { private: true },
          needs_attention: true,
          submitted_at: '2026-07-31T10:01:00.000Z',
        },
        error: null,
      };
    }
    return { data: null, error: null };
  });

  await assert.rejects(
    () => submitPublicHospitalFeedback({
      client,
      now: new Date('2026-07-31T10:01:00Z'),
      payload: {
        session_token: session.token,
        submission_key: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        rating: 5,
        language: 'en',
        answers: {},
      },
    }),
    (error) => error.statusCode === 409 && error.code === 'SUBMISSION_KEY_REUSED' && !/private|rating/i.test(error.message),
  );
});

test('public feedback submission blocks same-location payload mismatch', async () => {
  clearPublicFeedbackSessions();
  const qrId = '66666666-6666-4666-8666-666666666666';
  const session = createPublicFeedbackSession({ qrId, locationId: locationRow().id }, env, new Date('2026-07-31T10:00:00Z'));
  const client = fakeClient(async (table, filters, payload, mode) => {
    if (table === 'hospital_feedback_qr_codes') {
      return { data: { id: qrId, status: 'active', location_id: locationRow().id, location: locationRow() }, error: null };
    }
    if (table === 'hospital_feedback_submissions' && mode === 'maybeSingle') {
      return {
        data: {
          qr_code_id: qrId,
          location_id: locationRow().id,
          rating: 5,
          language: 'en',
          comments: null,
          answers: {},
          needs_attention: false,
          submitted_at: '2026-07-31T10:01:00.000Z',
        },
        error: null,
      };
    }
    return { data: null, error: null };
  });

  await assert.rejects(
    () => submitPublicHospitalFeedback({
      client,
      now: new Date('2026-07-31T10:01:00Z'),
      payload: {
        session_token: session.token,
        submission_key: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        rating: 4,
        language: 'en',
        answers: {},
      },
    }),
    (error) => error.statusCode === 409 && error.code === 'IDEMPOTENCY_PAYLOAD_MISMATCH',
  );
});

test('public feedback submission treats changed respondent name or comment as idempotency mismatch', async () => {
  clearPublicFeedbackSessions();
  const qrId = '66666666-6666-4666-8666-666666666666';
  const submissionKey = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const session = createPublicFeedbackSession({ qrId, locationId: locationRow().id }, env, new Date('2026-07-31T10:00:00Z'));
  const client = fakeClient(async (table, filters, payload, mode) => {
    if (table === 'hospital_feedback_qr_codes') {
      return { data: { id: qrId, status: 'active', location_id: locationRow().id, location: locationRow() }, error: null };
    }
    if (table === 'hospital_feedback_submissions' && mode === 'maybeSingle') {
      return {
        data: {
          qr_code_id: qrId,
          location_id: locationRow().id,
          rating: 5,
          language: 'en',
          respondent_name: 'Lakshmi',
          comments: 'Clean area',
          answers: {},
          needs_attention: false,
          submitted_at: '2026-07-31T10:01:00.000Z',
        },
        error: null,
      };
    }
    return { data: null, error: null };
  });

  for (const payloadPatch of [{ respondent_name: 'Ravi', comments: 'Clean area' }, { respondent_name: 'Lakshmi', comments: 'Different comment' }]) {
    await assert.rejects(
      () => submitPublicHospitalFeedback({
        client,
        now: new Date('2026-07-31T10:01:00Z'),
        payload: {
          session_token: session.token,
          submission_key: submissionKey,
          rating: 5,
          language: 'en',
          answers: {},
          ...payloadPatch,
        },
      }),
      (error) => error.statusCode === 409 && error.code === 'IDEMPOTENCY_PAYLOAD_MISMATCH' && !/Lakshmi|Clean area|Ravi/i.test(error.message),
    );
  }
});

test('public feedback submission safely handles concurrent 23505 retries and collisions', async () => {
  clearPublicFeedbackSessions();
  const qrId = '66666666-6666-4666-8666-666666666666';
  const submissionKey = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const session = createPublicFeedbackSession({ qrId, locationId: locationRow().id }, env, new Date('2026-07-31T10:00:00Z'));
  let submissionLookupCount = 0;
  const client = fakeClient(async (table, filters, payload, mode) => {
    if (table === 'hospital_feedback_qr_codes') {
      return { data: { id: qrId, status: 'active', location_id: locationRow().id, location: locationRow() }, error: null };
    }
    if (table === 'hospital_feedback_submissions' && mode === 'maybeSingle') {
      submissionLookupCount += 1;
      if (submissionLookupCount === 1) return { data: null, error: null };
      return {
        data: {
          qr_code_id: qrId,
          location_id: locationRow().id,
          rating: 3,
          language: 'ta',
          comments: null,
          answers: {},
          needs_attention: true,
          submitted_at: '2026-07-31T10:01:00.000Z',
        },
        error: null,
      };
    }
    if (table === 'hospital_feedback_submissions' && mode === 'single') {
      assert.equal(payload.needs_attention, true);
      return { data: null, error: { code: '23505', message: 'duplicate key' } };
    }
    return { data: null, error: null };
  });

  const result = await submitPublicHospitalFeedback({
    client,
    now: new Date('2026-07-31T10:01:00Z'),
    payload: {
      session_token: session.token,
      submission_key: submissionKey,
      rating: 3,
      language: 'ta',
      needs_attention: false,
      answers: {},
    },
  });

  assert.equal(result.submission.rating, 3);
  assert.equal(result.submission.needsAttention, true);
  assert.equal(submissionLookupCount, 2);
});

test('public feedback submission normalizes optional empty respondent name and comment to null', async () => {
  clearPublicFeedbackSessions();
  const qrId = '66666666-6666-4666-8666-666666666666';
  const session = createPublicFeedbackSession({ qrId, locationId: locationRow().id }, env, new Date('2026-07-31T10:00:00Z'));
  let insertedPayload = null;
  const client = fakeClient(async (table, filters, payload, mode) => {
    if (table === 'hospital_feedback_qr_codes') {
      return { data: { id: qrId, status: 'active', location_id: locationRow().id, location: locationRow() }, error: null };
    }
    if (table === 'hospital_feedback_submissions' && mode === 'maybeSingle') return { data: null, error: null };
    if (table === 'hospital_feedback_submissions' && mode === 'single') {
      insertedPayload = payload;
      return { data: { rating: payload.rating, needs_attention: payload.needs_attention, submitted_at: payload.submitted_at }, error: null };
    }
    return { data: null, error: null };
  });

  await submitPublicHospitalFeedback({
    client,
    now: new Date('2026-07-31T10:01:00Z'),
    payload: {
      session_token: session.token,
      submission_key: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      rating: 5,
      language: 'en',
      respondent_name: '   ',
      comments: '\n\t ',
      answers: {},
    },
  });

  assert.equal(insertedPayload.respondent_name, null);
  assert.equal(insertedPayload.comments, null);
});

test('public feedback submission blocks concurrent 23505 collision from another location', async () => {
  clearPublicFeedbackSessions();
  const qrId = '66666666-6666-4666-8666-666666666666';
  const session = createPublicFeedbackSession({ qrId, locationId: locationRow().id }, env, new Date('2026-07-31T10:00:00Z'));
  let submissionLookupCount = 0;
  const client = fakeClient(async (table, filters, payload, mode) => {
    if (table === 'hospital_feedback_qr_codes') {
      return { data: { id: qrId, status: 'active', location_id: locationRow().id, location: locationRow() }, error: null };
    }
    if (table === 'hospital_feedback_submissions' && mode === 'maybeSingle') {
      submissionLookupCount += 1;
      if (submissionLookupCount === 1) return { data: null, error: null };
      return {
        data: {
          qr_code_id: '77777777-7777-4777-8777-777777777777',
          location_id: '88888888-8888-4888-8888-888888888888',
          rating: 1,
          language: 'en',
          comments: 'do not leak',
          answers: { secret: true },
          needs_attention: true,
          submitted_at: '2026-07-31T10:01:00.000Z',
        },
        error: null,
      };
    }
    if (table === 'hospital_feedback_submissions' && mode === 'single') {
      return { data: null, error: { code: '23505', message: 'duplicate key' } };
    }
    return { data: null, error: null };
  });

  await assert.rejects(
    () => submitPublicHospitalFeedback({
      client,
      now: new Date('2026-07-31T10:01:00Z'),
      payload: {
        session_token: session.token,
        submission_key: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        rating: 5,
        language: 'en',
        answers: {},
      },
    }),
    (error) => error.statusCode === 409 && error.code === 'SUBMISSION_KEY_REUSED' && !/secret|leak|rating/i.test(error.message),
  );
});

test('public feedback submission rejects unsafe and oversized payloads', async () => {
  clearPublicFeedbackSessions();
  const qrId = '66666666-6666-4666-8666-666666666666';
  const session = createPublicFeedbackSession({ qrId, locationId: locationRow().id }, env, new Date('2026-07-31T10:00:00Z'));
  const client = fakeClient(async (table) => {
    if (table === 'hospital_feedback_qr_codes') {
      return { data: { id: qrId, status: 'active', location_id: locationRow().id, location: locationRow() }, error: null };
    }
    return { data: null, error: null };
  });
  const basePayload = {
    session_token: session.token,
    submission_key: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    rating: 5,
    language: 'en',
    answers: {},
  };

  const now = new Date('2026-07-31T10:01:00Z');
  await assert.rejects(() => submitPublicHospitalFeedback({ client, now, payload: { ...basePayload, submission_key: 'bad' } }), /valid UUID/);
  await assert.rejects(() => submitPublicHospitalFeedback({ client, now, payload: { ...basePayload, rating: 0 } }), /Rating/);
  await assert.rejects(() => submitPublicHospitalFeedback({ client, now, payload: { ...basePayload, rating: 6 } }), /Rating/);
  await assert.rejects(() => submitPublicHospitalFeedback({ client, now, payload: { ...basePayload, rating: 4.5 } }), /Rating/);
  await assert.rejects(() => submitPublicHospitalFeedback({ client, now, payload: { ...basePayload, rating: '5' } }), /Rating/);
  await assert.rejects(() => submitPublicHospitalFeedback({ client, now, payload: { ...basePayload, respondent_name: 123 } }), /Text fields/);
  await assert.rejects(() => submitPublicHospitalFeedback({ client, now, payload: { ...basePayload, respondent_name: 'x'.repeat(121) } }), /large/);
  await assert.rejects(() => submitPublicHospitalFeedback({ client, now, payload: { ...basePayload, respondent_name: 'Bad\u0001Name' } }), /unsupported characters/);
  await assert.rejects(() => submitPublicHospitalFeedback({ client, now, payload: { ...basePayload, comments: { text: 'bad' } } }), /Text fields/);
  await assert.rejects(() => submitPublicHospitalFeedback({ client, now, payload: { ...basePayload, comments: 'x'.repeat(2001) } }), /large/);
  await assert.rejects(() => submitPublicHospitalFeedback({ client, now, payload: { ...basePayload, answers: { safe: { constructor: true } } } }), /unsupported/);
  await assert.rejects(() => submitPublicHospitalFeedback({ client, now, payload: { ...basePayload, answers: { text: 'x'.repeat(16 * 1024) } } }), /too large/);
});

test('public feedback submission rejects invalid rating and expired session', async () => {
  clearPublicFeedbackSessions();
  const client = fakeClient(async () => ({ data: null, error: null }));
  await assert.rejects(
    () => submitPublicHospitalFeedback({
      client,
      payload: {
        session_token: 'missing',
        submission_key: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        rating: 5,
        language: 'en',
      },
    }),
    /expired/,
  );
  const session = createPublicFeedbackSession({ qrId: '66666666-6666-4666-8666-666666666666', locationId: locationRow().id }, env, new Date('2026-07-31T10:00:00Z'));
  const activeClient = fakeClient(async (table) => {
    if (table === 'hospital_feedback_qr_codes') {
      return {
        data: { id: '66666666-6666-4666-8666-666666666666', status: 'active', location_id: locationRow().id, location: locationRow() },
        error: null,
      };
    }
    return { data: null, error: null };
  });
  await assert.rejects(
    () => submitPublicHospitalFeedback({
      client: activeClient,
      now: new Date('2026-07-31T10:01:00Z'),
      payload: {
        session_token: session.token,
        submission_key: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        rating: 6,
        language: 'en',
      },
    }),
    /Rating/,
  );
});

test('authenticated feedback dashboard response includes respondent name and comments', () => {
  const result = aggregateHospitalFeedbackDashboardRows([
    {
      id: 'sub-1',
      rating: 5,
      language: 'en',
      respondent_name: 'Lakshmi',
      comments: 'Clean and well maintained.',
      answers: {},
      needs_attention: false,
      submitted_at: '2026-08-04T03:30:00.000Z',
      parent_client_id: 'parent-1',
      hospital_id: 'hospital-1',
      block_id: 'block-1',
      floor_id: 'floor-1',
      location_id: 'location-1',
      parent_client: { client_name: 'DME' },
      hospital: { client_name: 'RGGH' },
      block: { block_name: 'Block 1' },
      floor: { floor_name: 'Floor 1' },
      location: { location_name: 'Toilet 1', location_type: 'Toilet' },
    },
  ]);

  assert.equal(result.recentFeedback[0].respondentName, 'Lakshmi');
  assert.equal(result.recentFeedback[0].comments, 'Clean and well maintained.');
  assert.equal(result.recentFeedback[0].parentClientName, 'DME');
  assert.equal(result.recentFeedback[0].hospitalName, 'RGGH');
});

test('internal QR registry renders search filters empty state and reprint actions', () => {
  const generatorPage = readFileSync(new URL('../../src/pages/HospitalFeedbackQrGenerator.jsx', import.meta.url), 'utf8');
  assert.match(generatorPage, /Generated QR Codes/);
  assert.match(generatorPage, /No generated QR codes found\./);
  assert.match(generatorPage, /setTimeout\(\(\) => setDebouncedSearch/);
  assert.match(generatorPage, /setPage\(1\)/);
  assert.match(generatorPage, /listHospitalFeedbackQrs/);
  assert.match(generatorPage, /previewHospitalFeedbackQr/);
  assert.match(generatorPage, /reprintHospitalFeedbackQr/);
  assert.match(generatorPage, /Reprint \/ Download/);
  assert.match(generatorPage, /Delete QR\?/);
  assert.match(generatorPage, /This will permanently delete this QR record/);
  assert.match(generatorPage, /deleteHospitalFeedbackQr/);
  assert.match(generatorPage, /onQrDeleted/);
  assert.match(generatorPage, /setRegistryRefresh/);
});

test('public API bypasses authenticated interceptor and client input cannot choose location', () => {
  assert.match(api, /const publicApi = axios\.create/);
  assert.match(api, /\/api\/public\/hospital-feedback\/qr\//);
  assert.match(api, /resolvePublicHospitalFeedbackQr\(token\)/);
  assert.match(api, /listHospitalFeedbackQrs\(params/);
  assert.match(api, /previewHospitalFeedbackQr\(qrId\)/);
  assert.match(api, /reprintHospitalFeedbackQr\(qrId\)/);
  assert.match(api, /deleteHospitalFeedbackQr\(qrId\)/);
  assert.doesNotMatch(api, /resolvePublicHospitalFeedbackQr\(token, .*location/i);
  assert.match(routes, /Cache-Control/);
  assert.match(routes, /X-Robots-Tag/);
  assert.match(routes, /HOSPITAL_FEEDBACK_QR_RATE_LIMIT_MAX/);
  assert.match(routes, /router\.post\('\/submissions'/);
  assert.match(api, /submitPublicHospitalFeedback/);
});

test('Soft Services dashboard route API and page contracts are present', () => {
  assert.match(appRoutes, /operations\/hospital-feedback\/dashboard/);
  assert.match(routes, /\/dashboard\/summary/);
  assert.match(routes, /getHospitalFeedbackDashboard/);
  assert.match(api, /getHospitalFeedbackDashboard/);
  assert.match(dashboardPage, /Soft Services Feedback Report/);
  assert.match(dashboardPage, /Total Feedback/);
  assert.match(dashboardPage, /Average Rating/);
  assert.match(dashboardPage, /Five-Star %/);
  assert.match(dashboardPage, /Needs Attention/);
  assert.match(dashboardPage, /Named Responses/);
  assert.match(dashboardPage, /Checklist Completion Rate/);
  assert.match(dashboardPage, /Block \/ Location Performance/);
  assert.match(dashboardPage, /Comments & Names/);
});

test('respondent name/comment migration adds only nullable respondent field and safe constraints', () => {
  assert.match(nameCommentMigration, /add column if not exists respondent_name text/i);
  assert.doesNotMatch(nameCommentMigration, /respondent_name text not null/i);
  assert.match(nameCommentMigration, /char_length\(respondent_name\) <= 120/i);
  assert.match(nameCommentMigration, /char_length\(comments\) <= 2000/i);
  assert.match(nameCommentMigration, /not valid/i);
  assert.doesNotMatch(nameCommentMigration, /grant\s+insert[\s\S]{0,120}to anon/i);
});
