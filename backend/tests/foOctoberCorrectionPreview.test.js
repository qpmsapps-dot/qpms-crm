import test from 'node:test';
import assert from 'node:assert/strict';
import { previewOctoberCorrection } from '../services/foOctoberCorrectionPreview.js';
const base = {
  attendanceId: 'attendance-123', employeeCode: 'QPMSKL1403', attendanceDate: '2026-10-01',
  savedKm: 208.06, savedPetrol: 832.24,
  verifiedAddKm: 0, verifiedRemoveKm: 199.09, correctedPetrol: 35.88,
  reason: 'Verified train-mode correction',
  evidenceReferences: ['travel-leg-123456'],
};
test('previews full-journey deduction without deleting legitimate journey', () => {
  const x = previewOctoberCorrection(base);
  assert.equal(x.correctedKm, 8.97);
  assert.equal(x.correctedPetrol, 35.88);
  assert.equal(x.petrolDelta, -796.36);
  assert.equal(x.status, 'PREVIEW_ONLY_NOT_POSTED');
});
test('previews verified missing KM addition', () => {
  const x = previewOctoberCorrection({...base, verifiedAddKm: 3.37, verifiedRemoveKm: 0, correctedPetrol: 845.72});
  assert.equal(x.correctedKm, 211.43);
  assert.equal(x.petrolDelta, 13.48);
});
test('rejects unsupported, out-of-month and negative adjustments', () => {
  assert.throws(() => previewOctoberCorrection({...base, attendanceDate: '2026-11-01'}));
  assert.throws(() => previewOctoberCorrection({...base, verifiedRemoveKm: 209}));
  assert.throws(() => previewOctoberCorrection({...base, verifiedRemoveKm: -1}));
  assert.throws(() => previewOctoberCorrection({...base, verifiedRemoveKm: 0}));
  assert.throws(() => previewOctoberCorrection({...base, evidenceReferences: []}));
  assert.throws(() => previewOctoberCorrection({...base, savedPetrol: null}));
});
