import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { resolveRetailHkTrainingScope, isRetailHkTrainingReader } from '../services/retailTrainingReadScopeService.js';
import { loadAuthorizedTrainingSession, resolveTrainingReadScope, RELIANCE_TRAINING_CLIENT_ID } from '../services/trainingAccessService.js';
import { listTrainingSessions } from '../services/trainingService.js';
import { retailDashboard } from '../services/relianceRetailManagementService.js';
import { createTrainingRouter } from '../routes/trainingRoutes.js';

const S1 = '10000000-0000-0000-0000-000000000001';
const S2 = '10000000-0000-0000-0000-000000000002';
const S3 = '10000000-0000-0000-0000-000000000003';
const L1 = '20000000-0000-0000-0000-000000000001';
const hk = { id: 'hk', auth_user_id: 'auth-hk', employee_code: 'HK001', role: 'MIS', designation: 'HK MIS', business: 'Reliance Retail', state: 'TN', is_active: true, status: 'Active' };

function fixture() {
  const profiles = [hk, { id: 'fo', employee_code: 'FO001', role: 'FO', business: 'Reliance Retail', state: 'TN', is_active: true },
    { id: 'other', employee_code: 'OTHER', role: 'FO', business: 'Other', state: 'TN', is_active: true }];
  const session = (id, extra = {}) => ({ id, access_client_id: RELIANCE_TRAINING_CLIENT_ID, access_client_code: 'reliance_retail', retail_store_id: S1, store_id: null, state_snapshot: 'TN', training_date: '2026-10-22', status: 'submitted', category_id: 'cat', training_type_id: 'type', ...extra });
  const tables = {
    profiles, employee_hierarchy: [],
    access_user_assignments: [{ id: 'assignment', profile_id: hk.id, auth_user_id: hk.auth_user_id, role_id: 'mis', module_id: 'training', client_id: 'retail', business_vertical_id: 'vertical', verification_status: 'verified', active: true }],
    access_user_scopes: [{ user_assignment_id: 'assignment', scope_type: 'state', scope_code: 'TN', allowed: true }, { user_assignment_id: 'assignment', scope_type: 'store', scope_id: S1, allowed: true }],
    access_roles: [{ id: 'mis', code: 'mis', active: true }], access_modules: [{ id: 'training', code: 'training', active: true }],
    access_clients: [{ id: 'retail', code: 'reliance_retail', active: true }], access_business_verticals: [{ id: 'vertical', code: 'retail', active: true }],
    access_business_vertical_modules: [{ business_vertical_id: 'vertical', module_id: 'training', enabled: true }],
    access_client_modules: [{ client_id: 'retail', module_id: 'training', enabled: true }], access_permissions: [], access_role_permissions: [],
    reliance_retail_store_master: [{ id: S1, store_code: 'R1', state: 'TN', status: 'Active', zone_id: 'z1' }, { id: S2, store_code: 'R2', state: 'KL', status: 'Active', zone_id: 'z2' }, { id: S3, store_code: 'R3', state: 'TN', status: 'Active', zone_id: 'z3' }],
    store_master: [{ id: L1, store_code: 'R1', state: 'TN', business: 'Reliance Retail', status: 'Active' }],
    training_sessions: [session('canonical'), session('legacy', { retail_store_id: null, store_id: L1 }), session('both', { store_id: L1 }),
      session('unassigned', { retail_store_id: S3, store_id: L1 }), session('otherstate', { retail_store_id: S2, state_snapshot: 'KL' }),
      session('otherclient', { access_client_code: 'other' }), session('otherfo'), session('nonfo'), session('snapshot', { state_snapshot: 'KA' }),
      session('draft', { status: 'draft' }), session('cancelled', { status: 'cancelled' })],
    training_categories: [{ id: 'cat' }], training_types: [{ id: 'type' }], training_session_attendees: [], training_session_topics: [], training_evidence: [],
    client_deep_cleaning_submissions: [], reliance_retail_zones: [], reliance_retail_zone_fo_assignments: [],
  };
  tables.fo_activity_submissions = tables.training_sessions.map(s => ({ id: s.id, activity_type: 'training', employee_code: s.id === 'otherfo' ? 'OTHER' : s.id === 'nonfo' ? 'HK001' : 'FO001' }));
  const calls = [];
  function split(expression) { let depth = 0, start = 0; const parts = []; for (let i = 0; i < expression.length; i++) { if (expression[i] === '(') depth++; if (expression[i] === ')') depth--; if (expression[i] === ',' && depth === 0) { parts.push(expression.slice(start, i)); start = i + 1; } } parts.push(expression.slice(start)); return parts; }
  function matches(row, exp) {
    if (exp.startsWith('and(')) return split(exp.slice(4, -1)).every(part => matches(row, part));
    const inMatch = exp.match(/^(\w+)\.in\.\(([^)]*)\)$/); if (inMatch) return inMatch[2].split(',').includes(row[inMatch[1]]);
    const isMatch = exp.match(/^(\w+)\.is\.null$/); if (isMatch) return row[isMatch[1]] == null;
    const eqMatch = exp.match(/^(\w+)\.eq\.(.+)$/); if (eqMatch) return row[eqMatch[1]] === eqMatch[2];
    throw Error('Unsupported filter '+exp);
  }
  const client = { from(table) {
    let rows = [...(tables[table] || [])], slice = null;
    const q = { select() { return q; }, eq(k, v) { rows = rows.filter(r => r[k] === v); return q; }, in(k, v) { rows = rows.filter(r => v.includes(r[k])); return q; },
      is(k, v) { rows = rows.filter(r => (r[k] ?? null) === v); return q; }, order() { return q; }, limit(n) { slice = [0, n]; return q; }, range(a, b) { slice = [a, b + 1]; return q; },
      gte(k, v) { rows = rows.filter(r => r[k] >= v); return q; }, lte(k, v) { rows = rows.filter(r => r[k] <= v); return q; }, lt(k, v) { rows = rows.filter(r => r[k] < v); return q; },
      or(exp) { rows = rows.filter(r => split(exp).some(part => matches(r, part))); calls.push({ table, or: exp }); return q; },
      maybeSingle: async () => ({ data: rows[0] || null, error: null }),
      then(resolve, reject) { const data = slice ? rows.slice(...slice) : rows; calls.push({ table, ids: data.map(r => r.id) }); return Promise.resolve({ data, count: rows.length, error: null }).then(resolve, reject); },
    }; return q;
  } };
  return { tables, client, calls };
}

test('HK verified assignments: canonical, legacy and both IDs appear once; dashboard agrees with detail', async () => {
  const f = fixture();
  const rows = await listTrainingSessions(f.client, hk);
  assert.deepEqual(rows.map(r => r.id).sort(), ['both', 'canonical', 'legacy']);
  assert.equal((await retailDashboard(f.client, hk, { month: '2026-10' })).training_sessions, rows.length);
  assert.equal((await loadAuthorizedTrainingSession(f.client, hk, 'canonical')).session.id, 'canonical');
  for (const id of ['unassigned', 'otherstate', 'otherclient', 'otherfo', 'nonfo', 'snapshot', 'draft', 'cancelled']) {
    await assert.rejects(() => loadAuthorizedTrainingSession(f.client, hk, id), e => [403,404].includes(e.statusCode));
  }
});

test('HK store, state and date selections narrow scope and cannot replace it', async () => {
  const f = fixture();
  assert.equal((await listTrainingSessions(f.client, hk, { store_id: S3 })).length, 0);
  assert.equal((await listTrainingSessions(f.client, hk, { store_id: L1 })).length, 3);
  f.tables.store_master[0].state = 'Tamil Nadu';
  assert.equal((await listTrainingSessions(f.client, hk, { store_id: L1 })).length, 3);
  assert.equal((await listTrainingSessions(f.client, hk, { date_from: '2026-11-01' })).length, 0);
  assert.equal((await listTrainingSessions(f.client, hk, { mine: true })).length, 0);
  assert.equal((await listTrainingSessions(f.client, hk, { status: 'draft' })).length, 0);
  assert.equal((await retailDashboard(f.client, hk, { state: 'KL' })).training_sessions, 0);
});

test('HK multiple explicitly assigned states require matching store grants', async () => {
  const f = fixture();
  f.tables.access_user_scopes.push({ user_assignment_id: 'assignment', scope_type: 'state', scope_code: 'KL' }, { user_assignment_id: 'assignment', scope_type: 'store', scope_id: S2 });
  assert.equal((await listTrainingSessions(f.client, hk)).length, 4);
  assert.equal((await retailDashboard(f.client, hk, { month: '2026-10' })).training_sessions, 4);
});

for (const mutation of ['missing', 'unverified', 'expired', 'future', 'stateonly', 'storeonly', 'allstates', 'wrongstate', 'wrongclient', 'disabledmodule', 'scopeexpired', 'splitassignments']) {
  test(`HK assignments fail closed: ${mutation}`, async () => {
    const f = fixture(), a = f.tables.access_user_assignments[0];
    if (mutation === 'missing') f.tables.access_user_assignments = [];
    if (mutation === 'unverified') a.verification_status = 'draft';
    if (mutation === 'expired') a.effective_to = '2020-01-01';
    if (mutation === 'future') a.effective_from = '2099-01-01';
    if (mutation === 'stateonly') f.tables.access_user_scopes = f.tables.access_user_scopes.filter(s => s.scope_type === 'state');
    if (mutation === 'storeonly') f.tables.access_user_scopes = f.tables.access_user_scopes.filter(s => s.scope_type === 'store');
    if (mutation === 'allstates') f.tables.access_user_scopes[0].scope_code = 'All States';
    if (mutation === 'wrongstate') f.tables.access_user_scopes[0].scope_code = 'KL';
    if (mutation === 'wrongclient') f.tables.access_clients[0].code = 'other';
    if (mutation === 'disabledmodule') f.tables.access_client_modules[0].enabled = false;
    if (mutation === 'scopeexpired') f.tables.access_user_scopes[1].effective_to = '2020-01-01';
    if (mutation === 'splitassignments') { f.tables.access_user_assignments.push({ ...a, id: 'second' }); f.tables.access_user_scopes[1].user_assignment_id = 'second'; }
    await assert.rejects(() => resolveRetailHkTrainingScope(f.client, hk), e => e.statusCode === 403);
  });
}

test('HK another business and inactive identities are denied', async () => {
  for (const changes of [{ business: 'Other' }, { is_active: false }]) {
    await assert.rejects(() => resolveRetailHkTrainingScope(fixture().client, { ...hk, ...changes }), e => e.statusCode === 403);
  }
});

test('FO, Admin and Management retain their existing scope resolver branch', async () => {
  for (const role of ['FO','Admin','Management','Operations Manager','MD','COO','KAM','Executive Assistant']) {
    const actor = { ...hk, role };
    assert.equal(isRetailHkTrainingReader(actor), false);
    assert.equal(await resolveRetailHkTrainingScope(fixture().client, actor), null);
    assert.equal((await resolveTrainingReadScope(fixture().client, actor)).retailScope, undefined);
  }
});

test('HK router denies all mutations, approvals and unrelated Training resource endpoints', async () => {
  let invoked = 0;
  const app = express(); app.use(createTrainingRouter({ requireAuth(req,res,next) { req.profile = hk; next(); }, getClient() { invoked++; return fixture().client; } }));
  const server = app.listen(0,'127.0.0.1'); await new Promise(resolve => server.once('listening',resolve));
  try { const base = 'http://127.0.0.1:'+server.address().port;
    for (const [method,url] of [['POST','/sessions'],['PATCH','/sessions/canonical'],['DELETE','/sessions/canonical/attendees/a'],['POST','/sessions/canonical/submit'],['POST','/sessions/canonical/approve'],['PUT','/sessions/canonical/topics'],['GET','/site-staff']]) {
      assert.equal((await fetch(base+url,{method})).status,403);
    }
    assert.equal(invoked,0);
  } finally { await new Promise(resolve=>server.close(resolve)); }
});

test('HK HTTP list and detail use the verified read scope; missing assignments return 403', async () => {
  const f = fixture();
  const app = express(); app.use(createTrainingRouter({ requireAuth(req,res,next) { req.profile = hk; next(); }, getClient() { return f.client; } }));
  const server = app.listen(0,'127.0.0.1'); await new Promise(resolve => server.once('listening',resolve));
  try { const base = 'http://127.0.0.1:'+server.address().port;
    const list = await fetch(base+'/sessions'); assert.equal(list.status,200);
    assert.deepEqual((await list.json()).sessions.map(s => s.id).sort(),['both','canonical','legacy']);
    assert.equal((await fetch(base+'/sessions/unassigned')).status,404);
    f.tables.access_user_assignments = [];
    const denied = await fetch(base+'/sessions'); assert.equal(denied.status,403);
    assert.equal((await denied.json()).code,'training_scope_unverified');
  } finally { await new Promise(resolve => server.close(resolve)); }
});
