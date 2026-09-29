import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertTrainingActor,
  canonicalTrainingRole,
  loadTrainingCreateContext,
  safeTrainingError,
  translateTrainingDatabaseError,
} from '../services/trainingAccessService.js';
import {
  TRAINING_EVIDENCE_MAX_BYTES,
  validateTrainingEvidenceInput,
} from '../services/trainingEvidenceService.js';

const baseProfile = {
  id: 'profile-1',
  employee_code: 'FO001',
  role: 'FO',
  designation: 'Mismatched production designation',
  status: 'Active',
  is_active: true,
  business: 'Reliance Retail',
  state: 'KA',
};

function fakeClient(tables) {
  return {
    from(table) {
      let rows = [...(tables[table] || [])];
      const builder = {
        select() { return builder; },
        eq(column, value) { rows = rows.filter((row) => row[column] === value); return builder; },
        maybeSingle: async () => ({ data: rows[0] || null, error: null }),
      };
      return builder;
    },
  };
}

function contextTables(overrides = {}) {
  return {
    fo_attendance: [{
      id: 'attendance-1', employee_code: 'FO001', status: 'Active', logout_time: null,
      ...overrides.attendance,
    }],
    fo_site_visits: [{
      id: 'visit-1', attendance_id: 'attendance-1', employee_code: 'FO001', store_id: 'store-1',
      check_out_time: null, checkout_time: null, ...overrides.visit,
    }],
    store_master: [{
      id: 'store-1', status: 'Active', business: 'Reliance Retail', client_name: 'Reliance Retail', state: 'KA',
      ...overrides.store,
    }],
  };
}

test('canonical Training roles use role and not designation', () => {
  assert.equal(canonicalTrainingRole('Field Officer'), 'FO');
  assert.equal(canonicalTrainingRole('Operations Manager'), 'OPERATIONSMANAGER');
  assert.equal(canonicalTrainingRole('OM'), 'OPERATIONSMANAGER');
});
test('Reliance FO create authorization is allowed despite designation mismatch', () => {
  assert.equal(assertTrainingActor(baseProfile, { mutation: true }).id, 'profile-1');
});

test('Reliance Operations Manager create authorization is allowed', () => {
  assert.equal(assertTrainingActor({ ...baseProfile, role: 'Operations Manager' }, { mutation: true }).id, 'profile-1');
});

for (const role of ['Admin', 'Branch Head', 'KAM', 'Management', 'Executive Assistant']) {
  test(`${role} cannot create structured Training`, () => {
    assert.throws(() => assertTrainingActor({ ...baseProfile, role }, { mutation: true }), { code: 'forbidden_role' });
  });
}

test('inactive profile is denied', () => {
  assert.throws(() => assertTrainingActor({ ...baseProfile, is_active: false }, { mutation: true }), { code: 'inactive_profile' });
});

test('non-Reliance profile cannot bypass create gate', () => {
  assert.throws(() => assertTrainingActor({ ...baseProfile, business: 'Other Client' }, { mutation: true }), { code: 'forbidden_business' });
});

test('verified current attendance and site visit context passes', async () => {
  const result = await loadTrainingCreateContext(fakeClient(contextTables()), baseProfile, {
    attendance_id: 'attendance-1', site_visit_id: 'visit-1', business: 'fake Reliance text',
  });
  assert.equal(result.store.id, 'store-1');
});

test('client-supplied Reliance text cannot bypass a non-Reliance verified store', async () => {
  await assert.rejects(() => loadTrainingCreateContext(fakeClient(contextTables({
    store: { business: 'Other', client_name: 'Other' },
  })), baseProfile, {
    attendance_id: 'attendance-1', site_visit_id: 'visit-1', business: 'Reliance Retail',
  }), { code: 'non_reliance_store' });
});

test('invalid attendance is denied', async () => {
  await assert.rejects(() => loadTrainingCreateContext(fakeClient(contextTables()), baseProfile, {
    attendance_id: 'missing', site_visit_id: 'visit-1',
  }), { code: 'attendance_not_found' });
});

test('site visit and attendance mismatch is denied', async () => {
  await assert.rejects(() => loadTrainingCreateContext(fakeClient(contextTables({
    visit: { attendance_id: 'other-attendance' },
  })), baseProfile, { attendance_id: 'attendance-1', site_visit_id: 'visit-1' }), { code: 'visit_attendance_mismatch' });
});

test('historical checked-out visit cannot create a new session', async () => {
  await assert.rejects(() => loadTrainingCreateContext(fakeClient(contextTables({
    visit: { check_out_time: '2026-09-01T00:00:00Z' },
  })), baseProfile, { attendance_id: 'attendance-1', site_visit_id: 'visit-1' }), { code: 'site_visit_not_active' });
});

test('cross-state create is denied', async () => {
  await assert.rejects(() => loadTrainingCreateContext(fakeClient(contextTables({
    store: { state: 'TN' },
  })), baseProfile, { attendance_id: 'attendance-1', site_visit_id: 'visit-1' }), { code: 'cross_state_forbidden' });
});

const validEvidence = { evidence_type: 'topic_photo', training_session_topic_id: 'topic-1', file_name: 'photo.jpg', mime_type: 'image/jpeg', file_size: 1024 };

test('topic photo evidence validation accepts safe input', () => {
  assert.equal(validateTrainingEvidenceInput(validEvidence).evidenceType, 'topic_photo');
});

test('topic photo without topic is rejected', () => {
  assert.throws(() => validateTrainingEvidenceInput({ ...validEvidence, training_session_topic_id: null }), { code: 'topic_required' });
});

test('supporting evidence cannot attach a foreign topic', () => {
  assert.throws(() => validateTrainingEvidenceInput({ ...validEvidence, evidence_type: 'group_photo' }), { code: 'topic_not_allowed' });
});

test('unsupported MIME is rejected with 415', () => {
  assert.throws(() => validateTrainingEvidenceInput({ ...validEvidence, mime_type: 'application/x-msdownload' }), { statusCode: 415 });
});

test('oversized evidence is rejected with 413', () => {
  assert.throws(() => validateTrainingEvidenceInput({ ...validEvidence, file_size: TRAINING_EVIDENCE_MAX_BYTES + 1 }), { statusCode: 413 });
});

test('database conflict maps to safe HTTP 409', () => {
  const error = translateTrainingDatabaseError({ code: '23505', message: 'duplicate key contains private values' });
  assert.equal(error.statusCode, 409);
  assert.equal(error.code, 'duplicate_record');
});

test('safe error response suppresses internal database message', () => {
  const result = {};
  const response = { status(value) { result.status = value; return this; }, json(value) { result.body = value; } };
  safeTrainingError(response, new Error('postgres secret detail'));
  assert.equal(result.status, 500);
  assert.equal(result.body.message, 'Training request failed.');
  assert.doesNotMatch(JSON.stringify(result.body), /postgres secret/);
});
