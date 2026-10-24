import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createManualKmRangeRefreshService, manualKmRangeSelection } from '../services/foManualKmRangeRefreshService.js';

const profile = { role: 'Admin', employee_code: 'ADMIN', is_active: true, web_access_enabled: true };
const env = { KM_FINANCIAL_WRITES_MAINTENANCE: 'true', KM_FINANCIAL_WRITES_EMERGENCY_PAUSE: 'false' };
const error = (code, statusCode = 409) => Object.assign(new Error(code), { code, statusCode });
const payload = { employee_code: 'EMP', start_date: '2026-10-01', end_date: '2026-10-03', approval_reason: 'Reviewed range evidence', dry_run: true };
function fixture(single) {
  let clock = 0; let id = 0;
  const calls = [];
  const service = createManualKmRangeRefreshService({ singleAttendance: async context => {
    calls.push(context);
    if (single) return single(context);
    const date = context.payload.date;
    return context.payload.dry_run ? { ok: true, dry_run: true, attendance_id: `id-${date}`, date,
      preview_token: `token-${date}`, before: { route_km: 0, payable_km: 0, amount: 0 }, after: { route_km: 2, payable_km: 2, amount: 8 }, final_leg: { km: 1, source: 'GPS_BASED' } }
      : { ok: true, calculation_run_id: `run-${date}` };
  }, now: () => clock, token: () => `range-${++id}` });
  const client = { from: () => ({ select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: { total_approved_km: 4, petrol_amount: 16 } }; } }) };
  const invoke = (body = payload, extras = {}) => service({ client, payload: body, profile, authUser: { id: 'jwt-admin' }, environment: env, ...extras });
  const apply = token => ({ ...payload, dry_run: false, range_token: token });
  return { calls, invoke, apply, expire: () => { clock = 600001; } };
}

test('read-only protected and checkout-restricted previews are never ready or applied in a range', async () => {
  const f = fixture(async ({ payload: day }) => {
    assert.equal(day.dry_run,true);
    return { ok:true,read_only:true,financial_eligible:false,
      code:day.date.endsWith('01')?'KM_FINANCIAL_STATE_PROTECTED':'KM_CHECKOUT_ELIGIBILITY_REVIEW_REQUIRED',
      before:{route_km:71.48,payable_km:71.48,amount:285.92},
      after:{route_km:71.48,payable_km:71.48,amount:285.92},final_leg:{km:1.09} };
  });
  const preview=await f.invoke();assert.equal(preview.summary.ready,0);assert.equal(preview.summary.protected,1);
  assert.equal(preview.summary.recovered_km,0);assert.equal(preview.summary.payable_amount,0);
  const result=await f.invoke(f.apply(preview.range_token));assert.equal(result.summary.applied,0);assert.equal(f.calls.length,3);
});

test('strict server limit is seven inclusive calendar days, including leap days and month boundaries', () => {
  assert.deepEqual(manualKmRangeSelection({ ...payload, start_date: '2028-02-27', end_date: '2028-03-04' }).dates,
    ['2028-02-27', '2028-02-28', '2028-02-29', '2028-03-01', '2028-03-02', '2028-03-03', '2028-03-04']);
  for (const body of [{ end_date: '2026-10-08' }, { start_date: '2026-10-04' }, { start_date: '2026-02-30' },
    { employee_code: '' }, { date: '2026-10-01' }, { start_date: '2026-10-01T00:00:00Z' }]) {
    assert.throws(() => manualKmRangeSelection({ ...payload, ...body }), error => error.statusCode === 400);
  }
});

test('every date is independently previewed and applied through the single-attendance path, sequentially', async () => {
  let active = 0; let max = 0;
  const f = fixture(async ({ payload: day }) => {
    max = Math.max(max, ++active); await new Promise(resolve => setImmediate(resolve)); active--;
    return day.dry_run ? { ok: true, date: day.date, attendance_id: `id-${day.date}`, preview_token: `p-${day.date}`,
      before: { route_km: 0, payable_km: 0, amount: 0 }, after: { route_km: 2, payable_km: 2, amount: 8 } } : { ok: true, calculation_run_id: `r-${day.date}` };
  });
  const preview = await f.invoke(); assert.equal(f.calls.length, 3); assert.equal(max, 1);
  assert.equal(preview.summary.recovered_km, 6); assert.equal(preview.summary.payable_amount, 24);
  assert.ok(preview.results.every(row => !row.preview_token));
  const result = await f.invoke({ ...f.apply(preview.range_token), results: [{ attendance_id: 'spoofed' }] });
  assert.equal(result.summary.applied, 3); assert.equal(result.summary.recovered_km, 6);
  for (const call of f.calls.slice(3)) {
    assert.equal(call.payload.employee_code, 'EMP'); assert.equal(call.payload.attendance_id, `id-${call.payload.date}`);
    assert.equal(call.payload.preview_token, `p-${call.payload.date}`); assert.equal(call.payload.approval_reason, payload.approval_reason);
  }
  const replay = await f.invoke(f.apply(preview.range_token));
  assert.equal(f.calls.length, 6); assert.equal(replay.summary.applied, 3);
  assert.equal(replay.summary.payable_amount, 24); assert.ok(replay.results.every(row => row.idempotent_replay));
});

test('mixed preview protects approved dates and reports missing attendance without fabricating recalculation', async () => {
  const f = fixture(async ({ payload: day }) => {
    if (day.date.endsWith('02')) throw error('KM_FINANCIAL_STATE_PROTECTED');
    if (day.date.endsWith('03')) throw error('KM_ATTENDANCE_NOT_FOUND', 404);
    return { ok: true, date: day.date, attendance_id: 'one', preview_token: 'one', before: { route_km: 0, payable_km: 0, amount: 0 }, after: { route_km: 2, payable_km: 2, amount: 8 } };
  });
  const result = await f.invoke(); assert.equal(result.outcome, 'partial_success');
  assert.deepEqual(result.results.map(row => row.status), ['ready', 'protected', 'missing']);
  assert.equal(result.results[1].before.payable_km, 4); assert.equal(result.results[1].after, undefined);
  assert.equal(result.summary.recovered_km, 2); assert.equal(result.summary.payable_amount, 8);
});

test('recovered KM is the signed route difference, separate from the payable KM change', async () => {
  const f = fixture(async ({ payload: day }) => ({ ok: true, date: day.date, attendance_id: day.date, preview_token: day.date,
    before: { route_km: 1.5, payable_km: 0, amount: 0 }, after: { route_km: 2, payable_km: 2, amount: 8 } }));
  const preview = await f.invoke();
  assert.equal(preview.summary.recovered_km, 1.5);
  assert.equal(preview.summary.payable_km_difference, 6);
  assert.equal(preview.results[0].recovered_km, 0.5);
});

test('partial financial failures are independent; retries skip successful dates and preserve totals once', async () => {
  let attempts = 0;
  const f = fixture(async ({ payload: day }) => {
    if (day.dry_run) return { ok: true, date: day.date, attendance_id: day.date, preview_token: day.date,
      before: { route_km: 0, payable_km: 0, amount: 0 }, after: { route_km: 2, payable_km: 2, amount: 8 } };
    if (day.date.endsWith('02') && attempts++ === 0) throw error('KM_PERSISTENCE_UNVERIFIED', 503);
    if (day.date.endsWith('03')) throw error('KM_PREVIEW_STALE');
    return { ok: true, calculation_run_id: `run-${day.date}` };
  });
  const preview = await f.invoke();
  const partial = await f.invoke(f.apply(preview.range_token));
  assert.equal(partial.outcome, 'partial_success'); assert.equal(partial.summary.applied, 1);
  assert.deepEqual(partial.results.map(row => row.status), ['applied', 'failed', 'failed']);
  const retry = await f.invoke(f.apply(preview.range_token));
  assert.equal(retry.summary.applied, 2); assert.equal(retry.summary.recovered_km, 4); assert.equal(retry.summary.payable_amount, 16);
  assert.equal(f.calls.filter(call => !call.payload.dry_run && call.payload.date.endsWith('01')).length, 1);
  assert.equal(retry.results[2].code, 'KM_PREVIEW_STALE');
});

test('range token binds Admin, employee, dates, reason and expiry; no apply without prior preview', async () => {
  const f = fixture(); await assert.rejects(f.invoke(f.apply('missing')), error => error.code === 'KM_RANGE_PREVIEW_REQUIRED');
  const preview = await f.invoke();
  for (const changed of [{ employee_code: 'OTHER' }, { start_date: '2026-10-02' }, { end_date: '2026-10-04' }, { approval_reason: 'Another reason' }]) {
    await assert.rejects(f.invoke({ ...f.apply(preview.range_token), ...changed }), error => error.code === 'KM_RANGE_PREVIEW_REQUIRED');
  }
  await assert.rejects(f.invoke(f.apply(preview.range_token), { authUser: { id: 'another-admin' } }), error => error.code === 'KM_RANGE_PREVIEW_REQUIRED');
  f.expire(); await assert.rejects(f.invoke(f.apply(preview.range_token)), error => error.code === 'KM_RANGE_PREVIEW_REQUIRED');
  assert.equal(f.calls.length, 3);
});

test('role, web access, reason and emergency pause cannot be bypassed by authorized-range marker', async () => {
  const f = fixture();
  for (const invalid of [{ ...profile, role: 'FO' }, { ...profile, is_active: false }, { ...profile, web_access_enabled: false }]) {
    await assert.rejects(f.invoke(payload, { profile: invalid }), error => error.statusCode === 403);
  }
  await assert.rejects(f.invoke({ ...payload, approval_reason: ' ' }), error => error.statusCode === 400);
  const preview = await f.invoke();
  await assert.rejects(f.invoke(f.apply(preview.range_token), { environment: { ...env, KM_FINANCIAL_WRITES_EMERGENCY_PAUSE: 'true' } }), error => error.statusCode === 503);
  assert.equal(f.calls.length, 3);
});

test('parallel requests for the same range cannot both start financial work', async () => {
  let release;
  const f = fixture(async ({ payload: day }) => day.dry_run
    ? { ok: true, date: day.date, attendance_id: day.date, preview_token: day.date, before: { route_km: 0, payable_km: 0, amount: 0 }, after: { route_km: 2, payable_km: 2, amount: 8 } }
    : new Promise(resolve => { release = () => resolve({ ok: true, calculation_run_id: day.date }); }));
  const preview = await f.invoke(); const first = f.invoke(f.apply(preview.range_token));
  await assert.rejects(f.invoke(f.apply(preview.range_token)), error => error.code === 'KM_RANGE_ALREADY_RUNNING');
  for (let i = 0; i < 3; i++) { const finish = release; release = null; finish(); await new Promise(resolve => setImmediate(resolve)); }
  assert.equal((await first).summary.applied, 3);
});

test('every day retains authorization checks, including a denial arising after earlier days committed', async () => {
  let applyCalls = 0;
  const f = fixture(async ({ payload: day }) => {
    if (!day.dry_run && ++applyCalls > 1) throw error('manual_km_admin_required', 403);
    return { ok: true, date: day.date, attendance_id: day.date, preview_token: day.date,
      before: { route_km: 0, payable_km: 0, amount: 0 }, after: { route_km: 2, payable_km: 2, amount: 8 }, calculation_run_id: day.date };
  });
  const preview = await f.invoke(); const result = await f.invoke(f.apply(preview.range_token));
  assert.equal(result.summary.applied, 1); assert.equal(result.summary.failed, 2);
  assert.ok(result.results.slice(1).every(row => row.error_status === 403));
});

test('real HTTP handler forwards JWT identity and returns multi-status for per-day partial failures', async () => {
  const source = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const start = source.indexOf("app.post('/api/fo/km/manual-range'"); const end = source.indexOf('\napp.', start + 1);
  let handler;
  vm.runInNewContext(source.slice(start, end), {
    app: { post(...args) { handler = args.at(-1); } }, requireSupabaseJwt() {}, requireServiceRoleSupabase: () => ({}),
    manualKmRangeRefresh: async context => { assert.equal(context.authUser.id, 'trusted'); return { ok: true, outcome: 'partial_success', results: [] }; },
  });
  const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
  await handler({ body: payload, profile, authUser: { id: 'trusted' } }, response);
  assert.equal(response.statusCode, 207); assert.equal(response.body.outcome, 'partial_success');
});
