import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import { createMomRouter } from '../routes/momRoutes.js';

async function request(path, { method = 'GET', body, auth = true, service = {} } = {}) {
  const app = express(); app.use(express.json());
  const defaults = {
    listMomStatuses: async () => [{ id: 'mom-1' }], getMomByVisit: async () => null, getMom: async () => ({ mom: { id: 'mom-1' } }),
    saveMom: async (_c, _p, input, options) => ({ mom: { id: input.id, status: options?.submit ? 'submitted' : 'draft' } }),
    createMomAttachmentUploadUrl: async () => ({ attachment_id: 'attachment-1' }), completeMomAttachment: async () => ({ id: 'attachment-1' }), createMomAttachmentViewUrl: async () => ({ url: 'signed' }), ...service,
  };
  app.use('/api/mom', createMomRouter({ service: defaults, getClient: () => ({}), requireAuth(req, res, next) { if (!req.headers.authorization) return res.status(401).json({ ok: false }); req.profile = { id: 'profile-1', employee_code: 'FO001' }; return next(); } }));
  const server = http.createServer(app); await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try { const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { ...(auth ? { authorization: 'Bearer token' } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: response.status, body: await response.json() }; }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test('MoM endpoints require authentication', async () => assert.equal((await request('/api/mom/statuses', { auth: false })).status, 401));

for (const [method, path, key, body] of [
  ['GET','/api/mom/statuses?site_visit_ids=v','statuses'], ['GET','/api/mom/by-visit/v','record'], ['GET','/api/mom/m','record'],
  ['PUT','/api/mom/m/draft','record',{}], ['POST','/api/mom/m/submit','record',{}],
  ['POST','/api/mom/m/attachments/upload-url','upload',{}], ['POST','/api/mom/m/attachments/complete','attachment',{}], ['GET','/api/mom/m/attachments/a/view-url','view'],
]) {
  test(`${method} ${path.split('?')[0]} is registered`, async () => { const result = await request(path, { method, body }); assert.equal(result.status, 200); assert.equal(result.body.ok, true); assert.ok(Object.hasOwn(result.body, key)); });
}

test('route suppresses internal errors', async () => {
  const result = await request('/api/mom/statuses', { service: { listMomStatuses: async () => { throw new Error('database password'); } } });
  assert.deepEqual(result.body, { ok: false, code: 'mom_internal_error', message: 'Minutes of Meeting request failed.' });
});
