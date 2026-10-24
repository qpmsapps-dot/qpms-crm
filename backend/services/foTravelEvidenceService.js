import { recalculateAttendanceTravelLegs } from '../foKmRecalculationService.js';
import { adminKmApprovalAuthorization } from './foKmRecalculationAuthorizationService.js';

const READ_METHODS = new Set(['select', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is', 'in', 'order', 'limit', 'range', 'maybeSingle', 'single', 'ilike', 'like', 'or', 'not', 'match', 'filter']);
function fail(statusCode, code, message) { throw Object.assign(new Error(message), { statusCode, code }); }
const money = value => Math.round(Number(value || 0) * 100) / 100;
const known = value => ['number', 'string'].includes(typeof value) && String(value).trim() !== '' && Number.isFinite(Number(value));

// A capability boundary: even an accidental future engine write fails before
// reaching Supabase. RPCs and query-builder mutation methods are never exposed.
export function readOnlyEvidenceClient(client) {
  function wrap(query) {
    return new Proxy(query, { get(target, key) {
      if (['then', 'catch', 'finally'].includes(key)) return typeof target[key] === 'function' ? target[key].bind(target) : undefined;
      if (typeof key === 'symbol') return target[key];
      if (!READ_METHODS.has(key)) return () => fail(500, 'KM_EVIDENCE_WRITE_FORBIDDEN', 'Travel evidence cannot modify database records.');
      return (...args) => {
        let next = target[key](...args);
        if (typeof next?.abortSignal === 'function') next = next.abortSignal(AbortSignal.timeout(20000));
        return wrap(next);
      };
    } });
  }
  return Object.freeze({ from(table) { return wrap(client.from(table)); } });
}

export function travelEvidenceSelection(payload = {}) {
  const employee = String(payload.employee_code || '').trim(), date = payload.date;
  if (!employee || employee.length > 100 || !/^\d{4}-\d{2}-\d{2}$/.test(date || '') ||
      !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date ||
      Object.keys(payload).some(key => !['employee_code', 'date'].includes(key))) {
    fail(400, 'KM_EVIDENCE_SELECTION_REQUIRED', 'Select one employee and one valid date per evidence request.');
  }
  return { employee, date };
}
async function rows(query) { const result = await query; if (result.error) throw result.error; return result.data || []; }

export function summarizeTravelEvidence({ attendance, result, reviews = [], savedLegs = [], protectedRecord = false }) {
  const calculated = result.travel_legs || [];
  const closed = calculated.filter(leg => leg.status === 'calculated');
  const pending = reviews.filter(r => !['approved', 'rejected'].includes(r.status));
  const pendingValues = pending.map(r => r.metadata?.detected_missing_km ?? r.google_route_km ?? r.filtered_gps_km ?? r.suggested_missing_km);
  const unknownReviewInclusion = pending.some(r => !known(r.metadata?.already_included_km));
  const savedPayable = Number(attendance.total_approved_km || 0);
  const savedClosed = savedLegs.filter(l => !l.superseded_at && ['completed', 'calculated'].includes(l.status));
  const savedLegTotal = money(savedClosed.reduce((sum, l) => sum + (known(l.payable_km) ? Number(l.payable_km) : 0), 0));
  // A positive legacy baseline without a matching leg ledger is NOT zero included.
  const baselineKnown = !unknownReviewInclusion && (savedPayable === 0 ||
    (savedClosed.every(l => known(l.payable_km)) && Math.abs(savedLegTotal - savedPayable) < 0.011));
  const included = baselineKnown ? savedPayable : null;
  const eligible = money(closed.reduce((sum, leg) => sum + Number(leg.payable_km || 0), 0));
  const wrongCheckouts = (result.visits || []).filter(v =>
    v.checkout_location_status === 'wrong_location' || ((v.check_out_time || v.checkout_time) && v.petrol_eligible_after_checkout !== true));
  const reviewRequired = pending.length > 0 || wrongCheckouts.length > 0 || calculated.some(l => l.status === 'skipped' || l.decision === 'MANUAL_REVIEW' || (l.review_flags || []).length > 0);
  const active = !attendance.logout_time;
  const status = protectedRecord ? 'protected' : active || reviewRequired ? 'partial' : 'completed';
  return {
    ok: true, date: attendance.attendance_date, attendance_id: attendance.id, employee_code: attendance.employee_code,
    status, attendance_status: attendance.status, active, persisted: false, financial_eligible: false,
    calculated_travel_km: money(closed.reduce((sum, leg) => sum + Number(leg.km || 0), 0)),
    saved_route_km: Number(attendance.total_route_km || 0), saved_payable_km: savedPayable,
    saved_petrol_amount: Number(attendance.petrol_amount || 0), petrol_eligible_evidence_km: eligible,
    pending_checkout_review_km: pendingValues.every(known) ? money(pendingValues.reduce((sum, v) => sum + Number(v), 0)) : null,
    already_included_km: included,
    proposed_additional_payable_km: baselineKnown && !protectedRecord && !reviewRequired && !active ? Math.max(0, money(eligible - included)) : null,
    protected: protectedRecord, review_required: reviewRequired, travel_mode: attendance.travel_mode,
    gps_log_count: result.gps_log_count, valid_points: result.valid_points,
    message: `${active ? 'Closed travel windows only; End Day and the unfinished leg were not fabricated. ' : ''}${protectedRecord ? 'Saved financial records are protected. ' : ''}${eligible === 0 ? 'No petrol-eligible KM in the calculated windows; recorded transport eligibility is preserved. ' : ''}${wrongCheckouts.length ? `${wrongCheckouts.length} checkout(s) require eligibility/location review. ` : ''}${!baselineKnown ? 'Already-included distance is unverified; no additional payable distance is proposed. ' : ''}Evidence only: no route, payable, review or petrol values were saved.`,
    legs: calculated, review_visit_ids: wrongCheckouts.map(v => v.id),
  };
}

export function createTravelEvidenceService({ calculate = recalculateAttendanceTravelLegs, now = Date.now } = {}) {
  const running = new Set();
  return async ({ client, payload, profile, authUser }) => {
    adminKmApprovalAuthorization(profile, authUser, 'Read-only travel evidence; not financial approval');
    const { employee, date } = travelEvidenceSelection(payload);
    const key = `${authUser.id}:${employee}:${date}`;
    if (running.has(key)) fail(409, 'KM_EVIDENCE_RUNNING', 'This date is already being calculated.');
    if (running.size >= 2) fail(429, 'KM_EVIDENCE_BUSY', 'Two evidence calculations are already running. Retry shortly.');
    running.add(key);
    try {
      const read = readOnlyEvidenceClient(client);
      const found = await read.from('fo_attendance').select('*').eq('employee_code', employee).eq('attendance_date', date).maybeSingle();
      if (found.error) throw found.error;
      const attendance = found.data;
      if (!attendance) fail(404, 'KM_EVIDENCE_NO_ATTENDANCE', 'No attendance exists for this employee/date.');
      const [reviews, savedLegs, approvals, corrections, settlements] = await Promise.all([
        rows(read.from('fo_missing_km_reviews').select('*').eq('attendance_id', attendance.id)),
        rows(read.from('fo_travel_legs').select('*').eq('attendance_id', attendance.id)),
        rows(read.from('fo_km_financial_approvals').select('id').eq('attendance_id', attendance.id).limit(1)),
        rows(read.from('fo_travel_reimbursement_corrections').select('id').eq('attendance_id', attendance.id).limit(1)),
        rows(read.from('fo_monthly_travel_settlements').select('id').ilike('employee_code', employee).lte('period_start', date).gte('period_end', date).limit(1)),
      ]);
      const protectedRecord = Number(attendance.total_approved_km || 0) > 0 || Number(attendance.petrol_amount || 0) > 0 ||
        approvals.length > 0 || corrections.length > 0 || settlements.length > 0 || reviews.some(r => r.status === 'approved') ||
        [true, 'true'].includes(attendance.metadata?.shared_travel_adjustment);
      const result = await calculate(read, attendance.id, {
        evidenceOnly: true, persist: false, persistLegResults: false, auditDelayedCheckout: false,
        maxGoogleDirectionsCalls: 10, deadlineAt: now() + 90000,
      });
      return summarizeTravelEvidence({ attendance, result, reviews, savedLegs, protectedRecord });
    } finally { running.delete(key); }
  };
}
