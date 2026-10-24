import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createManualKmRefreshService, assertManualKmRangeAllowed, assertKmBulkAvailable } from '../services/foManualKmRefreshService.js';

const admin = { id: 'admin-profile', auth_user_id: 'admin-auth', employee_code: 'ADMIN-1',
  role: 'Admin', status: 'active', is_active: true, web_access_enabled: true };
const environment = { KM_FINANCIAL_WRITES_MAINTENANCE: 'true', KM_FINANCIAL_WRITES_EMERGENCY_PAUSE: 'false' };
function fixture() {
  const attendance = { id: 'attendance-1', employee_code: 'EMP-1', fo_user_id: 'fo-profile',
    attendance_date: '2026-10-10', status: 'Completed', logout_time: '2026-10-10T12:00:00Z',
    total_route_km: 0, total_approved_km: 0, petrol_amount: 0, metadata: {}, updated_at: '2026-10-10T12:01:00Z' };
  const rows = { fo_attendance: [attendance], fo_km_financial_approvals: [], fo_travel_reimbursement_corrections: [],
    fo_missing_km_reviews: [], fo_monthly_travel_settlements: [] };
  const calls = [];
  class Query {
    constructor(table) { this.values = [...rows[table]]; }
    select() { return this; }
    eq(key, value) { this.values = this.values.filter(row => row[key] === value); return this; }
    ilike(key, value) { this.values = this.values.filter(row => row[key]?.toLowerCase() === value.toLowerCase()); return this; }
    lte(key, value) { this.values = this.values.filter(row => row[key] <= value); return this; }
    gte(key, value) { this.values = this.values.filter(row => row[key] >= value); return this; }
    limit(n) { this.values = this.values.slice(0, n); return this; }
    maybeSingle() { return Promise.resolve({ data: this.values[0], error: this.values.length > 1 ? { code: 'PGRST116' } : null }); }
    then(resolve, reject) { return Promise.resolve({ data: this.values }).then(resolve, reject); }
  }
  const client = { from(table) { assert.ok(table in rows, table); return new Query(table); },
    async rpc(name, args) { calls.push({ name, args }); return { data: { ok: true, calculation_run_id: 'run-1', payable_km: 2, reimbursement: 8 } }; } };
  const prepared = { ok: true, expected_attendance_updated_at: attendance.updated_at,
    new_total_route_km: 2, final_return_leg_km: 1, final_return_leg_provider: 'GPS_BASED',
    canonical_calculation: { calculationVersion: 'KM_ENGINE_V2', inputDigest: 'a'.repeat(64),
      payableKm: 2, reimbursement: 8, decision: 'ACCEPTED', canonicalLegs: [{ type: 'last_checkout_to_end_day' }] } };
  let clock = 0;
  const service = createManualKmRefreshService({ calculateFinalLeg: async () => ({final_leg_evidence:{checkout_eligibility:{petrol_eligible_after_checkout:true}}}), calculate: async () => structuredClone(prepared), now: () => clock, token: () => 'opaque-preview' });
  const payload = { manual_refresh: true, dry_run: true, employee_code: 'EMP-1', date: '2026-10-10', approval_reason: 'Reviewed missing final leg' };
  const invoke = (body = payload, extra = {}) => service({ client, payload: body, profile: admin, authUser: { id: admin.auth_user_id }, environment, ...extra });
  const apply = () => ({ ...payload, dry_run: false, attendance_id: attendance.id, preview_token: 'opaque-preview' });
  return { attendance, rows, calls, client, prepared, payload, invoke, apply, expire: () => { clock = 300001; } };
}

test('preview writes nothing; apply sends only the server-reviewed calculation through narrow guarded RPC', async () => {
  const f = fixture(); const before = structuredClone(f.rows);
  const preview = await f.invoke();
  assert.equal(preview.before.payable_km, 0); assert.equal(preview.after.payable_km, 2);
  assert.equal(preview.final_leg.km, 1); assert.equal(f.calls.length, 0); assert.deepEqual(f.rows, before);
  const result = await f.invoke({ ...f.apply(), p_calculation: { payableKm: 9999 }, p_admin_user_id: 'spoofed' });
  assert.equal(result.calculation_run_id, 'run-1'); assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].name, 'rpc_apply_fo_manual_km_refresh_v1');
  assert.equal(f.calls[0].args.p_admin_user_id, admin.auth_user_id);
  assert.equal(f.calls[0].args.p_calculation.payableKm, 2);
});

test('Admin identity, reason, exact employee/date and own-attendance checks fail before any write', async () => {
  for (const body of [{ approval_reason: '' }, { date: '' }, { date: '2026-02-30' }, { employee_code: '' }, { date_from: '2026-10-10', date_to: '2026-10-11' }]) {
    const f = fixture(); await assert.rejects(f.invoke({ ...f.payload, ...body })); assert.equal(f.calls.length, 0);
  }
  for (const profile of [{ ...admin, role: 'FO' }, { ...admin, web_access_enabled: false }, { ...admin, is_active: false }, { ...admin, employee_code: 'EMP-1' }]) {
    const f = fixture(); await assert.rejects(f.invoke(f.payload, { profile }), error => error.statusCode === 403); assert.equal(f.calls.length, 0);
  }
});

test('apply requires an unexpired preview bound to the Admin, employee, date, attendance and reason', async () => {
  const f = fixture(); await assert.rejects(f.invoke(f.apply()), error => error.code === 'KM_PREVIEW_REQUIRED');
  await f.invoke();
  for (const changes of [{ employee_code: 'OTHER' }, { date: '2026-10-11' }, { attendance_id: 'other' }, { approval_reason: 'Different reason' }]) {
    await assert.rejects(f.invoke({ ...f.apply(), ...changes }), error => error.code === 'KM_PREVIEW_REQUIRED');
  }
  await assert.rejects(f.invoke(f.apply(), { authUser: { id: 'another-admin' } }), error => error.code === 'KM_PREVIEW_REQUIRED');
  f.expire(); await assert.rejects(f.invoke(f.apply()), error => error.code === 'KM_PREVIEW_REQUIRED'); assert.equal(f.calls.length, 0);
});

test('changed evidence or route amount invalidates approval; emergency pause still blocks apply but allows preview', async () => {
  const f = fixture(); await f.invoke(); f.prepared.canonical_calculation.payableKm = 3;
  await assert.rejects(f.invoke(f.apply()), error => error.code === 'KM_PREVIEW_STALE'); assert.equal(f.calls.length, 0);
  const paused = fixture(); const extra = { environment: { ...environment, KM_FINANCIAL_WRITES_EMERGENCY_PAUSE: 'true' } };
  await paused.invoke(paused.payload, extra);
  await assert.rejects(paused.invoke(paused.apply(), extra), error => error.code === 'KM_FINANCIAL_WRITES_MAINTENANCE');
  assert.equal(paused.calls.length, 0);
});

test('approved payable, approved reviews, corrections and settled records are protected even at preview', async () => {
  for (const mutate of [f => { f.attendance.total_approved_km = 1; }, f => { f.attendance.petrol_amount = 4; },
    f => f.rows.fo_km_financial_approvals.push({ id: 'approval', attendance_id: f.attendance.id }),
    f => f.rows.fo_missing_km_reviews.push({ id: 'review', attendance_id: f.attendance.id, status: 'approved' }),
    f => f.rows.fo_travel_reimbursement_corrections.push({ id: 'manual', attendance_id: f.attendance.id }),
    f => f.rows.fo_monthly_travel_settlements.push({ id: 'settled', employee_code: 'EMP-1', period_start: '2026-10-01', period_end: '2026-10-31' })]) {
    const f = fixture(); mutate(f); const before = structuredClone(f.rows);
    const preview = await f.invoke(); assert.equal(preview.read_only,true); assert.equal(preview.code,'KM_FINANCIAL_STATE_PROTECTED'); assert.equal(preview.preview_token,undefined);
    assert.deepEqual(f.rows, before); assert.equal(f.calls.length, 0);
  }
});

test('duplicate attendance and unresolved evidence cannot produce a writable preview', async () => {
  const f = fixture(); f.rows.fo_attendance.push({ ...f.attendance });
  await assert.rejects(f.invoke(), error => error.code === 'KM_ATTENDANCE_SELECTION_AMBIGUOUS');
  const unresolved = fixture(); unresolved.prepared.canonical_calculation.decision = 'MANUAL_REVIEW';
  await assert.rejects(unresolved.invoke(), error => error.code === 'KM_PREVIEW_UNAVAILABLE');
});

test('parallel approvals cannot both enter persistence; database stale/protected errors remain explicit', async () => {
  const f = fixture(); await f.invoke(); let release;
  f.client.rpc = () => new Promise(resolve => { release = resolve; });
  const first = f.invoke(f.apply());
  await assert.rejects(f.invoke(f.apply()), error => error.code === 'KM_RECALCULATION_ALREADY_RUNNING');
  while (!release) await new Promise(resolve => setImmediate(resolve));
  release({ data: { ok: true, calculation_run_id: 'run' } }); await first;
  const stale = fixture(); await stale.invoke();
  stale.client.rpc = async () => ({ error: { code: '40001', message: 'manual_km_preview_stale' } });
  await assert.rejects(stale.invoke(stale.apply()), error => error.statusCode === 409);
});

test('lost-response retry delegates original snapshot to database idempotency rather than recalculating approved records', async () => {
  const f = fixture(); await f.invoke(); f.attendance.updated_at = '2026-10-10T13:00:00Z'; f.attendance.total_approved_km = 2;
  f.client.rpc = async (name, args) => { assert.equal(args.p_expected_attendance_updated_at, '2026-10-10T12:01:00Z'); return { data: { ok: true, idempotent_replay: true, calculation_run_id: 'original-run' } }; };
  assert.equal((await f.invoke(f.apply())).idempotent_replay, true);
});

test('aborted database lock conflicts are retryable', async () => {
  const f = fixture(); await f.invoke();
  for (const code of ['40P01','55P03','57014']) {
    f.client.rpc=async()=>({error:{code,message:'Synthetic aborted transaction'}});
    await assert.rejects(f.invoke(f.apply()),error=>error.statusCode===409&&error.retryable===true);
  }
});

test('changed checkout snapshot cannot reuse an unchanged canonical digest', async () => {
  const f=fixture();let version='one';
  const service=createManualKmRefreshService({calculate:async()=>structuredClone(f.prepared),
    calculateFinalLeg:async()=>({final_leg_evidence:{checkout_eligibility:{petrol_eligible_after_checkout:true,snapshot:{visit_id:'v',updated_at:version}}}})});
  const invoke=body=>service({client:f.client,payload:body,profile:admin,authUser:{id:admin.auth_user_id},environment});
  const preview=await invoke(f.payload);version='two';
  await assert.rejects(invoke({...f.apply(),preview_token:preview.preview_token}),e=>e.code==='KM_PREVIEW_STALE');
  assert.equal(f.calls.length,0);
});

test('maintenance rejects multi-date ranges including Admin reasons; bulk remains disabled', () => {
  for (const approval_reason of [undefined, 'Admin reason']) {
    assert.throws(() => assertManualKmRangeAllowed({ date_from: '2026-10-01', date_to: '2026-10-02', approval_reason }, environment), error => error.code === 'KM_SINGLE_DATE_REQUIRED');
    assert.throws(() => assertManualKmRangeAllowed({ date_from: '2026-10-01', date_to: '2026-10-01', approval_reason }, environment), error => error.code === 'KM_MANUAL_PREVIEW_REQUIRED');
  }
  assert.throws(() => assertKmBulkAvailable(environment), error => error.statusCode === 423);
  assert.doesNotThrow(() => assertManualKmRangeAllowed({}, {}));
});

test('actual HTTP range/bulk handlers stop before any attendance or service-role access during maintenance', async () => {
  const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  for (const route of ['recalculate-employee-range', 'recalculate-batch', 'recalculate-all']) {
    let handler;
    const start = server.indexOf(`app.post('/api/fo/km/${route}'`);
    const end = server.indexOf('\napp.', start + 1);
    vm.runInNewContext(server.slice(start, end), {
      app: { post(...args) { handler = args.at(-1); } }, requireSupabaseJwt() {}, requireFoKmBatchRecalculationPermission() {},
      process: { env: environment }, assertManualKmRangeAllowed, assertKmBulkAvailable,
      requireServiceRoleSupabase() { throw new Error('Forbidden financial client access'); },
    });
    const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; } };
    await handler({ body: { date_from: '2026-10-01', date_to: '2026-10-02', approval_reason: 'Admin reason' }, profile: admin }, response);
    assert.equal(response.statusCode, 423);
  }
});

test('existing single-attendance HTTP endpoint passes trusted JWT identity and returns explicit manual errors', async () => {
  const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  let handler; let failure;
  const start = server.indexOf("app.post('/api/fo/km/recalculate',");
  const end = server.indexOf('\napp.', start + 1);
  vm.runInNewContext(server.slice(start, end), {
    app: { post(...args) { handler = args.at(-1); } }, requireSupabaseJwt() {}, requireServiceRoleSupabase: () => ({}),
    manualKmRefresh: async context => {
      assert.equal(context.authUser.id, 'verified-jwt'); assert.equal(context.profile.employee_code, admin.employee_code);
      if (failure) throw failure;
      return { ok: true, dry_run: true };
    },
  });
  for (const error of [null, Object.assign(new Error('Paused'), { statusCode: 503, code: 'KM_FINANCIAL_WRITES_MAINTENANCE' })]) {
    failure = error;
    const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; } };
    await handler({ body: { manual_refresh: true, dry_run: true, p_admin_user_id: 'spoofed' }, profile: admin, authUser: { id: 'verified-jwt' } }, response);
    assert.equal(response.statusCode, error ? 503 : 200);
    if (error) assert.equal(response.body.code, error.code);
  }
});

test('real canonical engine preview includes final leg and apply compares the same exact calculation', async () => {
  const source = readFileSync(new URL('./foKmAuthorizedActions.test.js', import.meta.url), 'utf8');
  const buildFixture = vm.runInNewContext(source.slice(source.indexOf('function fixture()'), source.indexOf('\ntest('))
    .replace('select() {', "ilike(key, value) { this.values = this.values.filter(row => String(row[key]).toLowerCase() === value.toLowerCase()); return this; }\nselect() {") + '\nfixture;', { assert, Date, structuredClone });
  const f = buildFixture(); f.attendance.total_approved_km = 0; f.attendance.petrol_amount = 0;
  f.rows.fo_missing_km_reviews = []; f.rows.fo_km_financial_approvals = []; f.rows.fo_monthly_travel_settlements = [];
  for (const visit of f.rows.fo_site_visits) visit.petrol_eligible_after_checkout = true;
  const service = createManualKmRefreshService();
  const payload = { manual_refresh: true, dry_run: true, employee_code: 'TEST-FO', date: '2026-10-10', approval_reason: 'Reviewed GPS evidence' };
  const invoke = body => service({ client: f.client, payload: body, profile: admin, authUser: { id: admin.auth_user_id }, environment });
  const oldFetch = globalThis.fetch; globalThis.fetch = () => { throw new Error('Network forbidden'); };
  try {
    const preview = await invoke(payload); assert.ok(preview.final_leg.km > 0); assert.ok(preview.after.payable_km > 0);
    f.client.rpc = async (name, args) => {
      assert.equal(name, 'rpc_apply_fo_manual_km_refresh_v1');
      assert.ok(args.p_calculation.canonicalLegs.some(leg => leg.type === 'last_checkout_to_end_day'));
      return { data: { ok: true, calculation_run_id: 'real-engine-run' } };
    };
    assert.equal((await invoke({ ...payload, dry_run: false, attendance_id: f.attendance.id, preview_token: preview.preview_token })).updated, true);
  } finally { globalThis.fetch = oldFetch; }
});
