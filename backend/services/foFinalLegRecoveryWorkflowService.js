import { createHash } from 'node:crypto';

import {
  persistFinalLegEvidenceReconciliation,
  prepareFinalLegEvidenceReconciliation,
} from './foFinalLegEvidenceReconciliationService.js';

export const FINAL_LEG_RESOLUTION_RPC = 'rpc_resolve_fo_final_leg_evidence_v1';
export const FINAL_LEG_APPLY_RPC = 'rpc_apply_fo_final_leg_financial_v1';
export const KM_FINANCIAL_APPROVAL_RPC = 'rpc_approve_fo_km_financial_change_v1';

const round2 = (value) => Number((Number(value) || 0).toFixed(2));
const text = (value) => String(value || '').trim();

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function sha256(value) {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function workflowError(code, message, statusCode = 409) {
  return Object.assign(new Error(message), { code, statusCode });
}

function queryError(error, fallback) {
  if (!error) return;
  throw workflowError(error.code || 'final_leg_recovery_query_failed', error.message || fallback, 500);
}

function isoTime(value) {
  const parsed = value ? new Date(value) : null;
  return parsed && Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function selectFinalLeg(attendance, legs = []) {
  const logoutAt = isoTime(attendance?.logout_time);
  if (!logoutAt) return null;
  const logoutMs = new Date(logoutAt).getTime();
  return [...legs]
    .filter((leg) => text(leg.status).toLowerCase() === 'completed' && isoTime(leg.ended_at))
    .sort((left, right) => new Date(right.ended_at) - new Date(left.ended_at))
    .find((leg) => Math.abs(new Date(leg.ended_at).getTime() - logoutMs) <= 1_000) || null;
}

function previewStatus({ plan, evidence, resolution, apply, correction, settlement }) {
  if (apply) return 'ALREADY_APPLIED';
  if (round2(plan.existingPayableKm) > 0) return 'ALREADY_PAYABLE';
  if (correction) return 'MANUAL_REVIEW_EXISTING_CORRECTION';
  if (settlement) return 'MANUAL_REVIEW_EXISTING_SETTLEMENT';
  if (resolution?.decision === 'REJECTED') return 'REJECTED';
  if (resolution?.decision === 'APPROVED_EVIDENCE') return 'EVIDENCE_APPROVED_FINANCIAL_APPROVAL_REQUIRED';
  if (evidence) return 'EVIDENCE_RECORDED_REVIEW_REQUIRED';
  if (plan.referenceOnly || plan.gpsCoverageClassification !== 'GPS_COMPLETE') return 'MANUAL_REVIEW';
  if (!plan.persistable || round2(plan.candidateCalculatedKm) <= 0) return 'MANUAL_REVIEW';
  return 'ELIGIBLE_FOR_EVIDENCE_REVIEW';
}

async function loadSettlement(client, attendance) {
  const employeeCode = text(attendance.employee_code || attendance.fo_user_id).toUpperCase();
  const date = text(attendance.attendance_date).slice(0, 10);
  if (!employeeCode || !date) return null;
  const result = await client.from('fo_monthly_travel_settlements')
    .select('id,employee_code,period_start,period_end,approved_payable_amount,source_reference')
    .ilike('employee_code', employeeCode).lte('period_start', date).gte('period_end', date)
    .order('period_end', { ascending: false }).limit(1).maybeSingle();
  if (result.error && !['42P01', 'PGRST205'].includes(result.error.code)) {
    queryError(result.error, 'Unable to load monthly-settlement state.');
  }
  return result.data || null;
}

async function loadExistingState(client, attendance, finalLegId) {
  const attendanceId = attendance.id;
  const [evidenceResult, applyResult, correctionResult, settlement] = await Promise.all([
    client.from('fo_final_leg_reconciliation_runs')
      .select('id,input_digest,candidate_calculated_km,source,reference_only,created_at')
      .eq('attendance_id', attendanceId).eq('travel_leg_id', finalLegId)
      .order('created_at', { ascending: false }).limit(1).maybeSingle(),
    client.from('fo_final_leg_financial_applies')
      .select('id,input_digest,approved_final_leg_km,approved_payable_amount,reconciliation_status,created_at')
      .eq('attendance_id', attendanceId).eq('travel_leg_id', finalLegId).maybeSingle(),
    client.from('fo_travel_reimbursement_corrections')
      .select('id,status,correction_key,correction_reason,applied_state,created_at')
      .eq('attendance_id', attendanceId).eq('status', 'applied')
      .order('created_at', { ascending: false }).limit(1).maybeSingle(),
    loadSettlement(client, attendance),
  ]);
  queryError(evidenceResult.error, 'Unable to load final-leg evidence state.');
  queryError(applyResult.error, 'Unable to load final-leg apply state.');
  // The legacy ledger may not exist in a minimal fixture. Production must have it.
  if (correctionResult.error && !['42P01', 'PGRST205'].includes(correctionResult.error.code)) {
    queryError(correctionResult.error, 'Unable to load correction-ledger state.');
  }
  let resolution = null;
  if (evidenceResult.data?.id) {
    const resolutionResult = await client.from('fo_final_leg_reconciliation_resolutions')
      .select('id,decision,approved_evidence_km,reviewer_identity,created_at')
      .eq('reconciliation_run_id', evidenceResult.data.id).maybeSingle();
    queryError(resolutionResult.error, 'Unable to load evidence resolution.');
    resolution = resolutionResult.data || null;
  }
  return {
    evidence: evidenceResult.data || null,
    resolution,
    apply: applyResult.data || null,
    correction: correctionResult.data || null,
    settlement,
  };
}

export async function previewFinalLegRecoveryAttendance(client, attendance, options = {}) {
  const legsResult = await client.from('fo_travel_legs').select('*')
    .eq('attendance_id', attendance.id).order('ended_at', { ascending: false });
  queryError(legsResult.error, 'Unable to load attendance travel legs.');
  const finalLeg = selectFinalLeg(attendance, legsResult.data || []);
  if (!finalLeg) {
    return {
      attendanceId: attendance.id,
      employeeCode: attendance.employee_code || attendance.fo_user_id,
      attendanceDate: attendance.attendance_date,
      status: 'MANUAL_REVIEW_MISSING_FINAL_LEG',
      warning: 'No completed travel leg matches the End Day boundary.',
    };
  }
  const plan = await prepareFinalLegEvidenceReconciliation(client, {
    attendance_id: attendance.id,
    final_leg_id: finalLeg.id,
  }, { ...options, maxGoogleDirectionsCalls: 0 });
  const state = await loadExistingState(client, attendance, finalLeg.id);
  const status = previewStatus({ plan, ...state });
  return {
    ...plan,
    status,
    existingEvidence: state.evidence,
    evidenceResolution: state.resolution,
    existingFinancialApply: state.apply,
    existingCorrection: state.correction,
    existingSettlement: state.settlement,
    proposedAdditiveTotalKm: status === 'ELIGIBLE_FOR_EVIDENCE_REVIEW' ||
      status === 'EVIDENCE_RECORDED_REVIEW_REQUIRED' ||
      status === 'EVIDENCE_APPROVED_FINANCIAL_APPROVAL_REQUIRED'
      ? round2(plan.expectedTotalApprovedKm + plan.candidateCalculatedKm)
      : round2(plan.expectedTotalApprovedKm),
    proposedPayableKm: 0,
    proposedReimbursementChange: 0,
  };
}

export function summarizeFinalLegRecoveryRows(rows = []) {
  const summary = rows.reduce((result, row) => {
    result.total += 1;
    if (row.status === 'ELIGIBLE_FOR_EVIDENCE_REVIEW') result.eligible += 1;
    else if (row.status === 'ALREADY_APPLIED' || row.status === 'ALREADY_PAYABLE') result.alreadyHandled += 1;
    else result.manualReview += 1;
    return result;
  }, { total: 0, eligible: 0, manualReview: 0, alreadyHandled: 0 });
  const outcome = summary.total > 0 && summary.alreadyHandled === summary.total
    ? 'complete'
    : summary.eligible > 0 && (summary.manualReview > 0 || summary.alreadyHandled > 0)
      ? 'partial_review_required'
      : summary.eligible > 0
        ? 'review_required'
        : summary.manualReview > 0
          ? 'manual_review_required'
          : 'no_eligible_changes';
  return { summary, outcome };
}

export async function previewFinalLegRecoveryRange(client, attendances = [], options = {}) {
  const rows = [];
  for (const attendance of attendances) {
    if (!attendance?.id || !attendance.logout_time) continue;
    try {
      rows.push(await previewFinalLegRecoveryAttendance(client, attendance, options));
    } catch (error) {
      rows.push({
        attendanceId: attendance.id,
        employeeCode: attendance.employee_code || attendance.fo_user_id,
        attendanceDate: attendance.attendance_date,
        status: 'MANUAL_REVIEW',
        code: error.code || 'FINAL_LEG_PREVIEW_FAILED',
        warning: error.message,
      });
    }
  }
  const { summary, outcome } = summarizeFinalLegRecoveryRows(rows);
  return {
    ok: true,
    outcome,
    rows,
    summary,
    financialValuesChanged: false,
  };
}

export async function recordFinalLegEvidence(client, attendanceId, finalLegId, actorSource, options = {}) {
  const plan = await prepareFinalLegEvidenceReconciliation(client, {
    attendance_id: attendanceId,
    final_leg_id: finalLegId,
  }, { maxGoogleDirectionsCalls: 0 });
  if (plan.referenceOnly || plan.gpsCoverageClassification !== 'GPS_COMPLETE') {
    throw workflowError('final_leg_evidence_manual_review_required',
      'Only GPS_COMPLETE evidence may enter the approval workflow.', 422);
  }
  return persistFinalLegEvidenceReconciliation(client, plan, { actorSource, ...options });
}

export async function resolveFinalLegEvidence(userClient, payload = {}) {
  const decision = text(payload.decision).toUpperCase();
  if (!['APPROVED_EVIDENCE', 'REJECTED'].includes(decision)) {
    throw workflowError('final_leg_resolution_invalid', 'An explicit evidence decision is required.', 400);
  }
  const { data, error } = await userClient.rpc(FINAL_LEG_RESOLUTION_RPC, {
    p_reconciliation_run_id: payload.reconciliation_run_id,
    p_decision: decision,
    p_approved_evidence_km: decision === 'APPROVED_EVIDENCE' ? round2(payload.approved_evidence_km) : 0,
    p_review_reason: text(payload.review_reason),
  });
  queryError(error, 'Unable to record the evidence decision.');
  return data;
}

export function buildFinalLegFinancialPlan(preview, payload = {}) {
  if (!preview?.existingEvidence?.id || preview?.evidenceResolution?.decision !== 'APPROVED_EVIDENCE') {
    throw workflowError('final_leg_evidence_approval_required', 'Approved evidence is required first.', 409);
  }
  if (preview.existingCorrection) {
    throw workflowError('final_leg_existing_correction_manual_review',
      'An applied correction already exists for this attendance; financial apply requires manual reconciliation.', 409);
  }
  if (preview.existingSettlement) {
    throw workflowError('final_leg_existing_settlement_manual_review',
      'An approved monthly settlement already covers this attendance; finance must reconcile the settlement separately.', 409);
  }
  const finalLegKm = round2(preview.evidenceResolution.approved_evidence_km);
  const rate = round2(payload.approved_rate_per_km);
  const amount = round2(payload.approved_payable_amount);
  if (finalLegKm <= 0 || rate <= 0 || amount !== round2(finalLegKm * rate) || !text(payload.rate_policy)) {
    throw workflowError('final_leg_financial_policy_invalid',
      'An explicit rate, exact amount and rate policy are required.', 400);
  }
  const before = {
    totalRouteKm: round2(preview.expectedTotalRouteKm),
    eligibleKm: round2(preview.expectedEligibleKm),
    totalApprovedKm: round2(preview.expectedTotalApprovedKm),
    petrolAmount: round2(preview.expectedPetrolAmount),
  };
  const after = {
    totalRouteKm: round2(before.totalRouteKm + finalLegKm),
    eligibleKm: round2(before.eligibleKm + finalLegKm),
    totalApprovedKm: round2(before.totalApprovedKm + finalLegKm),
    petrolAmount: round2(before.petrolAmount + amount),
  };
  const inputDigest = sha256({
    version: 'KM_ENGINE_V2_FINAL_LEG_FINANCIAL_V2',
    attendanceId: preview.attendanceId,
    finalLegId: preview.finalLegId,
    evidenceRunId: preview.existingEvidence.id,
    evidenceInputDigest: preview.existingEvidence.input_digest,
    finalLegKm, rate, amount, ratePolicy: text(payload.rate_policy), before, after,
  });
  return { inputDigest, finalLegKm, rate, amount, ratePolicy: text(payload.rate_policy), before, after };
}

export async function approveFinalLegFinancialChange(userClient, preview, payload = {}) {
  const plan = buildFinalLegFinancialPlan(preview, payload);
  const { data, error } = await userClient.rpc(KM_FINANCIAL_APPROVAL_RPC, {
    p_attendance_id: preview.attendanceId,
    p_input_digest: plan.inputDigest,
    p_expected_attendance_updated_at: preview.attendanceUpdatedAt,
    p_before_total_route_km: plan.before.totalRouteKm,
    p_before_eligible_km: plan.before.eligibleKm,
    p_before_total_approved_km: plan.before.totalApprovedKm,
    p_before_petrol_amount: plan.before.petrolAmount,
    p_after_total_route_km: plan.after.totalRouteKm,
    p_after_eligible_km: plan.after.eligibleKm,
    p_after_total_approved_km: plan.after.totalApprovedKm,
    p_after_petrol_amount: plan.after.petrolAmount,
    p_approval_reason: text(payload.approval_reason),
  });
  queryError(error, 'Unable to create the separate financial approval.');
  return { approval: data, plan };
}

export async function applyApprovedFinalLeg(client, preview, payload = {}) {
  const plan = buildFinalLegFinancialPlan(preview, payload);
  const { data, error } = await client.rpc(FINAL_LEG_APPLY_RPC, {
    p_attendance_id: preview.attendanceId,
    p_final_leg_id: preview.finalLegId,
    p_reconciliation_run_id: preview.existingEvidence.id,
    p_input_digest: plan.inputDigest,
    p_expected_evidence_input_digest: preview.existingEvidence.input_digest,
    p_expected_attendance_updated_at: preview.attendanceUpdatedAt,
    p_expected_leg_updated_at: preview.finalLegUpdatedAt,
    p_expected_before_total_route_km: plan.before.totalRouteKm,
    p_expected_before_eligible_km: plan.before.eligibleKm,
    p_expected_before_total_approved_km: plan.before.totalApprovedKm,
    p_expected_before_petrol_amount: plan.before.petrolAmount,
    p_expected_leg_calculated_km: preview.existingCalculatedKm,
    p_expected_leg_payable_km: preview.existingPayableKm,
    p_expected_leg_payable_amount: preview.existingPayableAmount,
    p_expected_leg_fare_amount: preview.existingFareAmount,
    p_approved_final_leg_km: plan.finalLegKm,
    p_approved_rate_per_km: plan.rate,
    p_approved_payable_amount: plan.amount,
    p_rate_policy: plan.ratePolicy,
    p_actor_source: text(payload.actor_source) || null,
  });
  queryError(error, 'Unable to apply the approved final-leg correction.');
  return data;
}
