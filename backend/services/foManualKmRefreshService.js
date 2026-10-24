import { randomUUID } from 'node:crypto';
import { recalculateFoKm, reconcileFinalLegOnly } from '../foKmRecalculationService.js';
import { adminKmApprovalAuthorization } from './foKmRecalculationAuthorizationService.js';
import { assertKmFinancialWritesAvailable, kmFinancialWritesMaintenanceEnabled } from './kmFinancialWriteMaintenanceService.js';

function fail(statusCode, code, message) {
  throw Object.assign(new Error(message), { statusCode, code, retryable: statusCode === 409 });
}

export function assertManualKmRangeAllowed(payload, environment = process.env) {
  if (!kmFinancialWritesMaintenanceEnabled(environment)) return;
  // The range handler always persists; it has no dry-run implementation.
  const from = payload.date_from || payload.from_date;
  const to = payload.date_to || payload.to_date || from;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || from !== to) {
    fail(423, 'KM_SINGLE_DATE_REQUIRED', 'During financial maintenance, select exactly one attendance date.');
  }
  fail(423, 'KM_MANUAL_PREVIEW_REQUIRED', 'Use the Admin single-attendance preview and approval workflow during maintenance.');
}

export function assertKmBulkAvailable(environment = process.env) {
  if (kmFinancialWritesMaintenanceEnabled(environment)) {
    fail(423, 'KM_BULK_RECALCULATION_DISABLED', 'Bulk KM recalculation remains disabled during financial maintenance.');
  }
}

function selection(payload) {
  const employee = String(payload.employee_code || '').trim();
  const date = String(payload.date || '');
  if (!employee || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date ||
      ['date_from', 'date_to', 'from_date', 'to_date', 'fromDate', 'toDate'].some(key => payload[key] != null)) {
    fail(400, 'KM_EXPLICIT_SELECTION_REQUIRED', 'Select an employee and one valid attendance date.');
  }
  return { employee, date };
}

async function protectedAttendance(client, attendance) {
  // Never reinterpret an existing payable amount as an unapproved draft.
  if (Number(attendance.total_approved_km || 0) > 0 || Number(attendance.petrol_amount || 0) > 0 ||
      attendance.metadata?.shared_travel_adjustment === true ||
      attendance.metadata?.shared_travel_adjustment === 'true') return true;
  for (const table of ['fo_km_financial_approvals', 'fo_travel_reimbursement_corrections']) {
    const { data, error } = await client.from(table).select('id').eq('attendance_id', attendance.id).limit(1);
    if (error) throw error;
    if (data?.length) return true;
  }
  const reviews = await client.from('fo_missing_km_reviews').select('id')
    .eq('attendance_id', attendance.id).eq('status', 'approved').limit(1);
  if (reviews.error) throw reviews.error;
  if (reviews.data?.length) return true;
  const settlements = await client.from('fo_monthly_travel_settlements').select('id')
    .ilike('employee_code', attendance.employee_code).lte('period_start', attendance.attendance_date)
    .gte('period_end', attendance.attendance_date).limit(1);
  if (settlements.error) throw settlements.error;
  return Boolean(settlements.data?.length);
}

// Short-lived, opaque previews contain server-calculated values only. Restart or
// routing to another replica fails closed and asks the Admin to preview again.
export function createManualKmRefreshService({ calculate = recalculateFoKm, calculateFinalLeg = reconcileFinalLegOnly, now = Date.now,
  token = randomUUID, ttlMs = 5 * 60 * 1000, maxPreviews = 200, maxGoogleDirectionsCalls = 25 } = {}) {
  const previews = new Map();
  async function commit(client, preview, admin) {
    const { data, error } = await client.rpc('rpc_apply_fo_manual_km_refresh_v1', {
      p_attendance_id: preview.attendanceId, p_input_digest: preview.calculation.inputDigest,
      p_expected_attendance_updated_at: preview.updatedAt, p_calculation: preview.calculation,
      p_admin_user_id: admin.userId, p_approval_reason: preview.reason,
    });
    if (error) {
      if (['PGRST202', '42883'].includes(error.code)) {
        fail(503, 'KM_MANUAL_SCHEMA_REQUIRED', 'The reviewed manual KM database guard must be installed before saving.');
      }
      const code = error.message?.match(/(?:manual_km|km_v2)_[a-z0-9_]+/)?.[0] || error.code;
      fail(error.code === '42501' ? 403 : ['40001', '40P01', '55P03', '57014'].includes(error.code) ? 409 : 422,
        code || 'KM_PERSISTENCE_FAILED', error.message || 'KM persistence failed.');
    }
    if (!data?.ok || !data.calculation_run_id) fail(503, 'KM_PERSISTENCE_UNVERIFIED', 'No persisted calculation receipt was returned.');
    preview.result = { ...preview.summary, ...data, ok: true, updated: true, dry_run: false };
    return preview.result;
  }
  return async function manualRefresh({ client, payload, profile, authUser, environment = process.env }) {
    const reason = String(payload.approval_reason || '').trim();
    if (reason.length > 1000) fail(400, 'KM_APPROVAL_REASON_INVALID', 'Keep the approval reason within 1000 characters.');
    const admin = adminKmApprovalAuthorization(profile, authUser, reason);
    if (!admin) fail(400, 'KM_APPROVAL_REASON_REQUIRED', 'Enter an Admin approval reason.');
    const { employee, date } = selection(payload);
    const dryRun = payload.dry_run === true;
    for (const [key, value] of previews) if (value.expires <= now()) previews.delete(key);
    let preview;
    if (!dryRun) {
      preview = previews.get(payload.preview_token);
      if (!preview || preview.userId !== authUser.id || preview.employee !== employee ||
          preview.date !== date || preview.reason !== reason || preview.attendanceId !== payload.attendance_id) {
        fail(409, 'KM_PREVIEW_REQUIRED', 'Preview this employee and date again before approval.');
      }
      assertKmFinancialWritesAvailable({ environment, authorizedAdminAction: true });
      if (preview.running) fail(409, 'KM_RECALCULATION_ALREADY_RUNNING', 'This approval is already running.');
      preview.running = true;
    }
    try {
      const { data: attendance, error } = await client.from('fo_attendance').select('*')
        .eq('employee_code', employee).eq('attendance_date', date).maybeSingle();
      if (error) fail(409, 'KM_ATTENDANCE_SELECTION_AMBIGUOUS', 'Unable to resolve a unique attendance. Select the employee and date again.');
      if (!attendance || (payload.attendance_id && payload.attendance_id !== attendance.id)) {
        fail(404, 'KM_ATTENDANCE_NOT_FOUND', 'The selected employee attendance was not found.');
      }
      if ([profile.id, profile.auth_user_id, profile.employee_code].filter(Boolean)
        .some(value => [attendance.fo_user_id, attendance.employee_code].filter(Boolean)
          .some(owner => String(owner).toUpperCase() === String(value).toUpperCase()))) {
        fail(403, 'KM_SELF_APPROVAL_FORBIDDEN', 'You cannot approve your own KM.');
      }
      if (!attendance.logout_time || !['completed', 'ended', 'ended day', 'closed', 'auto ended', 'stale auto ended']
        .includes(String(attendance.status || '').toLowerCase())) {
        fail(422, 'KM_COMPLETED_ATTENDANCE_REQUIRED', 'End Day must be completed before recalculation.');
      }
      const protectedRecord = await protectedAttendance(client, attendance);
      const diagnostic = await calculateFinalLeg(client, { attendance_id: attendance.id, dry_run: true }, {
        persist: false, includeOriginComparison: dryRun, maxGoogleDirectionsCalls: 3,
      });
      // Distance evidence cannot override checkout eligibility. Missing evidence
      // requires review too; these previews must never receive an apply token.
      const checkoutEligible = diagnostic.final_leg_evidence?.checkout_eligibility?.petrol_eligible_after_checkout === true;
      if (preview && checkoutEligible && attendance.updated_at !== preview.updatedAt) {
        // A successful save itself makes attendance financially protected.
        // Only the locked database guard may replay this exact Admin/digest's
        // existing receipt; an unrelated or stale change still fails closed.
        return await commit(client, preview, admin);
      }
      if (protectedRecord || !checkoutEligible) {
        if (dryRun) {
          const before = { route_km: Number(attendance.total_route_km || 0),
            payable_km: Number(attendance.total_approved_km || 0), amount: Number(attendance.petrol_amount || 0) };
          return { ok: true, dry_run: true, read_only: true, financial_eligible: false,
            code: protectedRecord ? 'KM_FINANCIAL_STATE_PROTECTED' : 'KM_CHECKOUT_ELIGIBILITY_REVIEW_REQUIRED',
            status: protectedRecord ? 'protected' : 'review_required',
            attendance_id: attendance.id, employee_code: employee, date,
            before, after: { ...before },
            message: protectedRecord
              ? 'Distance preview only. Saved financial values are unchanged. Payable adjustments require the separate authorized correction workflow; checkout eligibility must be reviewed independently.'
              : 'Distance preview only. Checkout petrol eligibility is false or unverified. Review original checkout evidence through the authorized correction workflow; Refresh KM cannot override this restriction.',
            final_leg: { ...diagnostic.final_leg_evidence,
              km: diagnostic.skipped ? null : diagnostic.final_return_leg_km,
              source: diagnostic.source || diagnostic.provider || null,
              status: diagnostic.final_leg_status || 'unavailable',
              reason: diagnostic.skip_reason || diagnostic.reason || null,
              review_flags: diagnostic.review_flags || [],
              included_in_financial_totals: false },
          };
        }
        fail(409, protectedRecord ? 'KM_FINANCIAL_STATE_PROTECTED' : 'KM_CHECKOUT_ELIGIBILITY_REVIEW_REQUIRED',
          protectedRecord ? 'Approved, settled or manually adjusted KM cannot be changed by Refresh KM.' : 'Checkout petrol eligibility is false or unverified; saving is blocked.');
      }
      const prepared = await calculate(client, { attendance_id: attendance.id, dry_run: true }, {
        prepareOnly: true, refreshMissingKmReviews: false, adminAuthorization: admin,
        maxGoogleDirectionsCalls, environment,
      });
      const calculation = prepared.canonical_calculation;
      if (calculation) calculation.manualCheckoutSnapshot = diagnostic.final_leg_evidence?.checkout_eligibility?.snapshot || null;
      const updatedAt = prepared.expected_attendance_updated_at;
      if (!calculation || !updatedAt || prepared.ok === false || prepared.skipped ||
          !['ACCEPTED', 'ACCEPTED_WITH_WARNING'].includes(calculation.decision) ||
          !calculation.canonicalLegs?.length ||
          !/^[a-f0-9]{64}$/.test(calculation.inputDigest || '')) {
        fail(422, 'KM_PREVIEW_UNAVAILABLE', 'Recalculation could not produce a complete canonical preview.');
      }
      const summary = {
        attendance_id: attendance.id, employee_code: attendance.employee_code, date,
        before: { route_km: Number(attendance.total_route_km || 0), payable_km: Number(attendance.total_approved_km || 0), amount: Number(attendance.petrol_amount || 0) },
        after: { route_km: prepared.new_total_route_km, payable_km: calculation.payableKm, amount: calculation.reimbursement },
        final_leg: { ...diagnostic.final_leg_evidence, reason: diagnostic.skip_reason || diagnostic.reason || null,
          km: prepared.final_return_leg_km, source: prepared.final_return_leg_provider, status: prepared.final_return_leg_status },
      };
      if (dryRun) {
        if (previews.size >= maxPreviews) fail(429, 'KM_PREVIEW_CAPACITY', 'Too many pending previews. Please retry shortly.');
        const key = token();
        previews.set(key, { userId: authUser.id, employee, date, reason, attendanceId: attendance.id,
          calculation, updatedAt, summary, expires: now() + ttlMs });
        return { ok: true, dry_run: true, preview_token: key, expires_in_seconds: ttlMs / 1000, ...summary };
      }
      if (updatedAt !== preview.updatedAt || calculation.inputDigest !== preview.calculation.inputDigest ||
          calculation.payableKm !== preview.calculation.payableKm ||
          calculation.reimbursement !== preview.calculation.reimbursement ||
          prepared.new_total_route_km !== preview.summary.after.route_km ||
          calculation.decision !== preview.calculation.decision) {
        fail(409, 'KM_PREVIEW_STALE', 'KM evidence changed after preview. Preview again before approval.');
      }
      if (JSON.stringify(calculation.manualCheckoutSnapshot) !== JSON.stringify(preview.calculation.manualCheckoutSnapshot)) {
        fail(409, 'KM_PREVIEW_STALE', 'Checkout evidence changed after preview. Preview again before approval.');
      }
      // Only this narrow database wrapper may commit a reviewed manual refresh.
      // Its attendance lock and protection checks precede the existing 228 RPC.
      return await commit(client, preview, admin);
    } finally {
      if (preview) preview.running = false;
    }
  };
}
