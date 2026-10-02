import { createHash } from 'node:crypto';

export const KM_ENGINE_VERSION = 'KM_ENGINE_V2';

export const KM_DECISION = Object.freeze({
  ACCEPTED: 'ACCEPTED',
  ACCEPTED_WITH_WARNING: 'ACCEPTED_WITH_WARNING',
  MANUAL_REVIEW: 'MANUAL_REVIEW',
  REJECTED: 'REJECTED',
});

export const KM_RISK_FLAG = Object.freeze({
  STALE_PROVIDER_FIX: 'STALE_PROVIDER_FIX',
  IMPOSSIBLE_SPEED: 'IMPOSSIBLE_SPEED',
  OSCILLATION: 'OSCILLATION',
  GAP_DOMINANT: 'GAP_DOMINANT',
  DIRECT_ROUTE_MISMATCH: 'DIRECT_ROUTE_MISMATCH',
  ROUTE_DURATION_MISMATCH: 'ROUTE_DURATION_MISMATCH',
  POOR_GPS_COVERAGE: 'POOR_GPS_COVERAGE',
  LONG_DISTANCE: 'LONG_DISTANCE',
  CROSS_MIDNIGHT: 'CROSS_MIDNIGHT',
  MISSING_CHECKOUT: 'MISSING_CHECKOUT',
  LEGACY_BOUNDARY: 'LEGACY_BOUNDARY',
  GPS_UNDERCOVERED: 'GPS_UNDERCOVERED',
  ROUTE_SUPPORTED: 'ROUTE_SUPPORTED',
  ROUTE_EVIDENCE_INVALID: 'ROUTE_EVIDENCE_INVALID',
  SHORT_WINDOW_SPEED_UNCERTAIN: 'SHORT_WINDOW_SPEED_UNCERTAIN',
  ROUTE_DETOUR: 'ROUTE_DETOUR',
});

export const KM_COVERAGE_CLASSIFICATION = Object.freeze({
  GPS_COMPLETE: 'GPS_COMPLETE',
  GPS_UNDERCOVERED: 'GPS_UNDERCOVERED',
  ROUTE_SUPPORTED: 'ROUTE_SUPPORTED',
  MANUAL_REVIEW: 'MANUAL_REVIEW',
});

export const KM_TRANSPORT_CLASSIFICATION = Object.freeze({
  EXPLICIT_INTERNAL_TRAIN_EVIDENCE: 'EXPLICIT_INTERNAL_TRAIN_EVIDENCE',
  HIGH_CONFIDENCE_RAIL_CORROBORATED: 'HIGH_CONFIDENCE_RAIL_CORROBORATED',
  RAIL_GAP_POLICY_NON_PAYABLE: 'RAIL_GAP_POLICY_NON_PAYABLE',
  MEDIUM_MANUAL_REVIEW: 'MEDIUM_MANUAL_REVIEW',
  PAYABLE_PRIVATE_MODE: 'PAYABLE_PRIVATE_MODE',
});

export const GOOGLE_TRANSIT_EVIDENCE = Object.freeze({
  RAIL_CORROBORATED: 'RAIL_CORROBORATED',
  NON_RAIL_TRANSIT: 'NON_RAIL_TRANSIT',
  EMPTY_ROUTE: 'EMPTY_ROUTE',
  UNAVAILABLE: 'UNAVAILABLE',
  NO_EVIDENCE: 'NO_EVIDENCE',
});

const RAIL_MODES = new Set(['train', 'rail', 'public_transport', 'public_transit']);
const PRIVATE_MODES = new Set(['bike', 'own_vehicle', 'car']);
const GOOGLE_RAIL_VEHICLE_TYPES = new Set([
  'RAIL',
  'METRO_RAIL',
  'SUBWAY',
  'TRAM',
  'MONORAIL',
  'HEAVY_RAIL',
  'COMMUTER_TRAIN',
  'HIGH_SPEED_TRAIN',
  'LONG_DISTANCE_TRAIN',
]);
const GOOGLE_BUS_VEHICLE_TYPES = new Set(['BUS', 'INTERCITY_BUS', 'TROLLEYBUS']);

export const GPS_REJECTION_REASON = Object.freeze({
  INVALID_COORDINATE: 'invalid_coordinate',
  ZERO_COORDINATE: 'zero_coordinate',
  POOR_ACCURACY: 'poor_accuracy',
  MOCKED: 'mocked',
  STALE_PROVIDER_TIMESTAMP: 'stale_provider_timestamp',
  FUTURE_TIMESTAMP: 'future_timestamp',
  OUTSIDE_ATTENDANCE_WINDOW: 'outside_attendance_window',
  DUPLICATE: 'duplicate',
  IMPOSSIBLE_SPEED: 'impossible_speed',
  STALE_CLUSTER: 'stale_cluster',
  OSCILLATION_OUTLIER: 'oscillation_outlier',
  IDENTITY_MISMATCH: 'identity_mismatch',
});

export const DEFAULT_KM_V2_POLICY = Object.freeze({
  maxAccuracyMeters: 50,
  minSegmentMeters: 5,
  maxNormalGapSeconds: 600,
  maxNormalSegmentMeters: 2500,
  maxPhysicalSpeedKmph: 120,
  duplicateWindowSeconds: 10,
  providerMaxAgeSeconds: 600,
  futureToleranceSeconds: 120,
  attendanceWindowToleranceSeconds: 300,
  oscillationMinimumJumpKm: 10,
  oscillationReturnRadiusKm: 1,
  oscillationMaximumSpanSeconds: 1200,
  maxRouteToStraightLineRatio: 4,
  maxWholeLegToDirectRatio: 1.75,
  wholeLegMismatchMinimumKm: 5,
  longDistanceReviewKm: 300,
  gapDominanceRatio: 0.75,
  undercoverageRatio: 0.75,
  undercoverageMinimumShortfallKm: 3,
  coverageEndpointFloorRatio: 0.85,
  coverageRouteCeilingRatio: 1.25,
  contaminatedCoverageMinMovementMeters: 15,
  speedGateMinimumDistanceKm: 0.5,
});

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function validDate(value) {
  const date = value instanceof Date ? value : value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function normalizedMode(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function roundedMoney(value) {
  return Number(Number(value || 0).toFixed(2));
}

function transportRate(mode, fallback = null) {
  const normalized = normalizedMode(mode);
  if (RAIL_MODES.has(normalized) || ['auto', 'bus', 'other'].includes(normalized)) return 0;
  const historicalRate = finiteNumber(fallback);
  if (historicalRate !== null && historicalRate >= 0) return historicalRate;
  if (normalized === 'car') return 8;
  if (['bike', 'own_vehicle'].includes(normalized)) return 4;
  return 0;
}

function legMode(leg = {}) {
  return normalizedMode(leg.mode || leg.travel_mode || leg.travelMode || leg.detected_mode);
}

function legDistance(leg = {}) {
  return finiteNumber(
    leg.km ?? leg.physical_km ?? leg.physicalKm ?? leg.calculated_km ?? leg.calculatedKm ?? leg.distance_km ?? leg.distanceKm,
  ) ?? 0;
}

function correctionIsAppliedMixedMode(correction = {}) {
  const key = String(correction.correction_key || correction.correctionKey || '').toLowerCase();
  const reason = String(correction.correction_reason || correction.correctionReason || '').toLowerCase();
  const status = String(correction.status || '').toLowerCase();
  const before = correction.before_state || correction.beforeState || {};
  const modes = before.modes_used || before.modesUsed || [];
  const legs = before.leg_breakdown || before.legBreakdown || [];
  const hasRail = modes.some((mode) => RAIL_MODES.has(normalizedMode(mode))) || legs.some((leg) => RAIL_MODES.has(legMode(leg)));
  return status === 'applied' && hasRail && (key.includes('mixed-mode') || reason.includes('mixed-mode') || reason.includes('rail'));
}

function authoritativeAppliedCorrection(corrections = []) {
  const correction = corrections.find(correctionIsAppliedMixedMode) || null;
  if (!correction) return null;
  const applied = correction.applied_state || correction.appliedState || {};
  const attendance = applied.attendance || applied.result || {};
  const payableKm = finiteNumber(attendance.total_approved_km ?? attendance.totalApprovedKm);
  const reimbursement = finiteNumber(attendance.petrol_amount ?? attendance.petrolAmount);
  const routeKm = finiteNumber(attendance.total_route_km ?? attendance.totalRouteKm ?? payableKm);
  if (payableKm === null || reimbursement === null) return null;
  return {
    id: correction.id || null,
    correctionKey: correction.correction_key || correction.correctionKey || null,
    payableKm: roundedMoney(payableKm),
    reimbursement: roundedMoney(reimbursement),
    routeKm: roundedMoney(routeKm),
    reason: 'PRESERVE_APPLIED_CORRECTION',
  };
}

function collectGoogleVehicleTypes(value, result = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectGoogleVehicleTypes(item, result);
    return result;
  }
  if (!value || typeof value !== 'object') return result;
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.replace(/_/g, '').toLowerCase();
    if (
      normalizedKey === 'vehicletype' ||
      (normalizedKey === 'type' && typeof child === 'string' && (
        GOOGLE_RAIL_VEHICLE_TYPES.has(child.trim().toUpperCase()) ||
        GOOGLE_BUS_VEHICLE_TYPES.has(child.trim().toUpperCase())
      ))
    ) {
      result.push(String(child || '').trim().toUpperCase());
    } else {
      collectGoogleVehicleTypes(child, result);
    }
  }
  return result;
}

export function classifyGoogleTransitEvidence(googleTransit = null) {
  if (!googleTransit) return GOOGLE_TRANSIT_EVIDENCE.NO_EVIDENCE;
  if (googleTransit.unavailable === true || googleTransit.error || googleTransit.ok === false) {
    return GOOGLE_TRANSIT_EVIDENCE.UNAVAILABLE;
  }
  const vehicleTypes = collectGoogleVehicleTypes(googleTransit);
  if (vehicleTypes.some((type) => GOOGLE_RAIL_VEHICLE_TYPES.has(type))) {
    return GOOGLE_TRANSIT_EVIDENCE.RAIL_CORROBORATED;
  }
  if (vehicleTypes.some((type) => GOOGLE_BUS_VEHICLE_TYPES.has(type))) {
    return GOOGLE_TRANSIT_EVIDENCE.NON_RAIL_TRANSIT;
  }
  const status = String(googleTransit.status || '').trim().toUpperCase();
  const routes = googleTransit.routes;
  if (status === 'ZERO_RESULTS' || (Array.isArray(routes) && routes.length === 0)) {
    return GOOGLE_TRANSIT_EVIDENCE.EMPTY_ROUTE;
  }
  return GOOGLE_TRANSIT_EVIDENCE.NO_EVIDENCE;
}

/**
 * Pure policy layer for rail/public-transport reimbursement. Google transit is
 * corroboration only: authoritative internal legs/corrections always win.
 * Physical distance and the originally selected private mode are never
 * rewritten by this function.
 */
export function classifyRailPublicTransportPolicy(input = {}) {
  const selectedMode = normalizedMode(input.selectedMode || input.selected_mode || input.travelMode || input.travel_mode);
  const physicalKm = finiteNumber(
    input.physicalKm ?? input.physical_km ?? input.calculatedKm ?? input.calculated_km ?? input.distanceKm ?? input.distance_km,
  ) ?? Number(input.acceptedGpsKm || input.accepted_gps_km || 0) + Number(input.reconstructedGapKm || input.reconstructed_gap_km || 0);
  const existingPayableKm = finiteNumber(input.payableKm ?? input.payable_km);
  const existingPayableAmount = finiteNumber(input.payableAmount ?? input.payable_amount);
  const internal = input.internalEvidence || input.internal_evidence || {};
  const local = input.localEvidence || input.local_evidence || {};
  const corrections = input.correctionLedger || input.correction_ledger || internal.corrections || [];
  const approved = input.approvedMixedMode || input.approved_mixed_mode || internal.approvedMixedMode || {};
  const directLegs = input.travelLegs || input.travel_legs || internal.travelLegs || [];
  const approvedLegs = approved.leg_breakdown || approved.legBreakdown || approved.travel_legs || approved.travelLegs || [];
  const appliedCorrection = corrections.find(correctionIsAppliedMixedMode) || null;
  const correctionBefore = appliedCorrection?.before_state || appliedCorrection?.beforeState || {};
  const correctionLegs = correctionBefore.leg_breakdown || correctionBefore.legBreakdown || [];
  const evidenceLegs = [...directLegs, ...approvedLegs, ...correctionLegs];
  const approvedModes = approved.modes_used || approved.modesUsed || correctionBefore.modes_used || correctionBefore.modesUsed || [];
  const explicitRail = RAIL_MODES.has(selectedMode) ||
    evidenceLegs.some((leg) => RAIL_MODES.has(legMode(leg))) ||
    approvedModes.some((mode) => RAIL_MODES.has(normalizedMode(mode))) ||
    Boolean(appliedCorrection);
  const googleEvidence = classifyGoogleTransitEvidence(input.googleTransit || input.google_transit || null);
  const railTopology = local.railCompatibleGpsTopology === true || local.rail_compatible_gps_topology === true || local.gpsMatchesRail === true;
  const stationEndpoints = local.stationOrCorridorEndpoints === true || local.station_or_corridor_endpoints === true;
  const meaningfulDistance = local.meaningfulLongDistance === true || local.meaningful_long_distance === true;
  const centralGpsLoss = local.centralGpsLoss === true || local.central_gps_loss === true || local.missingGps === true || local.missing_gps === true;
  const expectedSitePause = local.expectedSitePause === true || local.expected_site_pause === true;
  const strongerPrivateEvidence = local.strongerPrivateModeEvidence === true || local.stronger_private_mode_evidence === true;
  const strongLocalRail = railTopology && stationEndpoints && meaningfulDistance && !expectedSitePause && !strongerPrivateEvidence;

  let classification;
  let reason;
  if (explicitRail) {
    classification = KM_TRANSPORT_CLASSIFICATION.EXPLICIT_INTERNAL_TRAIN_EVIDENCE;
    reason = appliedCorrection ? 'APPLIED_INTERNAL_MIXED_MODE_CORRECTION' : 'INTERNAL_TRAIN_OR_PUBLIC_TRANSPORT_EVIDENCE';
  } else if (expectedSitePause && PRIVATE_MODES.has(selectedMode)) {
    classification = KM_TRANSPORT_CLASSIFICATION.PAYABLE_PRIVATE_MODE;
    reason = 'EXPECTED_SITE_PAUSE';
  } else if (strongLocalRail && !centralGpsLoss) {
    classification = KM_TRANSPORT_CLASSIFICATION.HIGH_CONFIDENCE_RAIL_CORROBORATED;
    reason = googleEvidence === GOOGLE_TRANSIT_EVIDENCE.RAIL_CORROBORATED
      ? 'LOCAL_RAIL_EVIDENCE_WITH_GOOGLE_RAIL_CORROBORATION'
      : 'MULTIPLE_INDEPENDENT_LOCAL_RAIL_SIGNALS';
  } else if (strongLocalRail && centralGpsLoss) {
    classification = KM_TRANSPORT_CLASSIFICATION.RAIL_GAP_POLICY_NON_PAYABLE;
    reason = 'STRONG_LOCAL_RAIL_EVIDENCE_ACROSS_CENTRAL_GPS_LOSS';
  } else if (centralGpsLoss || railTopology || stationEndpoints || meaningfulDistance || googleEvidence === GOOGLE_TRANSIT_EVIDENCE.RAIL_CORROBORATED) {
    classification = KM_TRANSPORT_CLASSIFICATION.MEDIUM_MANUAL_REVIEW;
    reason = expectedSitePause ? 'EXPECTED_SITE_PAUSE' : 'INSUFFICIENT_INDEPENDENT_RAIL_EVIDENCE';
  } else {
    classification = KM_TRANSPORT_CLASSIFICATION.PAYABLE_PRIVATE_MODE;
    reason = expectedSitePause ? 'EXPECTED_SITE_PAUSE' : 'NORMAL_PRIVATE_MODE_EVIDENCE';
  }

  const ratePerKm = transportRate(selectedMode, input.ratePerKm ?? input.rate_per_km);
  const privatePortionKm = evidenceLegs.reduce((sum, leg) => (
    PRIVATE_MODES.has(legMode(leg)) ? sum + legDistance(leg) : sum
  ), 0);
  const railPortionKm = evidenceLegs.reduce((sum, leg) => (
    RAIL_MODES.has(legMode(leg)) ? sum + legDistance(leg) : sum
  ), 0);
  let payableKm = existingPayableKm ?? (PRIVATE_MODES.has(selectedMode) ? physicalKm : 0);
  let payableAmount = existingPayableAmount ?? payableKm * ratePerKm;
  let idempotencyAction = 'NOT_APPLICABLE';

  if (appliedCorrection) {
    const applied = appliedCorrection.applied_state || appliedCorrection.appliedState || {};
    const appliedAttendance = applied.attendance || applied.result || {};
    payableKm = finiteNumber(appliedAttendance.total_approved_km ?? appliedAttendance.totalApprovedKm) ?? payableKm;
    payableAmount = finiteNumber(appliedAttendance.petrol_amount ?? appliedAttendance.petrolAmount) ?? payableAmount;
    idempotencyAction = 'PRESERVE_APPLIED_CORRECTION';
  } else if ([
    KM_TRANSPORT_CLASSIFICATION.EXPLICIT_INTERNAL_TRAIN_EVIDENCE,
    KM_TRANSPORT_CLASSIFICATION.HIGH_CONFIDENCE_RAIL_CORROBORATED,
    KM_TRANSPORT_CLASSIFICATION.RAIL_GAP_POLICY_NON_PAYABLE,
  ].includes(classification)) {
    payableKm = privatePortionKm > 0
      ? privatePortionKm
      : Math.max(0, (existingPayableKm ?? physicalKm) - railPortionKm || 0);
    if (railPortionKm <= 0 && privatePortionKm <= 0) payableKm = 0;
    payableAmount = payableKm * ratePerKm;
    idempotencyAction = 'RAIL_PORTION_EXCLUDED_ONCE';
  } else if (classification === KM_TRANSPORT_CLASSIFICATION.MEDIUM_MANUAL_REVIEW) {
    payableKm = 0;
    payableAmount = 0;
  }

  return {
    classification,
    decision: classification === KM_TRANSPORT_CLASSIFICATION.MEDIUM_MANUAL_REVIEW
      ? KM_DECISION.MANUAL_REVIEW
      : classification === KM_TRANSPORT_CLASSIFICATION.PAYABLE_PRIVATE_MODE
        ? KM_DECISION.ACCEPTED
        : KM_DECISION.ACCEPTED_WITH_WARNING,
    reason,
    detectedMode: classification === KM_TRANSPORT_CLASSIFICATION.PAYABLE_PRIVATE_MODE ? selectedMode.toUpperCase() :
      classification === KM_TRANSPORT_CLASSIFICATION.MEDIUM_MANUAL_REVIEW ? null : 'TRAIN',
    originalSelectedMode: selectedMode,
    physicalKm: roundedMoney(physicalKm),
    payableKm: roundedMoney(payableKm),
    payableAmount: roundedMoney(payableAmount),
    ratePerKm,
    railPortionKm: roundedMoney(railPortionKm),
    privatePortionKm: roundedMoney(privatePortionKm),
    googleEvidence,
    googleRequired: false,
    appliedCorrectionId: appliedCorrection?.id || null,
    idempotencyAction,
  };
}

export function haversineDistanceKm(a, b) {
  const toRadians = (value) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRadians(b.latitude - a.latitude);
  const dLng = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const value =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function canonicalKmInputDigest(value) {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function identityValues(attendance = {}) {
  return new Set(
    [attendance.fo_user_id, attendance.employee_code, attendance.username]
      .map((value) => String(value || '').trim().toUpperCase())
      .filter(Boolean),
  );
}

function pointIdentity(row = {}) {
  return String(row.fo_user_id || row.employee_code || row.username || '').trim().toUpperCase();
}

function rejection(rejected, row, reason, detail = {}) {
  rejected.push({
    id: row?.id || row?.local_id || null,
    reason,
    ...detail,
  });
}

function markOscillationOutliers(points, policy, rejected) {
  const rejectedIndexes = new Set();
  const clusterSupport = (anchor) => points.reduce(
    (count, point) => count + (
      haversineDistanceKm(anchor, point) <= policy.oscillationReturnRadiusKm ? 1 : 0
    ),
    0,
  );
  for (let index = 1; index < points.length - 1; index += 1) {
    const before = points[index - 1];
    const candidate = points[index];
    const after = points[index + 1];
    const beforeToCandidate = haversineDistanceKm(before, candidate);
    const candidateToAfter = haversineDistanceKm(candidate, after);
    const beforeToAfter = haversineDistanceKm(before, after);
    const spanSeconds = (after.capturedAt - before.capturedAt) / 1000;
    if (
      spanSeconds > 0 &&
      spanSeconds <= policy.oscillationMaximumSpanSeconds &&
      beforeToCandidate >= policy.oscillationMinimumJumpKm &&
      candidateToAfter >= policy.oscillationMinimumJumpKm &&
      beforeToAfter <= policy.oscillationReturnRadiusKm &&
      clusterSupport(before) >= clusterSupport(candidate)
    ) {
      rejectedIndexes.add(index);
      rejection(rejected, candidate.sourceRow, GPS_REJECTION_REASON.OSCILLATION_OUTLIER, {
        companion_reason: GPS_REJECTION_REASON.STALE_CLUSTER,
        jump_in_km: Number(beforeToCandidate.toFixed(3)),
        jump_out_km: Number(candidateToAfter.toFixed(3)),
        return_radius_km: Number(beforeToAfter.toFixed(3)),
      });
    }
  }
  return points.filter((_, index) => !rejectedIndexes.has(index));
}

export function normalizeGpsEvidence({ rows = [], attendance = {}, now = new Date(), policy = {} } = {}) {
  const effectivePolicy = { ...DEFAULT_KM_V2_POLICY, ...policy };
  const rejected = [];
  const accepted = [];
  const allowedIdentities = identityValues(attendance);
  const attendanceStart = validDate(attendance.login_time || attendance.started_at);
  const attendanceEnd = validDate(attendance.logout_time || attendance.ended_at);
  const evaluatedAt = validDate(now) || new Date();

  for (const row of rows) {
    const latitude = finiteNumber(row?.latitude);
    const longitude = finiteNumber(row?.longitude);
    const accuracy = finiteNumber(row?.accuracy);
    const providerTimestamp = validDate(row?.captured_at || row?.provider_captured_at);
    // Older deployed clients wrote the provider time to logged_at only. Keep
    // them operational, but mark the weaker boundary instead of pretending a
    // true provider timestamp was supplied.
    const capturedAt = providerTimestamp || validDate(row?.logged_at || row?.created_at);
    const receivedAt = validDate(row?.logged_at || row?.received_at || row?.created_at);
    const identity = pointIdentity(row);
    const timestampQuality = String(row?.metadata?.provider_timestamp_quality || '').trim().toLowerCase();

    if (latitude === null || longitude === null || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      rejection(rejected, row, GPS_REJECTION_REASON.INVALID_COORDINATE);
      continue;
    }
    if (latitude === 0 && longitude === 0) {
      rejection(rejected, row, GPS_REJECTION_REASON.ZERO_COORDINATE);
      continue;
    }
    if (accuracy === null || accuracy > effectivePolicy.maxAccuracyMeters) {
      rejection(rejected, row, GPS_REJECTION_REASON.POOR_ACCURACY, { accuracy });
      continue;
    }
    if (row?.is_mocked === true || row?.metadata?.mock === true || row?.metadata?.is_mocked === true) {
      rejection(rejected, row, GPS_REJECTION_REASON.MOCKED);
      continue;
    }
    if (['stale_provider_timestamp', 'missing_provider_timestamp_compat'].includes(timestampQuality)) {
      rejection(rejected, row, GPS_REJECTION_REASON.STALE_PROVIDER_TIMESTAMP, { timestamp_quality: timestampQuality });
      continue;
    }
    if (timestampQuality === 'future_provider_timestamp') {
      rejection(rejected, row, GPS_REJECTION_REASON.FUTURE_TIMESTAMP, { timestamp_quality: timestampQuality });
      continue;
    }
    if (!capturedAt) {
      rejection(rejected, row, GPS_REJECTION_REASON.STALE_PROVIDER_TIMESTAMP, { detail: 'provider_timestamp_missing' });
      continue;
    }
    if (capturedAt.getTime() > evaluatedAt.getTime() + effectivePolicy.futureToleranceSeconds * 1000) {
      rejection(rejected, row, GPS_REJECTION_REASON.FUTURE_TIMESTAMP);
      continue;
    }
    if (receivedAt && receivedAt >= capturedAt) {
      const providerAgeSeconds = (receivedAt - capturedAt) / 1000;
      if (providerAgeSeconds > effectivePolicy.providerMaxAgeSeconds) {
        rejection(rejected, row, GPS_REJECTION_REASON.STALE_PROVIDER_TIMESTAMP, { provider_age_seconds: providerAgeSeconds });
        continue;
      }
    }
    if (attendanceStart && capturedAt < new Date(attendanceStart.getTime() - effectivePolicy.attendanceWindowToleranceSeconds * 1000)) {
      rejection(rejected, row, GPS_REJECTION_REASON.OUTSIDE_ATTENDANCE_WINDOW);
      continue;
    }
    if (attendanceEnd && capturedAt > new Date(attendanceEnd.getTime() + effectivePolicy.attendanceWindowToleranceSeconds * 1000)) {
      rejection(rejected, row, GPS_REJECTION_REASON.OUTSIDE_ATTENDANCE_WINDOW);
      continue;
    }
    if (
      (attendance.id && row?.attendance_id && String(row.attendance_id) !== String(attendance.id)) ||
      (allowedIdentities.size && identity && !allowedIdentities.has(identity))
    ) {
      rejection(rejected, row, GPS_REJECTION_REASON.IDENTITY_MISMATCH, { identity });
      continue;
    }
    accepted.push({
      ...row,
      sourceRow: row,
      id: row?.id || row?.local_id || null,
      latitude,
      longitude,
      accuracy,
      capturedAt,
      receivedAt,
      legacyTimestampBoundary: !providerTimestamp,
    });
  }

  accepted.sort((left, right) => left.capturedAt - right.capturedAt || String(left.id || '').localeCompare(String(right.id || '')));
  const deduplicated = [];
  for (const point of accepted) {
    const previous = deduplicated.at(-1);
    if (previous) {
      const gapSeconds = (point.capturedAt - previous.capturedAt) / 1000;
      if (
        point.latitude === previous.latitude &&
        point.longitude === previous.longitude &&
        gapSeconds >= 0 &&
        gapSeconds <= effectivePolicy.duplicateWindowSeconds
      ) {
        rejection(rejected, point.sourceRow, GPS_REJECTION_REASON.DUPLICATE);
        continue;
      }
    }
    deduplicated.push(point);
  }

  const points = markOscillationOutliers(deduplicated, effectivePolicy, rejected);
  const rejectionCounts = rejected.reduce((counts, item) => {
    counts[item.reason] = (counts[item.reason] || 0) + 1;
    if (item.companion_reason) counts[item.companion_reason] = (counts[item.companion_reason] || 0) + 1;
    return counts;
  }, {});
  const riskFlags = [];
  if (rejectionCounts[GPS_REJECTION_REASON.STALE_PROVIDER_TIMESTAMP]) riskFlags.push(KM_RISK_FLAG.STALE_PROVIDER_FIX);
  if (rejectionCounts[GPS_REJECTION_REASON.OSCILLATION_OUTLIER]) riskFlags.push(KM_RISK_FLAG.OSCILLATION);
  if (points.some((point) => point.legacyTimestampBoundary)) riskFlags.push(KM_RISK_FLAG.LEGACY_BOUNDARY);

  return { points, rejected, rejectionCounts, riskFlags, policy: effectivePolicy };
}

export function planGpsSegments(points = [], policy = {}) {
  const effectivePolicy = { ...DEFAULT_KM_V2_POLICY, ...policy };
  const segments = [];
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    const elapsedSeconds = (to.capturedAt - from.capturedAt) / 1000;
    const straightLineKm = haversineDistanceKm(from, to);
    const impliedSpeedKmph = elapsedSeconds > 0
      ? straightLineKm / (elapsedSeconds / 3600)
      : Number.POSITIVE_INFINITY;
    const base = { index, from, to, elapsedSeconds, straightLineKm, impliedSpeedKmph };

    if (elapsedSeconds <= 0 || impliedSpeedKmph > effectivePolicy.maxPhysicalSpeedKmph) {
      segments.push({ ...base, status: 'rejected', reason: GPS_REJECTION_REASON.IMPOSSIBLE_SPEED, googleEligible: false });
      continue;
    }
    if (straightLineKm * 1000 < effectivePolicy.minSegmentMeters) {
      segments.push({ ...base, status: 'ignored', reason: 'below_minimum_movement', googleEligible: false });
      continue;
    }
    const gap = elapsedSeconds > effectivePolicy.maxNormalGapSeconds || straightLineKm * 1000 > effectivePolicy.maxNormalSegmentMeters;
    if (gap) {
      segments.push({ ...base, status: 'route_required', reason: 'plausible_gap', googleEligible: true });
      continue;
    }
    segments.push({ ...base, status: 'accepted_gps', reason: null, googleEligible: false });
  }
  return { segments, policy: effectivePolicy };
}

/**
 * A conservative lower-bound trace used only after the normal segment engine
 * has identified undercoverage. It never includes impossible-speed segments.
 * Oscillation-contaminated windows use a larger movement floor so residual GPS
 * jitter around the retained cluster cannot become payable distance.
 */
export function calculateGpsCoverageTrace(points = [], {
  contaminated = false,
  policy = {},
} = {}) {
  const effectivePolicy = { ...DEFAULT_KM_V2_POLICY, ...policy };
  const minimumMovementMeters = contaminated
    ? effectivePolicy.contaminatedCoverageMinMovementMeters
    : effectivePolicy.minSegmentMeters;
  let distanceKm = 0;
  let acceptedSegments = 0;
  let impossibleSegments = 0;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    const elapsedSeconds = (to.capturedAt - from.capturedAt) / 1000;
    const segmentKm = haversineDistanceKm(from, to);
    const speedKmph = elapsedSeconds > 0
      ? segmentKm / (elapsedSeconds / 3600)
      : Number.POSITIVE_INFINITY;
    if (elapsedSeconds <= 0 || speedKmph > effectivePolicy.maxPhysicalSpeedKmph) {
      impossibleSegments += 1;
      continue;
    }
    if (segmentKm * 1000 < minimumMovementMeters) continue;
    distanceKm += segmentKm;
    acceptedSegments += 1;
  }
  return {
    distanceKm,
    acceptedSegments,
    impossibleSegments,
    minimumMovementMeters,
  };
}

/**
 * Prevents a sparse but formally "usable" GPS trace from silently becoming a
 * payable lower bound. A trusted route corroborates the cleaned trace; it is
 * not copied into payable KM. Without trustworthy exact-window evidence the
 * leg is sent to manual review.
 */
export function evaluateLegCoverage({
  acceptedGpsKm = 0,
  reconstructedGapKm = 0,
  coverageTraceKm = 0,
  straightLineKm = null,
  routeEvidence = null,
  elapsedSeconds = null,
  existingRiskFlags = [],
  policy = {},
} = {}) {
  const effectivePolicy = { ...DEFAULT_KM_V2_POLICY, ...policy };
  const acceptedTotal = Number(acceptedGpsKm || 0) + Number(reconstructedGapKm || 0);
  const traceKm = finiteNumber(coverageTraceKm) ?? 0;
  const straightKm = finiteNumber(straightLineKm);
  const routeKm = finiteNumber(routeEvidence?.distanceKm ?? routeEvidence?.distance_km);
  const referenceKm = Math.max(straightKm || 0, routeKm || 0, traceKm || 0);
  const undercovered = referenceKm > 0 &&
    referenceKm - acceptedTotal >= effectivePolicy.undercoverageMinimumShortfallKm &&
    acceptedTotal / referenceKm < effectivePolicy.undercoverageRatio;
  if (!undercovered) {
    return {
      classification: KM_COVERAGE_CLASSIFICATION.GPS_COMPLETE,
      decision: KM_DECISION.ACCEPTED,
      selectedKm: acceptedTotal,
      reconstructedCoverageKm: 0,
      riskFlags: [...new Set(existingRiskFlags)].sort(),
    };
  }

  const risks = new Set([...existingRiskFlags, KM_RISK_FLAG.POOR_GPS_COVERAGE, KM_RISK_FLAG.GPS_UNDERCOVERED]);
  const routeTrusted = routeEvidence?.trusted === true && routeEvidence?.exactWindow === true && routeKm > 0;
  const elapsedPlausible = elapsedSeconds > 0 && routeKm / (elapsedSeconds / 3600) <= effectivePolicy.maxPhysicalSpeedKmph;
  const traceCoversEndpoints = straightKm === null || straightKm <= 0 || traceKm >= straightKm * effectivePolicy.coverageEndpointFloorRatio;
  const traceWithinRouteEnvelope = routeKm > 0 && traceKm <= routeKm * effectivePolicy.coverageRouteCeilingRatio;
  const tracePlausible = traceKm > acceptedTotal &&
    elapsedSeconds > 0 &&
    traceKm / (elapsedSeconds / 3600) <= effectivePolicy.maxPhysicalSpeedKmph;

  if (routeTrusted && elapsedPlausible && tracePlausible && traceCoversEndpoints && traceWithinRouteEnvelope) {
    risks.add(KM_RISK_FLAG.ROUTE_SUPPORTED);
    return {
      classification: KM_COVERAGE_CLASSIFICATION.ROUTE_SUPPORTED,
      decision: KM_DECISION.ACCEPTED_WITH_WARNING,
      selectedKm: traceKm,
      reconstructedCoverageKm: Math.max(0, traceKm - acceptedTotal),
      routeEvidenceKm: routeKm,
      riskFlags: [...risks].sort(),
    };
  }

  if (routeEvidence && !routeTrusted) risks.add(KM_RISK_FLAG.ROUTE_EVIDENCE_INVALID);
  return {
    classification: KM_COVERAGE_CLASSIFICATION.MANUAL_REVIEW,
    decision: KM_DECISION.MANUAL_REVIEW,
    selectedKm: acceptedTotal,
    reconstructedCoverageKm: 0,
    routeEvidenceKm: routeKm,
    riskFlags: [...risks].sort(),
  };
}

function routeForSegment(routeEvidence, index) {
  if (routeEvidence instanceof Map) return routeEvidence.get(index) || null;
  if (Array.isArray(routeEvidence)) return routeEvidence.find((route) => Number(route.segmentIndex) === index) || null;
  return routeEvidence?.[index] || null;
}

export function finalizeGpsSegments(segmentPlan, routeEvidence = {}, policy = {}) {
  const effectivePolicy = { ...DEFAULT_KM_V2_POLICY, ...(segmentPlan?.policy || {}), ...policy };
  let acceptedGpsKm = 0;
  let reconstructedGapKm = 0;
  const riskFlags = new Set();
  const segments = (segmentPlan?.segments || []).map((segment) => {
    if (segment.status === 'accepted_gps') {
      acceptedGpsKm += segment.straightLineKm;
      return segment;
    }
    if (segment.status === 'rejected') {
      if (segment.reason === GPS_REJECTION_REASON.IMPOSSIBLE_SPEED) riskFlags.add(KM_RISK_FLAG.IMPOSSIBLE_SPEED);
      return segment;
    }
    if (segment.status !== 'route_required') return segment;

    const route = routeForSegment(routeEvidence, segment.index);
    const routeKm = finiteNumber(route?.distanceKm ?? route?.distance_km);
    const durationSeconds = finiteNumber(route?.durationSeconds ?? route?.duration_seconds);
    if (!(routeKm > 0)) return { ...segment, status: 'rejected', reason: route?.errorCode || 'route_unavailable' };
    const routeSpeedKmph = durationSeconds > 0 ? routeKm / (durationSeconds / 3600) : null;
    if (durationSeconds !== null && (!(durationSeconds > 0) || routeSpeedKmph > effectivePolicy.maxPhysicalSpeedKmph)) {
      riskFlags.add(KM_RISK_FLAG.ROUTE_DURATION_MISMATCH);
      return { ...segment, status: 'rejected', reason: 'route_duration_mismatch', routeKm, durationSeconds, routeSpeedKmph };
    }
    if (segment.elapsedSeconds <= 0 || routeKm / (segment.elapsedSeconds / 3600) > effectivePolicy.maxPhysicalSpeedKmph) {
      riskFlags.add(KM_RISK_FLAG.IMPOSSIBLE_SPEED);
      return { ...segment, status: 'rejected', reason: GPS_REJECTION_REASON.IMPOSSIBLE_SPEED, routeKm, durationSeconds };
    }
    if (segment.straightLineKm > 0 && routeKm / segment.straightLineKm > effectivePolicy.maxRouteToStraightLineRatio) {
      riskFlags.add(KM_RISK_FLAG.DIRECT_ROUTE_MISMATCH);
      return { ...segment, status: 'manual_review', reason: 'route_straight_line_ratio_exceeded', routeKm, durationSeconds };
    }
    reconstructedGapKm += routeKm;
    return { ...segment, status: 'reconstructed_google', reason: null, routeKm, durationSeconds, routeSpeedKmph };
  });

  return {
    segments,
    acceptedGpsKm,
    reconstructedGapKm,
    totalKm: acceptedGpsKm + reconstructedGapKm,
    riskFlags: [...riskFlags].sort(),
  };
}

export function applyWholeLegSanityGate({
  acceptedGpsKm = 0,
  reconstructedGapKm = 0,
  calculatedKm,
  straightLineKm = null,
  directRouteKm = null,
  routeDurationSeconds = null,
  elapsedSeconds = null,
  startedAt = null,
  endedAt = null,
  missingCheckout = false,
  existingRiskFlags = [],
  policy = {},
} = {}) {
  const effectivePolicy = { ...DEFAULT_KM_V2_POLICY, ...policy };
  const total = finiteNumber(calculatedKm) ?? Number(acceptedGpsKm || 0) + Number(reconstructedGapKm || 0);
  const endpointStraightLineKm = finiteNumber(straightLineKm);
  const risks = new Set(existingRiskFlags);
  let decision = KM_DECISION.ACCEPTED;

  const startDate = validDate(startedAt);
  const endDate = validDate(endedAt);
  if (startDate && endDate && startDate.toISOString().slice(0, 10) !== endDate.toISOString().slice(0, 10)) {
    risks.add(KM_RISK_FLAG.CROSS_MIDNIGHT);
    decision = KM_DECISION.ACCEPTED_WITH_WARNING;
  }
  if (missingCheckout) {
    risks.add(KM_RISK_FLAG.MISSING_CHECKOUT);
    decision = KM_DECISION.MANUAL_REVIEW;
  }

  if (!(total >= 0) || !Number.isFinite(total)) {
    return { decision: KM_DECISION.REJECTED, payableKm: 0, endpointStraightLineKm, riskFlags: [...risks] };
  }
  if (elapsedSeconds !== null && elapsedSeconds > 0 && total / (elapsedSeconds / 3600) > effectivePolicy.maxPhysicalSpeedKmph) {
    if (total >= effectivePolicy.speedGateMinimumDistanceKm) {
      risks.add(KM_RISK_FLAG.IMPOSSIBLE_SPEED);
      decision = KM_DECISION.MANUAL_REVIEW;
    } else {
      risks.add(KM_RISK_FLAG.SHORT_WINDOW_SPEED_UNCERTAIN);
      if (decision === KM_DECISION.ACCEPTED) decision = KM_DECISION.ACCEPTED_WITH_WARNING;
    }
  }
  if (
    routeDurationSeconds !== null &&
    (
      !(routeDurationSeconds > 0) ||
      (finiteNumber(directRouteKm) ?? total) / (routeDurationSeconds / 3600) > effectivePolicy.maxPhysicalSpeedKmph
    )
  ) {
    risks.add(KM_RISK_FLAG.ROUTE_DURATION_MISMATCH);
    decision = KM_DECISION.MANUAL_REVIEW;
  }
  if (
    directRouteKm !== null &&
    directRouteKm > 0 &&
    total - directRouteKm >= effectivePolicy.wholeLegMismatchMinimumKm &&
    total / directRouteKm > effectivePolicy.maxWholeLegToDirectRatio
  ) {
    risks.add(KM_RISK_FLAG.DIRECT_ROUTE_MISMATCH);
    // A validated dense trace may contain a legitimate detour, loop, or
    // out-and-back route relative to the shortest direct route. Reconstructed
    // distance does not receive that trust: a gap-dominant mismatch remains a
    // manual-review condition (the historical stale-jump failure mode).
    if (total > 0 && reconstructedGapKm / total >= effectivePolicy.gapDominanceRatio) {
      decision = KM_DECISION.MANUAL_REVIEW;
    } else {
      risks.add(KM_RISK_FLAG.ROUTE_DETOUR);
      if (decision === KM_DECISION.ACCEPTED) decision = KM_DECISION.ACCEPTED_WITH_WARNING;
    }
  }
  if (total >= effectivePolicy.longDistanceReviewKm) {
    risks.add(KM_RISK_FLAG.LONG_DISTANCE);
    if (decision === KM_DECISION.ACCEPTED) decision = KM_DECISION.ACCEPTED_WITH_WARNING;
  }
  if (total > 0 && reconstructedGapKm / total >= effectivePolicy.gapDominanceRatio) {
    risks.add(KM_RISK_FLAG.GAP_DOMINANT);
    if (decision === KM_DECISION.ACCEPTED) decision = KM_DECISION.ACCEPTED_WITH_WARNING;
  }

  return {
    decision,
    payableKm: [KM_DECISION.ACCEPTED, KM_DECISION.ACCEPTED_WITH_WARNING].includes(decision) ? total : 0,
    calculatedKm: total,
    endpointStraightLineKm,
    riskFlags: [...risks].sort(),
  };
}

function applyTransportPolicyToLeg(leg = {}) {
  const evidence = leg.transportPolicyEvidence || leg.transport_policy_evidence;
  const mode = normalizedMode(leg.travelMode || leg.travel_mode);
  if (!evidence && !RAIL_MODES.has(mode)) return { ...leg };
  const policy = classifyRailPublicTransportPolicy({
    ...leg,
    ...(evidence || {}),
    selectedMode: evidence?.selectedMode || evidence?.selected_mode || leg.travelMode || leg.travel_mode,
  });
  return {
    ...leg,
    payableKm: policy.payableKm,
    payableAmount: policy.payableAmount,
    decision: policy.decision,
    transportClassification: policy.classification,
    detectedMode: policy.detectedMode,
    originalSelectedMode: policy.originalSelectedMode,
    physicalKm: policy.physicalKm,
    railPortionKm: policy.railPortionKm,
    googleTransitEvidence: policy.googleEvidence,
    railPolicyReason: policy.reason,
    railPolicyIdempotencyAction: policy.idempotencyAction,
    appliedCorrectionId: policy.appliedCorrectionId,
  };
}

export function calculateCanonicalKmV2({
  legs = [],
  approvedMissingKm = 0,
  approvedMissingAmount = 0,
  correctionLedger = [],
} = {}) {
  const canonicalLegs = legs.map(applyTransportPolicyToLeg);
  const acceptedGpsKm = canonicalLegs.reduce((sum, leg) => sum + Number(leg.acceptedGpsKm || 0), 0);
  const reconstructedGapKm = canonicalLegs.reduce((sum, leg) => sum + Number(leg.reconstructedGapKm || 0), 0);
  const legPayableKm = canonicalLegs.reduce((sum, leg) => sum + Number(leg.payableKm || 0), 0);
  const legAmount = canonicalLegs.reduce((sum, leg) => sum + Number(leg.payableAmount || 0), 0);
  const decisions = new Set(canonicalLegs.map((leg) => leg.decision));
  const decision = decisions.has(KM_DECISION.REJECTED)
    ? KM_DECISION.REJECTED
    : decisions.has(KM_DECISION.MANUAL_REVIEW)
      ? KM_DECISION.MANUAL_REVIEW
      : decisions.has(KM_DECISION.ACCEPTED_WITH_WARNING)
        ? KM_DECISION.ACCEPTED_WITH_WARNING
        : KM_DECISION.ACCEPTED;
  const riskFlags = [...new Set(canonicalLegs.flatMap((leg) => leg.riskFlags || []))].sort();
  const appliedCorrection = authoritativeAppliedCorrection(correctionLedger);
  const result = {
    calculationVersion: KM_ENGINE_VERSION,
    canonicalLegs,
    acceptedGpsKm: Number(acceptedGpsKm.toFixed(2)),
    reconstructedGapKm: Number(reconstructedGapKm.toFixed(2)),
    payableKm: appliedCorrection?.payableKm ?? Number((legPayableKm + Number(approvedMissingKm || 0)).toFixed(2)),
    reimbursement: appliedCorrection?.reimbursement ?? Number((legAmount + Number(approvedMissingAmount || 0)).toFixed(2)),
    approvedMissingKm: Number(Number(approvedMissingKm || 0).toFixed(2)),
    rejectedPointReasons: canonicalLegs.reduce((counts, leg) => {
      for (const [reason, count] of Object.entries(leg.rejectedPointReasons || {})) counts[reason] = (counts[reason] || 0) + Number(count || 0);
      return counts;
    }, {}),
    riskFlags,
    decision,
    authoritativeAppliedCorrection: appliedCorrection,
  };
  return {
    ...result,
    inputDigest: canonicalKmInputDigest({
      legs: canonicalLegs,
      approvedMissingKm,
      approvedMissingAmount,
      correctionLedger: correctionLedger.map((correction) => ({
        id: correction.id || null,
        correctionKey: correction.correction_key || correction.correctionKey || null,
        status: correction.status || null,
        appliedState: correction.applied_state || correction.appliedState || null,
      })),
    }),
  };
}
