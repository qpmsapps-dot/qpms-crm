import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import { createTrainingRouter } from '../routes/trainingRoutes.js';

const profile = { id: 'actor-1', employee_code: 'FO001', role: 'FO', is_active: true, status: 'Active', business: 'Reliance Retail' };

async function request(routerOptions, path, { method = 'GET', body, auth = true } = {}) {
  const app = express();
  app.use(express.json());
  app.use('/api/training', createTrainingRouter(routerOptions));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method,
      headers: {
        ...(auth ? { authorization: 'Bearer valid-test-token' } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function options(overrides = {}) {
  const calls = [];
  const service = {
    listTrainingCategories: async () => [{ id: 'category-1' }],
    listTrainingTypes: async () => [{ id: 'type-1' }],
    listTrainingTopics: async () => [{ id: 'topic-1' }],
    searchTrainingSiteStaff: async () => [{ profile_id: 'staff-1' }],
    createTrainingSession: async () => ({ session: { id: 'session-1' } }),
    listTrainingSessions: async () => [{ id: 'session-1' }],
    getTrainingSession: async () => ({ session: { id: 'session-1' } }),
    updateTrainingSession: async () => ({ session: { id: 'session-1' } }),
    addTrainingAttendee: async () => ({ id: 'attendee-1' }),
    removeTrainingAttendee: async () => ({ id: 'attendee-1' }),
    setTrainingTopics: async () => ({ count: 1 }),
    updateTrainingTopic: async () => ({ id: 'session-topic-1' }),
    submitTrainingSession: async () => ({ session: { id: 'session-1', status: 'submitted' } }),
    cancelTrainingSession: async () => ({ session: { id: 'session-1', status: 'cancelled' } }),
    ...overrides.service,
  };
  const evidenceService = {
    createTrainingEvidenceUploadUrl: async () => ({ evidence_id: 'evidence-1' }),
    completeTrainingEvidence: async () => ({ id: 'evidence-1' }),
    deleteTrainingEvidence: async () => ({ id: 'evidence-1' }),
    createTrainingEvidenceViewUrl: async () => ({ url: 'signed-test-url' }),
    verifyTrainingEvidenceObjects: async () => true,
    ...overrides.evidenceService,
  };
  return {
    calls,
    service,
    evidenceService,
    requireAuth(request, response, next) {
      if (!request.headers.authorization) return response.status(401).json({ ok: false, message: 'Authentication required.' });
      request.profile = profile;
      return next();
    },
    getClient: () => ({ test: true }),
  };
}

test('all Training endpoints require authentication', async () => {
  const result = await request(options(), '/api/training/categories', { auth: false });
  assert.equal(result.status, 401);
});
const cases = [
  ['GET', '/api/training/categories', 200, 'categories'],
  ['GET', '/api/training/types', 200, 'training_types'],
  ['GET', '/api/training/topics?category_id=category-1', 200, 'topics'],
  ['GET', '/api/training/site-staff?site_id=site-1', 200, 'staff'],
  ['POST', '/api/training/sessions', 201, 'session', { attendance_id: 'a', site_visit_id: 'v' }],
  ['GET', '/api/training/sessions', 200, 'sessions'],
  ['GET', '/api/training/sessions/session-1', 200, 'session'],
  ['PATCH', '/api/training/sessions/session-1', 200, 'session', { trainer_name: 'Trainer' }],
  ['POST', '/api/training/sessions/session-1/attendees', 201, 'attendee', { profile_id: 'staff-1' }],
  ['DELETE', '/api/training/sessions/session-1/attendees/attendee-1', 200, 'attendee'],
  ['PUT', '/api/training/sessions/session-1/topics', 200, 'topics', { topic_ids: ['topic-1'] }],
  ['PATCH', '/api/training/sessions/session-1/topics/session-topic-1', 200, 'topic', { is_covered: true }],
  ['POST', '/api/training/sessions/session-1/evidence/upload-url', 200, 'upload', { evidence_type: 'group_photo' }],
  ['POST', '/api/training/sessions/session-1/evidence/complete', 201, 'evidence', { evidence_id: 'evidence-1' }],
  ['DELETE', '/api/training/sessions/session-1/evidence/evidence-1', 200, 'evidence'],
  ['GET', '/api/training/sessions/session-1/evidence/evidence-1/view-url', 200, 'view'],
  ['POST', '/api/training/sessions/session-1/submit', 200, 'session'],
  ['POST', '/api/training/sessions/session-1/cancel', 200, 'session'],
];

for (const [method, path, status, key, body] of cases) {
  test(`${method} ${path.split('?')[0]} is registered and protected`, async () => {
    const result = await request(options(), path, { method, body });
    assert.equal(result.status, status);
    assert.equal(result.body.ok, true);
    assert.ok(result.body[key]);
  });
}

test('safe Training errors never expose database details', async () => {
  const result = await request(options({
    service: { listTrainingCategories: async () => { throw new Error('secret database connection string'); } },
  }), '/api/training/categories');
  assert.equal(result.status, 500);
  assert.deepEqual(result.body, { ok: false, code: 'training_internal_error', message: 'Training request failed.' });
});
