import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOctoberCanonicalCorrectionRequest } from '../services/foOctoberCanonicalCorrectionAdapter.js';

const digest = 'a'.repeat(64);
const request = {
  attendance: { id: 'a-valid-uuid-in-real-use', attendance_date: '2026-10-21', updated_at: '2026-10-21T15:00:00Z' },
  calculation: { calculationVersion: 'KM_ENGINE_V2', inputDigest: digest, payableKm: 42.51, reimbursement: 170.04 },
  inputDigest: digest,
  adminUserId: 'admin-uuid-from-backend',
  actorSource: 'web',
  reason: 'GPS evidence confirms payable distance',
  evidenceReferences: ['gps-evidence-001'],
};
test('maps correction to existing canonical RPC and refuses automatic posting', () => {
  const result = buildOctoberCanonicalCorrectionRequest(request);
  assert.equal(result.functionName, 'rpc_apply_fo_admin_km_correction_v1');
  assert.equal(result.args.p_source_entry_point, 'admin_correction');
  assert.equal(result.args.p_input_digest, digest);
  assert.equal(result.readyForPosting, false);
});
test('maps missing KM to review decision source', () => {
  const result = buildOctoberCanonicalCorrectionRequest({ ...request, reviewDecision: {reviewId:'review-uuid'} });
  assert.equal(result.args.p_source_entry_point, 'missing_km_approval');
});
test('rejects stale or untrusted context', () => {
  assert.throws(() => buildOctoberCanonicalCorrectionRequest({ ...request, attendance: {...request.attendance,attendance_date:'2026-11-01'} }));
  assert.throws(() => buildOctoberCanonicalCorrectionRequest({ ...request, inputDigest:'not-a-digest' }));
  assert.throws(() => buildOctoberCanonicalCorrectionRequest({ ...request, calculation:{...request.calculation,inputDigest:'b'.repeat(64)} }));
  assert.throws(() => buildOctoberCanonicalCorrectionRequest({ ...request, evidenceReferences:[] }));
  assert.throws(() => buildOctoberCanonicalCorrectionRequest({ ...request, adminUserId:null }));
});
