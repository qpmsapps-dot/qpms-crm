import assert from 'node:assert/strict';
import test from 'node:test';
import { runSupportedKmBatch, validateSupportedBatchSelection } from '../services/foKmSupportedBatchService.js';

const environment = {
  KM_SHARED_RECONCILIATION_ENABLED: 'true',
  KM_INCREMENTAL_REPORTING_ENABLED: 'true',
};
const adminAuthorization = { userId: 'test-admin', reason: 'Explicit selected-period evidence reconciliation' };
const attendance = [
  { id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', employee_code: 'FO-1', fo_user_id: 'p1', attendance_date: '2026-11-01', status: 'Completed', logout_time: '2026-11-01T18:00:00Z' },
  { id: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb', employee_code: 'FO-2', fo_user_id: 'p2', attendance_date: '2026-11-01', status: 'Completed', logout_time: '2026-11-01T18:00:00Z' },
  { id: 'cccccccc-cccc-4ccc-cccc-cccccccccccc', employee_code: 'FO-3', fo_user_id: 'p3', attendance_date: '2026-11-02', status: 'Completed', logout_time: '2026-11-02T18:00:00Z' },
  { id: 'dddddddd-dddd-4ddd-dddd-dddddddddddd', employee_code: 'FO-4', fo_user_id: 'p4', attendance_date: '2026-11-01', status: 'Active', logout_time: null },
];
const profiles = [
  { id: 'p1', employee_code: 'FO-1', state: 'TN', business: 'Retail' },
  { id: 'p2', employee_code: 'FO-2', state: 'KL', business: 'Retail' },
  { id: 'p3', employee_code: 'FO-3', state: 'TN', business: 'Retail' },
  { id: 'p4', employee_code: 'FO-4', state: 'TN', business: 'Retail' },
];
function fixture() {
  const calls = [];
  class Query {
    constructor(table) { this.table = table; this.rows = [...(table === 'fo_attendance' ? attendance : profiles)]; }
    select() { return this; }
    eq(column, value) { this.rows = this.rows.filter(r => r[column] === value); return this; }
    gte(column, value) { this.rows = this.rows.filter(r => r[column] >= value); return this; }
    lte(column, value) { this.rows = this.rows.filter(r => r[column] <= value); return this; }
    not(column, operator, value) { if (operator === 'is' && value === null) this.rows = this.rows.filter(r => r[column] != null); return this; }
    ilike(column, value) { this.rows = this.rows.filter(r => String(r[column]).toLowerCase() === String(value).toLowerCase()); return this; }
    order(column, opts = {}) { this.rows.sort((a,b) => String(a[column]).localeCompare(String(b[column])) * (opts.ascending === false ? -1 : 1)); return this; }
    limit(count) { this.rows = this.rows.slice(0, count); return this; }
    range(from, to) { this.rows = this.rows.slice(from, to + 1); return this; }
    or(expression) {
      if (expression.startsWith('attendance_date.gt.')) {
        const match = expression.match(/^attendance_date\.gt\.(\d{4}-\d\d-\d\d),and\(attendance_date\.eq\.(\d{4}-\d\d-\d\d),id\.gt\.([0-9a-f-]+)\)$/);
        assert.ok(match, expression);
        this.rows = this.rows.filter(r => r.attendance_date > match[1] || (r.attendance_date === match[2] && r.id > match[3]));
      } else {
        const codes = [...expression.matchAll(/employee_code\.in\.\(([^)]*)\)/g)].flatMap(m => [...m[1].matchAll(/"([^"]+)"/g)].map(v=>v[1]));
        const ids = [...expression.matchAll(/fo_user_id\.in\.\(([^)]*)\)/g)].flatMap(m => [...m[1].matchAll(/"([^"]+)"/g)].map(v=>v[1]));
        this.rows = this.rows.filter(r => codes.includes(r.employee_code) || ids.includes(r.fo_user_id));
      }
      return this;
    }
    then(resolve, reject) { return Promise.resolve({ data: this.rows, error: null }).then(resolve,reject); }
  }
  return { calls, client: { from(table) { assert.ok(['fo_attendance', 'profiles'].includes(table)); calls.push(table); return new Query(table); } } };
}

test('period, page size, and request mode are strictly validated', () => {
  assert.throws(() => validateSupportedBatchSelection({ date: '2026-02-30' }), /valid period/);
  assert.throws(() => validateSupportedBatchSelection({ fromDate: '2026-11-03', toDate: '2026-11-01' }), /valid period/);
  assert.throws(() => validateSupportedBatchSelection({ fromDate: '2026-10-01', toDate: '2026-11-03' }), /at most 31 days/);
  assert.throws(() => validateSupportedBatchSelection({ date: '2026-11-01', batchSize: 50 }), /between 1 and 10/);
  assert.throws(() => validateSupportedBatchSelection({ date: '2026-11-01', dryRun: 'false' }), /must be a boolean/);
});

test('no authorized Admin or inactive feature flag means no database access', async () => {
  const f = fixture();
  await assert.rejects(runSupportedKmBatch(f.client, { date: '2026-11-01' }, { environment }), /Authenticated Admin/);
  await assert.rejects(runSupportedKmBatch(f.client, { date: '2026-11-01' }, { adminAuthorization, environment: {} }), /inactive/);
  assert.equal(f.calls.length, 0);
});

test('one-day bulk paginates all completed attendances and preserves immutable credits on replay', async () => {
  const f = fixture();
  const credited = new Set();
  const reconcile = async (_client, { attendance_id }, options) => {
    assert.equal(options.persist, true);
    if (credited.has(attendance_id)) return { status: 'unchanged', financial_posted: false, additionalKm: 0, additionalAmount: 0 };
    credited.add(attendance_id);
    return { status: 'posted', financial_posted: true, receipt_id: attendance_id,
      additionalKm: 2, additionalAmount: 8 };
  };
  const first = await runSupportedKmBatch(f.client, { date: '2026-11-01', batchSize: 1 }, { environment, adminAuthorization, reconcile });
  assert.equal(first.processed, 1);
  assert.equal(first.updated, 1);
  assert.equal(first.creditedKm, 2);
  assert.ok(first.nextCursor);
  const second = await runSupportedKmBatch(f.client, { date: '2026-11-01', batchSize: 1, cursor: first.nextCursor }, { environment, adminAuthorization, reconcile });
  assert.equal(second.processed, 1);
  assert.equal(second.updated, 1);
  assert.equal(second.done, true);
  const replay = await runSupportedKmBatch(f.client, { date: '2026-11-01', batchSize: 1 }, { environment, adminAuthorization, reconcile });
  assert.equal(replay.updated, 0);
  assert.equal(replay.creditedKm, 0);
  assert.equal(replay.skipped, 1);
  assert.equal(credited.size, 2);
  await assert.rejects(runSupportedKmBatch(f.client, {
    date: '2026-11-02', batchSize: 1, cursor: first.nextCursor,
  }, { environment, adminAuthorization, reconcile }), /does not match the selected filters/);
});

test('preview never calls financial persistence, and state scope selects only matching profiles', async () => {
  const f = fixture();
  const seen = [];
  const reconcile = async (_client, payload, options) => {
    assert.equal(options.persist, false);
    seen.push(payload.attendance_id);
    return { status: 'calculated_not_posted', financial_posted: false, additionalKm: 3, additionalAmount: 12 };
  };
  const result = await runSupportedKmBatch(f.client, {
    date: '2026-11-01', state: 'TN', business: 'Retail', dryRun: true,
  }, { environment, adminAuthorization, reconcile });
  assert.deepEqual(seen, [attendance[0].id]);
  assert.equal(result.previewed, 1);
  assert.equal(result.updated, 0);
  assert.equal(result.creditedKm, 0);
  assert.equal(result.mode, 'preview');
});

test('deferred and failed results are not counted as posted credits', async () => {
  const f = fixture();
  let n = 0;
  const result = await runSupportedKmBatch(f.client, { date: '2026-11-01' }, {
    environment, adminAuthorization,
    reconcile: async () => ++n === 1
      ? { status: 'deferred', financial_posted: false, additionalKm: 5 }
      : Promise.reject(Object.assign(new Error('database offline'), { code: 'PG_FAILED' })),
  });
  assert.equal(result.processed, 2);
  assert.equal(result.updated, 0);
  assert.equal(result.deferred, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.creditedKm, 0);
});

test('unverified posting response is never treated as financial success', async () => {
  const f = fixture();
  const result = await runSupportedKmBatch(f.client, { date: '2026-11-01', batchSize: 1 }, {
    environment, adminAuthorization,
    reconcile: async () => ({ status: 'posted', financial_posted: true, additionalKm: 100, additionalAmount: 400 }),
  });
  assert.equal(result.updated, 0);
  assert.equal(result.failed, 1);
  assert.equal(result.creditedKm, 0);
  assert.equal(result.results[0].code, 'KM_POSTING_RECEIPT_MISSING');
});
