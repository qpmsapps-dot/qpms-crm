import { createHash } from 'node:crypto';
import { recalculateAttendanceTravelLegs } from '../foKmRecalculationService.js';
import { persistCanonicalKmV2 } from './foKmV2PersistenceService.js';
import { loadKmEvidence, kmError } from './foKmEvidenceService.js';

const round = n => Math.round(Number(n) * 100) / 100;
const overlap = (a, b) => new Date(a.from_time) < new Date(b.journey_end || b.ended_at || b.endedAt) && new Date(a.to_time) > new Date(b.journey_start || b.started_at || b.startedAt);
export function stableKmLegKey(attendanceId, leg) {
  return createHash('sha256').update(JSON.stringify([attendanceId, leg.type, leg.from_visit_id || 'start', leg.to_visit_id || 'end', leg.travel_mode, leg.mode_segment ? leg.persisted_travel_leg_id || null : null])).digest('hex');
}
/** Reconcile evidence, never infer unknown inclusion as zero. No financial writes. */
export function buildIncrementalKmPlan(evidence, calculation, existingCredits = []) {
  const { attendance, snapshots, visits, recoveries, corrections } = evidence;
  const receiptKm = existingCredits.filter(c => c.applied_to_attendance).reduce((s, c) => s + Number(c.added_km), 0);
  const base = Number(attendance.total_approved_km);
  const usedSnapshots = new Set();
  const correctionLegs = corrections.flatMap(c => c.before_state?.leg_breakdown || c.before_state?.legBreakdown || []);
  const correctionHistoryKnown = corrections.every(c => (c.before_state?.leg_breakdown || c.before_state?.legBreakdown || []).length > 0) && correctionLegs.every(l => (l.started_at || l.startedAt) && (l.ended_at || l.endedAt));
  const legs = calculation.travel_legs.map(leg => {
    const key = stableKmLegKey(attendance.id, leg);
    const matches = snapshots.filter(s => s.status !== 'cancelled' && s.ended_at &&
      Math.abs(new Date(s.started_at) - new Date(leg.from_time)) <= 120000 &&
      (!s.ended_at || new Date(s.ended_at) <= new Date(leg.to_time).getTime() + 120000));
    let included = matches.reduce((n, s) => { usedSnapshots.add(s.id); return n + Number(s.payable_km || 0); }, 0);
    const ambiguousPersisted = snapshots.some(s => s.status !== 'cancelled' && Number(s.payable_km) > 0 && overlap(leg, s) && !matches.includes(s));
    // Old clients left zero-valued lifecycle rows while the exact inbound route
    // was paid on the attendance. This is usable only when the full baseline
    // reconciles below; a bare zero-valued lifecycle row is not proof of zero pay.
    const visit = visits.find(v => v.id === leg.to_visit_id);
    if (visit && Number(visit.route_km) > included) included = Number(visit.route_km);
    if (leg.type === 'last_checkout_to_end_day' && attendance.metadata?.final_return_leg_included_in_payable === true) {
      const recorded = Number(attendance.metadata.final_return_leg_km);
      if (Number.isFinite(recorded)) included = Math.max(included, recorded);
    }
    const credited = existingCredits.filter(c => c.leg_key === key).reduce((s, c) => s + Number(c.added_km), 0);
    const supplements = recoveries.filter(r => overlap(leg, r));
    const partialSupplement = supplements.some(r => new Date(r.journey_start) < new Date(leg.from_time) || new Date(r.journey_end) > new Date(leg.to_time));
    const supplement = supplements.reduce((s, r) => s + Number(r.approved_additional_km), 0);
    const corrected = correctionLegs.some(c => overlap(leg, c));
    const status = ambiguousPersisted ? 'persisted_overlap_requires_review' : corrected ? 'applied_correction_preserved' : leg.status !== 'calculated' || !leg.payable ? leg.reason || 'not_eligible_or_unresolved'
      : partialSupplement ? 'supplement_overlap_requires_review' : 'supported';
    return { ...leg, leg_key: key, baseline_km: round(included), already_included_km: round(included + credited + supplement),
      new_eligible_km: status === 'supported' ? round(Math.max(0, Number(leg.payable_km) - included - credited - supplement)) : 0,
      evidence_status: status };
  });
  const assigned = legs.reduce((s, l) => s + l.baseline_km, 0) + snapshots.filter(s => s.status !== 'cancelled' && !usedSnapshots.has(s.id)).reduce((s, l) => s + Number(l.payable_km || 0), 0);
  const baselineKnown = attendance.total_approved_km != null && attendance.petrol_amount != null && Number.isFinite(base) &&
    Math.abs(assigned + receiptKm - base) < 0.011 && correctionHistoryKnown;
  for (const leg of legs) if (!baselineKnown && leg.new_eligible_km > 0) {
    leg.new_eligible_km = 0; leg.evidence_status = 'baseline_inclusion_unknown';
  }
  const additionalKm = round(legs.reduce((s, l) => s + l.new_eligible_km, 0));
  const additionalAmount = round(legs.reduce((s, l) => s + l.new_eligible_km * Number(l.rate_per_km || 0), 0));
  return { calculationVersion: 'KM_ENGINE_V2', incrementalRecovery: true, legs,
    existingPayableKm: attendance.total_approved_km, additionalKm, additionalAmount,
    finalPayableKm: Number.isFinite(base) ? round(base + additionalKm) : null,
    effectiveEnd: calculation.effective_end_evidence, baselineKnown,
    unresolved: legs.filter(l => !['supported'].includes(l.evidence_status)),
    sourceRowIds: evidence.originalRows.map(r => r.id).sort() };
}
export function sharedKmReconciliationEnabled(environment = process.env) {
  return environment.KM_SHARED_RECONCILIATION_ENABLED === 'true' && environment.KM_INCREMENTAL_REPORTING_ENABLED === 'true';
}
export function kmReconciliationDependencyError(error) {
  if (!['PGRST202','PGRST205','42P01','42883'].includes(error?.code)) return error;
  return Object.assign(kmError('KM_SHARED_SCHEMA_UNAVAILABLE', 'Shared KM reconciliation database functions are unavailable; no financial posting was confirmed.', 503), {retryable:true});
}
export async function reconcileSupportedKm(client, payload, options = {}) {
  const environment = options.environment || process.env;
  // Inactive means no evidence, ledger, RPC or queue access, including previews.
  if (!sharedKmReconciliationEnabled(environment)) return {attendance_id:payload.attendance_id, status:'deferred', code:'KM_SHARED_RECONCILIATION_INACTIVE', financial_posted:false, updated:false, retryable:true};
  if ((options.trigger || 'admin_recalculation') === 'admin_recalculation' && !options.adminAuthorization?.userId) throw kmError('KM_ADMIN_REQUIRED','An authenticated Admin is required.',403);
  const evidence = options.evidence || await loadKmEvidence(client, payload.attendance_id);
  const { data: state, error } = await client.rpc('rpc_fo_km_reconciliation_state_v1', { p_attendance_id: evidence.attendance.id });
  if (error) throw kmReconciliationDependencyError(error); // Never interpret an unavailable ledger as zero.
  const calculation = await recalculateAttendanceTravelLegs(client, evidence.attendance.id, {
    ...options, evidenceSnapshot: evidence, evidenceRows: evidence.rows,
    evidenceOnly: true, sharedRecovery: true, auditDelayedCheckout: false,
  });
  const plan = buildIncrementalKmPlan(evidence, calculation, state.credits || []);
  plan.snapshot = state.digest;
  plan.inputDigest = createHash('sha256').update(JSON.stringify({ attendance: evidence.attendance.id, legs: plan.legs, snapshot: state.digest, sources: plan.sourceRowIds })).digest('hex');
  const response = { attendance_id: evidence.attendance.id, date: evidence.attendance.attendance_date, ...plan, updated: false, financial_posted: false };
  if (!evidence.attendance.logout_time) return { ...response, status: 'active_closed_windows_only', additionalKm: 0, message: 'Closed travel evidence calculated; active attendance payable unchanged.' };
  if (options.persist === false) return { ...response, status: 'calculated_not_posted' };
  if (!plan.additionalKm) return { ...response, status: plan.unresolved.length ? 'partial_unresolved' : 'unchanged', message: 'Recalculation completed — no additional supported KM found. Existing payable unchanged.' };
  if(options.deadlineAt && Date.now()>=options.deadlineAt)return {...response,status:'deferred',code:'KM_EVIDENCE_TIMEOUT',retryable:true,message:'Calculation exceeded its bounded window; no financial posting was attempted.'};
  if (environment.KM_SHARED_RECONCILIATION_ENABLED !== 'true' || environment.KM_INCREMENTAL_REPORTING_ENABLED !== 'true') return { ...response, status: 'deferred', code: 'KM_SHARED_RECONCILIATION_INACTIVE', retryable: true };
  try {
    const posted = await persistCanonicalKmV2(client, {
      attendanceId: evidence.attendance.id, expectedAttendanceUpdatedAt: evidence.attendance.updated_at,
      calculation: plan, sourceEntryPoint: options.trigger || 'admin_recalculation', environment,
      adminAuthorization: options.adminAuthorization, actorSource: options.actorSource,
    });
    if (!posted?.receipt_id) throw kmError('km_posting_unverified', 'Persistence returned no atomic receipt.');
    return { ...response, ...posted, status: 'posted', financial_posted: true, updated: true };
  } catch (err) {
    if (err.retryable || err.code === 'KM_FINANCIAL_WRITES_MAINTENANCE') return { ...response, status: 'deferred', code: err.code, retryable: true, message: err.message };
    throw kmReconciliationDependencyError(err);
  }
}
