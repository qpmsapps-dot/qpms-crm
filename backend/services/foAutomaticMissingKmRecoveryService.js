import { createHash } from 'node:crypto';

import {
  recalculateAttendanceTravelLegs,
  refreshMissingKmReviewsForAttendance,
} from '../foKmRecalculationService.js';

export const AUTO_MISSING_KM_APPLY_RPC = 'rpc_apply_fo_gps_complete_missing_leg_v1';
export const AUTO_MISSING_KM_VERSION = 'KM_ENGINE_V2_AUTO_MISSING_LEG_V1';

const ELIGIBLE_LEG_TYPES = new Set([
  'start_to_first_checkin',
  'site_checkout_to_next_checkin',
  'last_checkout_to_end_day',
]);
const GPS_SOURCES = new Set(['GPS_BASED', 'GPS_ROUTE_SUPPORTED']);

const round2 = (value) => Number((Number(value) || 0).toFixed(2));
const text = (value) => String(value || '').trim();

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function serviceError(code, message, statusCode = 409) {
  return Object.assign(new Error(message), { code, statusCode });
}

function queryError(error, fallback) {
  if (!error) return;
  throw serviceError(error.code || 'automatic_missing_km_query_failed', error.message || fallback, 500);
}

async function loadProtectionState(client, attendance) {
  const employeeCode = text(attendance.employee_code || attendance.fo_user_id).toUpperCase();
  const date = text(attendance.attendance_date).slice(0, 10);
  const [correctionResult, settlementResult, appliesResult] = await Promise.all([
    client.from('fo_travel_reimbursement_corrections')
      .select('id,status,correction_key,created_at')
      .eq('attendance_id', attendance.id).eq('status', 'applied').limit(1),
    client.from('fo_monthly_travel_settlements')
      .select('id,period_start,period_end,source_reference')
      .ilike('employee_code', employeeCode).lte('period_start', date).gte('period_end', date).limit(1),
    client.from('fo_km_auto_recovery_applies')
      .select('id,travel_leg_id,applied_km,applied_amount,input_digest,created_at')
      .eq('attendance_id', attendance.id),
  ]);
  queryError(correctionResult.error, 'Unable to load correction-ledger protection state.');
  queryError(settlementResult.error, 'Unable to load settlement protection state.');
  if (appliesResult.error && !['42P01', 'PGRST205'].includes(appliesResult.error.code)) {
    queryError(appliesResult.error, 'Unable to load automatic-recovery audit state.');
  }
  return {
    correction: correctionResult.data?.[0] || null,
    settlement: settlementResult.data?.[0] || null,
    applies: new Map((appliesResult.data || []).map((row) => [row.travel_leg_id, row])),
  };
}

export async function loadAutomaticRecoveryAuthorization(client, employeeCode, fromDate, toDate) {
  const result = await client.from('fo_km_auto_recovery_authorizations')
    .select('id,employee_code,date_from,date_to,max_attendances,max_legs,authorized_by_identity,authorization_reason,expires_at,created_at')
    .eq('employee_code', text(employeeCode).toUpperCase())
    .eq('date_from', text(fromDate).slice(0, 10))
    .eq('date_to', text(toDate).slice(0, 10))
    .eq('status', 'ACTIVE')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (result.error && !['42P01', 'PGRST205'].includes(result.error.code)) {
    queryError(result.error, 'Unable to load the bounded automatic-recovery authorization.');
  }
  return result.data || null;
}

function buildLegPlan(attendance, visits, leg, persisted) {
  const candidateKm = round2(leg.payable_km);
  const rate = round2(leg.rate_per_km);
  const amount = round2(candidateKm * rate);
  const before = {
    totalRouteKm: round2(attendance.total_route_km),
    eligibleKm: round2(attendance.eligible_km),
    totalApprovedKm: round2(attendance.total_approved_km),
    petrolAmount: round2(attendance.petrol_amount),
  };
  const siteVisitRouteKm = round2(visits.reduce(
    (sum, visit) => sum + Math.max(0, Number(visit.route_km) || 0), 0,
  ));
  const evidence = {
    version: AUTO_MISSING_KM_VERSION,
    attendanceId: attendance.id,
    employeeCode: attendance.employee_code || attendance.fo_user_id,
    attendanceDate: attendance.attendance_date,
    travelLegId: persisted.id,
    legType: leg.type,
    startedAt: persisted.started_at,
    endedAt: persisted.ended_at,
    source: leg.source,
    gpsCoverageClassification: leg.gps_coverage_classification,
    decision: leg.decision,
    payable: leg.payable === true,
    candidateKm,
    rate,
    amount,
    before,
    existingLeg: {
      calculatedKm: round2(persisted.calculated_km),
      payableKm: round2(persisted.payable_km),
      payableAmount: round2(persisted.payable_amount),
      fareAmount: round2(persisted.fare_amount),
    },
    siteVisits: { count: visits.length, routeKm: siteVisitRouteKm },
    sourceRowIds: [],
    riskFlags: leg.review_flags || [],
    diagnostics: {
      gpsLogCount: Number(leg.gps_log_count || 0),
      validPoints: Number(leg.valid_points || 0),
      rejectedPoints: Number(leg.rejected_points || 0),
      acceptedGpsKm: round2(leg.accepted_gps_km),
      reconstructedGapKm: round2(leg.reconstructed_gap_km),
      gpsBindingSource: leg.gps_log_binding_source || null,
    },
  };
  return {
    ...evidence,
    inputDigest: digest(evidence),
    attendanceUpdatedAt: attendance.updated_at,
    travelLegUpdatedAt: persisted.updated_at,
  };
}

export function classifyAutomaticMissingKmLeg(attendance, leg, persisted, state) {
  const apply = persisted?.id ? state.applies.get(persisted.id) : null;
  if (apply) return { status: 'ALREADY_APPLIED', apply };
  if (!ELIGIBLE_LEG_TYPES.has(leg.type)) {
    return { status: 'MANUAL_REVIEW', reason: 'LEG_TYPE_NOT_AUTOMATICALLY_ELIGIBLE' };
  }
  if (!persisted?.id) return { status: 'MANUAL_REVIEW', reason: 'PERSISTED_TRAVEL_LEG_REQUIRED' };
  if (round2(persisted.payable_km) > 0 || round2(persisted.payable_amount) > 0 || round2(persisted.fare_amount) > 0) {
    return { status: 'ALREADY_PAYABLE', reason: 'EXISTING_LEG_FINANCIALS_PRESERVED' };
  }
  if (round2(persisted.calculated_km) !== 0) {
    return { status: 'MANUAL_REVIEW', reason: 'NONZERO_CALCULATED_LEG_REQUIRES_RECONCILIATION' };
  }
  if (state.correction) return { status: 'FINANCE_RECONCILIATION', reason: 'EXISTING_APPLIED_CORRECTION' };
  if (state.settlement) return { status: 'FINANCE_RECONCILIATION', reason: 'EXISTING_MONTHLY_SETTLEMENT' };
  if (leg.payable !== true || !GPS_SOURCES.has(leg.source) || leg.gps_coverage_classification !== 'GPS_COMPLETE') {
    return { status: 'MANUAL_REVIEW', reason: leg.fallback_reason || 'GPS_COMPLETE_PAYABLE_EVIDENCE_REQUIRED' };
  }
  if (!(round2(leg.payable_km) > 0) || !(round2(leg.rate_per_km) > 0)) {
    return { status: 'MANUAL_REVIEW', reason: 'STORED_PAYABLE_RATE_OR_KM_MISSING' };
  }
  return { status: 'AUTO_ELIGIBLE' };
}

export async function previewAutomaticMissingKmAttendance(client, attendance) {
  const [calculation, legRowsResult, state] = await Promise.all([
    recalculateAttendanceTravelLegs(client, attendance.id, {
      maxGoogleDirectionsCalls: 0,
      auditDelayedCheckout: false,
      persistLegResults: false,
    }),
    client.from('fo_travel_legs').select('*').eq('attendance_id', attendance.id),
    loadProtectionState(client, attendance),
  ]);
  queryError(legRowsResult.error, 'Unable to load persisted travel legs.');
  const currentAttendance = calculation.attendance || attendance;
  const persistedById = new Map((legRowsResult.data || []).map((row) => [row.id, row]));
  const legs = (calculation.travel_legs || []).map((leg) => {
    const persisted = persistedById.get(leg.persisted_travel_leg_id) || null;
    const classification = classifyAutomaticMissingKmLeg(currentAttendance, leg, persisted, state);
    const plan = classification.status === 'AUTO_ELIGIBLE'
      ? buildLegPlan(currentAttendance, calculation.visits || [], leg, persisted)
      : null;
    return {
      travelLegId: persisted?.id || null,
      legType: leg.type,
      source: leg.source,
      gpsCoverageClassification: leg.gps_coverage_classification || null,
      candidateKm: round2(leg.km),
      automaticallyEligibleKm: plan ? plan.candidateKm : 0,
      ratePerKm: plan ? plan.rate : round2(leg.rate_per_km),
      proposedAmount: plan ? plan.amount : 0,
      existingPayableKm: round2(persisted?.payable_km),
      status: classification.status,
      reason: classification.reason || null,
      existingApply: classification.apply || null,
      plan,
    };
  });
  const automaticKm = round2(legs.reduce((sum, leg) => sum + leg.automaticallyEligibleKm, 0));
  const missingKm = round2(legs.reduce((sum, leg) => (
    ['AUTO_ELIGIBLE', 'MANUAL_REVIEW', 'FINANCE_RECONCILIATION'].includes(leg.status) && leg.candidateKm > 0
      ? sum + leg.candidateKm : sum
  ), 0));
  return {
    attendanceId: attendance.id,
    employeeCode: currentAttendance.employee_code || currentAttendance.fo_user_id,
    attendanceDate: currentAttendance.attendance_date,
    existingKm: round2(currentAttendance.total_approved_km),
    existingReimbursement: round2(currentAttendance.petrol_amount),
    missingKm,
    automaticallyEligibleKm: automaticKm,
    proposedTotalKm: round2(round2(currentAttendance.total_approved_km) + automaticKm),
    proposedReimbursement: round2(round2(currentAttendance.petrol_amount) + legs.reduce((sum, leg) => sum + leg.proposedAmount, 0)),
    status: automaticKm > 0 ? 'AUTO_ELIGIBLE' : legs.some((leg) => leg.status === 'FINANCE_RECONCILIATION')
      ? 'FINANCE_RECONCILIATION' : legs.some((leg) => leg.status === 'MANUAL_REVIEW')
        ? 'MANUAL_REVIEW' : 'NO_CHANGE',
    legs,
    visits: calculation.visits || [],
    travelLegEvidence: calculation.travel_legs || [],
  };
}

async function applyPlan(client, authorization, plan, actor = {}) {
  const { data, error } = await client.rpc(AUTO_MISSING_KM_APPLY_RPC, {
    p_authorization_id: authorization.id,
    p_plan: plan,
    p_actor_user_id: actor.userId,
    p_actor_identity: text(actor.identity),
  });
  queryError(error, 'Unable to apply the bounded GPS_COMPLETE missing-KM leg.');
  return data;
}

export async function runAutomaticMissingKmRecoveryRange(client, attendances = [], options = {}) {
  const authorization = options.authorization || null;
  const actor = options.actor || {};
  const initialRows = [];
  for (const attendance of attendances) {
    if (!attendance?.id || !attendance.logout_time) continue;
    try {
      initialRows.push(await previewAutomaticMissingKmAttendance(client, attendance));
    } catch (error) {
      initialRows.push({
        attendanceId: attendance.id,
        employeeCode: attendance.employee_code || attendance.fo_user_id,
        attendanceDate: attendance.attendance_date,
        status: 'MANUAL_REVIEW',
        warning: error.message,
        code: error.code || 'AUTOMATIC_MISSING_KM_PREVIEW_FAILED',
        legs: [],
      });
    }
  }

  const eligibleLegCount = initialRows.reduce(
    (sum, row) => sum + (row.legs || []).filter((leg) => leg.status === 'AUTO_ELIGIBLE').length, 0,
  );
  if (!authorization) {
    return summarize(initialRows, [], {
      outcome: eligibleLegCount > 0 ? 'authorization_required' : 'no_eligible_changes',
      authorizationRequired: eligibleLegCount > 0,
    });
  }
  if (attendances.length > Number(authorization.max_attendances) || eligibleLegCount > Number(authorization.max_legs)) {
    throw serviceError('AUTO_RECOVERY_AUTHORIZATION_LIMIT_EXCEEDED',
      'The selected batch exceeds its bounded attendance or travel-leg authorization.', 403);
  }

  const applies = [];
  for (const initialRow of initialRows) {
    const attendance = attendances.find((row) => row.id === initialRow.attendanceId);
    if (!attendance) continue;
    await refreshMissingKmReviewsForAttendance(
      client,
      attendance,
      initialRow.visits || [],
      initialRow.travelLegEvidence || [],
      {
      actorSource: text(actor.identity) || 'automatic_missing_km_recovery',
      },
    );
    let preview = initialRow;
    const attempted = new Set();
    while (true) {
      const candidate = (preview.legs || []).find((leg) => (
        leg.status === 'AUTO_ELIGIBLE' && leg.plan && !attempted.has(leg.travelLegId)
      ));
      if (!candidate) break;
      attempted.add(candidate.travelLegId);
      try {
        applies.push(await applyPlan(client, authorization, candidate.plan, actor));
      } catch (error) {
        applies.push({
          ok: false,
          attendance_id: preview.attendanceId,
          travel_leg_id: candidate.travelLegId,
          code: error.code || 'AUTOMATIC_MISSING_KM_APPLY_FAILED',
          message: error.message,
        });
      }
      preview = await previewAutomaticMissingKmAttendance(client, attendance);
    }
  }

  const refreshedRows = [];
  for (const attendance of attendances) {
    if (!attendance?.id || !attendance.logout_time) continue;
    const row = await previewAutomaticMissingKmAttendance(client, attendance);
    const rowApplies = applies.filter((apply) => apply.attendance_id === attendance.id);
    row.appliedKm = round2(rowApplies.reduce((sum, apply) => sum + Number(apply.applied_km || 0), 0));
    row.appliedReimbursement = round2(rowApplies.reduce((sum, apply) => sum + Number(apply.applied_amount || 0), 0));
    row.applyErrors = rowApplies.filter((apply) => apply.ok === false);
    refreshedRows.push(row);
  }
  return summarize(refreshedRows, applies, {
    outcome: applies.some((row) => row.ok === false) ? 'partial_success' : applies.length ? 'applied' : 'no_eligible_changes',
    authorizationRequired: false,
  });
}

function summarize(rows, applies, extras = {}) {
  const summary = {
    attendanceCount: rows.length,
    existingKm: round2(rows.reduce((sum, row) => sum + Number(row.existingKm || 0), 0)),
    missingKm: round2(rows.reduce((sum, row) => sum + Number(row.missingKm || 0), 0)),
    automaticallyEligibleKm: round2(rows.reduce((sum, row) => sum + Number(row.automaticallyEligibleKm || 0), 0)),
    appliedKm: round2(applies.reduce((sum, row) => sum + Number(row.applied_km || 0), 0)),
    appliedReimbursement: round2(applies.reduce((sum, row) => sum + Number(row.applied_amount || 0), 0)),
    manualReviewCount: rows.filter((row) => row.status === 'MANUAL_REVIEW').length,
    financeReconciliationCount: rows.filter((row) => row.status === 'FINANCE_RECONCILIATION').length,
    failedApplyCount: applies.filter((row) => row.ok === false).length,
  };
  const responseRows = rows.map((sourceRow) => {
    const row = { ...sourceRow };
    delete row.visits;
    delete row.travelLegEvidence;
    return row;
  });
  return {
    ok: true,
    rows: responseRows,
    applies,
    summary,
    ...extras,
  };
}
