const RATE_PER_KM = 4;
const MAX_ACCURACY_METERS = 50;
const HIGH_CONFIDENCE_ACCURACY_METERS = 40;
const MIN_SEGMENT_METERS = 5;
const MAX_NORMAL_GAP_SECONDS = 600;
const MAX_NORMAL_SEGMENT_METERS = 2500;
const MAX_SPEED_KMPH = 120;
const DUPLICATE_WINDOW_SECONDS = 10;
const MIN_MEANINGFUL_FINAL_RETURN_LEG_KM = 0.05;
const DEFAULT_MAX_GOOGLE_DIRECTIONS_CALLS = 25;
const ATTENDANCE_SELECT_COLUMNS = [
  'id',
  'fo_user_id',
  'employee_code',
  'username',
  'display_name',
  'attendance_date',
  'login_time',
  'logout_time',
  'status',
  'start_latitude',
  'start_longitude',
  'end_latitude',
  'end_longitude',
  'actual_km',
  'eligible_km',
  'total_route_km',
  'total_approved_km',
  'rate_per_km',
  'petrol_amount',
  'travel_mode',
  'payable_km_allowed',
  'route_sync_status',
  'metadata',
].join(', ');
const SITE_VISIT_SELECT_COLUMNS = [
  'id',
  'attendance_id',
  'employee_code',
  'full_name',
  'store_name',
  'site_name',
  'client_name',
  'check_in_time',
  'check_out_time',
  'checkout_time',
  'check_in_latitude',
  'check_in_longitude',
  'check_out_latitude',
  'check_out_longitude',
  'origin_lat',
  'origin_lng',
  'destination_lat',
  'destination_lng',
  'route_km',
  'status',
  'visit_status',
  'sync_status',
  'metadata',
].join(', ');
const LOCATION_LOG_SELECT_COLUMNS = [
  'id',
  'fo_user_id',
  'employee_code',
  'username',
  'attendance_id',
  'latitude',
  'longitude',
  'accuracy',
  'speed',
  'battery_percentage',
  'is_mocked',
  'logged_at',
  'captured_at',
  'source',
  'sync_status',
  'metadata',
  'created_at',
].join(', ');

const isDebugLoggingEnabled =
  process.env.NODE_ENV !== 'production' ||
  process.env.FO_KM_DEBUG_LOGS === 'true';

function debugLog(...args) {
  if (isDebugLoggingEnabled) {
    console.log(...args);
  }
}

function log(event, detail = {}) {
  debugLog(`[${event}]`, detail);
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

function redactForLog(value, secrets = []) {
  let text = value == null ? '' : String(value);
  for (const secret of secrets) {
    if (secret) text = text.split(secret).join('[redacted]');
  }
  return text.replace(/([?&]key=)[^&\s]+/gi, '$1[redacted]');
}

function indiaDateKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function normalizeNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const number = Number(typeof value === 'string' ? value.trim() : value);
  return Number.isFinite(number) ? number : null;
}

function createGoogleDirectionsContext(options = {}) {
  const maxCalls = Number(options.maxGoogleDirectionsCalls ?? process.env.MAX_GOOGLE_DIRECTIONS_CALLS);
  return {
    enabled: process.env.ENABLE_GOOGLE_DIRECTIONS === 'true',
    disabledLogged: false,
    callsAttempted: 0,
    maxCalls: Number.isFinite(maxCalls) && maxCalls >= 0
      ? maxCalls
      : DEFAULT_MAX_GOOGLE_DIRECTIONS_CALLS,
  };
}

function googleDirectionsContext(options = {}) {
  if (options.googleDirectionsContext) return options.googleDirectionsContext;
  const context = createGoogleDirectionsContext(options);
  options.googleDirectionsContext = context;
  return context;
}

function pointTime(row) {
  const value = row?.captured_at || row?.logged_at || row?.created_at;
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
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

function cleanGpsLogs(rows = []) {
  const sorted = rows
    .map((row) => {
      const latitude = normalizeNumber(row.latitude);
      const longitude = normalizeNumber(row.longitude);
      const accuracy = normalizeNumber(row.accuracy);
      const capturedAt = pointTime(row);
      return {
        ...row,
        latitude,
        longitude,
        accuracy,
        capturedAt,
        highConfidence: accuracy !== null && accuracy <= HIGH_CONFIDENCE_ACCURACY_METERS,
      };
    })
    .filter((point) => {
      if (!isValidCoordinate(point.latitude, point.longitude)) return false;
      if (point.accuracy === null || point.accuracy > MAX_ACCURACY_METERS) return false;
      if (!point.capturedAt) return false;
      if (point.is_mocked === true || point.metadata?.mock === true) return false;
      return true;
    })
    .sort((a, b) => a.capturedAt - b.capturedAt);

  const cleaned = [];
  for (const point of sorted) {
    const previous = cleaned.at(-1);
    if (previous) {
      const sameCoordinate =
        previous.latitude === point.latitude && previous.longitude === point.longitude;
      const gapSeconds = (point.capturedAt - previous.capturedAt) / 1000;
      if (sameCoordinate && gapSeconds >= 0 && gapSeconds <= DUPLICATE_WINDOW_SECONDS) {
        continue;
      }
    }
    cleaned.push(point);
  }
  return cleaned;
}

async function googleDirectionsKm(start, end, options = {}) {
  const context = googleDirectionsContext(options);
  if (!context.enabled) {
    if (!context.disabledLogged) {
      context.disabledLogged = true;
      log('GOOGLE_DIRECTIONS_DISABLED', {
        enable_google_directions: process.env.ENABLE_GOOGLE_DIRECTIONS || 'false',
      });
    }
    return null;
  }
  if (context.callsAttempted >= context.maxCalls) {
    log('GOOGLE_DIRECTIONS_LIMIT_REACHED', {
      calls_attempted: context.callsAttempted,
      max_calls: context.maxCalls,
    });
    return null;
  }
  const keySource = options.googleMapsApiKey
    ? 'options.googleMapsApiKey'
    : process.env.GOOGLE_MAPS_API_KEY
      ? 'GOOGLE_MAPS_API_KEY'
      : process.env.VITE_GOOGLE_MAPS_API_KEY
        ? 'VITE_GOOGLE_MAPS_API_KEY'
        : null;
  const apiKey =
    options.googleMapsApiKey ||
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.VITE_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    log('GOOGLE_MAPS_API_KEY_MISSING', {
      checked_env: ['GOOGLE_MAPS_API_KEY', 'VITE_GOOGLE_MAPS_API_KEY'],
      has_options_key: Boolean(options.googleMapsApiKey),
    });
    return null;
  }
  const url = new URL('https://maps.googleapis.com/maps/api/directions/json');
  url.searchParams.set('origin', `${start.latitude},${start.longitude}`);
  url.searchParams.set('destination', `${end.latitude},${end.longitude}`);
  url.searchParams.set('mode', 'driving');
  url.searchParams.set('key', apiKey);

  log('GOOGLE_DIRECTIONS_REQUEST_ATTEMPTED', {
    endpoint: 'https://maps.googleapis.com/maps/api/directions/json',
    mode: 'driving',
    key_source: keySource,
    calls_attempted: context.callsAttempted + 1,
    max_calls: context.maxCalls,
    has_origin: isValidCoordinate(start.latitude, start.longitude),
    has_destination: isValidCoordinate(end.latitude, end.longitude),
  });
  context.callsAttempted += 1;

  try {
    const response = await fetch(url);
    log('GOOGLE_DIRECTIONS_HTTP_STATUS', {
      status: response.status,
      ok: response.ok,
      status_text: response.statusText,
    });
    if (!response.ok) {
      log('GOOGLE_DIRECTIONS_HTTP_FAILED', {
        status: response.status,
        status_text: response.statusText,
      });
      return null;
    }

    const payload = await response.json();
    log('GOOGLE_DIRECTIONS_PAYLOAD_STATUS', {
      status: payload.status,
      error_message: payload.error_message ? redactForLog(payload.error_message, [apiKey]) : null,
    });
    if (payload.status !== 'OK') return null;

    const meters = payload.routes?.[0]?.legs?.reduce(
      (sum, leg) => sum + Number(leg.distance?.value || 0),
      0,
    );
    const km = Number.isFinite(meters) && meters > 0 ? meters / 1000 : null;
    if (km === null) {
      log('GOOGLE_DIRECTIONS_NO_DISTANCE', {
        status: payload.status,
        route_count: Array.isArray(payload.routes) ? payload.routes.length : 0,
      });
    }
    return km;
  } catch (error) {
    log('GOOGLE_DIRECTIONS_FETCH_ERROR', {
      message: redactForLog(error?.message || String(error), [apiKey]),
      name: error?.name,
    });
    return null;
  }
}

async function calculateActualTravelKm(points, options = {}) {
  let acceptedKm = 0;
  let reconstructedKm = 0;
  let segmentsAccepted = 0;
  let segmentsRejected = 0;
  let segmentsReconstructed = 0;
  const segmentSummary = [];

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const secondsGap = (current.capturedAt - previous.capturedAt) / 1000;
    const distanceKm = haversineKm(previous, current);
    const distanceMeters = distanceKm * 1000;
    const speedKmph = secondsGap > 0 ? (distanceKm / (secondsGap / 3600)) : Number.POSITIVE_INFINITY;

    if (
      distanceMeters >= MIN_SEGMENT_METERS &&
      secondsGap > 0 &&
      secondsGap <= MAX_NORMAL_GAP_SECONDS &&
      speedKmph <= MAX_SPEED_KMPH &&
      distanceMeters <= MAX_NORMAL_SEGMENT_METERS
    ) {
      acceptedKm += distanceKm;
      segmentsAccepted += 1;
      log('FO_KM_SEGMENT_ACCEPTED', { index, distanceKm: Number(distanceKm.toFixed(3)), secondsGap, speedKmph: Number(speedKmph.toFixed(1)) });
      segmentSummary.push({ index, status: 'accepted', distance_km: distanceKm, seconds_gap: secondsGap, speed_kmph: speedKmph });
      continue;
    }

    const gapDetected =
      secondsGap > MAX_NORMAL_GAP_SECONDS || distanceMeters > MAX_NORMAL_SEGMENT_METERS;
    if (gapDetected) {
      log('FO_KM_GAP_DETECTED', { index, distanceKm: Number(distanceKm.toFixed(3)), secondsGap, speedKmph: Number(speedKmph.toFixed(1)) });
      const googleKm = await googleDirectionsKm(previous, current, options);
      if (googleKm !== null) {
        reconstructedKm += googleKm;
        segmentsReconstructed += 1;
        log('FO_KM_GAP_RECONSTRUCTED_GOOGLE', { index, googleKm: Number(googleKm.toFixed(3)) });
        segmentSummary.push({ index, status: 'reconstructed_google', distance_km: googleKm, seconds_gap: secondsGap, speed_kmph: speedKmph });
        continue;
      }
      if (secondsGap > 0 && speedKmph <= MAX_SPEED_KMPH) {
        reconstructedKm += distanceKm;
        segmentsReconstructed += 1;
        log('FO_KM_GAP_RECONSTRUCTED_HAVERSINE', {
          index,
          distanceKm: Number(distanceKm.toFixed(3)),
          secondsGap,
          speedKmph: Number(speedKmph.toFixed(1)),
          reason: 'google_directions_unavailable',
        });
        segmentSummary.push({ index, status: 'reconstructed_haversine', distance_km: distanceKm, seconds_gap: secondsGap, speed_kmph: speedKmph });
        continue;
      }
    }

    segmentsRejected += 1;
    log('FO_KM_SEGMENT_REJECTED', { index, distanceKm: Number(distanceKm.toFixed(3)), secondsGap, speedKmph: Number(speedKmph.toFixed(1)) });
    segmentSummary.push({ index, status: 'rejected', distance_km: distanceKm, seconds_gap: secondsGap, speed_kmph: speedKmph });
  }

  const actualTravelKm = acceptedKm + reconstructedKm;
  return {
    actualTravelKm,
    acceptedKm,
    reconstructedKm,
    segmentsAccepted,
    segmentsRejected,
    segmentsReconstructed,
    segmentSummary,
  };
}

function isStaleAutoEndedAttendance(attendance) {
  const metadata = safeAttendanceMetadata(attendance);
  return (
    String(attendance?.status || '').trim().toLowerCase() === 'stale auto ended' ||
    metadata.auto_ended === true ||
    String(metadata.auto_ended || '').toLowerCase() === 'true' ||
    metadata.stale_auto_ended === true ||
    String(metadata.stale_auto_ended || '').toLowerCase() === 'true'
  );
}

async function findAttendance(client, { attendance_id, fo_user_id, employee_code, date }) {
  if (attendance_id) {
    const { data, error } = await client
      .from('fo_attendance')
      .select(ATTENDANCE_SELECT_COLUMNS)
      .eq('id', attendance_id)
      .single();
    if (error) throw error;
    return data;
  }
  const employeeKey = String(fo_user_id || employee_code || '').trim();
  if (!employeeKey) {
    const error = new Error('fo_user_id, employee_code, or attendance_id is required.');
    error.statusCode = 400;
    throw error;
  }
  const attendanceDate = date || indiaDateKey();
  let query = client
    .from('fo_attendance')
    .select(ATTENDANCE_SELECT_COLUMNS)
    .eq('attendance_date', attendanceDate)
    .order('login_time', { ascending: false })
    .limit(1);
  query = fo_user_id
    ? query.eq('fo_user_id', fo_user_id)
    : query.eq('employee_code', employeeKey);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) {
    const missing = new Error(`No attendance found for ${employeeKey} on ${attendanceDate}.`);
    missing.statusCode = 404;
    throw missing;
  }
  return data;
}

async function loadGpsLogs(client, attendance) {
  const { data: attendanceLogs, error: attendanceLogsError } = await client
    .from('fo_location_logs')
    .select(LOCATION_LOG_SELECT_COLUMNS)
    .eq('attendance_id', attendance.id)
    .order('captured_at', { ascending: true })
    .limit(20000);
  if (attendanceLogsError) throw attendanceLogsError;
  if (attendanceLogs?.length) return attendanceLogs;

  const start = attendance.login_time;
  const end = attendance.logout_time || new Date().toISOString();
  const { data, error } = await client
    .from('fo_location_logs')
    .select(LOCATION_LOG_SELECT_COLUMNS)
    .eq('fo_user_id', attendance.fo_user_id)
    .gte('captured_at', start)
    .lte('captured_at', end)
    .order('captured_at', { ascending: true })
    .limit(20000);
  if (error) throw error;
  return data || [];
}

async function loadSiteVisits(client, attendance) {
  const { data, error } = await client
    .from('fo_site_visits')
    .select(SITE_VISIT_SELECT_COLUMNS)
    .eq('attendance_id', attendance.id)
    .order('check_in_time', { ascending: true })
    .limit(500);
  if (error) throw error;
  return data || [];
}

function sumStoredRouteKm(visits = []) {
  return visits.reduce((sum, visit) => {
    const routeKm = normalizeNumber(visit.route_km);
    return Number.isFinite(routeKm) && routeKm > 0 ? sum + routeKm : sum;
  }, 0);
}

function isOpenVisit(visit) {
  return !visit?.checkout_time && !visit?.check_out_time;
}

function visitTime(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function latestCheckedOutVisit(visits = []) {
  return visits
    .filter((visit) => {
      const status = String(visit?.status || visit?.visit_status || '').toLowerCase();
      return Boolean(
        visit?.check_out_time ||
          visit?.checkout_time ||
          status.includes('checked out') ||
          status.includes('completed'),
      );
    })
    .sort((a, b) => {
      const aTime = visitTime(a.checkout_time || a.check_out_time || a.updated_at || a.check_in_time);
      const bTime = visitTime(b.checkout_time || b.check_out_time || b.updated_at || b.check_in_time);
      return (bTime?.getTime() || 0) - (aTime?.getTime() || 0);
    })[0] || null;
}

function latestCompletedVisit(visits = []) {
  return visits
    .filter((visit) => !isOpenVisit(visit))
    .sort((a, b) => {
      const aTime = visitTime(a.checkout_time || a.check_out_time || a.updated_at || a.check_in_time);
      const bTime = visitTime(b.checkout_time || b.check_out_time || b.updated_at || b.check_in_time);
      return (bTime?.getTime() || 0) - (aTime?.getTime() || 0);
    })[0] || null;
}

function finalReturnOriginFromVisit(visit) {
  if (!visit) return null;
  const candidates = [
    ['check_out_latitude', 'check_out_longitude', 'checkout_location'],
    ['destination_lat', 'destination_lng', 'site_destination'],
    ['check_in_latitude', 'check_in_longitude', 'site_checkin'],
  ];
  for (const [latKey, lngKey, source] of candidates) {
    const latitude = normalizeNumber(visit?.[latKey]);
    const longitude = normalizeNumber(visit?.[lngKey]);
    if (isValidCoordinate(latitude, longitude)) {
      return { latitude, longitude, source };
    }
  }
  return null;
}

function safeAttendanceMetadata(attendance) {
  return attendance?.metadata && typeof attendance.metadata === 'object' && !Array.isArray(attendance.metadata)
    ? attendance.metadata
    : {};
}

function normalizeTravelMode(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  return ['bike', 'own_vehicle', 'auto', 'bus', 'train', 'other'].includes(normalized)
    ? normalized
    : 'bike';
}

function travelModeAllowsPayableKm(attendance) {
  const metadata = safeAttendanceMetadata(attendance);
  const travelMode = normalizeTravelMode(attendance?.travel_mode || metadata.travel_mode);
  const explicitAllowed = attendance?.payable_km_allowed;
  if (explicitAllowed === false || String(explicitAllowed).toLowerCase() === 'false') {
    return { travelMode, payableKmAllowed: false };
  }
  return {
    travelMode,
    payableKmAllowed: travelMode === 'bike' || travelMode === 'own_vehicle',
  };
}

function attendanceEndCoordinate(attendance) {
  return coordinateFrom(
    attendance,
    ['end_latitude'],
    ['end_longitude'],
  );
}

function attendanceEndedWithOpenSite(attendance) {
  const metadata = safeAttendanceMetadata(attendance);
  return metadata.end_day_with_open_site === true || String(metadata.end_day_with_open_site || '').toLowerCase() === 'true';
}

async function calculateFinalReturnLegKm(attendance, visits = [], options = {}) {
  if (isStaleAutoEndedAttendance(attendance)) {
    const reason = 'skipped_stale_auto_ended';
    log('FINAL_RETURN_LEG_SKIPPED', {
      attendance_id: attendance.id,
      reason,
    });
    return { km: null, calculated: false, includedInPayable: false, status: reason, reason };
  }
  if (!attendance?.logout_time) {
    const reason = 'skipped_missing_logout_time';
    log('FINAL_RETURN_LEG_SKIPPED', {
      attendance_id: attendance.id,
      reason,
    });
    return { km: null, calculated: false, includedInPayable: false, status: reason, reason };
  }
  if (!visits.length) {
    const reason = 'skipped_no_visits';
    log('FINAL_RETURN_LEG_SKIPPED', {
      attendance_id: attendance.id,
      reason,
    });
    return { km: null, calculated: false, includedInPayable: false, status: reason, reason };
  }
  if (attendanceEndedWithOpenSite(attendance)) {
    const reason = 'skipped_end_day_with_open_site';
    log('FINAL_RETURN_LEG_SKIPPED', {
      attendance_id: attendance.id,
      reason,
    });
    return { km: null, calculated: false, includedInPayable: false, status: reason, reason };
  }
  const checkedOutVisit = latestCheckedOutVisit(visits);
  const completedVisit = checkedOutVisit || latestCompletedVisit(visits);
  const origin = finalReturnOriginFromVisit(completedVisit);
  const destination = attendanceEndCoordinate(attendance);
  const lastSiteName = completedVisit?.store_name || completedVisit?.site_name || completedVisit?.client_name || null;

  log('FINAL_RETURN_LEG_CHECK', {
    attendance_id: attendance.id,
    site_visit_id: completedVisit?.id,
    origin_source: origin?.source || null,
    has_origin: Boolean(origin),
    has_destination: Boolean(destination),
  });
  debugLog('FINAL LEG INPUTS', {
    attendanceId: attendance.id,
    employeeCode: attendance.employee_code,
    endLatitude: attendance.end_latitude,
    endLongitude: attendance.end_longitude,
    visitsCount: visits.length,
    storedRouteKm: options.storedRouteKm ?? null,
    lastVisitId: completedVisit?.id || null,
    lastSiteName,
    originLat: origin?.latitude ?? null,
    originLng: origin?.longitude ?? null,
    originSource: origin?.source ?? null,
    destinationLat: destination?.latitude ?? null,
    destinationLng: destination?.longitude ?? null,
  });

  if (!completedVisit || !origin) {
    const reason = completedVisit ? 'skipped_missing_origin' : 'skipped_no_checked_out_visits';
    log('FINAL_RETURN_LEG_SKIPPED', { attendance_id: attendance.id, reason });
    return { km: null, calculated: false, includedInPayable: false, status: reason, reason };
  }
  if (!destination) {
    const reason = 'skipped_missing_end_location';
    log('FINAL_RETURN_LEG_SKIPPED', { attendance_id: attendance.id, site_visit_id: completedVisit.id, reason });
    return { km: null, calculated: false, includedInPayable: false, status: reason, reason };
  }

  const straightLineKm = haversineKm(origin, destination);
  if (!Number.isFinite(straightLineKm) || straightLineKm < MIN_MEANINGFUL_FINAL_RETURN_LEG_KM) {
    const reason = 'same_or_near_same_location';
    log('FINAL_RETURN_LEG_SKIPPED', {
      attendance_id: attendance.id,
      site_visit_id: completedVisit.id,
      reason,
      straight_line_km: Number((straightLineKm || 0).toFixed(3)),
    });
    return {
      km: 0,
      calculated: true,
      reason,
      status: 'calculated_same_location',
      includedInPayable: true,
      site_visit_id: completedVisit.id,
      site_name: lastSiteName,
      origin,
      destination,
      provider: 'none',
      origin_source: origin.source,
    };
  }

  const googleKm = await googleDirectionsKm(origin, destination, options);
  if (googleKm !== null) {
    const km = Number(googleKm.toFixed(2));
    log('FINAL_RETURN_LEG_GOOGLE_SUCCESS', {
      attendance_id: attendance.id,
      site_visit_id: completedVisit.id,
      route_km: km,
      straight_line_km: Number(straightLineKm.toFixed(3)),
    });
    return {
      km,
      calculated: true,
      reason: null,
      status: 'calculated',
      includedInPayable: true,
      site_visit_id: completedVisit.id,
      site_name: lastSiteName,
      origin,
      destination,
      provider: 'google_directions',
      origin_source: origin.source,
    };
  }

  const fallbackKm = Number(straightLineKm.toFixed(2));
  const reason = process.env.ENABLE_GOOGLE_DIRECTIONS === 'true'
    ? 'google_failed_used_haversine'
    : process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY
      ? 'google_disabled_used_haversine'
      : 'google_missing_key_used_haversine';
  log('FINAL_RETURN_LEG_HAVERSINE_FALLBACK', {
    attendance_id: attendance.id,
    site_visit_id: completedVisit.id,
    route_km: fallbackKm,
    reason,
    straight_line_km: Number(straightLineKm.toFixed(3)),
  });
  return {
    km: fallbackKm,
    calculated: true,
    reason,
    status: 'calculated',
    includedInPayable: true,
    site_visit_id: completedVisit.id,
    site_name: lastSiteName,
    origin,
    destination,
    provider: 'haversine_fallback',
    origin_source: origin.source,
  };
}

async function calculateRouteKmFromVisitAnchors(client, attendance, visits = [], options = {}) {
  const reviewFlags = [];
  let origin = coordinateFrom(
    attendance,
    ['start_latitude'],
    ['start_longitude'],
  );
  if (!origin) reviewFlags.push('MISSING_ANCHOR_COORDINATES');

  let routeKm = 0;
  let googleFailed = false;
  let calculatedLegs = 0;

  for (const visit of visits) {
    if (isOpenVisit(visit)) reviewFlags.push('OPEN_SITE_VISIT');
    const destination =
      coordinateFrom(visit, ['destination_lat', 'check_in_latitude', 'current_latitude'], ['destination_lng', 'check_in_longitude', 'current_longitude']);
    if (!origin || !destination) {
      reviewFlags.push('MISSING_ANCHOR_COORDINATES');
    } else {
      const legKm = await googleDirectionsKm(origin, destination, options);
      if (legKm === null) {
        googleFailed = true;
      } else {
        const roundedLegKm = Number(legKm.toFixed(2));
        routeKm += roundedLegKm;
        calculatedLegs += 1;
        const existingRouteKm = normalizeNumber(visit.route_km);
        if (!Number.isFinite(existingRouteKm) || existingRouteKm <= 0) {
          const { error } = await client
            .from('fo_site_visits')
            .update({
              route_km: roundedLegKm,
              distance_source: 'google_directions_recalculation',
              updated_at: new Date().toISOString(),
            })
            .eq('id', visit.id);
          if (error) throw error;
        }
      }
    }
    origin =
      coordinateFrom(visit, ['check_out_latitude', 'current_latitude', 'destination_lat'], ['check_out_longitude', 'current_longitude', 'destination_lng']) ||
      destination ||
      origin;
  }

  const end = coordinateFrom(
    attendance,
    ['end_latitude'],
    ['end_longitude'],
  );
  if (origin && end && attendance.logout_time) {
    const endLegKm = await googleDirectionsKm(origin, end, options);
    if (endLegKm === null) {
      googleFailed = true;
    } else {
      routeKm += Number(endLegKm.toFixed(2));
      calculatedLegs += 1;
    }
  } else if (attendance.logout_time && visits.length) {
    reviewFlags.push('MISSING_ANCHOR_COORDINATES');
  }

  if (googleFailed) reviewFlags.push('GOOGLE_ROUTE_FAILED');
  return {
    routeKm: Number(routeKm.toFixed(2)),
    calculatedLegs,
    reviewFlags: [...new Set(reviewFlags)],
  };
}

function confidenceFor({ usedPoints, totalPoints, segmentsRejected, segmentsReconstructed }) {
  if (usedPoints >= 100 && segmentsRejected <= 10) return 'HIGH';
  if (usedPoints >= 25 && segmentsRejected <= Math.max(10, usedPoints * 0.15)) return 'MEDIUM';
  if (segmentsReconstructed > 0 && usedPoints >= 10) return 'MEDIUM';
  return 'LOW';
}

export async function recalculateFoKm(serviceRoleClient, payload = {}, options = {}) {
  const client = requireServiceRoleClient(serviceRoleClient);
  const attendanceId = payload.attendance_id || payload.id || null;
  const foUserId = payload.fo_user_id || null;
  const employeeCode = payload.employee_code || null;
  const date = payload.date || payload.attendance_date || null;
  debugLog('KM RECALC REQUEST', {
    attendanceId,
    foUserId,
    employeeCode,
    date,
  });
  log('FO_KM_RECALC_STARTED', {
    attendance_id: attendanceId,
    fo_user_id: foUserId,
    employee_code: employeeCode,
    date,
  });
  const attendance = await findAttendance(client, {
    attendance_id: attendanceId,
    fo_user_id: foUserId,
    employee_code: employeeCode,
    date,
  });
  const rows = await loadGpsLogs(client, attendance);
  const visits = await loadSiteVisits(client, attendance);
  log('FO_KM_GPS_LOGS_LOADED', {
    fo_user_id: attendance.fo_user_id,
    attendance_id: attendance.id,
    count: rows.length,
  });

  const points = cleanGpsLogs(rows);
  const calculation = await calculateActualTravelKm(points, options);
  const actualTravelKm = Number(calculation.actualTravelKm.toFixed(2));
  const storedRouteKm = Number(sumStoredRouteKm(visits).toFixed(2));
  const existingMetadata = safeAttendanceMetadata(attendance);
  const finalReturnLeg = await calculateFinalReturnLegKm(attendance, visits, {
    ...options,
    storedRouteKm,
  });
  const finalReturnLegKm = Number.isFinite(finalReturnLeg.km)
    ? Number(finalReturnLeg.km.toFixed(2))
    : 0;
  const finalReturnLegKmForMetadata = finalReturnLeg.calculated === true && Number.isFinite(finalReturnLeg.km)
    ? Number(finalReturnLeg.km.toFixed(2))
    : null;
  const reviewFlags = [];
  const visitsMissingRouteKm = visits.filter((visit) => {
    const routeKm = normalizeNumber(visit.route_km);
    return !Number.isFinite(routeKm) || routeKm <= 0;
  }).length;
  if (visitsMissingRouteKm > 0) reviewFlags.push('SITE_VISIT_ROUTE_KM_MISSING');
  if (storedRouteKm <= 0 && visits.length > 0 && finalReturnLegKm <= 0) reviewFlags.push('ROUTE_KM_ZERO_WITH_VISITS');
  if (finalReturnLeg.reason && finalReturnLegKm <= 0) {
    reviewFlags.push(`FINAL_RETURN_LEG_${finalReturnLeg.reason.toUpperCase()}`);
  }
  if (rows.length < 5) reviewFlags.push('LOW_GPS_LOG_COUNT');
  const ratePerKm = normalizeNumber(attendance.rate_per_km) || RATE_PER_KM;
  const travelPolicy = travelModeAllowsPayableKm(attendance);
  const calculatedPayableKm = Number((storedRouteKm + finalReturnLegKm).toFixed(2));
  const approvedKm = travelPolicy.payableKmAllowed ? calculatedPayableKm : 0;
  const petrolAmount = travelPolicy.payableKmAllowed
    ? Number((approvedKm * ratePerKm).toFixed(2))
    : 0;
  let routeSyncStatus = approvedKm > 0 ? 'site_visit_route_km_sum' : 'review_required';
  if (finalReturnLegKm > 0) {
    routeSyncStatus = finalReturnLeg.provider === 'haversine_fallback'
      ? 'site_visit_route_km_sum_plus_final_leg_fallback'
      : 'site_visit_route_km_sum_plus_final_leg';
  }
  if (!travelPolicy.payableKmAllowed) {
    reviewFlags.push('NON_PAYABLE_TRAVEL_MODE');
    routeSyncStatus = 'non_payable_travel_mode';
  }
  log('FINAL_APPROVED_KM', {
    attendance_id: attendance.id,
    site_visit_route_km: storedRouteKm,
    final_return_leg_km: finalReturnLegKm,
    calculated_payable_km: calculatedPayableKm,
    travel_mode: travelPolicy.travelMode,
    payable_km_allowed: travelPolicy.payableKmAllowed,
    approved_km: approvedKm,
  });
  debugLog('FINAL LEG RESULT', {
    attendanceId: attendance.id,
    storedRouteKm,
    finalLegKm: finalReturnLegKm,
    finalReturnLegKm,
    provider: finalReturnLeg.provider || null,
    reason: finalReturnLeg.reason || null,
    calculatedPayableKm,
    travelMode: travelPolicy.travelMode,
    payableKmAllowed: travelPolicy.payableKmAllowed,
    approvedKm,
    petrolAmount,
    routeSyncStatus,
  });

  const attendanceUpdate = {
    actual_km: approvedKm,
    total_route_km: approvedKm,
    eligible_km: approvedKm,
    total_raw_km: actualTravelKm,
    raw_gps_km: actualTravelKm,
    filtered_gps_km: Number(calculation.acceptedKm.toFixed(2)),
    actual_travel_km: actualTravelKm,
    actual_travel_updated_at: new Date().toISOString(),
    total_approved_km: approvedKm,
    petrol_amount: petrolAmount,
    travel_mode: travelPolicy.travelMode,
    payable_km_allowed: travelPolicy.payableKmAllowed,
    rate_per_km: ratePerKm,
    eligibility_status: reviewFlags.length ? reviewFlags.join(',') : 'Approved',
    route_sync_status: routeSyncStatus,
    metadata: {
      ...existingMetadata,
      final_return_leg_km: finalReturnLegKmForMetadata,
      final_return_leg_provider: finalReturnLeg.provider || null,
      final_return_leg_reason: finalReturnLeg.reason || null,
      final_return_leg_status: finalReturnLeg.status || (finalReturnLegKm > 0 ? 'calculated' : 'skipped'),
      final_return_leg_from_site: finalReturnLeg.site_name || null,
      final_return_leg_from_visit_id: finalReturnLeg.site_visit_id || null,
      final_return_leg_origin_lat: finalReturnLeg.origin?.latitude ?? null,
      final_return_leg_origin_lng: finalReturnLeg.origin?.longitude ?? null,
      final_return_leg_origin_source: finalReturnLeg.origin_source || null,
      final_return_leg_destination_lat: finalReturnLeg.destination?.latitude ?? null,
      final_return_leg_destination_lng: finalReturnLeg.destination?.longitude ?? null,
      final_return_leg_destination_source: finalReturnLeg.destination ? 'attendance_end_location' : null,
      final_return_leg_calculated_at: new Date().toISOString(),
      final_return_leg_included_in_payable:
        finalReturnLeg.includedInPayable === true && travelPolicy.payableKmAllowed,
      site_visit_route_km_sum: storedRouteKm,
      calculated_payable_km_before_travel_mode_policy: calculatedPayableKm,
      travel_mode: travelPolicy.travelMode,
      payable_km_allowed: travelPolicy.payableKmAllowed,
      recalculated_total_route_km: approvedKm,
      recalculated_petrol_amount: petrolAmount,
      km_recalculated_at: new Date().toISOString(),
      final_return_leg_from: finalReturnLeg.origin
        ? {
            latitude: finalReturnLeg.origin.latitude,
            longitude: finalReturnLeg.origin.longitude,
            site_visit_id: finalReturnLeg.site_visit_id || null,
            site_name: finalReturnLeg.site_name || null,
            source: finalReturnLeg.origin_source || null,
          }
        : null,
      final_return_leg_to: finalReturnLeg.destination
        ? {
            latitude: finalReturnLeg.destination.latitude,
            longitude: finalReturnLeg.destination.longitude,
            attendance_id: attendance.id,
          }
        : null,
      final_return_leg_calculated: finalReturnLeg.calculated === true,
      final_return_leg_skip_reason: finalReturnLegKm > 0 ? null : finalReturnLeg.reason || null,
      final_return_leg_reused_existing: false,
      final_return_leg_updated_at: new Date().toISOString(),
    },
    updated_at: new Date().toISOString(),
  };
  const { error: attendanceUpdateError } = await client
    .from('fo_attendance')
    .update(attendanceUpdate)
    .eq('id', attendance.id);
  if (attendanceUpdateError) throw attendanceUpdateError;
  log('FO_KM_ATTENDANCE_UPDATED', { attendance_id: attendance.id, actualTravelKm });

  const { error: liveStatusError } = await client
    .from('fo_live_status')
    .upsert(
      {
        fo_user_id: attendance.fo_user_id,
        username: attendance.username || attendance.fo_user_id,
        display_name: attendance.display_name,
        attendance_id: attendance.id,
        route_km_today: approvedKm,
        last_seen_at: new Date().toISOString(),
        source: 'backend_km_recalculation',
        sync_status: 'synced',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'fo_user_id' },
    );
  if (liveStatusError) throw liveStatusError;
  log('FO_KM_LIVE_STATUS_UPDATED', { fo_user_id: attendance.fo_user_id, route_km_today: approvedKm });

  const result = {
    ok: true,
    fo_user_id: attendance.fo_user_id,
    employee_code: attendance.employee_code,
    attendance_id: attendance.id,
    old_total_route_km: normalizeNumber(attendance.total_route_km),
    old_petrol_amount: normalizeNumber(attendance.petrol_amount),
    actual_travel_km: actualTravelKm,
    approved_km: approvedKm,
    new_total_route_km: approvedKm,
    new_petrol_amount: petrolAmount,
    total_route_km: approvedKm,
    petrol_amount: petrolAmount,
    gps_points_total: rows.length,
    gps_points_used: points.length,
    site_visits_count: visits.length,
    stored_route_km: storedRouteKm,
    stored_site_visit_route_km: storedRouteKm,
    final_return_leg_km: finalReturnLegKmForMetadata,
    final_return_leg_provider: finalReturnLeg.provider || null,
    final_return_leg_status: finalReturnLeg.status || (finalReturnLegKm > 0 ? 'calculated' : 'skipped'),
    final_return_leg_reason: finalReturnLeg.reason || null,
    final_return_leg_calculated: finalReturnLeg.calculated,
    final_return_leg_reused_existing: false,
    final_return_leg_skip_reason: finalReturnLegKm > 0 ? null : finalReturnLeg.reason,
    final_return_leg_site_visit_id: finalReturnLeg.site_visit_id || existingMetadata.final_return_leg_from?.site_visit_id || null,
    backend_route_legs_calculated: finalReturnLeg.calculated ? 1 : 0,
    site_visits_missing_route_km: visitsMissingRouteKm,
    review_flags: [...new Set(reviewFlags)],
    route_sync_status: routeSyncStatus,
    segments_accepted: calculation.segmentsAccepted,
    segments_reconstructed: calculation.segmentsReconstructed,
    segments_rejected: calculation.segmentsRejected,
    confidence: confidenceFor({
      usedPoints: points.length,
      totalPoints: rows.length,
      segmentsRejected: calculation.segmentsRejected,
      segmentsReconstructed: calculation.segmentsReconstructed,
    }),
    accepted_gps_km: Number(calculation.acceptedKm.toFixed(2)),
    reconstructed_gap_km: Number(calculation.reconstructedKm.toFixed(2)),
    updated: true,
    skipped: finalReturnLeg.includedInPayable !== true,
    skip_reason: finalReturnLeg.includedInPayable === true ? null : finalReturnLeg.reason || null,
  };
  log('FO_KM_RECALC_COMPLETED', result);
  return result;
}

function normalizeDateInput(value, fallback = indiaDateKey()) {
  const text = String(value || fallback || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const error = new Error('Date must be in YYYY-MM-DD format.');
    error.statusCode = 400;
    throw error;
  }
  return text;
}

function batchCounterKey(result = {}) {
  const reason = String(
    result.skip_reason ||
      result.final_return_leg_status ||
      result.final_return_leg_reason ||
      '',
  );
  if (/stale_auto_ended/.test(reason)) return 'skipped_stale_auto_ended';
  if (/missing_end_location|missing_end_day_gps/.test(reason)) return 'skipped_missing_end_location';
  if (/no_visits|no_checked_out_visits/.test(reason)) return 'skipped_no_visits';
  if (/missing_origin|missing_site_gps/.test(reason)) return 'skipped_missing_origin';
  if (result.skipped) return 'skipped_other';
  return null;
}

export async function recalculateFoKmBatch(serviceRoleClient, payload = {}, options = {}) {
  const client = requireServiceRoleClient(serviceRoleClient);
  const fromDate = normalizeDateInput(payload.fromDate || payload.from_date || payload.date);
  const toDate = normalizeDateInput(payload.toDate || payload.to_date || payload.date || fromDate, fromDate);
  if (fromDate > toDate) {
    const error = new Error('fromDate must be before or equal to toDate.');
    error.statusCode = 400;
    throw error;
  }

  let query = client
    .from('fo_attendance')
    .select(ATTENDANCE_SELECT_COLUMNS)
    .gte('attendance_date', fromDate)
    .lte('attendance_date', toDate)
    .not('logout_time', 'is', null)
    .order('login_time', { ascending: false })
    .limit(Number(payload.limit || 2000));
  if (payload.fo_user_id) query = query.eq('fo_user_id', payload.fo_user_id);
  if (payload.employee_code) query = query.eq('employee_code', payload.employee_code);
  const { data, error } = await query;
  if (error) throw error;

  const results = [];
  const summary = {
    scanned: data?.length || 0,
    updated: 0,
    skipped_missing_end_location: 0,
    skipped_stale_auto_ended: 0,
    skipped_no_visits: 0,
    skipped_missing_origin: 0,
    skipped_other: 0,
    failed: 0,
  };

  for (const attendance of data || []) {
    try {
      const result = await recalculateFoKm(client, { attendance_id: attendance.id }, options);
      if (result.skipped) {
        const key = batchCounterKey(result) || 'skipped_other';
        summary[key] = (summary[key] || 0) + 1;
      } else {
        summary.updated += 1;
      }
      results.push({
        attendance_id: result.attendance_id,
        employee_code: result.employee_code,
        status: result.skipped ? 'skipped' : 'updated',
        old_total_route_km: result.old_total_route_km,
        stored_route_km: result.stored_route_km,
        final_return_leg_km: result.final_return_leg_km,
        new_total_route_km: result.new_total_route_km,
        old_petrol_amount: result.old_petrol_amount,
        new_petrol_amount: result.new_petrol_amount,
        provider: result.final_return_leg_provider,
        reason: result.skip_reason || result.final_return_leg_reason,
        route_sync_status: result.route_sync_status,
      });
    } catch (error) {
      summary.failed += 1;
      results.push({
        fo_user_id: attendance.fo_user_id,
        employee_code: attendance.employee_code,
        attendance_id: attendance.id,
        status: 'failed',
        message: error.message,
      });
    }
  }
  return {
    fromDate,
    toDate,
    state: payload.state || null,
    business: payload.business || null,
    stateBusinessFiltering: 'not_applied_attendance_rows_do_not_store_confirmed_state_business_columns',
    ...summary,
    results,
  };
}

export async function recalculateFoKmForToday(serviceRoleClient, payload = {}, options = {}) {
  const date = payload.date || indiaDateKey();
  return recalculateFoKmBatch(serviceRoleClient, { ...payload, fromDate: date, toDate: date }, options);
}
