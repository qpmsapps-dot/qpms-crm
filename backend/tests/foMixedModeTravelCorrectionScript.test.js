import assert from 'node:assert/strict';
import test from 'node:test';
import {
  correctionImpact,
  correctionKey,
  eligibleCorrectionRows,
} from '../scripts/applySeptemberMixedModeTravelCorrections.js';
import fs from 'node:fs';

function report(rows) {
  return {
    project_ref: 'ubawkjdbtickdlrgkulz',
    date_range: { from: '2026-09-01', to: '2026-09-29' },
    rows,
  };
}

test('only changed HIGH and MEDIUM September rows are eligible', () => {
  const rows = eligibleCorrectionRows(report([
    { attendance_id: 'a', attendance_date: '2026-09-01', correction_confidence: 'HIGH', original_distance_reimbursement: 40, corrected_distance_reimbursement: 20, difference: -20 },
    { attendance_id: 'b', attendance_date: '2026-09-02', correction_confidence: 'MEDIUM', original_distance_reimbursement: 0, corrected_distance_reimbursement: 32, difference: 32 },
    { attendance_id: 'c', attendance_date: '2026-09-03', correction_confidence: 'LOW', original_distance_reimbursement: 80, corrected_distance_reimbursement: null, difference: null },
    { attendance_id: 'd', attendance_date: '2026-09-04', correction_confidence: 'HIGH', original_distance_reimbursement: 16, corrected_distance_reimbursement: 16, difference: 0 },
  ]));
  assert.deepEqual(rows.map((row) => row.attendance_id), ['a', 'b']);
});

test('financial impact separates reductions and increases', () => {
  assert.deepEqual(correctionImpact([
    { original_distance_reimbursement: 40, corrected_distance_reimbursement: 20 },
    { original_distance_reimbursement: 0, corrected_distance_reimbursement: 32 },
  ]), { records: 2, original: 40, corrected: 52, reduction: 20, increase: 32, net: 12 });
});

test('correction key is stable for idempotent reruns', () => {
  const row = { attendance_id: 'attendance-1', attendance_date: '2026-09-29' };
  assert.equal(correctionKey(row), correctionKey(row));
  assert.equal(correctionKey(row), 'fo-mixed-mode-v1:attendance-1:2026-09-29');
});

test('applied audit rows are read before any correction insert on rerun', () => {
  const source = fs.readFileSync(
    new URL('../scripts/applySeptemberMixedModeTravelCorrections.js', import.meta.url),
    'utf8',
  );
  const existingLookup = source.indexOf(".eq('correction_key', key)");
  const insert = source.indexOf('.insert(payload)');
  assert.ok(existingLookup >= 0);
  assert.ok(insert > existingLookup);
  assert.match(source, /if \(existing\) return existing;/);
});

test('wrong project or period fails closed', () => {
  assert.throws(() => eligibleCorrectionRows({ ...report([]), project_ref: 'wrong' }), /project_ref/);
  assert.throws(() => eligibleCorrectionRows({ ...report([]), date_range: { from: '2026-09-01', to: '2026-09-30' } }), /date range/);
});
