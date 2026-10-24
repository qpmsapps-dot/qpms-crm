import test from 'node:test';
import assert from 'node:assert/strict';
import { assertTrainingActor, loadTrainingCreateContext } from '../services/trainingAccessService.js';
import { loadTrainingRetailStore } from '../services/trainingService.js';

const fo = { id: 'local-profile', employee_code: 'LOCAL-FO', role: 'FO', business: 'Reliance Retail', state: 'KA', is_active: true, status: 'Active' };
function client(overrides = {}) {
  const tables = {
    fo_attendance: [{ id: 'attendance', employee_code: fo.employee_code, status: 'Active', logout_time: null }],
    fo_site_visits: [{ id: 'visit', attendance_id: 'attendance', employee_code: fo.employee_code, check_in_time: '2026-10-24T04:00:00Z', check_out_time: null }],
    reliance_retail_store_master: [{ id: 'retail', state: 'KA', status: 'Active', zone_id: null, metadata: { operational_model: 'SUPERVISOR_ONLY' } }],
    ...overrides,
  };
  return { from(table) { let rows = tables[table] || []; const q = { select() { return q; }, eq(key, value) { rows = rows.filter(r => r[key] === value); return q; }, async maybeSingle() { return { data: rows[0] || null, error: null }; } }; return q; } };
}
test('existing Training mutations remain FO-only; reporting roles gain no mutation authority', () => {
  assert.equal(assertTrainingActor(fo, { mutation: true }), fo);
  for (const role of ['Admin', 'Operations Manager', 'Management', 'MIS']) assert.throws(() => assertTrainingActor({ ...fo, role }, { mutation: true }), { code: 'forbidden_role' });
});
test('current checked-in FO attendance/visit context passes; foreign and closed visits fail', async () => {
  const input = { attendance_id: 'attendance', site_visit_id: 'visit' };
  const result = await loadTrainingCreateContext(client(), fo, input);
  assert.equal(result.attendance.id, 'attendance'); assert.equal(result.visit.id, 'visit');
  for (const change of [{ employee_code: 'OTHER' }, { check_out_time: '2026-10-24T05:00:00Z' }, { check_in_time: null }]) {
    const visit = { ...result.visit, ...change };
    await assert.rejects(loadTrainingCreateContext(client({ fo_site_visits: [visit] }), fo, input), { code: change.employee_code ? 'site_visit_forbidden' : 'site_visit_not_active' });
  }
});
test('authoritative Retail store gate denies other state, business and unsupported supervisor category', async () => {
  assert.equal((await loadTrainingRetailStore(client(), fo, 'retail', 'technical_mep')).id, 'retail');
  await assert.rejects(loadTrainingRetailStore(client(), { ...fo, state: 'TN' }, 'retail', 'technical_mep'), { code: 'store_scope_forbidden' });
  await assert.rejects(loadTrainingRetailStore(client(), { ...fo, business: 'Other' }, 'retail', 'technical_mep'), { code: 'store_scope_forbidden' });
  await assert.rejects(loadTrainingRetailStore(client(), fo, 'retail', 'housekeeping'), { code: 'store_scope_forbidden' });
});
