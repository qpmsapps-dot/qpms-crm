const STALE_VISIT_STATUS = 'Stale Auto Closed';
const STALE_ATTENDANCE_STATUS = 'Stale Auto Ended';
const GPS_EVIDENCE_FRESHNESS_MINUTES = 30;

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

function logCleanup(event, detail = {}) {
  console.log('[myQPMS FO stale cleanup]', event, detail);
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
      current_status: 'Offline',
      active_site_visit_id: null,
      route_km_today: 0,
      updated_at: executedAt,
    })
    .eq('fo_user_id', foId);
  if (error) throw error;
  return { reset: true, skippedTodayActive: false };
}

async function closeStaleAttendance(client, attendance, executedAt) {
  const closeAt = indiaDayEndUtcIso(attendance.attendance_date);
  if (!closeAt) return false;
  const metadata = mergeMetadata(attendance, {
    auto_ended: true,
    stale_auto_ended: true,
    auto_ended_reason: 'midnight_cleanup',
    auto_ended_at: executedAt,
    requires_review: true,
    cleanup_reason: 'Previous-day active attendance',
    cleanup_source: 'backend_midnight_cleanup',
    cleanup_executed_at: executedAt,
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
    reviewEvidenceCaptured: 0,
    skippedStaleGps: 0,
    skippedBecauseTodayAttendanceExists: 0,
    errors: [],
  };
  logCleanup('cleanup started', { indiaDate: today });
  try {
    const { data: attendanceRows, error } = await client
      .from('fo_attendance')
      .select('id, fo_user_id, attendance_date, metadata')
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
    logCleanup('cleanup finished', {
      indiaDate: summary.indiaDate,
      attendanceRowsFound: summary.attendanceRowsFound,
      visitsClosed: summary.visitsClosed,
      attendanceClosed: summary.attendanceClosed,
      liveStatusesReset: summary.liveStatusesReset,
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
