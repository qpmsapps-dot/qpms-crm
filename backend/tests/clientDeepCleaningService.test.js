import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import { createClientDeepCleaningRouter } from '../routes/clientDeepCleaningRoutes.js';
import {
  CLIENT_DEEP_CLEANING_BUSINESS,
  buildClientDeepCleaningStoragePath,
  completeClientDeepCleaningUpload,
  createClientDeepCleaningSubmission,
  createClientDeepCleaningUploadUrl,
  createClientDeepCleaningUploadViewUrl,
  deleteClientDeepCleaningUpload,
  listClientDeepCleaningSubmissions,
  loadOwnedSubmission,
  searchRelianceRetailStores,
  submitClientDeepCleaningSubmission,
  updateClientDeepCleaningDraft,
  validateUploadInput,
} from '../services/clientDeepCleaningService.js';

const FO_PROFILE = {
  id: 'profile-1',
  auth_user_id: '11111111-1111-4111-8111-111111111111',
  employee_code: 'RRFO001',
  role: 'FO',
  business: 'Reliance Retail',
};

const OTHER_FO_PROFILE = {
  id: 'profile-2',
  auth_user_id: '22222222-2222-4222-8222-222222222222',
  employee_code: 'RRFO002',
  role: 'FO',
  business: 'Reliance',
};

const NON_RELIANCE_PROFILE = {
  id: 'profile-3',
  auth_user_id: '33333333-3333-4333-8333-333333333333',
  employee_code: 'FO003',
  role: 'FO',
  business: 'Standalone',
};

const TABLES = [
  'store_master',
  'client_deep_cleaning_submissions',
  'client_deep_cleaning_uploads',
  'fo_activity_submissions',
  'fo_activity_uploads',
];

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function matchesFilter(row, filter) {
  const actual = row[filter.column];
  if (filter.type === 'eq') return String(actual ?? '') === String(filter.value ?? '');
  if (filter.type === 'ilike') {
    const pattern = String(filter.value ?? '').replace(/%/g, '').toLowerCase();
    return String(actual ?? '').toLowerCase().includes(pattern);
  }
  if (filter.type === 'gte') return String(actual ?? '') >= String(filter.value ?? '');
  if (filter.type === 'lte') return String(actual ?? '') <= String(filter.value ?? '');
  if (filter.type === 'in') return filter.values.includes(actual);
  if (filter.type === 'or') return filter.conditions.some((condition) => matchesFilter(row, condition));
  return true;
}

class Query {
  constructor(db, table) {
    this.db = db;
    this.table = table;
    this.filters = [];
    this._operation = 'select';
    this._payload = null;
    this._limit = null;
    this._range = null;
    this._single = false;
    this._maybeSingle = false;
    this._count = null;
    this._head = false;
  }

  select(_columns, options = {}) {
    this._count = options.count || null;
    this._head = options.head === true;
    return this;
  }

  insert(payload) {
    this._operation = 'insert';
    this._payload = payload;
    return this;
  }

  update(payload) {
    this._operation = 'update';
    this._payload = payload;
    return this;
  }

  delete() {
    this._operation = 'delete';
    return this;
  }

  eq(column, value) {
    this.filters.push({ type: 'eq', column, value });
    return this;
  }

  ilike(column, value) {
    this.filters.push({ type: 'ilike', column, value });
    return this;
  }

  gte(column, value) {
    this.filters.push({ type: 'gte', column, value });
    return this;
  }

  lte(column, value) {
    this.filters.push({ type: 'lte', column, value });
    return this;
  }

  in(column, values) {
    this.filters.push({ type: 'in', column, values });
    return this;
  }

  or(expression) {
    const conditions = String(expression)
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const match = part.match(/^([^.]*)\.ilike\.(.*)$/i);
        if (match) return { type: 'ilike', column: match[1], value: match[2] };
        return null;
      })
      .filter(Boolean);
    if (conditions.length) this.filters.push({ type: 'or', conditions });
    return this;
  }

  order() {
    return this;
  }

  limit(value) {
    this._limit = value;
    return this;
  }

  range(from, to) {
    this._range = [from, to];
    return this;
  }

  maybeSingle() {
    this._maybeSingle = true;
    return this.execute();
  }

  single() {
    this._single = true;
    return this.execute();
  }

  then(resolve, reject) {
    return this.execute().then(resolve, reject);
  }

  async execute() {
    const rows = this.db.tables[this.table];
    if (!rows) return { data: null, error: new Error(`Unknown table ${this.table}`), count: null };
    const matches = () => rows.filter((row) => this.filters.every((filter) => matchesFilter(row, filter)));
    if (this._operation === 'insert') {
      const payloads = Array.isArray(this._payload) ? this._payload : [this._payload];
      const inserted = payloads.map((payload) => {
        const row = {
          id: payload.id || this.db.nextId(this.table),
          created_at: payload.created_at || new Date().toISOString(),
          updated_at: payload.updated_at || new Date().toISOString(),
          ...clone(payload),
        };
        rows.push(row);
        return clone(row);
      });
      return this._single || this._maybeSingle
        ? { data: inserted[0] || null, error: null, count: null }
        : { data: inserted, error: null, count: null };
    }
    if (this._operation === 'update') {
      const changed = [];
      for (const row of matches()) {
        Object.assign(row, clone(this._payload), { updated_at: new Date().toISOString() });
        changed.push(clone(row));
      }
      return this._single || this._maybeSingle
        ? { data: changed[0] || null, error: null, count: null }
        : { data: changed, error: null, count: null };
    }
    if (this._operation === 'delete') {
      const toDelete = new Set(matches().map((row) => row.id));
      this.db.tables[this.table] = rows.filter((row) => !toDelete.has(row.id));
      return { data: null, error: null, count: toDelete.size };
    }
    let selected = matches().map(clone);
    const count = selected.length;
    if (this._range) selected = selected.slice(this._range[0], this._range[1] + 1);
    if (this._limit != null) selected = selected.slice(0, this._limit);
    if (this._head) return { data: null, error: null, count };
    if (this._single) return { data: selected[0] || null, error: null, count: null };
    if (this._maybeSingle) return { data: selected[0] || null, error: null, count: null };
    return { data: selected, error: null, count: this._count ? count : null };
  }
}

class FakeSupabase {
  constructor(seed = {}) {
    this.tables = Object.fromEntries(TABLES.map((table) => [table, clone(seed[table] || [])]));
    this.idCounters = {};
    this.storageObjects = new Map();
    this.storage = {
      from: (bucket) => ({
        createSignedUploadUrl: async (path) => ({
          data: { signedUrl: `https://upload.example/${bucket}/${path}`, token: `token-${path}` },
          error: null,
        }),
        createSignedUrl: async (path, expiresIn) => ({
          data: { signedUrl: `https://download.example/${bucket}/${path}?expiresIn=${expiresIn}` },
          error: null,
        }),
        list: async (directory, options = {}) => {
          const prefix = directory ? `${directory}/` : '';
          const search = String(options.search || '');
          const objects = [...(this.storageObjects.get(bucket) || [])]
            .filter((object) => object.path.startsWith(prefix))
            .map((object) => ({
              ...object,
              name: object.path.slice(prefix.length),
            }))
            .filter((object) => !search || object.name === search);
          return { data: objects, error: null };
        },
        remove: async (paths) => {
          const objects = this.storageObjects.get(bucket) || [];
          this.storageObjects.set(bucket, objects.filter((object) => !paths.includes(object.path)));
          return { data: paths.map((path) => ({ name: path })), error: null };
        },
      }),
    };
  }

  nextId(table) {
    this.idCounters[table] = (this.idCounters[table] || 0) + 1;
    return `${table}-${this.idCounters[table]}`;
  }

  from(table) {
    return new Query(this, table);
  }

  addStorageObject(bucket, path, size = 1000) {
    const objects = this.storageObjects.get(bucket) || [];
    objects.push({ path, size, metadata: { size } });
    this.storageObjects.set(bucket, objects);
  }
}

function client() {
  return new FakeSupabase({
    store_master: [
      {
        id: 'store-rr-1',
        store_code: 'RR001',
        store_name: 'Reliance Smart Hyderabad',
        client_name: 'Reliance Retail',
        business: 'Reliance',
        state: 'TG',
        status: 'Active',
        metadata: { city: 'Hyderabad', store_format: 'Smart' },
      },
      {
        id: 'store-other-1',
        store_code: 'ST001',
        store_name: 'Standalone Store',
        client_name: 'Other',
        business: 'Standalone',
        state: 'TG',
        status: 'Active',
        metadata: {},
      },
      {
        id: 'store-rr-2',
        store_code: 'TH72',
        store_name: 'Reliance Fresh Chennai',
        client_name: 'Reliance',
        business: 'Reliance Retail',
        state: 'TN',
        status: 'Active',
        metadata: { city: 'Chennai', format: 'Fresh' },
      },
      {
        id: 'store-other-2',
        store_code: 'TH72-OTHER',
        store_name: 'Other TH72 Store',
        client_name: 'Other',
        business: 'Standalone',
        state: 'TN',
        status: 'Active',
        metadata: {},
      },
    ],
  });
}

async function issueAndCompleteUpload(db, submission, uploadType, profile = FO_PROFILE) {
  const issued = await createClientDeepCleaningUploadUrl(db, profile, submission.id, {
    upload_type: uploadType,
    filename: `${uploadType}.jpg`,
    mime_type: 'image/jpeg',
    file_size: 1000,
  });
  db.addStorageObject(issued.storage_bucket, issued.storage_path, 1000);
  return completeClientDeepCleaningUpload(db, profile, submission.id, {
    upload_id: issued.upload_id,
    upload_type: uploadType,
    storage_bucket: issued.storage_bucket,
    storage_path: issued.storage_path,
    filename: `${uploadType}.jpg`,
    mime_type: 'image/jpeg',
    file_size: 1000,
  });
}

async function createReadySubmission(db, profile = FO_PROFILE) {
  const draft = await createClientDeepCleaningSubmission(db, profile, {
    store_code: 'RR001',
    deep_cleaning_date: '2026-09-01',
    vendor_name: '',
    remarks: 'Monthly cleaning',
    business: 'Forged Business',
    submitted_by_user_id: 'forged-user',
    submitted_by_employee_code: 'forged-code',
    performed_by_type: 'fo',
  });
  await issueAndCompleteUpload(db, draft, 'before', profile);
  await issueAndCompleteUpload(db, draft, 'after', profile);
  return draft;
}

test('Reliance Retail FO can create draft and forged trusted fields are ignored', async () => {
  const db = client();
  const row = await createClientDeepCleaningSubmission(db, FO_PROFILE, {
    store_code: 'RR001',
    deep_cleaning_date: '2026-09-01',
    vendor_name: 'Vendor One',
    remarks: 'Monthly cleaning',
    business: 'Standalone',
    submitted_by_user_id: 'attacker',
    submitted_by_employee_code: 'ATTACK',
    performed_by_type: 'fo',
  });
  assert.equal(row.business, CLIENT_DEEP_CLEANING_BUSINESS);
  assert.equal(row.submitted_by_user_id, FO_PROFILE.auth_user_id);
  assert.equal(row.submitted_by_employee_code, FO_PROFILE.employee_code);
  assert.equal(row.performed_by_type, 'vendor');
  assert.equal(row.status, 'draft');
  assert.equal(row.store_id, 'store-rr-1');
  assert.equal(row.store_format, 'Smart');
  assert.equal(row.attendance_id, undefined);
  assert.equal(row.site_visit_id, undefined);
});

test('Non-Reliance FO receives 403 and unauthenticated route receives 401', async () => {
  const db = client();
  await assert.rejects(
    () => createClientDeepCleaningSubmission(db, NON_RELIANCE_PROFILE, { store_code: 'RR001' }),
    /Reliance Retail authorization is required/,
  );

  const app = express();
  app.use(express.json());
  app.use('/api/client-deep-cleaning', createClientDeepCleaningRouter({
    requireAuth: (_request, response) => response.status(401).json({ ok: false, message: 'Supabase Bearer token required.' }),
    getClient: () => db,
  }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/client-deep-cleaning/submissions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ store_code: 'RR001' }),
    });
    assert.equal(response.status, 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('Invalid or non-Reliance store is rejected and Reliance alias stores save canonical business', async () => {
  const db = client();
  await assert.rejects(
    () => createClientDeepCleaningSubmission(db, FO_PROFILE, { store_code: 'MISSING001' }),
    /not found or is inactive/,
  );
  await assert.rejects(
    () => createClientDeepCleaningSubmission(db, FO_PROFILE, { store_code: 'ST001' }),
    /Store is not a Reliance Retail store/,
  );
  const row = await createClientDeepCleaningSubmission(db, FO_PROFILE, { store_code: 'RR001' });
  assert.equal(row.business, 'Reliance Retail');
});

test('Reliance store search is authorised and returns only Reliance-compatible stores', async () => {
  const db = client();
  const retail = await searchRelianceRetailStores(db, FO_PROFILE, { limit: 10 });
  assert.equal(retail.rows.length, 2);
  assert.deepEqual(retail.rows.map((row) => row.business), ['Reliance Retail', 'Reliance Retail']);
  assert.ok(retail.rows.every((row) => row.store_code !== 'ST001' && row.store_code !== 'TH72-OTHER'));

  const alias = await searchRelianceRetailStores(db, OTHER_FO_PROFILE, { q: 'TH72', page: 1, limit: 1 });
  assert.equal(alias.rows.length, 1);
  assert.equal(alias.rows[0].store_code, 'TH72');
  assert.equal(alias.pagination.page, 1);
  assert.equal(alias.pagination.limit, 1);

  await assert.rejects(
    () => searchRelianceRetailStores(db, NON_RELIANCE_PROFILE, {}),
    /Reliance Retail authorization is required/,
  );
  await assert.rejects(
    () => searchRelianceRetailStores(db, { ...FO_PROFILE, role: 'KAM' }, {}),
    /Only FO users/,
  );
});

test('Deep Cleaning store route enforces auth profile and paginated response shape', async () => {
  const db = client();
  const app = express();
  app.use(express.json());
  app.use('/api/client-deep-cleaning', createClientDeepCleaningRouter({
    requireAuth: (request, _response, next) => {
      request.profile = request.headers.authorization === 'Bearer retail'
        ? FO_PROFILE
        : NON_RELIANCE_PROFILE;
      next();
    },
    getClient: () => db,
  }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  try {
    const { port } = server.address();
    const allowed = await fetch(`http://127.0.0.1:${port}/api/client-deep-cleaning/stores?q=TH72&page=1&limit=1`, {
      headers: { authorization: 'Bearer retail' },
    });
    assert.equal(allowed.status, 200);
    const body = await allowed.json();
    assert.equal(body.ok, true);
    assert.equal(body.rows.length, 1);
    assert.equal(body.rows[0].store_code, 'TH72');
    assert.equal(body.rows[0].business, 'Reliance Retail');
    assert.equal(body.pagination.limit, 1);

    const denied = await fetch(`http://127.0.0.1:${port}/api/client-deep-cleaning/stores`, {
      headers: { authorization: 'Bearer other' },
    });
    assert.equal(denied.status, 403);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('FO can list and read own submissions but not another FO record', async () => {
  const db = client();
  const own = await createClientDeepCleaningSubmission(db, FO_PROFILE, { store_code: 'RR001' });
  const other = await createClientDeepCleaningSubmission(db, OTHER_FO_PROFILE, { store_code: 'RR001' });
  const list = await listClientDeepCleaningSubmissions(db, FO_PROFILE, {});
  assert.deepEqual(list.rows.map((row) => row.id), [own.id]);
  assert.equal((await loadOwnedSubmission(db, FO_PROFILE, own.id)).id, own.id);
  await assert.rejects(() => loadOwnedSubmission(db, FO_PROFILE, other.id), /not found/);
});

test('FO cannot modify another FO draft, draft can be edited, and submitted record is locked', async () => {
  const db = client();
  const own = await createReadySubmission(db);
  const other = await createClientDeepCleaningSubmission(db, OTHER_FO_PROFILE, { store_code: 'RR001' });
  await assert.rejects(() => updateClientDeepCleaningDraft(db, FO_PROFILE, other.id, { remarks: 'Nope' }), /not found/);
  const edited = await updateClientDeepCleaningDraft(db, FO_PROFILE, own.id, { remarks: 'Updated', vendor_name: 'Vendor Two' });
  assert.equal(edited.remarks, 'Updated');
  const submitted = await submitClientDeepCleaningSubmission(db, FO_PROFILE, own.id);
  assert.equal(submitted.status, 'submitted');
  await assert.rejects(() => updateClientDeepCleaningDraft(db, FO_PROFILE, own.id, { remarks: 'After submit' }), /cannot be edited/);
});

test('Upload validation rejects invalid type, oversize, and unsafe MIME', () => {
  assert.throws(() => validateUploadInput({ upload_type: 'avatar', mime_type: 'image/jpeg', file_size: 1 }), /Upload type/);
  assert.throws(() => validateUploadInput({ upload_type: 'before', mime_type: 'image/jpeg', file_size: 6 * 1024 * 1024 }), /5 MB/);
  assert.throws(() => validateUploadInput({ upload_type: 'before', mime_type: 'application/x-msdownload', file_size: 1 }), /Unsupported/);
});

test('Upload URL path is independent from attendance and site visits', async () => {
  const db = client();
  const draft = await createClientDeepCleaningSubmission(db, FO_PROFILE, { store_code: 'RR001' });
  const result = await createClientDeepCleaningUploadUrl(db, FO_PROFILE, draft.id, {
    upload_type: 'before',
    filename: '../bad name.jpg',
    mime_type: 'image/jpeg',
    file_size: 1000,
  });
  assert.match(result.storage_path, /^deep-cleaning\/reliance-retail\/RR001\//);
  assert.doesNotMatch(result.storage_path, /attendance|site-visit|site_visit|fo_attendance|fo_site_visits/i);
  assert.equal(result.storage_bucket, 'client-deep-cleaning-uploads');
  assert.ok(result.upload_id);
  assert.ok(result.signed_url);
  assert.equal(db.tables.client_deep_cleaning_uploads[0].upload_status, 'pending');
});

test('Upload complete verifies issued intent and physical storage object', async () => {
  const db = client();
  const draft = await createClientDeepCleaningSubmission(db, FO_PROFILE, { store_code: 'RR001' });
  const issued = await createClientDeepCleaningUploadUrl(db, FO_PROFILE, draft.id, {
    upload_type: 'before',
    filename: 'before.jpg',
    mime_type: 'image/jpeg',
    file_size: 1000,
  });
  await assert.rejects(
    () => completeClientDeepCleaningUpload(db, FO_PROFILE, draft.id, {
      upload_id: issued.upload_id,
      upload_type: 'before',
      storage_bucket: issued.storage_bucket,
      storage_path: issued.storage_path,
      filename: 'before.jpg',
      mime_type: 'image/jpeg',
      file_size: 1000,
    }),
    /not found in storage/,
  );
  assert.equal(db.tables.client_deep_cleaning_uploads[0].upload_status, 'pending');
  db.addStorageObject(issued.storage_bucket, issued.storage_path, 1000);
  const before = await completeClientDeepCleaningUpload(db, FO_PROFILE, draft.id, {
    upload_id: issued.upload_id,
    upload_type: 'before',
    storage_bucket: issued.storage_bucket,
    storage_path: issued.storage_path,
    filename: 'before.jpg',
    mime_type: 'image/jpeg',
    file_size: 1000,
  });
  assert.equal(before.upload_status, 'uploaded');
  assert.ok(before.uploaded_at);
});

test('Before, after, and duplicate upload completion are handled safely', async () => {
  const db = client();
  const draft = await createClientDeepCleaningSubmission(db, FO_PROFILE, { store_code: 'RR001' });
  const issued = await createClientDeepCleaningUploadUrl(db, FO_PROFILE, draft.id, {
    upload_type: 'before',
    filename: 'before.jpg',
    mime_type: 'image/jpeg',
    file_size: 1000,
  });
  db.addStorageObject(issued.storage_bucket, issued.storage_path, 1000);
  const body = {
    upload_id: issued.upload_id,
    upload_type: 'before',
    storage_bucket: issued.storage_bucket,
    storage_path: issued.storage_path,
    filename: 'before.jpg',
    mime_type: 'image/jpeg',
    file_size: 1000,
  };
  const before = await completeClientDeepCleaningUpload(db, FO_PROFILE, draft.id, body);
  const duplicate = await completeClientDeepCleaningUpload(db, FO_PROFILE, draft.id, body);
  assert.equal(duplicate.id, before.id);
  assert.equal(db.tables.client_deep_cleaning_uploads.length, 1);

  const after = await issueAndCompleteUpload(db, draft, 'after');
  assert.equal(after.upload_type, 'after');
});

test('Submit requires before and after evidence, succeeds with minimum uploads, and repeat submit is idempotent', async () => {
  const db = client();
  const draft = await createClientDeepCleaningSubmission(db, FO_PROFILE, {
    store_code: 'RR001',
    deep_cleaning_date: '2026-09-01',
    vendor_name: 'Vendor One',
  });
  await assert.rejects(() => submitClientDeepCleaningSubmission(db, FO_PROFILE, draft.id), /before image/);
  await issueAndCompleteUpload(db, draft, 'before');
  await assert.rejects(() => submitClientDeepCleaningSubmission(db, FO_PROFILE, draft.id), /after image/);
  await issueAndCompleteUpload(db, draft, 'after');
  const submitted = await submitClientDeepCleaningSubmission(db, FO_PROFILE, draft.id);
  assert.equal(submitted.status, 'submitted');
  assert.ok(submitted.submitted_at);
  const repeated = await submitClientDeepCleaningSubmission(db, FO_PROFILE, draft.id);
  assert.equal(repeated.status, 'submitted');
  assert.equal(db.tables.client_deep_cleaning_submissions.length, 1);
});

test('Vendor name is optional and submit still succeeds with valid before and after evidence', async () => {
  const db = client();
  const draft = await createReadySubmission(db);
  const submitted = await submitClientDeepCleaningSubmission(db, FO_PROFILE, draft.id);
  assert.equal(submitted.status, 'submitted');
  assert.equal(submitted.vendor_name, null);
});

test('Submit re-verifies storage object existence for registered uploads', async () => {
  const db = client();
  const draft = await createReadySubmission(db);
  db.storageObjects.set('client-deep-cleaning-uploads', []);
  await assert.rejects(() => submitClientDeepCleaningSubmission(db, FO_PROFILE, draft.id), /not found in storage/);
});

test('Deleting own draft upload removes storage and metadata, but another FO or submitted record cannot delete', async () => {
  const db = client();
  const draft = await createClientDeepCleaningSubmission(db, FO_PROFILE, { store_code: 'RR001' });
  const upload = await issueAndCompleteUpload(db, draft, 'before');
  await assert.rejects(
    () => deleteClientDeepCleaningUpload(db, OTHER_FO_PROFILE, draft.id, upload.id),
    /not found/,
  );
  const deleted = await deleteClientDeepCleaningUpload(db, FO_PROFILE, draft.id, upload.id);
  assert.equal(deleted.id, upload.id);
  assert.equal(db.tables.client_deep_cleaning_uploads.length, 0);
  assert.equal(db.storageObjects.get('client-deep-cleaning-uploads').length, 0);

  const ready = await createReadySubmission(db);
  await submitClientDeepCleaningSubmission(db, FO_PROFILE, ready.id);
  const submittedUpload = db.tables.client_deep_cleaning_uploads.find((row) => row.submission_id === ready.id);
  await assert.rejects(
    () => deleteClientDeepCleaningUpload(db, FO_PROFILE, ready.id, submittedUpload.id),
    /cannot be deleted/,
  );
});

test('Signed view URL is issued only for own uploaded private evidence', async () => {
  const db = client();
  const draft = await createClientDeepCleaningSubmission(db, FO_PROFILE, { store_code: 'RR001' });
  const before = await issueAndCompleteUpload(db, draft, 'before');

  const view = await createClientDeepCleaningUploadViewUrl(db, FO_PROFILE, draft.id, before.id);
  assert.equal(view.upload_id, before.id);
  assert.match(view.signed_url, /^https:\/\/download\.example\/client-deep-cleaning-uploads\//);
  assert.equal(view.expires_in, 600);
  assert.ok(view.expires_at);

  await assert.rejects(
    () => createClientDeepCleaningUploadViewUrl(db, OTHER_FO_PROFILE, draft.id, before.id),
    /not found/,
  );
  await assert.rejects(
    () => createClientDeepCleaningUploadViewUrl(db, FO_PROFILE, draft.id, 'missing-upload'),
    /Upload was not found/,
  );
});

test('Signed view URL rejects pending uploads and invalid bucket/path rows', async () => {
  const db = client();
  const draft = await createClientDeepCleaningSubmission(db, FO_PROFILE, { store_code: 'RR001' });
  const pending = await createClientDeepCleaningUploadUrl(db, FO_PROFILE, draft.id, {
    upload_type: 'before',
    filename: 'pending.jpg',
    mime_type: 'image/jpeg',
    file_size: 1000,
  });
  await assert.rejects(
    () => createClientDeepCleaningUploadViewUrl(db, FO_PROFILE, draft.id, pending.upload_id),
    /not ready to view/,
  );

  const uploaded = await issueAndCompleteUpload(db, draft, 'after');
  db.tables.client_deep_cleaning_uploads.find((row) => row.id === uploaded.id).storage_bucket = 'public-bucket';
  await assert.rejects(
    () => createClientDeepCleaningUploadViewUrl(db, FO_PROFILE, draft.id, uploaded.id),
    /storage path is invalid/i,
  );
  db.tables.client_deep_cleaning_uploads.find((row) => row.id === uploaded.id).storage_bucket = 'client-deep-cleaning-uploads';
  db.tables.client_deep_cleaning_uploads.find((row) => row.id === uploaded.id).storage_path = 'deep-cleaning/reliance-retail/OTHER/submission/after/file.jpg';
  await assert.rejects(
    () => createClientDeepCleaningUploadViewUrl(db, FO_PROFILE, draft.id, uploaded.id),
    /outside this submission/,
  );
});

test('Historical FO activity tables are untouched by the new service', async () => {
  const db = client();
  db.tables.fo_activity_submissions.push({ id: 'legacy-submission', activity_type: 'deep_cleaning' });
  db.tables.fo_activity_uploads.push({ id: 'legacy-upload', activity_type: 'deep_cleaning' });
  const before = clone({
    submissions: db.tables.fo_activity_submissions,
    uploads: db.tables.fo_activity_uploads,
  });
  await createReadySubmission(db);
  assert.deepEqual(db.tables.fo_activity_submissions, before.submissions);
  assert.deepEqual(db.tables.fo_activity_uploads, before.uploads);
});

test('Migration defines independent tables, bucket, RLS, and no attendance/site visit columns', () => {
  const sql = readFileSync(new URL('../../supabase/migrations_2_0/065_client_deep_cleaning_foundation.sql', import.meta.url), 'utf8');
  assert.match(sql, /create table if not exists public\.client_deep_cleaning_submissions/i);
  assert.match(sql, /create table if not exists public\.client_deep_cleaning_uploads/i);
  assert.match(sql, /client-deep-cleaning-uploads/i);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /create or replace function public\.is_reliance_retail_fo/i);
  assert.match(sql, /public\.is_reliance_retail_fo\(auth\.uid\(\)\)/i);
  assert.match(sql, /performed_by_type text not null default 'vendor'/i);
  assert.match(sql, /upload_status text not null default 'pending'/i);
  assert.match(sql, /uploaded_at timestamptz/i);
  assert.doesNotMatch(sql, /\battendance_id\b/i);
  assert.doesNotMatch(sql, /\bsite_visit_id\b/i);
  assert.doesNotMatch(sql, /fo_attendance/i);
  assert.doesNotMatch(sql, /fo_site_visits/i);
  assert.doesNotMatch(sql, /fo_location_logs/i);
  assert.doesNotMatch(sql, /fo_live_status/i);
});

test('API-only access migration revokes direct anon and authenticated table grants only', () => {
  const sql = readFileSync(new URL('../../supabase/migrations_2_0/066_client_deep_cleaning_api_only_access.sql', import.meta.url), 'utf8');
  assert.match(sql, /revoke all privileges\s+on table public\.client_deep_cleaning_submissions\s+from anon,\s*authenticated/i);
  assert.match(sql, /revoke all privileges\s+on table public\.client_deep_cleaning_uploads\s+from anon,\s*authenticated/i);
  assert.doesNotMatch(sql, /disable row level security/i);
  assert.doesNotMatch(sql, /drop policy/i);
  assert.doesNotMatch(sql, /storage\.objects/i);
  assert.doesNotMatch(sql, /\bfo_activity_submissions\b/i);
  assert.doesNotMatch(sql, /\bfo_activity_uploads\b/i);
  assert.doesNotMatch(sql, /\bfo_attendance\b/i);
  assert.doesNotMatch(sql, /\bfo_site_visits\b/i);
});

test('Service-role access migration grants CRUD only to the trusted backend role', () => {
  const sql = readFileSync(new URL('../../supabase/migrations_2_0/067_client_deep_cleaning_service_role_access.sql', import.meta.url), 'utf8');
  const grantStatements = sql
    .split(';')
    .map((statement) => statement.replace(/--.*$/gm, '').trim())
    .filter((statement) => /^grant\b/i.test(statement))
    .join(';\n');
  assert.match(sql, /grant select,\s*insert,\s*update,\s*delete\s+on table public\.client_deep_cleaning_submissions\s+to service_role/i);
  assert.match(sql, /grant select,\s*insert,\s*update,\s*delete\s+on table public\.client_deep_cleaning_uploads\s+to service_role/i);
  assert.doesNotMatch(grantStatements, /\bto\s+anon\b/i);
  assert.doesNotMatch(grantStatements, /\bto\s+authenticated\b/i);
  assert.doesNotMatch(grantStatements, /\btruncate\b/i);
  assert.doesNotMatch(grantStatements, /\btrigger\b/i);
  assert.doesNotMatch(grantStatements, /\breferences\b/i);
  assert.doesNotMatch(sql, /disable row level security/i);
  assert.doesNotMatch(sql, /drop policy/i);
  assert.doesNotMatch(sql, /storage\.objects/i);
  assert.doesNotMatch(sql, /\bfo_activity_submissions\b/i);
  assert.doesNotMatch(sql, /\bfo_activity_uploads\b/i);
  assert.doesNotMatch(sql, /\bfo_attendance\b/i);
  assert.doesNotMatch(sql, /\bfo_site_visits\b/i);
});
