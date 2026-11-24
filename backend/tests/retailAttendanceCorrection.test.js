import test from 'node:test';
import assert from 'node:assert/strict';
import XLSX from 'xlsx';
import { previewRetailAttendance } from '../services/retailAttendanceService.js';
import { commitMisAttendance, misAttendanceStatus } from '../services/retailAttendanceCommitService.js';
const profile = { id: 'actor', role: 'ADMIN', is_active: true }, store = { id: 's1', store_code: '001', state: 'AP-1', status: 'Active' };
function workbook(count = 2468) {
  const b = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(b, XLSX.utils.aoa_to_sheet([
    ['EP No','EP Name','Site Code','Att. Date','Att. Status','Class'],
    ...Array.from({ length: count }, (_, i) => [`E${i}`, 'Synthetic employee', '001', '2026-11-01', i % 2 ? 'P' : 'HD', i % 2 ? 'MEPC' : 'House Keeping']),
  ]), 'Attendance'); return XLSX.write(b, { type: 'buffer', bookType: 'xlsx', compression: true });
}
const conflicts = n => Array.from({ length: n }, (_, i) => ({ id: `conflict-${i}`, employee_code: `E${i}`, attendance_date: '2026-11-01', retail_store_id: 's1', class: i % 2 ? 'MEPC' : 'HK', credit: i % 2 ? 1 : 0.5 }));
function database(snapshot) {
  const writes = [], calls = [];
  return { writes, calls, from(table) { const q = { select() { return q; }, order() { return q; }, eq() { return q; }, range: async () => ({ data: [store] }),
    maybeSingle: async () => ({ data: null }), insert(value) { writes.push(value); return q; }, single: async () => ({ data: { id: 'preview' } }) };
    assert.ok(['reliance_retail_store_master', 'retail_attendance_uploads'].includes(table)); return q; },
    async rpc(name, args) { calls.push([name, args]); assert.equal(name, 'rpc_retail_attendance_conflict_snapshot'); return { data: snapshot }; } };
}
test('preview persists every conflict beyond 1000; original class/credit/source and full expected IDs retained', async () => {
  const records = conflicts(2446), db = database({ count: 2446, records });
  const result = await previewRetailAttendance(db, profile, workbook(), 'correction.xlsx', { log() {} });
  assert.equal(result.affected_record_count, 2446); assert.equal(result.affected_records.length, 2446); assert.equal(result.conflict_snapshot_complete, true);
  assert.equal(result.valid_rows, 2468); assert.equal(result.rejected_rows, 0); assert.equal(db.writes.length, 1);
  assert.deepEqual(db.writes[0].expected_ids, records.map(r => r.id).sort()); assert.equal(db.writes[0].payload.length, 2468);
  assert.equal(db.writes[0].payload[0].credit, 0.5); assert.equal(db.writes[0].payload[0].class, 'HK'); assert.equal(db.writes[0].payload[1].class, 'MEPC');
  assert.equal(db.writes[0].raw_source.encoding, 'retail-attendance-gzip-json-v1');
});
test('truncated, duplicate, oversized or malformed snapshots cannot create an import preview', async () => {
  for (const snapshot of [{ count: 2446, records: conflicts(1000) }, { count: 2, records: [conflicts(1)[0], conflicts(1)[0]] }, { count: 100001, records: conflicts(100001) }, {count:1,records:[null]}, {count:1,records:[{}]}, [], null]) {
    const db = database(snapshot); await assert.rejects(() => previewRetailAttendance(db, profile, workbook(2), 'fixture.xlsx', { log() {} }), { statusCode: 413 }); assert.equal(db.writes.length, 0);
  }
});
test('full conflict snapshot exposes foreign-state employee/day conflict before any preview is saved', async () => {
  const records = conflicts(1001); records[1000].retail_store_id = 'foreign-state-store';
  const db = database({ count: records.length, records });
  const mis = { ...profile, role: 'CENTRAL_MIS', _retailMis: { role: 'CENTRAL_MIS', states: [], active: true }, _retailMisModule: 'imports' };
  await assert.rejects(() => previewRetailAttendance(db, mis, workbook(), 'fixture.xlsx', { log() {} }), { statusCode: 403 }); assert.equal(db.writes.length, 0);
});
test('commit calls existing RPC once with verified actor and carries cancellation; no automatic retry', async () => {
  let signal, calls = 0;
  const client = { rpc(name, args) { calls++; assert.equal(name, 'rpc_retail_mis_attendance_commit'); assert.equal(args.p_actor, profile.id);
    return { abortSignal(s) { signal = s; return Promise.resolve({ data: 'batch' }); } }; } };
  assert.equal(await commitMisAttendance(client, profile, { id: 'batch', preview_key: 'key', replace: true, reason: 'Verified correction', p_actor: 'spoofed' }, { log() {} }), 'batch');
  assert.equal(calls, 1); assert.ok(signal instanceof AbortSignal);
  await assert.rejects(() => commitMisAttendance(client, profile, { id: 'batch', preview_key: 'key', replace: true, reason: '' }), { statusCode: 400 }); assert.equal(calls, 1);
});
test('lock/stale/cancel errors are explicit; transport failure never asserts rollback or completion', async () => {
  for (const [code, http, outcome] of [['55P03',409,'not_committed'],['40001',409,'not_committed'],['57014',503,'not_committed'],['42501',403,'not_committed'],['PGRST003',503,'unconfirmed']]) {
    const client = { rpc: async () => ({ error: { code, message: 'PRIVATE DATABASE DETAILS' } }) };
    await assert.rejects(() => commitMisAttendance(client, profile, { id: 'batch', preview_key: 'key', replace: false }, { log() {} }), e => e.statusCode === http && e.outcome === outcome && !e.message.includes('PRIVATE'));
  }
  let args;
  const client = { rpc: async (name, input) => { assert.equal(name, 'rpc_retail_mis_attendance_status'); args = input; return { data: { id: 'batch', status: 'preview', writer_busy: true } }; } };
  assert.equal((await misAttendanceStatus(client, profile, { id: 'batch', preview_key: 'key' }, { log() {} })).writer_busy, true); assert.equal(args.p_actor, profile.id);
});
