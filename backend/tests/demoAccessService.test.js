import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEMO_READ_ONLY_CODE,
  DEMO_READ_ONLY_MESSAGE,
  getDemoAccessScope,
  isDemoUser,
  isReadOnlyUser,
  rejectDemoMutation,
  sanitizeDemoRecord,
} from '../services/demoAccessService.js';

test('DEMO_ADMIN and TENDER_DEMO are read-only demo users', () => {
  assert.equal(isDemoUser({ role: 'DEMO_ADMIN' }), true);
  assert.equal(isDemoUser({ role: 'TENDER_DEMO' }), true);
  assert.equal(isReadOnlyUser({ role: 'DEMO_ADMIN' }), true);
  assert.equal(isReadOnlyUser({ email: 'admin@qpms.co.in' }), true);
});

test('demo scope exposes approved tender states and modules', () => {
  const scope = getDemoAccessScope({ role: 'DEMO_ADMIN' });
  assert.equal(scope.read_only, true);
  assert.deepEqual(scope.states, ['TN', 'KL', 'KA', 'TG', 'AP-1', 'AP-2']);
  assert.equal(scope.modules.includes('fault_tracker'), true);
  assert.equal(scope.modules.includes('store_master'), true);
});

test('demo mutations are rejected with stable contract', () => {
  let statusCode = 0;
  let body = null;
  const response = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(payload) {
      body = payload;
      return this;
    },
  };
  const rejected = rejectDemoMutation({ method: 'POST' }, response, { role: 'DEMO_ADMIN' });
  assert.equal(rejected, true);
  assert.equal(statusCode, 403);
  assert.equal(body.error, DEMO_READ_ONLY_CODE);
  assert.equal(body.code, DEMO_READ_ONLY_CODE);
  assert.equal(body.message, DEMO_READ_ONLY_MESSAGE);
});

test('demo record sanitizer removes private fields', () => {
  const row = sanitizeDemoRecord({
    ticket_no: 'FT-1',
    supervisor_mobile: 'redacted',
    supervisor_email: 'redacted',
    employee_code: 'redacted',
    metadata: { internal: true },
    store_name: 'Demo Store',
  });
  assert.deepEqual(row, {
    ticket_no: 'FT-1',
    store_name: 'Demo Store',
  });
});
