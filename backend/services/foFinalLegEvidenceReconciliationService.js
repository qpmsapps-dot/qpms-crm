import { createHash } from 'node:crypto';

import { calculateTravelLegKm } from '../foKmRecalculationService.js';

export const FINAL_LEG_EVIDENCE_VERSION = 'KM_ENGINE_V2_FINAL_LEG_EVIDENCE_V1';
export const FINAL_LEG_EVIDENCE_RPC = 'rpc_record_fo_final_leg_evidence_v1';
export const FINAL_LEG_EVIDENCE_TARGETS = Object.freeze([
  Object.freeze({
    attendanceId: 'a8d170e6-cbb4-4788-928d-6eb9999d51e2',
    finalLegId: '48991354-ca06-4856-9931-8f95e6bb932e',
    employeeCode: 'QPMSTNC17015',
    attendanceDate: '2026-10-07',
    protectedBaseKm: 76.45,
    siteVisitCount: 7,
    financialApplyAuthorized: true,
  }),
  Object.freeze({
    attendanceId: 'd299f0c4-9af7-4f0c-b8cc-86e5b7fb1f91',
    finalLegId: '850bc41b-e492-4661-9f5e-05aaafb19d0c',
    employeeCode: 'QPMSTNC17015',
    attendanceDate: '2026-10-08',
    financialApplyAuthorized: false,
  }),
]);

// Backward-compatible export for the separately guarded 7 October financial apply.
export const FINAL_LEG_EVIDENCE_TARGET = FINAL_LEG_EVIDENCE_TARGETS[0];

const GPS_PAYABLE_EVIDENCE_SOURCES = new Set(['GPS_BASED', 'GPS_ROUTE_SUPPORTED']);
const VERIFIED_ROUTE_SOURCE = 'VERIFIED_ROAD_ROUTE';
const BOUNDARY_TOLERANCE_MS = 1_000;
const COORDINATE_TOLERANCE_METERS = 25;

function number(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round2(value) {
  return Number((number(value) || 0).toFixed(2));
}

function timestamp(value) {
  const parsed = value ? new Date(value) : null;
  return parsed && Number.isFinite(parsed.getTime()) ? parsed : null;
}

function coordinate(latitude, longitude) {
  const lat = number(latitude);
  const lng = number(longitude);
  if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { latitude: lat, longitude: lng };
}

function haversineMeters(left, right) {
  if (!left || !right) return Number.POSITIVE_INFINITY;
  const radians = (degrees) => degrees * Math.PI / 180;
  const latitudeDelta = radians(right.latitude - left.latitude);
  const longitudeDelta = radians(right.longitude - left.longitude);
  const a = Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(left.latitude)) * Math.cos(radians(right.latitude)) *
    Math.sin(longitudeDelta / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

function visitCheckoutTime(visit = {}) {
  return timestamp(visit.check_out_time || visit.checkout_time || visit.check_out_at);
}

function visitCheckoutCoordinate(visit = {}) {
  return coordinate(
    visit.check_out_latitude ?? visit.checkout_latitude ?? visit.current_latitude,
    visit.check_out_longitude ?? visit.checkout_longitude ?? visit.current_longitude,
  );
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');
}

function requireRow(row, code, message) {
  if (row) return row;
  const error = new Error(message);
  error.code = code;
  error.statusCode = 404;
  throw error;
}

function queryError(error, fallback) {
  if (!error) return;
  const wrapped = new Error(error.message || fallback);
  wrapped.code = error.code || 'final_leg_evidence_query_failed';
  wrapped.details = error.details || null;
  wrapped.statusCode = 500;
  throw wrapped;
}

function candidateClassification(calculation = {}, { independentlyVerifiedRoadRoute = false } = {}) {
  const source = String(calculation.legSource || 'SKIPPED').trim().toUpperCase();
  const calculatedKm = round2(calculation.legKm);
  if (calculatedKm <= 0 || source === 'SKIPPED') {
    return {
      persistable: false,
      source,
      candidateKm: 0,
      reason: calculation.fallbackReason || 'FINAL_LEG_ZERO_OR_INVALID_CANDIDATE',
      flags: ['FINAL_LEG_ZERO_OR_INVALID_CANDIDATE'],
      referenceOnly: false,
    };
  }
  if (GPS_PAYABLE_EVIDENCE_SOURCES.has(source)) {
    return {
      persistable: true,
      source,
      candidateKm: calculatedKm,
      reason: 'VALID_GPS_EVIDENCE_RECORDED_PENDING_PAYABLE_REVIEW',
      flags: ['FINAL_LEG_PAYABLE_REVIEW_REQUIRED'],
      referenceOnly: false,
    };
  }
  if (source === 'GOOGLE_ROUTE_FALLBACK' && independentlyVerifiedRoadRoute) {
    return {
      persistable: true,
      source: VERIFIED_ROUTE_SOURCE,
      candidateKm: calculatedKm,
      reason: 'INDEPENDENT_ROAD_ROUTE_EVIDENCE_RECORDED_PENDING_PAYABLE_REVIEW',
      flags: ['FINAL_LEG_PAYABLE_REVIEW_REQUIRED', 'INDEPENDENT_ROAD_ROUTE_VERIFICATION_REQUIRED'],
      referenceOnly: false,
    };
  }
  if (source === 'HAVERSINE_ROUTE_FALLBACK') {
    return {
      persistable: true,
      source: 'HAVERSINE_REFERENCE',
      candidateKm: calculatedKm,
      reason: 'HAVERSINE_ONLY_MANUAL_REVIEW_NONPAYABLE',
      flags: ['FINAL_LEG_PAYABLE_REVIEW_REQUIRED', 'HAVERSINE_ONLY_NOT_PAYABLE'],
      referenceOnly: true,
    };
  }
  return {
    persistable: false,
    source,
    candidateKm: calculatedKm,
    reason: source === 'HAVERSINE_ROUTE_FALLBACK'
      ? 'HAVERSINE_ONLY_MANUAL_REVIEW_NONPAYABLE'
      : 'FINAL_LEG_SOURCE_NOT_AUTHORIZED_FOR_PERSISTENCE',
    flags: [
      'FINAL_LEG_PAYABLE_REVIEW_REQUIRED',
      source === 'HAVERSINE_ROUTE_FALLBACK'
        ? 'HAVERSINE_ONLY_NOT_PAYABLE'
        : 'FINAL_LEG_SOURCE_NOT_AUTHORIZED_FOR_PERSISTENCE',
    ],
    referenceOnly: true,
  };
}

export function buildFinalLegEvidencePlan({
  attendance,
  finalLeg,
  visits = [],
  gpsRows = [],
  calculation = {},
  expectedEmployeeCode,
  expectedAttendanceDate,
  expectedBaseKm,
  expectedSiteVisitCount,
  expectedSiteVisitRouteKm,
  expectedPetrolAmount,
  independentlyVerifiedRoadRoute = false,
} = {}) {
  requireRow(attendance, 'final_leg_attendance_missing', 'Target attendance was not found.');
  requireRow(finalLeg, 'final_leg_row_missing', 'Target final travel leg was not found.');
  if (finalLeg.attendance_id !== attendance.id) {
    throw Object.assign(new Error('Final leg does not belong to the target attendance.'), {
      code: 'final_leg_attendance_mismatch', statusCode: 409,
    });
  }
  if (String(finalLeg.status || '').toLowerCase() !== 'completed') {
    throw Object.assign(new Error('Final leg must be completed before evidence reconciliation.'), {
      code: 'final_leg_not_completed', statusCode: 409,
    });
  }
  const employeeCode = String(attendance.employee_code || attendance.fo_user_id || '').trim();
  const authorizedTarget = FINAL_LEG_EVIDENCE_TARGETS.find((target) => (
    attendance.id === target.attendanceId &&
    finalLeg.id === target.finalLegId &&
    employeeCode === target.employeeCode &&
    attendance.attendance_date === target.attendanceDate
  ));
  if (!authorizedTarget) {
    throw Object.assign(new Error('Final-leg evidence persistence is not authorized for this target.'), {
      code: 'final_leg_target_not_authorized', statusCode: 403,
    });
  }
  if (expectedEmployeeCode && employeeCode !== String(expectedEmployeeCode).trim()) {
    throw Object.assign(new Error('Attendance employee does not match the expected employee.'), {
      code: 'final_leg_employee_mismatch', statusCode: 409,
    });
  }
  if (expectedAttendanceDate && attendance.attendance_date !== expectedAttendanceDate) {
    throw Object.assign(new Error('Attendance date does not match the expected date.'), {
      code: 'final_leg_date_mismatch', statusCode: 409,
    });
  }

  const legStart = timestamp(finalLeg.started_at);
  const legEnd = timestamp(finalLeg.ended_at);
  const attendanceEnd = timestamp(attendance.logout_time);
  const orderedVisits = [...visits].filter(visitCheckoutTime).sort((a, b) => visitCheckoutTime(a) - visitCheckoutTime(b));
  const lastVisit = orderedVisits.at(-1);
  const lastCheckout = visitCheckoutTime(lastVisit);
  const legStartCoordinate = coordinate(finalLeg.start_lat, finalLeg.start_lng);
  const legEndCoordinate = coordinate(finalLeg.end_lat, finalLeg.end_lng);
  const visitCoordinate = visitCheckoutCoordinate(lastVisit);
  const attendanceCoordinate = coordinate(attendance.end_latitude, attendance.end_longitude);
  const boundariesMatch = Boolean(
    legStart && legEnd && attendanceEnd && lastCheckout &&
    Math.abs(legStart - lastCheckout) <= BOUNDARY_TOLERANCE_MS &&
    Math.abs(legEnd - attendanceEnd) <= BOUNDARY_TOLERANCE_MS &&
    haversineMeters(legStartCoordinate, visitCoordinate) <= COORDINATE_TOLERANCE_METERS &&
    haversineMeters(legEndCoordinate, attendanceCoordinate) <= COORDINATE_TOLERANCE_METERS
  );
  if (!boundariesMatch) {
    throw Object.assign(new Error('Final leg boundaries do not match the final Check-Out and End Day anchors.'), {
      code: 'final_leg_boundary_mismatch', statusCode: 409,
    });
  }

  const siteVisitRouteKm = round2(visits.reduce((sum, visit) => sum + Math.max(0, number(visit.route_km) || 0), 0));
  const baseKm = round2(attendance.total_route_km);
  const eligibleKm = round2(attendance.eligible_km);
  const approvedKm = round2(attendance.total_approved_km);
  const petrolAmount = round2(attendance.petrol_amount);
  const expectedKm = round2(expectedBaseKm);
  if (
    (expectedBaseKm !== undefined && (baseKm !== expectedKm || eligibleKm !== expectedKm || approvedKm !== expectedKm)) ||
    (expectedSiteVisitCount !== undefined && visits.length !== Number(expectedSiteVisitCount)) ||
    (expectedSiteVisitRouteKm !== undefined && siteVisitRouteKm !== round2(expectedSiteVisitRouteKm)) ||
    (expectedPetrolAmount !== undefined && petrolAmount !== round2(expectedPetrolAmount))
  ) {
    throw Object.assign(new Error('Existing attendance, visit or reimbursement totals do not match the guarded expectations.'), {
      code: 'final_leg_existing_totals_mismatch', statusCode: 409,
    });
  }

  const classification = candidateClassification(calculation, { independentlyVerifiedRoadRoute });
  const riskFlags = [...new Set([...(calculation.reviewFlags || []), ...classification.flags])].sort();
  const sourceRowIds = gpsRows.map((row) => row.id).filter(Boolean).sort();
  const evidenceInput = {
    version: FINAL_LEG_EVIDENCE_VERSION,
    attendanceId: attendance.id,
    employeeCode,
    attendanceDate: attendance.attendance_date,
    finalLegId: finalLeg.id,
    startedAt: legStart.toISOString(),
    endedAt: legEnd.toISOString(),
    start: legStartCoordinate,
    end: legEndCoordinate,
    existingPayableKm: round2(finalLeg.payable_km),
    existingPayableAmount: round2(finalLeg.payable_amount),
    existingFareAmount: round2(finalLeg.fare_amount),
    attendanceTotals: { totalRouteKm: baseKm, eligibleKm, totalApprovedKm: approvedKm, petrolAmount },
    visits: { count: visits.length, routeKm: siteVisitRouteKm },
    evidence: {
      source: classification.source,
      gpsCoverageClassification: calculation.gpsCoverageClassification || null,
      candidateCalculatedKm: classification.candidateKm,
      gpsLogCount: Number(calculation.gpsLogCount || gpsRows.length || 0),
      rawSampleCount: Number(calculation.gpsRawSampleCount ?? calculation.gpsLogCount ?? gpsRows.length ?? 0),
      duplicateSampleCount: Number(calculation.gpsDuplicateSampleCount || 0),
      effectiveSampleCount: Number(calculation.gpsEffectiveSampleCount ?? calculation.gpsLogCount ?? gpsRows.length ?? 0),
      validPointCount: Number(calculation.validPoints || 0),
      validSampleRatio: Number(calculation.gpsValidRatio || 0),
      rejectedPointCount: Number(calculation.rejectedPoints || 0),
      rejectedUniqueSampleCount: Number(calculation.gpsRejectedUniqueSampleCount || 0),
      rejectedPointReasons: calculation.rejectionReasonCounts || {},
      acceptedGpsKm: round2(calculation.acceptedGpsKm ?? calculation.filteredGpsKm),
      sourceRowIds,
      sourceRows: gpsRows.map((row) => ({
        id: row.id || null,
        latitude: number(row.latitude),
        longitude: number(row.longitude),
        accuracy: number(row.accuracy),
        mocked: row.is_mocked === true,
        capturedAt: row.captured_at || null,
        receivedAt: row.logged_at || row.created_at || null,
      })),
      riskFlags,
    },
  };

  return {
    calculationVersion: FINAL_LEG_EVIDENCE_VERSION,
    inputDigest: digest(evidenceInput),
    attendanceId: attendance.id,
    employeeCode,
    attendanceDate: attendance.attendance_date,
    attendanceUpdatedAt: attendance.updated_at,
    finalLegId: finalLeg.id,
    finalLegUpdatedAt: finalLeg.updated_at,
    startedAt: legStart.toISOString(),
    endedAt: legEnd.toISOString(),
    startLat: legStartCoordinate.latitude,
    startLng: legStartCoordinate.longitude,
    endLat: legEndCoordinate.latitude,
    endLng: legEndCoordinate.longitude,
    existingCalculatedKm: round2(finalLeg.calculated_km),
    existingPayableKm: round2(finalLeg.payable_km),
    existingPayableAmount: round2(finalLeg.payable_amount),
    existingFareAmount: round2(finalLeg.fare_amount),
    expectedTotalRouteKm: baseKm,
    expectedEligibleKm: eligibleKm,
    expectedTotalApprovedKm: approvedKm,
    expectedPetrolAmount: petrolAmount,
    expectedSiteVisitCount: visits.length,
    expectedSiteVisitRouteKm: siteVisitRouteKm,
    candidateCalculatedKm: classification.candidateKm,
    proposedPayableKm: 0,
    proposedReimbursementChange: 0,
    decision: 'MANUAL_REVIEW',
    source: classification.source,
    gpsCoverageClassification: evidenceInput.evidence.gpsCoverageClassification,
    referenceOnly: classification.referenceOnly === true,
    reason: classification.reason,
    riskFlags,
    gpsLogCount: evidenceInput.evidence.gpsLogCount,
    rawSampleCount: evidenceInput.evidence.rawSampleCount,
    duplicateSampleCount: evidenceInput.evidence.duplicateSampleCount,
    effectiveSampleCount: evidenceInput.evidence.effectiveSampleCount,
    validPointCount: evidenceInput.evidence.validPointCount,
    validSampleRatio: evidenceInput.evidence.validSampleRatio,
    rejectedPointCount: evidenceInput.evidence.rejectedPointCount,
    rejectedUniqueSampleCount: evidenceInput.evidence.rejectedUniqueSampleCount,
    rejectedPointReasons: evidenceInput.evidence.rejectedPointReasons,
    acceptedGpsKm: evidenceInput.evidence.acceptedGpsKm,
    sourceRowIds,
    persistable: classification.persistable,
    preservesExistingFinancials: true,
    canonicalRecalculationComplete: false,
  };
}

export async function prepareFinalLegEvidenceReconciliation(client, payload = {}, options = {}) {
  if (!client || typeof client.from !== 'function') {
    throw Object.assign(new Error('A service-role Supabase client is required.'), {
      code: 'final_leg_service_role_client_required', statusCode: 503,
    });
  }
  const attendanceId = String(payload.attendance_id || '').trim();
  const finalLegId = String(payload.final_leg_id || '').trim();
  if (!attendanceId || !finalLegId) {
    throw Object.assign(new Error('attendance_id and final_leg_id are required.'), {
      code: 'final_leg_required_ids_missing', statusCode: 400,
    });
  }
  const [attendanceResult, legResult, visitsResult] = await Promise.all([
    client.from('fo_attendance').select('*').eq('id', attendanceId).maybeSingle(),
    client.from('fo_travel_legs').select('*').eq('id', finalLegId).eq('attendance_id', attendanceId).maybeSingle(),
    client.from('fo_site_visits').select('*').eq('attendance_id', attendanceId).order('check_in_time'),
  ]);
  queryError(attendanceResult.error, 'Unable to load target attendance.');
  queryError(legResult.error, 'Unable to load target final leg.');
  queryError(visitsResult.error, 'Unable to load target site visits.');
  const attendance = requireRow(attendanceResult.data, 'final_leg_attendance_missing', 'Target attendance was not found.');
  const finalLeg = requireRow(legResult.data, 'final_leg_row_missing', 'Target final travel leg was not found.');
  const visits = visitsResult.data || [];
  const startedAt = timestamp(finalLeg.started_at);
  const endedAt = timestamp(finalLeg.ended_at);
  if (!startedAt || !endedAt) {
    throw Object.assign(new Error('Final leg has an invalid time window.'), {
      code: 'final_leg_invalid_time_window', statusCode: 409,
    });
  }
  const gpsResult = await client
    .from('fo_location_logs')
    .select('id,latitude,longitude,accuracy,speed,is_mocked,captured_at,logged_at,created_at,metadata')
    .eq('attendance_id', attendanceId)
    .gt('captured_at', startedAt.toISOString())
    .lte('captured_at', endedAt.toISOString())
    .order('captured_at');
  queryError(gpsResult.error, 'Unable to load final-leg GPS evidence.');
  const gpsRows = gpsResult.data || [];
  const calculation = await calculateTravelLegKm({
    client,
    attendance,
    fromTime: startedAt,
    toTime: endedAt,
    fromLat: finalLeg.start_lat,
    fromLng: finalLeg.start_lng,
    toLat: finalLeg.end_lat,
    toLng: finalLeg.end_lng,
    employeeCode: attendance.employee_code || attendance.fo_user_id,
    attendanceId,
    legType: 'last_checkout_to_end_day',
    routeEvidence: options.routeEvidence || null,
    options: {
      ...options,
      maxGoogleDirectionsCalls: options.maxGoogleDirectionsCalls ?? 0,
    },
  });
  return buildFinalLegEvidencePlan({
    attendance,
    finalLeg,
    visits,
    gpsRows,
    calculation,
    expectedEmployeeCode: payload.expected_employee_code,
    expectedAttendanceDate: payload.expected_attendance_date,
    expectedBaseKm: payload.expected_base_km,
    expectedSiteVisitCount: payload.expected_site_visit_count,
    expectedSiteVisitRouteKm: payload.expected_site_visit_route_km,
    expectedPetrolAmount: payload.expected_petrol_amount,
    independentlyVerifiedRoadRoute: options.independentlyVerifiedRoadRoute === true,
  });
}

export async function persistFinalLegEvidenceReconciliation(client, plan, { actorSource = null } = {}) {
  if (!plan?.persistable) {
    const error = new Error(plan?.reason || 'Final-leg evidence is not eligible for persistence.');
    error.code = 'final_leg_evidence_not_persistable';
    error.statusCode = 409;
    throw error;
  }
  if (!client || typeof client.rpc !== 'function') {
    throw Object.assign(new Error('A service-role Supabase RPC client is required.'), {
      code: 'final_leg_service_role_rpc_required', statusCode: 503,
    });
  }
  const { data, error } = await client.rpc(FINAL_LEG_EVIDENCE_RPC, {
    p_plan: plan,
    p_actor_source: actorSource,
  });
  if (error) {
    const message = String(error.message || 'Final-leg evidence persistence failed.');
    const schemaMissing = ['PGRST202', '42883', '42P01', '42703'].includes(error.code) ||
      /schema cache|does not exist|could not find the function/i.test(message);
    const wrapped = new Error(schemaMissing
      ? 'Final-leg evidence schema is not deployed. Apply canonical V2 prerequisites before retrying.'
      : message);
    wrapped.code = schemaMissing ? 'final_leg_evidence_schema_missing' : (error.code || 'final_leg_evidence_persistence_failed');
    wrapped.statusCode = schemaMissing ? 503 : (error.code === '40001' ? 409 : 500);
    wrapped.details = error.details || null;
    throw wrapped;
  }
  return data;
}
