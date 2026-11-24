import test from 'node:test';
import assert from 'node:assert/strict';
import { attendancePendingKey, readPendingAttendance, savePendingAttendance, submitAttendanceOnce, checkAttendanceCommit } from '../src/utils/retailAttendanceCommit.js';
const batch = { id: 'batch', preview_key: 'review-key' };
test('timeout followed by committed receipt confirms success without a second POST', async () => {
  const calls = [];
  const result = await submitAttendanceOnce(async (path, config) => { calls.push([path, config]); if (config.method === 'POST') throw Error('timeout of 60000ms exceeded'); return { ...batch, status: 'committed', writer_busy: false }; }, batch, { replace: true, reason: 'Verified' });
  assert.equal(result.status, 'committed'); assert.equal(calls.filter(([, c]) => c.method === 'POST').length, 1); assert.equal(calls.length, 2);
});
test('busy preview and unavailable status never become success or trigger repeated inserts', async () => {
  let posts = 0;
  const result = await submitAttendanceOnce(async (_, c) => { if (c.method === 'POST') { posts++; throw Error('Lost reply'); } return { ...batch, status: 'preview', writer_busy: true }; }, batch, { replace: false });
  assert.equal(result.status, 'preview'); assert.equal(result.writer_busy, true); assert.equal(posts, 1);
  await assert.rejects(() => submitAttendanceOnce(async () => { throw Error('Network down'); }, batch, { replace: false }), /status remains unconfirmed/);
  await assert.rejects(() => checkAttendanceCommit(async () => ({ id: 'foreign', status: 'committed', writer_busy: false }), batch), /could not be verified/);
});
test('pending receipt survives reload, contains no workbook/employee data and is isolated by actor/module', () => {
  const values = new Map(), storage = { getItem: k => values.get(k), setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) };
  const key = attendancePendingKey('actor', 'imports'); savePendingAttendance(storage, key, { ...batch, employee: 'private', raw_source: 'private' });
  assert.deepEqual(readPendingAttendance(storage, key), batch); assert.equal(values.get(key).includes('private'), false);
  assert.equal(readPendingAttendance(storage, attendancePendingKey('other', 'imports')), null);
  assert.equal(readPendingAttendance(storage, attendancePendingKey('actor', 'attendance-mepc')), null);
  savePendingAttendance(storage, key, null); assert.equal(readPendingAttendance(storage, key), null);
});
test('known rejected stale preview requires revalidation, never misleading pending status or repeat POST', async()=>{
  let calls=0;
  await assert.rejects(()=>submitAttendanceOnce(async()=>{calls++;throw {response:{data:{code:'ATTENDANCE_PREVIEW_STALE',outcome:'not_committed',message:'Review original workbook again'}}};},batch,{replace:true,reason:'Verified'}),e=>e.requires_preview===true);
  assert.equal(calls,1);
});
