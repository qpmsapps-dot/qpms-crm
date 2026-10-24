import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createTravelEvidenceService, readOnlyEvidenceClient, summarizeTravelEvidence } from '../services/foTravelEvidenceService.js';
import { createTravelEvidenceRouter } from '../routes/foTravelEvidenceRoutes.js';
import { recalculateAttendanceTravelLegs } from '../foKmRecalculationService.js';

const admin = { id: 'admin-profile', role: 'Admin', is_active: true, status: 'Active', auth_user_id: 'admin-auth', employee_code: 'ADMIN' };
const times = [
  ['04:32:54', '05:29:56'], ['06:42:36', '07:08:14'], ['07:35:15', '08:04:27'],
  ['09:41:04', '09:41:21'], ['10:11:27', '10:25:10'], ['10:25:53', '10:34:27'],
];
const at = time => `2026-10-24T${time}.000Z`;
function fixture({ mode = 'auto', completed = false, sparse = false, openPrivate = false } = {}) {
  const attendance = { id: 'manoj-audited-shape', employee_code: 'QPMSKL3762', fo_user_id: 'QPMSKL3762',
    attendance_date: '2026-10-24', login_time: at('03:11:48'), logout_time: completed ? at('12:00:00') : null,
    status: completed ? 'Completed' : 'Active', travel_mode: mode, payable_km_allowed: mode === 'bike',
    start_latitude: 13, start_longitude: 80, end_latitude: 13.014, end_longitude: 80,
    total_route_km: 0, total_approved_km: 0, petrol_amount: 0, metadata: {} };
  const visits = times.map(([start, end], i) => ({ id: `visit-${i}`, attendance_id: attendance.id,
    check_in_time: at(start), check_out_time: at(end), check_in_latitude: 13.001 + i * 0.002,
    check_in_longitude: 80, check_out_latitude: 13.002 + i * 0.002, check_out_longitude: 80,
    petrol_eligible_after_checkout: i >= 2, checkout_location_status: i < 2 ? 'wrong_location' : 'valid', metadata: {} }));
  const legs = visits.map((v, i) => ({ id: `leg-${i}`, attendance_id: attendance.id, travel_mode: mode,
    payable_km_allowed: mode === 'bike', status: 'completed', started_at: i ? visits[i - 1].check_out_time : attendance.login_time,
    ended_at: v.check_in_time, start_lat: i ? visits[i - 1].check_out_latitude : 13, start_lng: 80,
    end_lat: v.check_in_latitude, end_lng: 80, calculated_km: 0, payable_km: 0, metadata: {} }));
  legs.push({ id: 'last-leg', attendance_id: attendance.id, travel_mode: mode, payable_km_allowed: mode === 'bike',
    status: completed ? 'completed' : 'active', started_at: visits.at(-1).check_out_time,
    ended_at: attendance.logout_time, start_lat: visits.at(-1).check_out_latitude, start_lng: 80,
    end_lat: completed ? 13.014 : null, end_lng: completed ? 80 : null, calculated_km: 0, payable_km: 0 });
  if (openPrivate) legs.at(-1).travel_mode = 'bike';
  const gps = legs.filter(l => l.ended_at).flatMap((leg, index) => Array.from({ length: sparse ? 2 : 15 }, (_, i) => ({
    id: `gps-${index}-${i}`, attendance_id: attendance.id, employee_code: attendance.employee_code, fo_user_id: attendance.fo_user_id,
    captured_at: new Date(Date.parse(leg.started_at) + (Date.parse(leg.ended_at) - Date.parse(leg.started_at)) * i / ((sparse ? 2 : 15) - 1)).toISOString(),
    latitude: leg.start_lat + (leg.end_lat - leg.start_lat) * i / ((sparse ? 2 : 15) - 1), longitude: 80, accuracy: 5, is_mocked: false, source: 'mobile', metadata: {},
  })));
  const tables = { fo_attendance: [attendance], fo_site_visits: visits, fo_travel_legs: legs, fo_location_logs: gps,
    fo_missing_km_reviews: [], fo_km_financial_approvals: [], fo_travel_reimbursement_corrections: [], fo_monthly_travel_settlements: [] };
  const mutations = [];
  class Query {
    constructor(table) { this.values = [...(tables[table] || [])]; }
    select() { return this; }
    eq(k, v) { this.values = this.values.filter(row => row[k] === v); return this; }
    neq(k, v) { this.values = this.values.filter(row => row[k] !== v); return this; }
    in(k, v) { this.values = this.values.filter(row => v.includes(row[k])); return this; }
    gte(k, v) { this.values = this.values.filter(row => row[k] >= v); return this; }
    gt(k, v) { this.values = this.values.filter(row => row[k] > v); return this; }
    lt(k, v) { this.values = this.values.filter(row => row[k] < v); return this; }
    lte(k, v) { this.values = this.values.filter(row => row[k] <= v); return this; }
    ilike(k, v) { this.values = this.values.filter(row => String(row[k]).toLowerCase() === v.toLowerCase()); return this; }
    is(k, v) { this.values = this.values.filter(row => (row[k] ?? null) === v); return this; }
    not() { return this; }
    or() { return this; }
    order() { return this; }
    limit(n) { this.values = this.values.slice(0, n); return this; }
    range(a, b) { this.values = this.values.slice(a, b + 1); return this; }
    maybeSingle() { return Promise.resolve({ data: this.values[0] || null, error: null }); }
    single() { return this.maybeSingle(); }
    then(resolve, reject) { return Promise.resolve({ data: this.values, error: null }).then(resolve, reject); }
    update() { mutations.push('update'); return this; }
    insert() { mutations.push('insert'); return this; }
    upsert() { mutations.push('upsert'); return this; }
    delete() { mutations.push('delete'); return this; }
  }
  const client = { from: table => new Query(table), rpc: () => { mutations.push('rpc'); throw Error('Unexpected financial RPC'); } };
  const invoke = (service = createTravelEvidenceService()) => service({ client, payload: { employee_code: attendance.employee_code, date: attendance.attendance_date }, profile: admin, authUser: { id: admin.auth_user_id } });
  return { attendance, visits, legs, gps, tables, client, mutations, invoke };
}

test('QPMSKL3762 active six-visit Auto shape calculates closed evidence under pause, never finalizes or pays', async () => {
  const old = process.env.KM_FINANCIAL_WRITES_EMERGENCY_PAUSE; process.env.KM_FINANCIAL_WRITES_EMERGENCY_PAUSE = 'true';
  try {
    const f = fixture(), before = structuredClone(f.tables), service = createTravelEvidenceService();
    const result = await f.invoke(service), repeated = await f.invoke(service);
    assert.equal(result.legs.length, 6); assert(result.calculated_travel_km > 0);
    assert(result.legs.some(l => l.source === 'GPS_BASED')); assert.equal(result.petrol_eligible_evidence_km, 0);
    assert.equal(result.active, true); assert.equal(result.persisted, false); assert.equal(result.status, 'partial');
    assert(!result.legs.some(l => l.type === 'last_checkout_to_end_day'));
    assert.equal(repeated.calculated_travel_km, result.calculated_travel_km); assert.deepEqual(f.tables, before); assert.deepEqual(f.mutations, []);
  } finally { if (old === undefined) delete process.env.KM_FINANCIAL_WRITES_EMERGENCY_PAUSE; else process.env.KM_FINANCIAL_WRITES_EMERGENCY_PAUSE = old; }
});
test('completed Bike evidence includes exactly one final leg without saving totals', async () => {
  const f = fixture({ mode: 'bike', completed: true }), result = await f.invoke();
  assert.equal(result.legs.filter(l => l.type === 'last_checkout_to_end_day').length, 1);
  assert(result.petrol_eligible_evidence_km > 0); assert.equal(f.attendance.total_approved_km, 0); assert.deepEqual(f.mutations, []);
  assert(result.legs.some(leg => leg.review_flags.includes('CHECKOUT_ELIGIBILITY_REVIEW_REQUIRED') && leg.payable_km === 0));
});
test('missing final leg is calculated once beside earlier persisted legs, without inserting a record', async () => {
  const f = fixture({ mode: 'bike', completed: true }); f.legs.pop();
  const result = await f.invoke();
  assert.equal(result.legs.filter(leg => leg.type === 'last_checkout_to_end_day').length, 1);
  assert.equal(result.legs.length, 7); assert.equal(f.legs.length, 6); assert.deepEqual(f.mutations, []);
});
test('insufficient GPS uses existing Google fallback with a bounded mock and preserves Auto non-payability', async t => {
  const enabled = process.env.ENABLE_GOOGLE_DIRECTIONS, key = process.env.GOOGLE_MAPS_API_KEY, fetchBefore = global.fetch;
  process.env.ENABLE_GOOGLE_DIRECTIONS = 'true'; process.env.GOOGLE_MAPS_API_KEY = 'local-mock-only'; let calls = 0;
  global.fetch = async () => { calls++; return { ok: true, status: 200, statusText: 'OK', json: async () => ({ status: 'OK', routes: [{ legs: [{ distance: { value: 120 } }] }] }) }; };
  t.after(() => { global.fetch = fetchBefore; if (enabled === undefined) delete process.env.ENABLE_GOOGLE_DIRECTIONS; else process.env.ENABLE_GOOGLE_DIRECTIONS = enabled; if (key === undefined) delete process.env.GOOGLE_MAPS_API_KEY; else process.env.GOOGLE_MAPS_API_KEY = key; });
  const f = fixture({ sparse: true }), result = await f.invoke();
  assert(result.legs.some(l => l.source === 'GOOGLE_ROUTE_FALLBACK')); assert(calls > 0 && calls <= 10);
  assert.equal(result.petrol_eligible_evidence_km, 0); assert(result.calculated_travel_km > 0); assert.deepEqual(f.mutations, []);
});
test('active private leg is excluded in evidence only, but original financial closure guard is preserved', async () => {
  const f = fixture({ mode: 'bike' });
  await assert.rejects(recalculateAttendanceTravelLegs(f.client, f.attendance.id, { persist: false, auditDelayedCheckout: false }), { code: 'travel_leg_closure_pending' });
  const evidence = await f.invoke(); assert.equal(evidence.legs.length, 6); assert(evidence.active); assert.deepEqual(f.mutations, []);
});
test('read-only capability rejects mutation methods and offers no RPC capability', async () => {
  const f = fixture(), read = readOnlyEvidenceClient(f.client);
  for (const method of ['update', 'insert', 'upsert', 'delete']) assert.throws(() => read.from('fo_attendance')[method]({}), { code: 'KM_EVIDENCE_WRITE_FORBIDDEN' });
  assert.equal(read.rpc, undefined); assert.deepEqual(f.mutations, []);
  const service = createTravelEvidenceService({ calculate: async client => { client.from('fo_site_visits').update({}); } });
  await assert.rejects(f.invoke(service), { code: 'KM_EVIDENCE_WRITE_FORBIDDEN' });
});
test('already included final leg stays included; protected values and unknown legacy/review inclusion stay untouched', () => {
  const attendance = { attendance_date: '2026-10-01', logout_time: 'end', total_approved_km: 71.25, total_route_km: 71.25, petrol_amount: 285 };
  const result = { visits: [], travel_legs: [{ type: 'last_checkout_to_end_day', status: 'calculated', km: 27.97, payable_km: 27.97 }] };
  const savedLegs = [{ status: 'completed', payable_km: 43.28 }, { status: 'completed', payable_km: 27.97 }];
  const summary = summarizeTravelEvidence({ attendance, result, savedLegs, protectedRecord: true });
  assert.equal(summary.already_included_km, 71.25); assert.equal(summary.saved_payable_km, 71.25); assert.equal(summary.proposed_additional_payable_km, null); assert.equal(summary.status, 'protected');
  const unknown = summarizeTravelEvidence({ attendance, result, reviews: [{ status: 'clarification_required', google_route_km: 14.3, metadata: { already_included_km: null } }] });
  assert.equal(unknown.already_included_km, null); assert.equal(unknown.proposed_additional_payable_km, null); assert.equal(unknown.pending_checkout_review_km, 14.3);
  const cancelled = summarizeTravelEvidence({ attendance, result, savedLegs: [{ status: 'cancelled', payable_km: 71.25 }] });
  assert.equal(cancelled.already_included_km, null);
});
test('approval, correction, approved review and settlement independently protect saved records', async () => {
  for (const [table, record] of [
    ['fo_km_financial_approvals', { id: 'approval', attendance_id: 'manoj-audited-shape' }],
    ['fo_travel_reimbursement_corrections', { id: 'correction', attendance_id: 'manoj-audited-shape' }],
    ['fo_missing_km_reviews', { id: 'review', attendance_id: 'manoj-audited-shape', status: 'approved', approved_missing_km: 2 }],
    ['fo_monthly_travel_settlements', { id: 'settlement', employee_code: 'QPMSKL3762', period_start: '2026-10-01', period_end: '2026-10-31' }],
  ]) {
    const f = fixture(); f.tables[table].push(record); const before = structuredClone(f.tables);
    const result = await f.invoke(); assert.equal(result.protected, true, table); assert.equal(result.proposed_additional_payable_km, null);
    assert.deepEqual(f.tables, before); assert.deepEqual(f.mutations, []);
  }
});
test('expired calculation budget fails without finalizing a travel leg or persisting partial results', async () => {
  const f = fixture(); await assert.rejects(f.invoke(createTravelEvidenceService({ now: () => Date.now() - 90001 })), { code: 'KM_EVIDENCE_TIMEOUT' });
  assert.equal(f.legs.at(-1).ended_at, null); assert.deepEqual(f.mutations, []);
});
test('authorization and payload spoofing fail before calculation; failures release request lock', async () => {
  const f = fixture(); let calls = 0;
  const service = createTravelEvidenceService({ calculate: async () => { calls++; throw Object.assign(Error('timeout'), { code: '57014' }); } });
  await assert.rejects(service({ client: f.client, payload: {}, profile: { ...admin, role: 'FO' }, authUser: { id: 'fo' } }), { statusCode: 403 });
  await assert.rejects(service({ client: f.client, payload: { employee_code: 'QPMSKL3762', date: '2026-10-24', persist: true }, profile: admin, authUser: { id: 'admin' } }), { statusCode: 400 });
  for (let i = 0; i < 2; i++) await assert.rejects(f.invoke(service), { code: '57014' });
  assert.equal(calls, 2); assert.deepEqual(f.mutations, []);
});
test('concurrent duplicate dates and excess capacity fail closed without duplicate work', async () => {
  const f = fixture(); let release;
  const wait = new Promise(resolve => { release = resolve; }); let entered = 0;
  const service = createTravelEvidenceService({ calculate: async () => { entered++; await wait; return { travel_legs: [], visits: [] }; } });
  const first = f.invoke(service); while (!entered) await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(f.invoke(service), { code: 'KM_EVIDENCE_RUNNING' });
  const another = identity => service({ client: f.client, payload: { employee_code: 'QPMSKL3762', date: '2026-10-24' }, profile: { ...admin, auth_user_id: identity }, authUser: { id: identity } });
  const second = another('admin-2'); while (entered < 2) await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(another('admin-3'), { code: 'KM_EVIDENCE_BUSY' });
  release(); await Promise.all([first, second]); assert.equal(entered, 2); assert.deepEqual(f.mutations, []);
});
test('actual mounted HTTP route denies unauthorized calls and reports timeout without claiming zero evidence', async () => {
  let acquired = 0;
  const app = express(); app.use(express.json());
  app.use('/api/fo/km', createTravelEvidenceRouter({ requireAuth(req, res, next) { if (!req.headers['x-role']) return res.sendStatus(401); req.profile = { ...admin, role: req.headers['x-role'] }; req.authUser = { id: 'admin-auth' }; next(); }, getClient() { acquired++; return {}; }, calculate: async () => { throw { code: '57014' }; } }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/fo/km/travel-evidence`;
    assert.equal((await fetch(url, { method: 'POST' })).status, 401);
    assert.equal((await fetch(url, { method: 'POST', headers: { 'x-role': 'FO' } })).status, 403); assert.equal(acquired, 0);
    const response = await fetch(url, { method: 'POST', headers: { 'x-role': 'Admin' } });
    assert.equal(response.status, 504); const body = await response.json(); assert.equal(body.ok, false); assert(!('calculated_travel_km' in body));
  } finally { await new Promise(r => server.close(r)); }
});
