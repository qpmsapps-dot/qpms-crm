import { createHash } from 'node:crypto';
import { recalculateAttendanceTravelLegs } from '../foKmRecalculationService.js';
import { persistCanonicalKmV2 } from './foKmV2PersistenceService.js';
import { loadKmEvidence, kmError } from './foKmEvidenceService.js';

const round = n => Math.round(Number(n) * 100) / 100;
function timestampMicros(value) {
  const text = value instanceof Date ? value.toISOString() : String(value || '');
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) return null;
  const fraction = (text.match(/\.(\d+)(?:Z|[+-]\d\d:?\d\d)$/)?.[1] || '').padEnd(6,'0');
  return BigInt(ms) * 1000n + BigInt(fraction.slice(3,6) || '0');
}
const overlap = (a, b) => new Date(a.from_time) < new Date(b.journey_end || b.ended_at || b.endedAt) && new Date(a.to_time) > new Date(b.journey_start || b.started_at || b.startedAt);
export function stableKmLegKey(attendanceId, leg) {
  return createHash('sha256').update(JSON.stringify([attendanceId, leg.type, leg.from_visit_id || 'start', leg.to_visit_id || 'end', leg.travel_mode, leg.mode_segment ? leg.persisted_travel_leg_id || null : null])).digest('hex');
}
/** Reconcile evidence, never infer unknown inclusion as zero. No financial writes. */
export function buildIncrementalKmPlan(evidence, calculation, existingCredits = []) {
  const { attendance, snapshots, visits, recoveries, corrections } = evidence;
  const receiptKm = existingCredits.filter(c => c.applied_to_attendance).reduce((s, c) => s + Number(c.added_km), 0);
  const base = Number(attendance.total_approved_km);
  const legacyPayableKm = base - receiptKm;
  const inboundLegCounts = new Map();
  for (const leg of calculation.travel_legs) if (leg.to_visit_id) inboundLegCounts.set(leg.to_visit_id, (inboundLegCounts.get(leg.to_visit_id) || 0) + 1);
  const usedSnapshots = new Set();
  const correctionLegs = corrections.flatMap(c => c.before_state?.leg_breakdown || c.before_state?.legBreakdown || []);
  const correctionHistoryKnown = corrections.every(c => (c.before_state?.leg_breakdown || c.before_state?.legBreakdown || []).length > 0) && correctionLegs.every(l => (l.started_at || l.startedAt) && (l.ended_at || l.endedAt));
  const legs = calculation.travel_legs.map(calculatedLeg => {
    const leg = { ...calculatedLeg };
    // Reconstructed Date values lose sub-millisecond precision. For new legs,
    // retain the authoritative attendance endpoint when it is the same instant
    // at Date precision; never relax exact saved-leg boundary verification.
    if (!leg.persisted_travel_leg_id) {
      if (leg.from_source === 'attendance_start' && attendance.login_time &&
          Number.isFinite(Date.parse(leg.from_time)) && Date.parse(leg.from_time) === Date.parse(attendance.login_time)) leg.from_time = attendance.login_time;
      if (leg.to_source === 'attendance_end_location' && attendance.logout_time &&
          Number.isFinite(Date.parse(leg.to_time)) && Date.parse(leg.to_time) === Date.parse(attendance.logout_time)) leg.to_time = attendance.logout_time;
      const arrival=visits.find(v=>v.id===leg.to_visit_id);
      if (arrival?.check_in_time && Date.parse(leg.to_time)===Date.parse(arrival.check_in_time)) leg.to_time=arrival.check_in_time;
      const departure=visits.find(v=>v.id===leg.from_visit_id);
      const checkout=departure?.check_out_time||departure?.checkout_time;
      if (checkout && Date.parse(leg.from_time)===Date.parse(checkout)) leg.from_time=checkout;
      if (['corroborated_mobile_departure','verified_mobile_near_checkout'].includes(leg.from_source)) {
        const fixes=evidence.originalRows.filter(r=>(leg.source_row_ids||[]).includes(r.id) &&
          Number.isFinite(Date.parse(r.captured_at)) && Date.parse(r.captured_at)===Date.parse(leg.from_time));
        if (fixes.length===1) leg.from_time=fixes[0].captured_at;
      }
    }
    // A later lifecycle snapshot can describe an already-paid whole window.
    // Retain that exact receipt key; never guess inclusion across partial windows.
    const sameWindow=existingCredits.find(c=>c.evidence?.type===leg.type && c.evidence?.travel_mode===leg.travel_mode &&
      (c.evidence?.from_visit_id||null)===(leg.from_visit_id||null) && (c.evidence?.to_visit_id||null)===(leg.to_visit_id||null) &&
      timestampMicros(c.started_at)!==null && timestampMicros(c.started_at)===timestampMicros(leg.from_time) &&
      timestampMicros(c.ended_at)===timestampMicros(leg.to_time));
    const key = sameWindow?.leg_key || stableKmLegKey(attendance.id, leg);
    const recorded = snapshots.find(s => s.id === leg.persisted_travel_leg_id);
    // The posting RPC binds exact saved boundaries, including microseconds.
    // Reconstructed windows spanning reopen/pause legs are not the saved leg.
    // Keep them unresolved rather than failing all independent eligible windows.
    const invalidRecordedWindow = Boolean(leg.persisted_travel_leg_id) && (!recorded ||
      timestampMicros(leg.from_time) === null || timestampMicros(leg.to_time) === null ||
      timestampMicros(leg.from_time) !== timestampMicros(recorded.started_at) ||
      timestampMicros(leg.to_time) !== timestampMicros(recorded.ended_at));
    const matches = snapshots.filter(s => s.status !== 'cancelled' && s.ended_at &&
      Math.abs(new Date(s.started_at) - new Date(leg.from_time)) <= 120000 &&
      (!s.ended_at || new Date(s.ended_at) <= new Date(leg.to_time).getTime() + 120000));
    let included = matches.reduce((n, s) => { usedSnapshots.add(s.id); return n + Number(s.payable_km || 0); }, 0);
    const ambiguousPersisted = snapshots.some(s => s.status !== 'cancelled' && Number(s.payable_km) > 0 && overlap(leg, s) && !matches.includes(s));
    // Old clients left zero-valued lifecycle rows while the exact inbound route
    // was paid on the attendance. This is usable only when the full baseline
    // reconciles below; a bare zero-valued lifecycle row is not proof of zero pay.
    const visit = visits.find(v => v.id === leg.to_visit_id);
    // Route metadata is not itself a paid credit. It may explain a positive
    // legacy attendance baseline, once, for an unsplit inbound window only.
    // Never duplicate the whole route on each transport segment or invent a
    // baseline when the attendance has never paid any KM.
    if (visit && legacyPayableKm > 0.01 && inboundLegCounts.get(visit.id) === 1 && !leg.mode_segment && Number(visit.route_km) > included) included = Number(visit.route_km);
    if (leg.type === 'last_checkout_to_end_day' && attendance.metadata?.final_return_leg_included_in_payable === true) {
      const recorded = Number(attendance.metadata.final_return_leg_km);
      if (Number.isFinite(recorded)) included = Math.max(included, recorded);
    }
    const credited = existingCredits.filter(c => c.leg_key === key).reduce((s, c) => s + Number(c.added_km), 0);
    const supplements = recoveries.filter(r => overlap(leg, r));
    const partialSupplement = supplements.some(r => new Date(r.journey_start) < new Date(leg.from_time) || new Date(r.journey_end) > new Date(leg.to_time));
    const supplement = supplements.reduce((s, r) => s + Number(r.approved_additional_km), 0);
    const corrected = correctionLegs.some(c => overlap(leg, c));
    const status = invalidRecordedWindow ? 'recorded_leg_window_requires_review' : ambiguousPersisted ? 'persisted_overlap_requires_review' : corrected ? 'applied_correction_preserved' : leg.status !== 'calculated' || !leg.payable ? leg.reason || 'not_eligible_or_unresolved'
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
  const settledSupplements = existingCredits.filter(c => !c.applied_to_attendance).reduce((s,c) => s + Number(c.added_km),0);
  const recoverySupplements = recoveries.reduce((s,r) => s + Number(r.approved_additional_km || 0),0);
  const existingPayableKm = Number.isFinite(base) ? round(base + settledSupplements + recoverySupplements) : null;
  return { calculationVersion: 'KM_ENGINE_V2', incrementalRecovery: true, legs,
    existingPayableKm, additionalKm, additionalAmount,
    finalPayableKm: existingPayableKm == null ? null : round(existingPayableKm + additionalKm),
    effectiveEnd: calculation.effective_end_evidence, baselineKnown,
    unresolved: legs.filter(l => !['supported'].includes(l.evidence_status)),
    sourceRowIds: evidence.originalRows.map(r => r.id).sort() };
}
export function sharedKmReconciliationEnabled(environment = process.env) {
  return environment.KM_SHARED_RECONCILIATION_ENABLED === 'true' && environment.KM_INCREMENTAL_REPORTING_ENABLED === 'true';
}
export function sharedKmPreviewEnabled(environment = process.env) {
  return sharedKmReconciliationEnabled(environment) || environment.KM_SHARED_RECONCILIATION_PREVIEW_ENABLED === 'true';
}
export function kmReconciliationDependencyError(error) {
  if (!['PGRST202','PGRST205','42P01','42883'].includes(error?.code)) return error;
  return Object.assign(kmError('KM_SHARED_SCHEMA_UNAVAILABLE', 'Shared KM reconciliation database functions are unavailable; no financial posting was confirmed.', 503), {retryable:true});
}
export async function reconcileSupportedKm(client, payload, options = {}) {
  const environment = options.environment || process.env;
  // A separately enabled Admin preview may read evidence while posting stays off.
  // This never enables workers or changes the financial persistence guard.
  const adminPreview = options.persist === false && (options.trigger || 'admin_recalculation') === 'admin_recalculation' && sharedKmPreviewEnabled(environment);
  if (!sharedKmReconciliationEnabled(environment) && !adminPreview) return {attendance_id:payload.attendance_id, status:'deferred', code:'KM_SHARED_RECONCILIATION_INACTIVE', financial_posted:false, updated:false, retryable:true};
  if ((options.trigger || 'admin_recalculation') === 'admin_recalculation' && !options.adminAuthorization?.userId) throw kmError('KM_ADMIN_REQUIRED','An authenticated Admin is required.',403);
  const evidence = options.evidence || await loadKmEvidence(client, payload.attendance_id, {closedJourneysOnly:options.automaticKm===true});
  const { data: state, error } = await client.rpc('rpc_fo_km_reconciliation_state_v1', { p_attendance_id: evidence.attendance.id });
  if (error) throw kmReconciliationDependencyError(error); // Never interpret an unavailable ledger as zero.
  const liveAutomatic=options.automaticKm===true && environment.KM_CANONICAL_AUTOMATION_ENABLED==='true' &&
    ['site_visit','late_gps'].includes(options.trigger) && !evidence.attendance.logout_time &&
    String(evidence.attendance.status||'').toLowerCase()==='active';
  if (options.persist !== false && !liveAutomatic && (!evidence.attendance.logout_time ||
      !['completed','ended','ended day','closed','auto ended','stale auto ended'].includes(String(evidence.attendance.status || '').toLowerCase()))) {
    return {attendance_id:evidence.attendance.id,date:evidence.attendance.attendance_date,
      status:evidence.attendance.logout_time ? 'deferred' : 'active_closed_windows_only',
      code:'KM_COMPLETED_ATTENDANCE_REQUIRED',additionalKm:0,financial_posted:false,updated:false};
  }
  const calculation = await recalculateAttendanceTravelLegs(client, evidence.attendance.id, {
    ...options, evidenceSnapshot: evidence, evidenceRows: evidence.rows,
    evidenceOnly: true, sharedRecovery: true, auditDelayedCheckout: false,
  });
  const plan = buildIncrementalKmPlan(evidence, calculation, state.credits || []);
  if(options.finalLegOnly===true){
    for(const leg of plan.legs)if(leg.type!=='last_checkout_to_end_day')leg.new_eligible_km=0;
    plan.additionalKm=round(plan.legs.reduce((sum,l)=>sum+l.new_eligible_km,0));
    plan.additionalAmount=round(plan.legs.reduce((sum,l)=>sum+l.new_eligible_km*Number(l.rate_per_km||0),0));
    plan.finalPayableKm=plan.existingPayableKm==null?null:round(plan.existingPayableKm+plan.additionalKm);
    plan.finalLegOnly=true;
  }
  plan.snapshot = state.digest;
  plan.inputDigest = createHash('sha256').update(JSON.stringify({ attendance: evidence.attendance.id, legs: plan.legs, snapshot: state.digest, sources: plan.sourceRowIds })).digest('hex');
  const response = { attendance_id: evidence.attendance.id, date: evidence.attendance.attendance_date, ...plan, updated: false, financial_posted: false };
  if (!evidence.attendance.logout_time && !liveAutomatic) return { ...response, status: 'active_closed_windows_only', additionalKm: 0, message: 'Closed travel evidence calculated; active attendance payable unchanged.' };
  if (options.persist === false) return { ...response, authorization_calculation: plan, status: 'calculated_not_posted', message: 'Evidence calculated only. No KM or petrol credit was posted.' };
  if (!plan.additionalKm) return { ...response, status: plan.unresolved.length ? 'partial_unresolved' : 'unchanged', message: 'Recalculation completed — no additional supported KM found. Existing payable unchanged.' };
  if(options.deadlineAt && Date.now()>=options.deadlineAt)return {...response,status:'deferred',code:'KM_EVIDENCE_TIMEOUT',retryable:true,message:'Calculation exceeded its bounded window; no financial posting was attempted.'};
  if (environment.KM_SHARED_RECONCILIATION_ENABLED !== 'true' || environment.KM_INCREMENTAL_REPORTING_ENABLED !== 'true') return { ...response, status: 'deferred', code: 'KM_SHARED_RECONCILIATION_INACTIVE', retryable: true };
  try {
    const posted = await persistCanonicalKmV2(client, {
      attendanceId: evidence.attendance.id, expectedAttendanceUpdatedAt: evidence.attendance.updated_at,
      calculation: plan, sourceEntryPoint: options.trigger || 'admin_recalculation', environment,
      adminAuthorization: options.adminAuthorization, actorSource: options.actorSource,
      scopedAuthorizationReference: options.scopedAuthorizationReference,
      automaticKm: options.automaticKm === true,
    });
    if (!posted?.receipt_id) throw kmError('km_posting_unverified', 'Persistence returned no atomic receipt.');
    return { ...response, ...posted, status: 'posted', financial_posted: true, updated: true };
  } catch (err) {
    if (err.retryable || err.code === 'KM_FINANCIAL_WRITES_MAINTENANCE') return { ...response, status: 'deferred', code: err.code, retryable: true, message: err.message };
    throw kmReconciliationDependencyError(err);
  }
}
