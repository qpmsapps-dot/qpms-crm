import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { recalculateFoKm, calculateIncrementalMissingKm, decideMissingKmReview } from '../foKmRecalculationService.js';
import { recalculateEmployeeRange } from '../services/employeeRangeReportService.js';
import { adminKmApprovalAuthorization } from '../services/foKmRecalculationAuthorizationService.js';
import { persistForwardFinalLeg } from '../services/foForwardFinalLegPersistenceService.js';
import { startFoGpsEvidenceSummaryWorker } from '../services/foGpsEvidenceSummaryService.js';

// Synthetic completed-day evidence only. No database, auth, or network client.
function fixture() {
  const start = Date.parse('2026-10-10T04:30:00Z');
  const coordinate = (index) => ({ latitude: 13 + index * 0.0001, longitude: 80 + index * 0.0001 });
  const at = (index) => new Date(start + index * 10000).toISOString();
  const attendance = {
    id: 'test-attendance', fo_user_id: 'test-profile', employee_code: 'TEST-FO',
    attendance_date: '2026-10-10', login_time: at(0), logout_time: at(30),
    start_latitude: coordinate(0).latitude, start_longitude: coordinate(0).longitude,
    end_latitude: coordinate(30).latitude, end_longitude: coordinate(30).longitude,
    travel_mode: 'bike', payable_km_allowed: true, rate_per_km: 4, status: 'Completed',
    total_route_km: 999, eligible_km: 999, total_approved_km: 999, petrol_amount: 3996,
    metadata: {}, updated_at: at(31),
  };
  const rows = {
    fo_attendance: [attendance],
    fo_location_logs: Array.from({ length: 31 }, (_, i) => ({
      id: `test-gps-${i}`, attendance_id: attendance.id, fo_user_id: attendance.fo_user_id,
      ...coordinate(i), accuracy: 10, is_mocked: false, source: 'mobile', captured_at: at(i),
    })),
    fo_site_visits: [{
      id: 'test-visit', attendance_id: attendance.id, check_in_time: at(12), check_out_time: at(18),
      check_in_latitude: coordinate(12).latitude, check_in_longitude: coordinate(12).longitude,
      check_out_latitude: coordinate(18).latitude, check_out_longitude: coordinate(18).longitude,
      route_km: 0, status: 'Completed', metadata: {
        checkout_review_status: 'approved', approved_missing_checkout_km: 1.25,
        approved_adjustment_from_time: at(12), approved_adjustment_to_time: at(18),
      },
    }],
    fo_travel_legs: [], fo_travel_reimbursement_corrections: [],
    fo_missing_km_reviews: [{
      id: 'previously-approved', attendance_id: attendance.id, site_visit_id: 'test-visit',
      status: 'approved', approved_missing_km: 1.25, approved_amount: 5,
    }],
  };
  const calls = [];
  class Query {
    constructor(table) { this.values = [...rows[table]]; }
    select() { return this; }
    eq(key, value) { this.values = this.values.filter((row) => row[key] === value); return this; }
    gt(key, value) { this.values = this.values.filter((row) => row[key] > value); return this; }
    gte(key, value) { this.values = this.values.filter((row) => row[key] >= value); return this; }
    lte(key, value) { this.values = this.values.filter((row) => row[key] <= value); return this; }
    order() { return this; }
    limit(n) { this.values = this.values.slice(0, n); return this; }
    single() { return Promise.resolve({ data: this.values[0], error: null }); }
    maybeSingle() { return this.single(); }
    then(resolve, reject) { return Promise.resolve({ data: this.values, error: null }).then(resolve, reject); }
    update() { throw new Error('Unexpected nontransactional write'); }
    insert() { throw new Error('Unexpected nontransactional insert'); }
  }
  const client = {
    from(table) { assert.ok(table in rows, `Unexpected table ${table}`); return new Query(table); },
    async rpc(name, args) {
      calls.push({ name, args });
      assert.equal(name, 'rpc_persist_fo_canonical_km_v2');
      const calculation = args.p_calculation;
      return { data: { ok: true, calculation_run_id: '11111111-1111-4111-8111-111111111111',
        payable_km: calculation.payableKm, reimbursement: calculation.reimbursement }, error: null };
    },
  };
  return { client, attendance, calls, rows };
}

test('completed attendance dry-run precedes mock persistence; prior Missing KM is included once on retries', async () => {
  const { client, attendance, calls, rows } = fixture();
  const before = structuredClone(rows);
  const oldFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('Network/Google calls forbidden'); };
  try {
    const options = { refreshMissingKmReviews: false, maxGoogleDirectionsCalls: 0,
      environment: { KM_FINANCIAL_WRITES_MAINTENANCE: 'false' } };
    const preview = await recalculateFoKm(client, { attendance_id: attendance.id, dry_run: true }, {
      ...options, environment: { KM_FINANCIAL_WRITES_MAINTENANCE: 'true' },
    });
    assert.equal(calls.length, 0);
    assert.equal(preview.updated, false);
    assert.equal(preview.approved_missing_km, 1.25);
    assert.ok(preview.total_route_km > 0);
    assert.equal(preview.total_approved_km, Number((preview.total_route_km + 1.25).toFixed(2)));
    assert.deepEqual(rows, before);
    for (let retry = 0; retry < 2; retry += 1) {
      const result = await recalculateFoKm(client, { attendance_id: attendance.id }, options);
      const calculation = calls.at(-1).args.p_calculation;
      assert.equal(calculation.approvedMissingKm, 1.25);
      const legKm = calculation.canonicalLegs.reduce((sum, leg) => sum + leg.payableKm, 0);
      const legAmount = calculation.canonicalLegs.reduce((sum, leg) => sum + leg.payableAmount, 0);
      assert.equal(calculation.payableKm, Number((legKm + 1.25).toFixed(2)));
      assert.equal(calculation.reimbursement, Number((legAmount + 5).toFixed(2)));
      assert.equal(result.total_approved_km, preview.total_approved_km);
      assert.equal(calls.at(-1).args.p_expected_attendance_updated_at, attendance.updated_at);
    }
    assert.equal(calls.length, 2);
    assert.equal(calls[0].args.p_input_digest, calls[1].args.p_input_digest);
    assert.deepEqual(rows, before);
  } finally { globalThis.fetch = oldFetch; }
});

test('incremental Missing KM excludes previously covered distance', () => {
  assert.deepEqual(calculateIncrementalMissingKm(7, { alreadyIncludedKm: 5 }), {
    detectedMissingKm: 7, alreadyIncludedKm: 5, approvalMissingKm: 2,
  });
  assert.equal(calculateIncrementalMissingKm(7, { alreadyIncludedKm: 9 }).approvalMissingKm, 0);
});

test('removing the runtime hold does not bypass database gates, approvals, or stale-state rejection', async () => {
  for (const [code, message, expectedStatus] of [
    ['55000', 'km_v2_database_financial_writes_closed', 503],
    ['55000', 'km_v2_financial_approval_required', 409],
    ['40001', 'km_v2_stale_input_digest', 409],
  ]) {
    const { client, attendance, rows } = fixture();
    const before = structuredClone(rows);
    let rpcCalls = 0;
    client.rpc = async () => {
      rpcCalls += 1;
      return { data: null, error: { code, message } };
    };
    await assert.rejects(recalculateFoKm(client, { attendance_id: attendance.id }, {
      refreshMissingKmReviews: false, maxGoogleDirectionsCalls: 0,
      environment: { KM_FINANCIAL_WRITES_MAINTENANCE: 'false' },
    }), (error) => error.statusCode === expectedStatus && error.message === message);
    assert.equal(rpcCalls, 1);
    assert.deepEqual(rows, before);
  }
});

test('15 returned failure results cannot be counted as successful updates', async () => {
  const { attendance } = fixture();
  const result = await recalculateEmployeeRange({
    attendances: Array.from({ length: 15 }, (_, i) => ({ ...attendance, id: `test-${i}` })),
    recalculate: async () => ({ ok: false, code: 'KM_FINANCIAL_WRITES_MAINTENANCE', statusCode: 503, retryable: true }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'complete_failure');
  assert.equal(result.updated, 0);
  assert.equal(result.failed, 15);
  assert.ok(result.results.every((row) => row.error_status === 503 && row.retryable));
});

test('HTTP range route preserves non-200 handling for complete failures', () => {
  const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const route = server.slice(server.indexOf("app.post('/api/fo/km/recalculate-employee-range'"));
  assert.match(route, /result.outcome === 'complete_failure'\s*\? hasServerFailure \? 503 : 422/);
  assert.match(route, /response.status\(status\).json\(result\)/);
});

const admin = { auth_user_id: 'test-admin-user', employee_code: 'TEST-ADMIN', full_name: 'Test Admin', role: 'Admin' };
function pendingReviewFixture() {
  const data = fixture();
  Object.assign(data.rows.fo_missing_km_reviews[0], {
    status: 'pending', approved_missing_km: 0, approved_amount: 0,
    employee_code: 'TEST-FO', rate_per_km: 4, suggested_missing_km: 2,
    updated_at: '2026-10-10T05:00:00Z', metadata: { incremental_determination: 'defensible' },
  });
  return data;
}

test('Missing KM persistence failure leaves review and attendance untouched in JS', async () => {
  for (const [code, message, status] of [
    ['40001', 'km_v2_stale_input_digest', 409],
    ['40001', 'km_v2_missing_review_base_changed', 409],
    ['55000', 'km_v2_final_leg_evidence_unresolved', 409],
    ['XX000', 'transaction failed', 500],
  ]) {
    const { client, rows } = pendingReviewFixture();
    const before = structuredClone(rows);
    const calls = [];
    client.rpc = async (name, args) => {
      calls.push({ name, args });
      assert.equal(name, 'rpc_approve_fo_missing_km_v1');
      assert.equal(args.p_admin_user_id, admin.auth_user_id);
      assert.equal(args.p_review_id, 'previously-approved');
      assert.equal(args.p_approved_km, 2);
      return { data: null, error: { code, message } };
    };
    await assert.rejects(decideMissingKmReview(client, 'previously-approved', 'approve', {
      approved_missing_km: 2, remarks: 'Verified incremental travel',
    }, admin), (error) => error.statusCode === status);
    assert.equal(calls.length, 1);
    assert.deepEqual(rows, before);
  }
});

test('explicit Admin correction uses the existing engine and service-only approval RPC with the legacy hold active', async () => {
  const { client, attendance } = fixture();
  let calls = 0;
  client.rpc = async (name, args) => {
    calls += 1;
    assert.equal(name, 'rpc_apply_fo_admin_km_correction_v1');
    assert.equal(args.p_admin_user_id, admin.auth_user_id);
    assert.equal(args.p_review_decision, null);
    assert.equal(args.p_source_entry_point, 'admin_correction');
    assert.equal(args.p_approval_reason, 'Verified correction');
    assert.equal(args.p_calculation.approvedMissingKm, 1.25);
    return { data: { ok: true, payable_km: args.p_calculation.payableKm,
      reimbursement: args.p_calculation.reimbursement, calculation_run_id: 'test-run' }, error: null };
  };
  await recalculateFoKm(client, { attendance_id: attendance.id }, {
    adminAuthorization: { userId: admin.auth_user_id, reason: 'Verified correction' },
    environment: { KM_FINANCIAL_WRITES_MAINTENANCE: 'true' }, maxGoogleDirectionsCalls: 0,
  });
  assert.equal(calls, 1);
});

test('Missing KM reaches only its dedicated guarded approval RPC under both legacy holds', async () => {
  const { client, rows } = pendingReviewFixture();
  const priorHold = process.env.KM_FINANCIAL_WRITES_MAINTENANCE;
  const priorEmergency = process.env.KM_FINANCIAL_WRITES_EMERGENCY_PAUSE;
  let calls = 0;
  client.rpc = async (name, args) => {
    calls += 1;
    assert.equal(name, 'rpc_approve_fo_missing_km_v1');
    assert.equal(args.p_approved_km, 2);
    return { data: { ok: true, review: { ...rows.fo_missing_km_reviews[0], status: 'approved' },
      receipt_id:'test-receipt',payable_km: 41, reimbursement: 164,additionalKm:2,additionalAmount:8 }, error: null };
  };
  try {
    process.env.KM_FINANCIAL_WRITES_MAINTENANCE = 'true';
    process.env.KM_FINANCIAL_WRITES_EMERGENCY_PAUSE = 'false';
    const result = await decideMissingKmReview(client, 'previously-approved', 'approve', { approved_missing_km: 2,remarks:'Verified missing increment' }, admin);
    assert.equal(result.review.status, 'approved');
    assert.equal(calls, 1);
    process.env.KM_FINANCIAL_WRITES_EMERGENCY_PAUSE = 'true';
    await decideMissingKmReview(client, 'previously-approved', 'approve', { approved_missing_km: 2,remarks:'Verified missing increment' }, admin);
    assert.equal(calls, 2);
  } finally {
    for (const [key, value] of [['KM_FINANCIAL_WRITES_MAINTENANCE', priorHold], ['KM_FINANCIAL_WRITES_EMERGENCY_PAUSE', priorEmergency]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('duplicate approval returns committed receipt without loading GPS or writing again', async () => {
  const { client, rows } = pendingReviewFixture();
  const review = rows.fo_missing_km_reviews[0];
  Object.assign(review, { status: 'approved', approved_missing_km: 2, approved_amount: 8,
    metadata: { atomic_approval_input_digest: 'a'.repeat(64), atomic_approval_calculation_run_id: 'test-run' } });
  const load = client.from.bind(client);
  client.from = (table) => { assert.equal(table, 'fo_missing_km_reviews'); return load(table); };
  let calls = 0;
  client.rpc = async (name, args) => {
    calls += 1;
    assert.equal(name, 'rpc_approve_fo_missing_km_v1');
    assert.equal(args.p_approved_km, 2);
    return { data: { review,receipt_id:'test-receipt',idempotent_replay: true, payable_km: 12, reimbursement: 48,additionalKm:0,additionalAmount:0 }, error: null };
  };
  assert.equal((await decideMissingKmReview(client, review.id, 'approve', { approved_missing_km: 2,remarks:'Receipt retry' }, admin)).no_change, true);
  await assert.rejects(decideMissingKmReview(client, review.id, 'approve', { approved_missing_km: 3 }, admin),
    (error) => error.statusCode === 409);
  assert.equal(calls, 1);
});

test('approval requires authenticated Admin and rejects self-approval before any RPC', async () => {
  for (const actor of [{ ...admin, employee_code: 'TEST-FO' }, { ...admin, auth_user_id: null }, { ...admin, role: 'FO' }]) {
    const { client } = pendingReviewFixture();
    client.rpc = () => { throw new Error('Unauthorized RPC'); };
    await assert.rejects(decideMissingKmReview(client, 'previously-approved', 'approve', { approved_missing_km: 2 }, actor),
      (error) => error.statusCode === 403);
  }
  assert.equal(adminKmApprovalAuthorization({ is_active: true, role: 'Admin' }, { id: 'jwt-user' }, 'Correction').userId, 'jwt-user');
  assert.throws(() => adminKmApprovalAuthorization({ is_active: true, role: 'FO' }, { id: 'jwt-user' }, 'Correction'),
    (error) => error.statusCode === 403);
});

test('a committed Missing KM approval cannot be rejected through the nonfinancial review action', async () => {
  const { client, rows } = pendingReviewFixture();
  Object.assign(rows.fo_missing_km_reviews[0], { status: 'approved', approved_missing_km: 2, approved_amount: 8 });
  const before = structuredClone(rows);
  client.rpc = () => { throw new Error('Unexpected financial call'); };
  await assert.rejects(decideMissingKmReview(client, 'previously-approved', 'reject', { remarks: 'Changed decision' }, admin),
    (error) => error.statusCode === 409);
  assert.deepEqual(rows, before);
});

test('forward final-leg persistence retains legacy hold compatibility and honors emergency pause', async () => {
  let calls = 0;
  const client = { rpc: async (name) => { calls += 1; assert.equal(name, 'rpc_persist_fo_forward_final_leg_v1'); return { data: {}, error: null }; } };
  const input = { attendanceId: 'test-attendance', expectedAttendanceUpdatedAt: '2026-10-10T05:00:00Z',
    calculation: { calculationVersion: 'KM_ENGINE_V2', inputDigest: 'a'.repeat(64) },
    environment: { KM_FINANCIAL_WRITES_MAINTENANCE: 'true' } };
  await persistForwardFinalLeg(client, input);
  await assert.rejects(persistForwardFinalLeg(client, { ...input,
    environment: { ...input.environment, KM_FINANCIAL_WRITES_EMERGENCY_PAUSE: 'true' } }), (error) => error.statusCode === 503);
  assert.equal(calls, 1);
});

test('SQL approval transaction retains canonical checks and never toggles the global gate', () => {
  const sql = readFileSync(new URL('../../supabase/migrations_2_0/228_fo_atomic_admin_km_approval.sql', import.meta.url), 'utf8');
  assert.match(sql, /before_total_route_km = round/);
  assert.match(sql, /not exists \(select 1 from public.fo_km_financial_approval_consumptions/);
  assert.match(sql, /review.updated_at is distinct from/);
  assert.match(sql, /km_v2_missing_review_base_changed/);
  assert.match(sql, /km_v2_self_approval_forbidden/);
  assert.match(sql, /revoke all on function.*from public, anon, authenticated/);
  assert.doesNotMatch(sql, /update\s+public.fo_km_financial_control|exception\s+when/i);
  const wrapper = sql.slice(sql.indexOf('create function public.rpc_apply_fo_admin_km_correction_v1'));
  assert.ok(wrapper.indexOf("set status = 'approved'") < wrapper.indexOf('result := public.rpc_persist_fo_canonical_km_v2'));
  assert.match(sql, /Migration 228: canonical definition drift/);
});

test('GPS worker is optional, bounded, evidence-only and single-flight', async () => {
  assert.equal(startFoGpsEvidenceSummaryWorker({}, {}), null);
  let tick;
  let release;
  let calls = 0;
  const pending = new Promise((resolve) => { release = resolve; });
  startFoGpsEvidenceSummaryWorker({ rpc: async (name, args) => {
    assert.equal(name, 'rpc_refresh_fo_gps_evidence_summaries_v1');
    assert.equal(args.p_limit, 5);
    calls += 1; await pending; return { data: { failed: 0 }, error: null };
  } }, { FO_GPS_EVIDENCE_REFRESH_ENABLED: 'true' }, {
    schedule: (callback, interval) => { tick = callback; assert.equal(interval, 60_000); return { unref() {} }; },
  });
  const first = tick(); await tick(); assert.equal(calls, 1);
  release(); await first; await tick(); assert.equal(calls, 2);
  const sql = readFileSync(new URL('../../supabase/migrations_2_0/229_fo_coalesced_gps_evidence_summary.sql', import.meta.url), 'utf8');
  assert.match(sql, /for each statement/);
  assert.match(sql, /skip locked/);
  assert.match(sql, /for update nowait/);
  assert.match(sql, /perform public.refresh_fo_attendance_actual_travel_km/);
  assert.doesNotMatch(sql, /set\s+(total_approved_km|eligible_km|petrol_amount)|rpc_persist_fo/i);
});
