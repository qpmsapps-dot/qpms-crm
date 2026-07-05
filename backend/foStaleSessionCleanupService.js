const STALE_VISIT_STATUS = 'Stale Auto Closed';
const STALE_ATTENDANCE_STATUS = 'Stale Auto Ended';
const GPS_EVIDENCE_FRESHNESS_MINUTES = 30;
const STALE_AUTO_END_GPS_WINDOW_MINUTES = 60;
const STALE_AUTO_END_ACCEPTABLE_ACCURACY_METERS = 100;

let cleanupInFlight = false;

export function currentIndiaDateInput(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function indiaDayEndUtcIso(attendanceDate) {
  const [year, month, day] = String(attendanceDate || '').slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return null;
  const nextIndiaMidnightUtcMs = Date.UTC(year, month - 1, day + 1, 0, 0, 0, 0) - (5.5 * 60 * 60 * 1000);
  return new Date(nextIndiaMidnightUtcMs - 1000).toISOString();
}

function mergeMetadata(row, metadata) {
  const existing = row?.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
    ? row.metadata
    : {};
  return { ...existing, ...metadata };
}

const isStaleCleanupDebugLoggingEnabled =
  process.env.NODE_ENV !== 'production' ||
  process.env.FO_STALE_CLEANUP_DEBUG_LOGS === 'true';

function debugLog(...args) {
  if (isStaleCleanupDebugLoggingEnabled) {
    console.log(...args);
  }
}

function logCleanup(event, detail = {}) {
  debugLog('[myQPMS FO stale cleanup]', event, detail);
}

function normalizeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isValidCoordinate(latitude, longitude) {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

function coordinateFrom(row, latKeys = [], lngKeys = []) {
  for (const latKey of latKeys) {
    for (const lngKey of lngKeys) {
      const latitude = normalizeNumber(row?.[latKey]);
      const longitude = normalizeNumber(row?.[lngKey]);
      if (isValidCoordinate(latitude, longitude)) {
        return { latitude, longitude };
      }
    }
  }
  return null;
}

function haversineKm(a, b) {
  const toRadians = (value) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRadians(b.latitude - a.latitude);
  const dLng = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const haversine =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function pointTime(row) {
  const value = row?.captured_at || row?.logged_at || row?.created_at;
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

async function latestGpsEvidenceForVisit(client, attendance, visit, closeAtIso) {
  const closeAt = new Date(closeAtIso);
  if (Number.isNaN(closeAt.getTime())) {
    return { status: 'unavailable', reason: 'invalid_close_time' };
  }

  const queryByAttendance = attendance?.id
    ? client
        .from('fo_location_logs')
        .select('id, latitude, longitude, captured_at, logged_at, created_at')
        .eq('attendance_id', attendance.id)
        .lte('captured_at', closeAtIso)
        .order('captured_at', { ascending: false })
        .limit(1)
    : null;
  const { data: attendanceLogs, error: attendanceError } = queryByAttendance
    ? await queryByAttendance
    : { data: [], error: null };
  if (attendanceError) throw attendanceError;

  let latestLog = attendanceLogs?.[0] || null;
  if (!latestLog && attendance?.fo_user_id) {
    const { data: userLogs, error: userError } = await client
      .from('fo_location_logs')
      .select('id, latitude, longitude, captured_at, logged_at, created_at')
      .eq('fo_user_id', attendance.fo_user_id)
      .lte('captured_at', closeAtIso)
      .order('captured_at', { ascending: false })
      .limit(1);
    if (userError) throw userError;
    latestLog = userLogs?.[0] || null;
  }

  if (!latestLog) {
    return { status: 'unavailable', reason: 'no_fresh_gps_log' };
  }

  const detectedAt = pointTime(latestLog);
  const latitude = normalizeNumber(latestLog.latitude);
  const longitude = normalizeNumber(latestLog.longitude);
  if (!detectedAt || !isValidCoordinate(latitude, longitude)) {
    return { status: 'unavailable', reason: 'invalid_gps_log' };
  }

  const ageMinutes = Math.max(0, Math.round((closeAt.getTime() - detectedAt.getTime()) / 60000));
  if (ageMinutes > GPS_EVIDENCE_FRESHNESS_MINUTES) {
    return {
      status: 'stale',
      reason: 'no_fresh_gps_log',
      latest_gps_evidence: {
        source: 'latest_gps_log',
        gps_log_id: latestLog.id,
        detected_at: detectedAt.toISOString(),
        lat: latitude,
        lng: longitude,
        gps_log_age_minutes: ageMinutes,
      },
    };
  }

  const checkInPoint = coordinateFrom(
    visit,
    ['check_in_latitude', 'current_latitude', 'destination_lat'],
    ['check_in_longitude', 'current_longitude', 'destination_lng'],
  );
  const detectedPoint = { latitude, longitude };
  const missingKm = checkInPoint
    ? Number(haversineKm(checkInPoint, detectedPoint).toFixed(2))
    : null;

  return {
    status: 'fresh',
    reason: null,
    latest_gps_evidence: {
      source: 'latest_gps_log',
      gps_log_id: latestLog.id,
      detected_at: detectedAt.toISOString(),
      lat: latitude,
      lng: longitude,
      gps_log_age_minutes: ageMinutes,
    },
    missing_checkout_km_detected: Number.isFinite(missingKm) ? missingKm : null,
  };
}

function gpsEvidenceTimestampFilter(closeAtIso) {
  return `captured_at.lte.${closeAtIso},logged_at.lte.${closeAtIso},created_at.lte.${closeAtIso}`;
}

async function latestGpsEvidenceForAttendance(client, attendance, closeAtIso) {
  const closeAt = new Date(closeAtIso);
  if (Number.isNaN(closeAt.getTime())) {
    return { status: 'not_found', reason: 'invalid_close_time' };
  }

  const lookups = [
    ['attendance_id', attendance?.id],
    ['fo_user_id', attendance?.fo_user_id],
    ['employee_code', attendance?.employee_code],
  ].filter(([, value]) => String(value || '').trim());

  let bestRejected = null;

  for (const [field, value] of lookups) {
    const { data, error } = await client
      .from('fo_location_logs')
      .select('id, attendance_id, fo_user_id, employee_code, latitude, longitude, accuracy, captured_at, logged_at, created_at')
      .eq(field, value)
      .not('latitude', 'is', null)
      .not('longitude', 'is', null)
      .or(gpsEvidenceTimestampFilter(closeAtIso))
      .order('captured_at', { ascending: false, nullsFirst: false })
      .order('logged_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false, nullsFirst: false })
      .limit(25);
    if (error) throw error;

    const candidates = (data || [])
      .map((log) => {
        const detectedAt = pointTime(log);
        const latitude = normalizeNumber(log.latitude);
        const longitude = normalizeNumber(log.longitude);
        const accuracy = normalizeNumber(log.accuracy);
        const minutesBeforeClose = detectedAt
          ? Math.max(0, Math.round((closeAt.getTime() - detectedAt.getTime()) / 60000))
          : null;
        return {
          log,
          detectedAt,
          latitude,
          longitude,
          accuracy,
          minutesBeforeClose,
          source: field,
        };
      })
      .filter((candidate) =>
        candidate.detectedAt &&
        candidate.detectedAt.getTime() <= closeAt.getTime() &&
        isValidCoordinate(candidate.latitude, candidate.longitude),
      )
      .sort((a, b) => b.detectedAt.getTime() - a.detectedAt.getTime());

    const recentCandidates = candidates.filter(
      (candidate) =>
        Number.isFinite(candidate.minutesBeforeClose) &&
        candidate.minutesBeforeClose <= STALE_AUTO_END_GPS_WINDOW_MINUTES,
    );

    const acceptableAccuracy = recentCandidates.find(
      (candidate) =>
        candidate.accuracy === null ||
        candidate.accuracy <= STALE_AUTO_END_ACCEPTABLE_ACCURACY_METERS,
    );
    const selected = acceptableAccuracy || recentCandidates[0];
    if (selected) {
      return {
        status: 'found',
        reason:
          selected.accuracy !== null &&
          selected.accuracy > STALE_AUTO_END_ACCEPTABLE_ACCURACY_METERS
            ? 'latest_recent_gps_accuracy_above_preferred_limit'
            : null,
        source: selected.source,
        gps_log_id: selected.log.id,
        latitude: selected.latitude,
        longitude: selected.longitude,
        accuracy: selected.accuracy,
        captured_at: selected.detectedAt.toISOString(),
        minutes_before_close: selected.minutesBeforeClose,
      };
    }

    if (!bestRejected && candidates[0]) {
      bestRejected = candidates[0];
    }
  }

  return {
    status: 'not_found',
    reason: bestRejected
      ? 'no_recent_gps_log_before_auto_close'
      : 'no_valid_gps_log_before_auto_close',
    latest_gps_log_age_minutes: bestRejected?.minutesBeforeClose ?? null,
  };
}

function requireServiceRoleClient(serviceRoleClient) {
  if (!serviceRoleClient || typeof serviceRoleClient.from !== 'function') {
    const error = new Error('Backend service-role client is not configured.');
    error.statusCode = 503;
    error.code = 'service_role_client_not_configured';
    error.diagnosticReason = 'service_role_client_not_configured';
    throw error;
  }
  return serviceRoleClient;
}

async function closeOpenVisitsForAttendance(client, attendance, executedAt) {
  const attendanceId = String(attendance.id || '').trim();
  if (!attendanceId) return 0;
  const closeAt = indiaDayEndUtcIso(attendance.attendance_date);
  if (!closeAt) return { closed: 0, evidenceCaptured: 0, staleGpsSkipped: 0 };
  const { data: visits, error: visitsError } = await client
    .from('fo_site_visits')
    .select('id, check_in_latitude, check_in_longitude, current_latitude, current_longitude, destination_lat, destination_lng, route_km, metadata')
    .eq('attendance_id', attendanceId)
    .filter('checkout_time', 'is', null)
    .filter('check_out_time', 'is', null)
    .limit(500);
  if (visitsError) throw visitsError;

  let closed = 0;
  let evidenceCaptured = 0;
  let staleGpsSkipped = 0;
  for (const visit of visits || []) {
    const evidence = await latestGpsEvidenceForVisit(client, attendance, visit, closeAt);
    if (evidence.status === 'fresh') evidenceCaptured += 1;
    if (evidence.status === 'stale' || evidence.status === 'unavailable') staleGpsSkipped += 1;
    const metadata = mergeMetadata(visit, {
      auto_closed: true,
      stale_auto_closed: true,
      auto_closed_reason: 'midnight_cleanup',
      auto_closed_at: executedAt,
      cleanup_reason: 'Previous-day open visit',
      cleanup_source: 'backend_midnight_cleanup',
      cleanup_executed_at: executedAt,
      requires_checkout_review: true,
      checkout_exception_type: 'missed_checkout_auto_closed',
      checkout_review_status: 'pending',
      latest_gps_evidence_status: evidence.status,
      latest_gps_evidence_reason: evidence.reason || null,
      latest_gps_evidence: evidence.latest_gps_evidence || null,
      missing_checkout_km_detected: evidence.missing_checkout_km_detected ?? null,
      approved_missing_km: Number(visit?.metadata?.approved_missing_km || 0),
      payable_km_after_site_checkin_added: false,
    });
    const { error } = await client
      .from('fo_site_visits')
      .update({
        status: STALE_VISIT_STATUS,
        visit_status: STALE_VISIT_STATUS,
        checkout_time: closeAt,
        check_out_time: closeAt,
        checkout_note: 'Auto closed at midnight because checkout was not completed.',
        metadata,
        updated_at: executedAt,
      })
      .eq('id', visit.id)
      .filter('checkout_time', 'is', null)
      .filter('check_out_time', 'is', null);
    if (error) throw error;
    closed += 1;
  }
  return { closed, evidenceCaptured, staleGpsSkipped };
}

async function hasTodayActiveAttendance(client, foUserId, today) {
  const foId = String(foUserId || '').trim();
  if (!foId) return false;
  const { data, error } = await client
    .from('fo_attendance')
    .select('id')
    .eq('fo_user_id', foId)
    .eq('attendance_date', today)
    .eq('status', 'Active')
    .filter('logout_time', 'is', null)
    .limit(1);
  if (error) throw error;
  return Boolean(data?.length);
}

const CLOSED_SITE_VISIT_STATUSES = new Set([
  'checked out',
  'completed',
  'stale auto closed',
]);

function normalizeStatus(value) {
  return String(value || '').trim().replace(/_/g, ' ').replace(/\s+/g, ' ').toLowerCase();
}

function isClosedSiteVisitReference(visit) {
  if (!visit) return true;
  return Boolean(
    visit.checkout_time ||
      visit.check_out_time ||
      CLOSED_SITE_VISIT_STATUSES.has(normalizeStatus(visit.status)) ||
      CLOSED_SITE_VISIT_STATUSES.has(normalizeStatus(visit.visit_status)),
  );
}

function safeAffectedFoIds(rows) {
  return [...new Set((rows || []).map((row) => String(row.fo_user_id || '').trim()).filter(Boolean))].slice(0, 25);
}

export async function cleanupStaleLiveStatusReferences(serviceRoleClient, options = {}) {
  const client = requireServiceRoleClient(serviceRoleClient);
  const today = options.today || currentIndiaDateInput();
  const executedAt = options.executedAt || new Date().toISOString();
  const { data: liveRows, error: liveError } = await client
    .from('fo_live_status')
    .select('fo_user_id, current_status, active_site_visit_id')
    .not('active_site_visit_id', 'is', null)
    .limit(options.limit || 1000);
  if (liveError) throw liveError;

  const activeLiveRows = liveRows || [];
  const visitIds = [
    ...new Set(
      activeLiveRows
        .map((row) => String(row.active_site_visit_id || '').trim())
        .filter(Boolean),
    ),
  ];

  let visitsById = new Map();
  if (visitIds.length) {
    const { data: visits, error: visitsError } = await client
      .from('fo_site_visits')
      .select('id, checkout_time, check_out_time, status, visit_status')
      .in('id', visitIds);
    if (visitsError) throw visitsError;
    visitsById = new Map((visits || []).map((visit) => [String(visit.id), visit]));
  }

  const staleRows = activeLiveRows.filter((row) => {
    const visitId = String(row.active_site_visit_id || '').trim();
    return visitId && isClosedSiteVisitReference(visitsById.get(visitId));
  });

  let cleared = 0;
  let endedDay = 0;
  let activeDay = 0;
  const affectedFoIds = [];

  for (const row of staleRows) {
    const foUserId = String(row.fo_user_id || '').trim();
    const visitId = String(row.active_site_visit_id || '').trim();
    if (!foUserId || !visitId) continue;

    const hasActiveAttendance = await hasTodayActiveAttendance(client, foUserId, today);
    const updatePayload = hasActiveAttendance
      ? {
          active_site_visit_id: null,
          current_status: normalizeStatus(row.current_status) === 'on site visit'
            ? 'Tracking Active'
            : row.current_status || 'Tracking Active',
          updated_at: executedAt,
        }
      : {
          active_site_visit_id: null,
          is_online: false,
          is_tracking: false,
          current_status: 'Ended Day',
          updated_at: executedAt,
        };

    const { data: updatedRows, error: updateError } = await client
      .from('fo_live_status')
      .update(updatePayload)
      .eq('fo_user_id', foUserId)
      .eq('active_site_visit_id', visitId)
      .select('fo_user_id');
    if (updateError) throw updateError;

    const updatedCount = updatedRows?.length || 0;
    if (updatedCount > 0) {
      cleared += updatedCount;
      affectedFoIds.push(foUserId);
      if (hasActiveAttendance) activeDay += updatedCount;
      else endedDay += updatedCount;
    }
  }

  const result = {
    checked: activeLiveRows.length,
    staleFound: staleRows.length,
    cleared,
    endedDay,
    activeDay,
    affectedFoIds: safeAffectedFoIds(affectedFoIds.map((foUserId) => ({ fo_user_id: foUserId }))),
  };

  if (result.staleFound || result.cleared) {
    console.log('[myQPMS FO stale cleanup] stale live_status references reconciled', result);
  }

  return result;
}

async function resetLiveStatusIfSafe(client, attendance, today, executedAt) {
  const foId = String(attendance.fo_user_id || '').trim();
  if (!foId) return { reset: false, skippedTodayActive: false };
  if (await hasTodayActiveAttendance(client, foId, today)) {
    return { reset: false, skippedTodayActive: true };
  }
  const { error } = await client
    .from('fo_live_status')
    .update({
      is_online: false,
      is_tracking: false,
      current_status: 'Ended Day',
      active_site_visit_id: null,
      updated_at: executedAt,
    })
    .eq('fo_user_id', foId);
  if (error) throw error;
  return { reset: true, skippedTodayActive: false };
}

async function closeStaleAttendance(client, attendance, executedAt) {
  const closeAt = indiaDayEndUtcIso(attendance.attendance_date);
  if (!closeAt) return false;
  const gpsEvidence = await latestGpsEvidenceForAttendance(client, attendance, closeAt);
  debugLog('STALE AUTO END GPS EVIDENCE', {
    attendanceId: attendance?.id || null,
    employeeCode: attendance?.employee_code || null,
    closeAt,
    evidenceStatus: gpsEvidence.status,
    source: gpsEvidence.source || null,
    capturedAt: gpsEvidence.captured_at || null,
    minutesBeforeClose: gpsEvidence.minutes_before_close ?? gpsEvidence.latest_gps_log_age_minutes ?? null,
    accuracy: gpsEvidence.accuracy ?? null,
  });
  const metadata = mergeMetadata(attendance, {
    auto_ended: true,
    stale_auto_ended: true,
    auto_ended_reason: 'midnight_cleanup',
    auto_ended_at: executedAt,
    requires_review: true,
    cleanup_reason: 'Previous-day active attendance',
    cleanup_source: 'backend_midnight_cleanup',
    cleanup_executed_at: executedAt,
    stale_auto_end_gps_evidence_status: gpsEvidence.status,
    stale_auto_end_gps_reason: gpsEvidence.reason || null,
    stale_auto_end_gps_latitude: gpsEvidence.status === 'found' ? gpsEvidence.latitude : null,
    stale_auto_end_gps_longitude: gpsEvidence.status === 'found' ? gpsEvidence.longitude : null,
    stale_auto_end_gps_accuracy: gpsEvidence.status === 'found' ? gpsEvidence.accuracy : null,
    stale_auto_end_gps_captured_at: gpsEvidence.status === 'found' ? gpsEvidence.captured_at : null,
    stale_auto_end_gps_minutes_before_close:
      gpsEvidence.status === 'found' ? gpsEvidence.minutes_before_close : null,
    stale_auto_end_gps_source: gpsEvidence.status === 'found' ? gpsEvidence.source : null,
    stale_auto_end_gps_log_id: gpsEvidence.status === 'found' ? gpsEvidence.gps_log_id : null,
    stale_auto_end_final_leg_review_required: true,
    stale_auto_end_final_leg_policy: 'review_only_not_payable',
  });
  const { data, error } = await client
    .from('fo_attendance')
    .update({
      status: STALE_ATTENDANCE_STATUS,
      logout_time: closeAt,
      metadata,
      updated_at: executedAt,
    })
    .eq('id', attendance.id)
    .eq('status', 'Active')
    .filter('logout_time', 'is', null)
    .select('id');
  if (error) throw error;
  return Boolean(data?.length);
}

export async function cleanupStaleFoSessions(serviceRoleClient, options = {}) {
  if (cleanupInFlight) {
    return { ok: false, skipped: true, reason: 'cleanup_in_flight' };
  }
  const client = requireServiceRoleClient(serviceRoleClient);
  cleanupInFlight = true;
  const today = options.today || currentIndiaDateInput();
  const executedAt = new Date().toISOString();
  const summary = {
    ok: true,
    indiaDate: today,
    attendanceRowsFound: 0,
    visitsClosed: 0,
    attendanceClosed: 0,
    liveStatusesReset: 0,
    staleLiveStatusReferencesChecked: 0,
    staleLiveStatusReferencesFound: 0,
    staleLiveStatusReferencesCleared: 0,
    staleLiveStatusAffectedFoIds: [],
    reviewEvidenceCaptured: 0,
    skippedStaleGps: 0,
    skippedBecauseTodayAttendanceExists: 0,
    errors: [],
  };
  logCleanup('cleanup started', { indiaDate: today });
  try {
    const { data: attendanceRows, error } = await client
      .from('fo_attendance')
      .select('id, fo_user_id, employee_code, attendance_date, metadata')
      .lt('attendance_date', today)
      .eq('status', 'Active')
      .filter('logout_time', 'is', null)
      .order('attendance_date', { ascending: true })
      .limit(options.limit || 500);
    if (error) throw error;
    summary.attendanceRowsFound = attendanceRows?.length || 0;

    for (const attendance of attendanceRows || []) {
      try {
        const visitResult = await closeOpenVisitsForAttendance(client, attendance, executedAt);
        summary.visitsClosed += visitResult.closed;
        summary.reviewEvidenceCaptured += visitResult.evidenceCaptured;
        summary.skippedStaleGps += visitResult.staleGpsSkipped;
        if (await closeStaleAttendance(client, attendance, executedAt)) {
          summary.attendanceClosed += 1;
        }
        const liveResult = await resetLiveStatusIfSafe(client, attendance, today, executedAt);
        if (liveResult.reset) summary.liveStatusesReset += 1;
        if (liveResult.skippedTodayActive) summary.skippedBecauseTodayAttendanceExists += 1;
      } catch (error) {
        summary.errors.push({
          attendance_id: attendance.id,
          message: error.message,
          code: error.code,
        });
      }
    }
    const staleLiveStatusResult = await cleanupStaleLiveStatusReferences(client, { today, executedAt });
    summary.staleLiveStatusReferencesChecked = staleLiveStatusResult.checked;
    summary.staleLiveStatusReferencesFound = staleLiveStatusResult.staleFound;
    summary.staleLiveStatusReferencesCleared = staleLiveStatusResult.cleared;
    summary.staleLiveStatusAffectedFoIds = staleLiveStatusResult.affectedFoIds;
    logCleanup('cleanup finished', {
      indiaDate: summary.indiaDate,
      attendanceRowsFound: summary.attendanceRowsFound,
      visitsClosed: summary.visitsClosed,
      attendanceClosed: summary.attendanceClosed,
      liveStatusesReset: summary.liveStatusesReset,
      staleLiveStatusReferencesChecked: summary.staleLiveStatusReferencesChecked,
      staleLiveStatusReferencesFound: summary.staleLiveStatusReferencesFound,
      staleLiveStatusReferencesCleared: summary.staleLiveStatusReferencesCleared,
      staleLiveStatusAffectedFoIds: summary.staleLiveStatusAffectedFoIds,
      reviewEvidenceCaptured: summary.reviewEvidenceCaptured,
      skippedStaleGps: summary.skippedStaleGps,
      skippedBecauseTodayAttendanceExists: summary.skippedBecauseTodayAttendanceExists,
      errors: summary.errors.length,
    });
    return summary;
  } finally {
    cleanupInFlight = false;
  }
}
