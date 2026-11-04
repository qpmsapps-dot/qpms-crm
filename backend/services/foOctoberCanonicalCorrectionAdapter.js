// Canonical posting adapter: does not call the database or change financial gates.
// The backend must independently authenticate the admin and generate calculation/digest.
const SHA256 = /^[a-f0-9]{64}$/;
const OCTOBER = /^2026-10-(0[1-9]|[12][0-9]|3[01])$/;
export function buildOctoberCanonicalCorrectionRequest({
  attendance, calculation, inputDigest, adminUserId, actorSource,
  reason, evidenceReferences, reviewDecision = null,
}) {
  if (!attendance || !attendance.id || !OCTOBER.test(attendance.attendance_date || '')) {
    throw new Error('OCTOBER_ATTENDANCE_REQUIRED');
  }
  if (!attendance.updated_at || !adminUserId) throw new Error('AUTHORITATIVE_CONTEXT_REQUIRED');
  if (!SHA256.test(inputDigest || '') || !calculation ||
      calculation.calculationVersion !== 'KM_ENGINE_V2' ||
      calculation.inputDigest !== inputDigest ||
      !Number.isFinite(Number(calculation.payableKm)) ||
      !Number.isFinite(Number(calculation.reimbursement))) {
    throw new Error('SERVER_CALCULATION_REQUIRED');
  }
  if (!['admin_correction', 'missing_km_approval'].includes(reviewDecision ? 'missing_km_approval' : 'admin_correction')) {
    throw new Error('INVALID_SOURCE');
  }
  if (!String(reason || '').trim() || !Array.isArray(evidenceReferences) ||
      evidenceReferences.length === 0 ||
      evidenceReferences.some(x => typeof x !== 'string' || x.trim().length < 8)) {
    throw new Error('CORRECTION_EVIDENCE_REQUIRED');
  }
  if (typeof actorSource !== 'string' || !actorSource.trim()) throw new Error('ACTOR_SOURCE_REQUIRED');
  return {
    functionName: 'rpc_apply_fo_admin_km_correction_v1',
    args: {
      p_attendance_id: attendance.id,
      p_input_digest: inputDigest,
      p_expected_attendance_updated_at: attendance.updated_at,
      p_calculation: calculation,
      p_source_entry_point: reviewDecision ? 'missing_km_approval' : 'admin_correction',
      p_actor_source: actorSource,
      p_admin_user_id: adminUserId,
      p_approval_reason: reason.trim() + ' | evidence: ' + evidenceReferences.join(', '),
      p_review_decision: reviewDecision,
    },
    readyForPosting: false,
    requires: ['AUTHENTICATED_BACKEND', 'CURRENT_SERVER_CALCULATION', 'OPEN_FINANCIAL_GATE', 'CANONICAL_RECEIPT_CHECK'],
  };
}
