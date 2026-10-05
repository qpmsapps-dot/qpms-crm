import assert from 'node:assert/strict';
import test from 'node:test';
import { assertMomActor, loadMomVisitContext, safeMomError, translateMomError, validateMomPayload } from '../services/momAccessService.js';

const profile = { id: 'profile-1', employee_code: 'FO001', role: 'FO', status: 'Active', is_active: true };

function fakeClient(tables) {
  return {
    from(table) {
      let rows = [...(tables[table] || [])];
      const builder = {
        select() { return builder; },
        eq(column, value) { rows = rows.filter((row) => row[column] === value); return builder; },
        or(expression) {
          const matches = expression.split(',').map((part) => part.split('.eq.')).filter((part) => part.length === 2);
          rows = rows.filter((row) => matches.some(([column, value]) => `${row[column]}` === value));
          return builder;
        },
        limit(value) { rows = rows.slice(0, value); return builder; },
        maybeSingle: async () => ({ data: rows[0] || null, error: null }),
      };
      return builder;
    },
  };
}

function tables(overrides = {}) {
  return {
    fo_attendance: [{ id: 'attendance-1', employee_code: 'FO001', status: 'Closed', logout_time: '2026-10-04T12:00:00Z', ...overrides.attendance }],
    fo_site_visits: [{ id: 'visit-1', attendance_id: 'attendance-1', employee_code: 'FO001', store_id: 'store-1', check_out_time: '2026-10-04T11:00:00Z', ...overrides.visit }],
    store_master: [{ id: 'store-1', business: 'DME', client_name: 'Hospital', state: 'KA', ...overrides.store }],
    mom_business_capabilities: [{ business_key: 'DME', client_key: null, is_enabled: true, ...overrides.capability }],
  };
}

test('active FO may mutate MoM and unrelated roles may not', () => {
  assert.equal(assertMomActor(profile, { mutation: true }).id, 'profile-1');
  assert.throws(() => assertMomActor({ ...profile, role: 'Management' }, { mutation: true }), { code: 'forbidden_role' });
});

test('checked-out attendance and visit remain valid MoM context', async () => {
  const result = await loadMomVisitContext(fakeClient(tables()), profile, { attendance_id: 'attendance-1', site_visit_id: 'visit-1' });
  assert.equal(result.visit.id, 'visit-1');
  assert.equal(result.store.id, 'store-1');
});

test('FO cannot attach MoM to another employee attendance', async () => {
  await assert.rejects(() => loadMomVisitContext(fakeClient(tables({ attendance: { employee_code: 'OTHER' } })), profile, { attendance_id: 'attendance-1', site_visit_id: 'visit-1' }), { code: 'attendance_forbidden' });
});

test('visit must belong to attendance and authoritative site must be enabled', async () => {
  await assert.rejects(() => loadMomVisitContext(fakeClient(tables({ visit: { attendance_id: 'other' } })), profile, { attendance_id: 'attendance-1', site_visit_id: 'visit-1' }), { code: 'visit_attendance_mismatch' });
  await assert.rejects(() => loadMomVisitContext(fakeClient(tables({ store: { business: 'Other' } })), profile, { attendance_id: 'attendance-1', site_visit_id: 'visit-1', business: 'DME' }), { code: 'visit_not_eligible' });
});

test('duplicate and database errors map to safe responses', () => {
  assert.equal(translateMomError({ code: '23505', message: 'private duplicate value' }).statusCode, 409);
  const result = {};
  const response = { status(value) { result.status = value; return this; }, json(value) { result.body = value; } };
  safeMomError(response, new Error('secret database connection string'));
  assert.equal(result.status, 500);
  assert.deepEqual(result.body, { ok: false, code: 'mom_internal_error', message: 'Minutes of Meeting request failed.' });
});

test('submission permits zero actions but rejects incomplete added actions', () => {
  const base = {
    meeting_with: 'Medical Superintendent',
    meeting_designation: 'Medical Superintendent',
    discussion_points: [{ observation_issue: 'Housekeeping improved', priority: 'Low' }],
    action_items: [],
    follow_up_required: false,
  };
  assert.doesNotThrow(() => validateMomPayload(base, { submit: true }));
  assert.throws(() => validateMomPayload({ ...base, action_items: [{ issue_observation: 'Gap', corrective_action: '' }] }, { submit: true }), { code: 'action_incomplete' });
});

test('submission validates follow-up, designation, priority and action status', () => {
  const base = {
    meeting_with: 'Director', meeting_designation: 'Director',
    discussion_points: [{ observation_issue: 'Observation', priority: 'Medium' }], action_items: [],
  };
  assert.throws(() => validateMomPayload({ ...base, follow_up_required: true }, { submit: true }), { code: 'follow_up_date_required' });
  assert.throws(() => validateMomPayload({ ...base, follow_up_required: true, follow_up_date: '2026-10-10' }, { submit: true }), { code: 'follow_up_mode_required' });
  assert.throws(() => validateMomPayload({ ...base, follow_up_required: true, follow_up_date: '2026-10-10', follow_up_mode: 'Other' }, { submit: true }), { code: 'follow_up_mode_other_required' });
  assert.doesNotThrow(() => validateMomPayload({ ...base, follow_up_required: true, follow_up_date: '2026-10-10', follow_up_mode: 'Call' }, { submit: true }));
  assert.throws(() => validateMomPayload({ ...base, discussion_points: [{ observation_issue: 'x', priority: 'Urgent' }] }, { submit: true }), { code: 'priority_invalid' });
  assert.throws(() => validateMomPayload({ ...base, action_items: [{ issue_observation: 'x', corrective_action: 'y', status: 'Done' }] }, { submit: true }), { code: 'action_status_invalid' });
});
