import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEMO_READ_ONLY_CODE,
  isDemoUser,
  isReadOnlyDemoUser,
  isReadOnlyUser,
  isSensitiveReadOnlyDemoGet,
  rejectReadOnlyDemoRequest,
} from '../services/demoAccessService.js';
import { canAccessLeadModule, canCreateLead, canEditLead, canManageLeadMom, canViewLead, leadActor } from '../services/leadManagementService.js';

function responseRecorder() {
  return {
    statusCode: 0,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

test('DEMO_VIEWER is read-only and does not receive lead mutation authority', () => {
  const profile = { id: 'profile-demo', auth_user_id: 'auth-demo', role: 'DEMO_VIEWER', is_active: true, status: 'Active', web_access_enabled: true };
  const actor = leadActor(profile, { id: 'auth-demo', email: 'demo.viewer@example.com' });
  assert.equal(isDemoUser(profile), true);
  assert.equal(isReadOnlyDemoUser(profile), true);
  assert.equal(isReadOnlyUser(profile), true);
  assert.equal(canAccessLeadModule(actor), true);
  assert.equal(canViewLead(actor, { id: 'lead-1' }), true);
  assert.equal(canCreateLead(actor), false);
  assert.equal(canEditLead(actor, { id: 'lead-1' }), false);
  assert.equal(canManageLeadMom(actor, { id: 'lead-1' }), false);
});

test('DEMO_VIEWER safe GET requests are allowed by centralized middleware', () => {
  const response = responseRecorder();
  const rejected = rejectReadOnlyDemoRequest(
    { method: 'GET', originalUrl: '/api/lead-management/leads' },
    response,
    { role: 'DEMO_VIEWER' },
  );
  assert.equal(rejected, false);
  assert.equal(response.statusCode, 0);
});

test('DEMO_VIEWER mutations return HTTP 403', () => {
  ['POST', 'PUT', 'PATCH', 'DELETE'].forEach((method) => {
    const response = responseRecorder();
    const rejected = rejectReadOnlyDemoRequest(
      { method, originalUrl: '/api/lead-management/leads' },
      response,
      { role: 'DEMO_VIEWER' },
    );
    assert.equal(rejected, true, method);
    assert.equal(response.statusCode, 403, method);
    assert.equal(response.body.code, DEMO_READ_ONLY_CODE, method);
  });
});

test('DEMO_VIEWER sensitive GET exports and administration endpoints return HTTP 403', () => {
  [
    '/api/admin/users',
    '/api/store-master',
    '/api/fo/reports/consolidated-travel-claims/pdf',
    '/api/access/foundation',
    '/api/fault-tracker/imports/export',
  ].forEach((path) => {
    const response = responseRecorder();
    assert.equal(isSensitiveReadOnlyDemoGet({ method: 'GET', originalUrl: path }), true, path);
    const rejected = rejectReadOnlyDemoRequest({ method: 'GET', originalUrl: path }, response, { role: 'DEMO_VIEWER' });
    assert.equal(rejected, true, path);
    assert.equal(response.statusCode, 403, path);
  });
});
