const RATE_PER_KM = 4;
const CAR_RATE_PER_KM = 8;
const MAX_ACCURACY_METERS = 50;
const HIGH_CONFIDENCE_ACCURACY_METERS = 40;
const MIN_SEGMENT_METERS = 5;
const MAX_NORMAL_GAP_SECONDS = 600;
const MAX_NORMAL_SEGMENT_METERS = 2500;
const MAX_SPEED_KMPH = 120;
const DUPLICATE_WINDOW_SECONDS = 10;
const ANCHOR_DEDUP_WINDOW_SECONDS = 30;
const ANCHOR_DEDUP_DISTANCE_METERS = 50;
const OPEN_SITE_DEPARTURE_DISTANCE_METERS = 100;
const MIN_WINDOW_RAW_GPS_ROWS = 10;
const MIN_WINDOW_VALID_GPS_POINTS = 5;
const MIN_WINDOW_VALID_GPS_RATIO = 0.6;
const MIN_MEANINGFUL_FINAL_RETURN_LEG_KM = 0.05;
const DEFAULT_MAX_GOOGLE_DIRECTIONS_CALLS = 25;
// Conservative review defaults. They can be overridden per call or through
// environment configuration without changing the payable source rule.
const DEFAULT_FINAL_RETURN_MISMATCH_MIN_ROUTE_KM = 5;
const DEFAULT_FINAL_RETURN_MISMATCH_MAX_GPS_RATIO = 0.25;
const DEFAULT_FINAL_RETURN_MISMATCH_MIN_DIFFERENCE_KM = 5;
const SWITCH_TIME_ANCHOR_MAX_GAP_MINUTES = 60;
const DELAYED_CHECKOUT_WARNING_THRESHOLD_METERS = 100;
const DELAYED_CHECKOUT_REVIEW_THRESHOLD_METERS = 1000;
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
  'store_id',
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
  'checkout_distance_meters',
  'checkout_location_status',
  'checkout_note',
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

function calculateRawGpsKm(points = []) {
  let rawKm = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const secondsGap = (current.capturedAt - previous.capturedAt) / 1000;
    const distanceKm = haversineKm(previous, current);
    if (secondsGap > 0 && distanceKm * 1000 >= MIN_SEGMENT_METERS) {
      rawKm += distanceKm;
    }
  }
  return rawKm;
}

function gpsWindowQuality(rows = [], cleanedPoints = [], calculatedKm = 0) {
  const rawCount = rows.length;
  const validCount = cleanedPoints.length;
  const validRatio = rawCount > 0 ? validCount / rawCount : 0;
  return {
    rawCount,
    validCount,
    validRatio,
    usable:
      rawCount >= MIN_WINDOW_RAW_GPS_ROWS &&
      validCount >= MIN_WINDOW_VALID_GPS_POINTS &&
      validRatio >= MIN_WINDOW_VALID_GPS_RATIO &&
      Number(calculatedKm) > 0,
  };
}

function deduplicateGpsRows(rows = []) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = row?.id
      ? `id:${row.id}`
      : `point:${pointTime(row)?.toISOString() || ''}:${normalizeNumber(row?.latitude)}:${normalizeNumber(row?.longitude)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function indiaDayEndExclusive(attendanceDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(attendanceDate || ''));
  if (!match) return null;
  const utc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 18, 30, 0, 0);
  return new Date(utc);
}

function pointCoordinate(point) {
  const latitude = normalizeNumber(point?.latitude);
  const longitude = normalizeNumber(point?.longitude);
  return isValidCoordinate(latitude, longitude) ? { latitude, longitude } : null;
}

function addWindowAnchor(points, coordinate, time, position) {
  const anchorTime = parseValidDate(time);
  if (!coordinate || !anchorTime) return points;
  const duplicate = points.some((point) => {
    const capturedAt = point?.capturedAt || pointTime(point);
    const pointCoord = pointCoordinate(point);
    return capturedAt && pointCoord &&
      Math.abs(capturedAt - anchorTime) / 1000 <= ANCHOR_DEDUP_WINDOW_SECONDS &&
      haversineKm(pointCoord, coordinate) * 1000 <= ANCHOR_DEDUP_DISTANCE_METERS;
  });
  if (duplicate) return points;
  const anchor = {
    id: `anchor:${position}:${anchorTime.toISOString()}`,
    latitude: coordinate.latitude,
    longitude: coordinate.longitude,
    accuracy: 0,
    capturedAt: anchorTime,
    captured_at: anchorTime.toISOString(),
    highConfidence: true,
    isWindowAnchor: true,
  };
  return [...points, anchor].sort((a, b) => a.capturedAt - b.capturedAt);
}

function connectWindowAnchors(points, from, fromTime, to, toTime) {
  let connected = [...points];
  connected = addWindowAnchor(connected, from, fromTime, 'start');
  connected = addWindowAnchor(connected, to, toTime, 'end');
  return connected;
}

function isStaleAutoEndedAttendance(attendance) {
  const metadata = safeAttendanceMetadata(attendance);
  const status = String(attendance?.status || '').trim().toLowerCase();
  return (
    status === 'stale auto ended' ||
    status === 'auto ended' ||
    status === 'automatically ended' ||
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

async function loadGpsLogsForWindow(client, attendance, fromTime, toTime) {
  const start = parseValidDate(fromTime);
  const end = parseValidDate(toTime);
  if (!start || !end || end <= start) return [];

  let query = client
    .from('fo_location_logs')
    .select(LOCATION_LOG_SELECT_COLUMNS)
    .gte('captured_at', start.toISOString())
    .lte('captured_at', end.toISOString())
    .order('captured_at', { ascending: true })
    .limit(20000);
  query = attendance?.id
    ? query.eq('attendance_id', attendance.id)
    : query.eq('fo_user_id', attendance.fo_user_id);
  const { data: attendanceLogs, error: attendanceLogsError } = await query;
  if (attendanceLogsError) throw attendanceLogsError;
  if (attendanceLogs?.length || !attendance?.fo_user_id) return attendanceLogs || [];

  const { data, error } = await client
    .from('fo_location_logs')
    .select(LOCATION_LOG_SELECT_COLUMNS)
    .eq('fo_user_id', attendance.fo_user_id)
    .gte('captured_at', start.toISOString())
    .lte('captured_at', end.toISOString())
    .order('captured_at', { ascending: true })
    .limit(20000);
  if (error) throw error;
  return data || [];
}

async function loadGpsLogsForWindowWithBinding(client, attendance, fromTime, toTime) {
  const start = parseValidDate(fromTime);
  const end = parseValidDate(toTime);
  if (!start || !end || end <= start) {
    return { rows: [], bindingSource: 'none' };
  }

  let attendanceRows = [];
  if (attendance?.id) {
    const { data, error } = await client
      .from('fo_location_logs')
      .select(LOCATION_LOG_SELECT_COLUMNS)
      .eq('attendance_id', attendance.id)
      .gt('captured_at', start.toISOString())
      .lte('captured_at', end.toISOString())
      .order('captured_at', { ascending: true })
      .limit(20000);
    if (error) throw error;
    attendanceRows = data || [];
  }
  const attendanceCleaned = cleanGpsLogs(attendanceRows);
  const attendancePrecheck = attendanceCleaned.length >= 2
    ? await calculateActualTravelKm(attendanceCleaned, { maxGoogleDirectionsCalls: 0 })
    : { actualTravelKm: 0 };
  const attendanceQuality = gpsWindowQuality(
    attendanceRows,
    attendanceCleaned,
    attendancePrecheck.actualTravelKm,
  );
  if (attendanceQuality.usable || !attendance?.fo_user_id) {
    return {
      rows: deduplicateGpsRows(attendanceRows),
      bindingSource: attendance?.id ? 'attendance_id' : 'none',
    };
  }

  const { data: sameDayAttendances, error: overlapError } = await client
    .from('fo_attendance')
    .select('id, login_time, logout_time')
    .eq('fo_user_id', attendance.fo_user_id)
    .eq('attendance_date', attendance.attendance_date)
    .limit(20);
  if (overlapError) throw overlapError;
  const overlapsAnotherAttendance = (sameDayAttendances || []).some((row) => {
    if (row.id === attendance.id) return false;
    const otherStart = parseValidDate(row.login_time);
    const otherEnd = parseValidDate(row.logout_time) || indiaDayEndExclusive(attendance.attendance_date);
    return otherStart && otherEnd && otherStart < end && otherEnd > start;
  });
  if (overlapsAnotherAttendance) {
    return { rows: deduplicateGpsRows(attendanceRows), bindingSource: 'attendance_id' };
  }

  const { data: employeeRows, error: employeeError } = await client
    .from('fo_location_logs')
    .select(LOCATION_LOG_SELECT_COLUMNS)
    .eq('fo_user_id', attendance.fo_user_id)
    .gt('captured_at', start.toISOString())
    .lte('captured_at', end.toISOString())
    .order('captured_at', { ascending: true })
    .limit(20000);
  if (employeeError) throw employeeError;
  const fallbackRows = deduplicateGpsRows(employeeRows || []);
  const fallbackCleaned = cleanGpsLogs(fallbackRows);
  const fallbackPrecheck = fallbackCleaned.length >= 2
    ? await calculateActualTravelKm(fallbackCleaned, { maxGoogleDirectionsCalls: 0 })
    : { actualTravelKm: 0 };
  const fallbackQuality = gpsWindowQuality(fallbackRows, fallbackCleaned, fallbackPrecheck.actualTravelKm);
  if (
    fallbackQuality.usable ||
    fallbackQuality.validCount > attendanceQuality.validCount ||
    fallbackRows.length > attendanceRows.length
  ) {
    return { rows: fallbackRows, bindingSource: 'employee_time_window_fallback' };
  }
  return { rows: deduplicateGpsRows(attendanceRows), bindingSource: 'attendance_id' };
}

export async function resolveEffectiveAttendanceEnd(client, attendance, options = {}) {
  const manualEndTime = parseValidDate(attendance?.logout_time);
  const manualEndCoordinate = attendanceEndCoordinate(attendance);
  if (!isStaleAutoEndedAttendance(attendance)) {
    return {
      time: manualEndTime,
      coordinate: manualEndCoordinate,
      source: manualEndTime && manualEndCoordinate ? 'attendance_end_location' : 'missing_attendance_end',
      bindingSource: attendance?.id ? 'attendance_id' : 'none',
      rows: [],
    };
  }

  const start = parseValidDate(attendance?.login_time);
  const dayEnd = indiaDayEndExclusive(attendance?.attendance_date);
  if (!start || !dayEnd || dayEnd <= start) {
    return { time: null, coordinate: null, source: 'missing_auto_end_day_boundary', bindingSource: 'none', rows: [] };
  }
  const evidence = await loadGpsLogsForWindowWithBinding(client, attendance, start, dayEnd);
  const validPoints = cleanGpsLogs(evidence.rows)
    .filter((point) => String(point.source || '').trim().toLowerCase() === 'mobile')
    .filter((point) => point.capturedAt >= start && point.capturedAt < dayEnd)
    .sort((a, b) => a.capturedAt - b.capturedAt);
  const last = validPoints.at(-1) || null;
  return {
    time: last?.capturedAt || null,
    coordinate: last ? { latitude: last.latitude, longitude: last.longitude } : null,
    source: last ? 'last_mobile_gps_before_auto_end' : 'missing_valid_mobile_gps_before_auto_end',
    bindingSource: evidence.bindingSource,
    rows: evidence.rows,
    validPoints,
    ...(options.includeEvidence ? { evidenceRows: evidence.rows } : {}),
  };
}

function sumStoredRouteKm(visits = []) {
  return visits.reduce((sum, visit) => {
    const routeKm = normalizeNumber(visit.route_km);
    return Number.isFinite(routeKm) && routeKm > 0 ? sum + routeKm : sum;
  }, 0);
}

function completedSiteVisit(visit) {
  const status = String(visit?.status || visit?.visit_status || '').trim().toLowerCase();
  return Boolean(
    visit?.check_out_time ||
      visit?.checkout_time ||
      status.includes('checked out') ||
      status.includes('completed') ||
      status.includes('closed'),
  );
}

export function approvedMissingCheckoutKm(visits = []) {
  const seen = new Set();
  return visits.reduce((sum, visit, index) => {
    const key = String(
      visit?.id ||
        `${visit?.employee_code || visit?.fo_user_id || 'visit'}:${visit?.check_in_time || index}:${visit?.check_out_time || visit?.checkout_time || ''}`,
    );
    if (seen.has(key)) return sum;
    seen.add(key);
    const metadata = safeVisitMetadata(visit);
    if (delayedCheckoutReviewStatus(metadata) !== 'approved') return sum;
    const km = normalizeNumber(
      metadata.approved_missing_checkout_km ??
        metadata.approved_missing_checkout_adjustment_km ??
        metadata.approved_missing_km ??
        metadata.approved_missing_checkout ??
        visit?.approved_missing_checkout_km ??
        visit?.approved_missing_km,
    );
    return Number.isFinite(km) && km > 0 ? sum + km : sum;
  }, 0);
}

function finalReturnMismatchConfig(options = {}) {
  const positiveOrDefault = (value, fallback) => {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : fallback;
  };
  return {
    minRouteKm: positiveOrDefault(
      options.finalReturnMismatchMinRouteKm ?? process.env.FINAL_RETURN_MISMATCH_MIN_ROUTE_KM,
      DEFAULT_FINAL_RETURN_MISMATCH_MIN_ROUTE_KM,
    ),
    maxGpsRatio: positiveOrDefault(
      options.finalReturnMismatchMaxGpsRatio ?? process.env.FINAL_RETURN_MISMATCH_MAX_GPS_RATIO,
      DEFAULT_FINAL_RETURN_MISMATCH_MAX_GPS_RATIO,
    ),
    minDifferenceKm: positiveOrDefault(
      options.finalReturnMismatchMinDifferenceKm ?? process.env.FINAL_RETURN_MISMATCH_MIN_DIFFERENCE_KM,
      DEFAULT_FINAL_RETURN_MISMATCH_MIN_DIFFERENCE_KM,
    ),
  };
}

export function gpsLegPassesExistingQualityChecks(leg) {
  const gpsLogCount = Number(leg?.gps_log_count || 0);
  const validPoints = Number(leg?.valid_points || 0);
  const validRatio = gpsLogCount > 0 ? validPoints / gpsLogCount : 0;
  const km = normalizeNumber(leg?.km);
  return (
    leg?.status === 'calculated' &&
    ['GPS_BASED', 'PRE_SITE_GPS_SOURCING'].includes(String(leg?.source || '')) &&
    Number.isFinite(km) &&
    km > 0 &&
    gpsLogCount >= 10 &&
    validPoints >= 5 &&
    validRatio >= 0.6
  );
}

function adjustmentWindowMatchesLeg(adjustment, leg) {
  const from = parseValidDate(adjustment.from_time || adjustment.covered_from_time);
  const to = parseValidDate(adjustment.to_time || adjustment.covered_to_time);
  const legFrom = parseValidDate(leg?.from_time);
  const legTo = parseValidDate(leg?.to_time);
  if (!from || !to || !legFrom || !legTo) return false;
  return Math.abs(from - legFrom) <= 60000 && Math.abs(to - legTo) <= 60000;
}

function collectApprovedAdjustmentAudits(attendance = {}, visits = [], travelLegs = []) {
  const candidates = [];
  const addCandidate = (record, defaults = {}) => {
    if (!record || typeof record !== 'object') return;
    const status = String(record.approval_status || record.status || defaults.approval_status || '').trim().toLowerCase();
    const km = normalizeNumber(record.approved_km ?? record.km ?? defaults.approved_km);
    candidates.push({
      adjustment_type: record.adjustment_type || record.type || defaults.adjustment_type || 'manual_adjustment',
      covered_from_time: record.covered_from_time || record.from_time || defaults.covered_from_time || null,
      covered_to_time: record.covered_to_time || record.to_time || defaults.covered_to_time || null,
      approved_km: Number.isFinite(km) && km > 0 ? Number(km.toFixed(2)) : 0,
      approval_status: status || 'unknown',
    });
  };
  const attendanceMetadata = safeAttendanceMetadata(attendance);
  for (const key of ['approved_adjustments', 'km_adjustments', 'manual_km_adjustments']) {
    for (const record of Array.isArray(attendanceMetadata[key]) ? attendanceMetadata[key] : []) addCandidate(record);
  }
  for (const visit of visits) {
    const metadata = safeVisitMetadata(visit);
    for (const key of ['approved_adjustments', 'km_adjustments', 'manual_km_adjustments']) {
      for (const record of Array.isArray(metadata[key]) ? metadata[key] : []) addCandidate(record, {
        adjustment_type: 'missing_checkout_adjustment',
      });
    }
    const legacyKm = normalizeNumber(
      metadata.approved_missing_checkout_km ??
      metadata.approved_missing_checkout_adjustment_km ??
      metadata.approved_missing_km,
    );
    if (delayedCheckoutReviewStatus(metadata) === 'approved' && legacyKm > 0) {
      addCandidate({}, {
        adjustment_type: 'missing_checkout_adjustment',
        approved_km: legacyKm,
        approval_status: 'approved',
        covered_from_time: metadata.approved_adjustment_from_time || metadata.missing_checkout_from_time || null,
        covered_to_time: metadata.approved_adjustment_to_time || metadata.missing_checkout_to_time || null,
      });
    }
  }

  const seen = new Set();
  return candidates.map((adjustment) => {
    const key = JSON.stringify(adjustment);
    if (seen.has(key)) return { ...adjustment, included: false, exclusion_reason: 'duplicate_adjustment_record' };
    seen.add(key);
    if (adjustment.approval_status !== 'approved' || adjustment.approved_km <= 0) {
      return { ...adjustment, included: false, exclusion_reason: 'not_approved_or_zero' };
    }
    const matchingLeg = travelLegs.find((leg) => adjustmentWindowMatchesLeg(adjustment, leg));
    if (!matchingLeg) {
      return { ...adjustment, included: false, exclusion_reason: 'exact_travel_window_not_identified' };
    }
    if (matchingLeg.status === 'calculated' && matchingLeg.payable !== false) {
      return {
        ...adjustment,
        included: false,
        exclusion_reason: matchingLeg.source === 'GPS_BASED' || matchingLeg.source === 'FULL_DAY_GPS_NO_SITE'
          ? 'gps_already_covers_window'
          : 'route_fallback_already_covers_window',
      };
    }
    return { ...adjustment, included: true, exclusion_reason: null };
  });
}

/** Pure payable calculation. Travel-window legs are the only route authority. */
export function calculateCanonicalRoutePayableKm({
  attendance = {},
  visits = [],
  finalReturnLeg = {},
  gpsTravelLegs = [],
  ratePerKm = RATE_PER_KM,
  options = {},
} = {}) {
  const travelPolicy = travelModeAllowsPayableKm(attendance);
  const completedVisits = visits.filter(completedSiteVisit);
  const siteVisitRouteKm = Number(sumStoredRouteKm(completedVisits).toFixed(2));
  const payableTravelLegs = gpsTravelLegs.map((leg) => {
    const legMode = normalizeTravelMode(leg?.travel_mode || leg?.travelMode || travelPolicy.travelMode);
    const legPolicy = travelModeAllowsPayableKm({
      travel_mode: legMode,
      payable_km_allowed: leg?.payable_km_allowed,
      metadata: {},
    });
    const legRatePerKm = normalizeNumber(leg?.rate_per_km ?? leg?.ratePerKm) ||
      ratePerKmForTravelMode(legMode, ratePerKm);
    const payable = leg?.status === 'calculated' && legPolicy.payableKmAllowed && leg?.payable !== false;
    const payableKm = payable && Number.isFinite(Number(leg?.km))
      ? Number(Number(leg.km).toFixed(2))
      : 0;
    const payableAmount = Number((payableKm * legRatePerKm).toFixed(2));
    return {
      ...leg,
      travel_mode: legMode,
      rate_per_km: legRatePerKm,
      payable,
      payable_km: payableKm,
      payable_amount: payableAmount,
      fare_amount: leg?.fare_amount ?? payableAmount,
      payable_status: payable ? 'payable_travel_window' : 'non_payable_or_uncovered',
    };
  });
  const gpsTravelLegTotal = Number(payableTravelLegs.reduce((sum, leg) => (
    leg.payable && Number.isFinite(Number(leg?.payable_km))
      ? sum + Number(leg.payable_km)
      : sum
  ), 0).toFixed(2));
  const finalGpsLeg = payableTravelLegs.find((leg) => leg?.type === 'last_checkout_to_end_day') || null;
  const finalReturnPayableKm = finalGpsLeg?.payable ? Number(Number(finalGpsLeg.km || 0).toFixed(2)) : 0;
  const finalReturnPayableSource = finalGpsLeg?.payable ? finalGpsLeg.source : 'none';
  const finalReturnFallbackReason = finalGpsLeg?.fallback_reason || finalGpsLeg?.reason || null;
  const finalGpsAuditKm = normalizeNumber(
    ['GPS_BASED', 'FULL_DAY_GPS_NO_SITE'].includes(finalGpsLeg?.source)
      ? finalGpsLeg?.km
      : finalGpsLeg?.filtered_gps_km ?? finalGpsLeg?.accepted_gps_km,
  );
  const routeFinalKm = normalizeNumber(finalGpsLeg?.google_direct_route_km ?? finalReturnLeg?.km);
  const adjustmentAudits = collectApprovedAdjustmentAudits(attendance, visits, payableTravelLegs);
  const approvedAdjustmentKm = Number(adjustmentAudits.reduce((sum, item) => (
    item.included ? sum + item.approved_km : sum
  ), 0).toFixed(2));
  const routeBasedSelected = payableTravelLegs.some((leg) => leg.status === 'calculated') || approvedAdjustmentKm > 0;
  const mismatch = finalReturnMismatchConfig(options);
  const finalDifferenceKm = routeFinalKm !== null && Number.isFinite(finalGpsAuditKm)
    ? Number((finalGpsAuditKm - routeFinalKm).toFixed(2))
    : null;
  const finalGpsRatio = routeFinalKm > 0 && Number.isFinite(finalGpsAuditKm)
    ? Number((finalGpsAuditKm / routeFinalKm).toFixed(4))
    : null;
  const suspiciousFinalReturn = Boolean(
    routeFinalKm !== null &&
      routeFinalKm >= mismatch.minRouteKm &&
      Number.isFinite(finalGpsAuditKm) &&
      Math.abs(finalDifferenceKm) >= mismatch.minDifferenceKm,
  );

  const payableBeforeAdjustmentKm = gpsTravelLegTotal;
  const payableApprovedAdjustmentKm = travelPolicy.payableKmAllowed ? approvedAdjustmentKm : 0;
  const calculatedPayableKm = Number((payableBeforeAdjustmentKm + payableApprovedAdjustmentKm).toFixed(2));
  const approvedAdjustmentAmount = Number(
    (payableApprovedAdjustmentKm * ratePerKmForTravelMode(travelPolicy.travelMode, ratePerKm)).toFixed(2),
  );
  const petrolAmount = Number((
    payableTravelLegs.reduce((sum, leg) => sum + Number(leg.payable_amount || 0), 0) +
    approvedAdjustmentAmount
  ).toFixed(2));
  const finalReturnIncluded = Boolean(finalGpsLeg?.payable);

  return {
    routeBasedSelected,
    travelMode: travelPolicy.travelMode,
    payableKmAllowed: travelPolicy.payableKmAllowed,
    siteVisitRouteKm,
    finalReturnPayableKm,
    finalReturnPayableSource,
    finalReturnIncluded,
    finalReturnFallbackReason,
    finalReturnGoogleKm: routeFinalKm,
    finalReturnRouteEstimateKm: routeFinalKm,
    finalReturnGpsAuditKm: Number.isFinite(finalGpsAuditKm) ? Number(finalGpsAuditKm.toFixed(2)) : null,
    finalReturnSourceComparison: {
      route_km: routeFinalKm,
      gps_km: Number.isFinite(finalGpsAuditKm) ? Number(finalGpsAuditKm.toFixed(2)) : null,
      difference_km: finalDifferenceKm,
      gps_to_route_ratio: finalGpsRatio,
      suspicious: suspiciousFinalReturn,
      thresholds: {
        minimum_route_km: mismatch.minRouteKm,
        maximum_gps_ratio: mismatch.maxGpsRatio,
        minimum_difference_km: mismatch.minDifferenceKm,
      },
    },
    approvedAdjustmentKm,
    payableBeforeAdjustmentKm,
    calculatedPayableKm,
    petrolAmount,
    gpsTravelLegTotal,
    adjustmentAudits,
    auditTravelLegs: payableTravelLegs,
    reviewFlags: [
      ...(suspiciousFinalReturn ? ['FINAL_RETURN_GPS_ROUTE_MISMATCH_REVIEW'] : []),
      ...payableTravelLegs.flatMap((leg) => leg.review_flags || []),
    ],
    payableKmSource: routeBasedSelected ? 'gps_travel_leg_based' : null,
    payableKmFormula: routeBasedSelected ? 'sum_cleaned_gps_travel_windows' : null,
    selectedKmSourceReason: routeBasedSelected
      ? 'Eligible travel windows use cleaned GPS first; exact-window route fallbacks are used only when GPS is insufficient.'
      : 'No eligible travel window could be calculated.',
  };
}

export function calculateFoKmHistoricalImpact({
  attendance = {},
  visits = [],
  finalReturnLeg = {},
  gpsTravelLegs = [],
  ratePerKm,
  options = {},
} = {}) {
  const corrected = calculateCanonicalRoutePayableKm({
    attendance,
    visits,
    finalReturnLeg,
    gpsTravelLegs,
    ratePerKm: ratePerKm ?? attendance?.rate_per_km ?? RATE_PER_KM,
    options,
  });
  const currentStoredPayableKm = normalizeNumber(
    attendance?.eligible_km ?? attendance?.total_route_km ?? attendance?.total_approved_km,
  ) || 0;
  return {
    dry_run: true,
    attendance_id: attendance?.id || null,
    current_stored_payable_km: Number(currentStoredPayableKm.toFixed(2)),
    corrected_route_based_payable_km: corrected.routeBasedSelected
      ? corrected.calculatedPayableKm
      : Number(currentStoredPayableKm.toFixed(2)),
    difference_km: corrected.routeBasedSelected
      ? Number((corrected.calculatedPayableKm - currentStoredPayableKm).toFixed(2))
      : 0,
    corrected_petrol_amount: corrected.routeBasedSelected
      ? corrected.petrolAmount
      : Number((currentStoredPayableKm * Number(ratePerKm ?? attendance?.rate_per_km ?? RATE_PER_KM)).toFixed(2)),
    affected_reason: corrected.routeBasedSelected && Math.abs(corrected.calculatedPayableKm - currentStoredPayableKm) >= 0.01
      ? 'stored_payable_differs_from_canonical_route_based_formula'
      : null,
    calculation: corrected,
  };
}

function isOpenVisit(visit) {
  return !visit?.checkout_time && !visit?.check_out_time;
}

function hasAnySiteCheckIn(visits = []) {
  return visits.some((visit) => Boolean(visitTime(visit?.check_in_time)));
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

function safeVisitMetadata(visit) {
  return visit?.metadata && typeof visit.metadata === 'object' && !Array.isArray(visit.metadata)
    ? visit.metadata
    : {};
}

function delayedCheckoutReviewStatus(metadata = {}) {
  return String(metadata.checkout_review_status || '').trim().toLowerCase();
}

function coordinateWithSource(row, candidates = []) {
  for (const [latKey, lngKey, source] of candidates) {
    const latitude = normalizeNumber(row?.[latKey]);
    const longitude = normalizeNumber(row?.[lngKey]);
    if (isValidCoordinate(latitude, longitude)) return { latitude, longitude, source };
  }
  return null;
}

async function loadStoreCoordinate(client, visit) {
  const storeId = String(visit?.store_id || '').trim();
  if (!storeId) return null;
  const { data, error } = await client
    .from('store_master')
    .select('id, latitude, longitude')
    .eq('id', storeId)
    .maybeSingle();
  if (error) throw error;
  const latitude = normalizeNumber(data?.latitude);
  const longitude = normalizeNumber(data?.longitude);
  return isValidCoordinate(latitude, longitude)
    ? { latitude, longitude, source: 'store_master' }
    : null;
}

function delayedCheckoutDestination(visit) {
  return coordinateWithSource(visit, [
    ['check_out_latitude', 'check_out_longitude', 'checkout_location'],
  ]);
}

async function delayedCheckoutOrigin(client, visit) {
  const visitOrigin = coordinateWithSource(visit, [
    ['check_in_latitude', 'check_in_longitude', 'site_checkin'],
    ['destination_lat', 'destination_lng', 'site_destination'],
  ]);
  if (visitOrigin) return visitOrigin;
  return loadStoreCoordinate(client, visit);
}

function checkoutDistanceMetersForReview(visit, origin, destination) {
  const metadata = safeVisitMetadata(visit);
  const mobileDistance = normalizeNumber(
    visit?.checkout_distance_meters ??
      metadata.checkout_distance_meters ??
      metadata.checkout_distance_from_site_meters ??
      metadata.distance_from_site_meters ??
      metadata.checkout_distance,
  );
  if (Number.isFinite(mobileDistance) && mobileDistance >= 0) {
    return { meters: mobileDistance, source: 'mobile' };
  }
  if (origin && destination) {
    return {
      meters: Number((haversineKm(origin, destination) * 1000).toFixed(1)),
      source: 'backend_haversine',
    };
  }
  return { meters: null, source: null };
}

function delayedCheckoutAuditAlreadyFinal(metadata = {}) {
  const status = delayedCheckoutReviewStatus(metadata);
  return status === 'approved' || status === 'rejected';
}

export async function auditDelayedCheckoutMissingKmForVisit(client, visit, options = {}) {
  const metadata = safeVisitMetadata(visit);
  if (!visit?.id) {
    return { audited: false, updated: false, reason: 'missing_visit_id' };
  }
  if (!visit?.checkout_time && !visit?.check_out_time) {
    return { audited: false, updated: false, reason: 'visit_not_checked_out' };
  }
  if (delayedCheckoutAuditAlreadyFinal(metadata) && options.force !== true) {
    return {
      audited: true,
      updated: false,
      reason: `review_already_${delayedCheckoutReviewStatus(metadata)}`,
    };
  }

  const origin = await delayedCheckoutOrigin(client, visit);
  const destination = delayedCheckoutDestination(visit);
  if (!origin || !destination) {
    return {
      audited: false,
      updated: false,
      reason: !origin ? 'missing_origin_coordinate' : 'missing_checkout_coordinate',
    };
  }

  const distance = checkoutDistanceMetersForReview(visit, origin, destination);
  if (!Number.isFinite(distance.meters)) {
    return { audited: false, updated: false, reason: 'missing_checkout_distance' };
  }

  const reviewRequired = distance.meters > DELAYED_CHECKOUT_REVIEW_THRESHOLD_METERS;
  const warningOnly =
    !reviewRequired && distance.meters > DELAYED_CHECKOUT_WARNING_THRESHOLD_METERS;
  if (!reviewRequired && !warningOnly && options.writeNormalAudit !== true) {
    return {
      audited: true,
      updated: false,
      review_required: false,
      checkout_distance_meters: distance.meters,
      reason: 'checkout_distance_within_threshold',
    };
  }

  const nowIso = new Date().toISOString();
  const metadataUpdate = {
    ...metadata,
    checkout_distance_meters: distance.meters,
    checkout_distance_source: distance.source,
    checkout_distance_audited_at: nowIso,
    checkout_distance_warning: warningOnly,
    checkout_review_reason: reviewRequired
      ? 'checkout_more_than_1000m_from_site_or_checkin'
      : 'checkout_100m_to_1000m_from_site_or_checkin',
  };

  let suggestedKm = null;
  let suggestedSource = null;
  let googleError = null;
  if (reviewRequired) {
    metadataUpdate.requires_checkout_review = true;
    metadataUpdate.checkout_exception_type =
      metadata.checkout_exception_type || 'delayed_far_checkout';
    metadataUpdate.checkout_review_status =
      delayedCheckoutReviewStatus(metadata) || 'pending';
    metadataUpdate.checkout_review_created_at =
      metadata.checkout_review_created_at || nowIso;

    const skipGoogleDirections =
      options.skipDelayedCheckoutGoogle === true ||
      options.skipDelayedCheckoutGoogleDirections === true;
    const googleKm = skipGoogleDirections
      ? null
      : await googleDirectionsKm(origin, destination, options);
    if (googleKm !== null) {
      suggestedKm = Number(googleKm.toFixed(2));
      suggestedSource = 'google_directions';
      metadataUpdate.suggested_missing_checkout_km = suggestedKm;
      metadataUpdate.suggested_missing_checkout_amount = Number((suggestedKm * RATE_PER_KM).toFixed(2));
      metadataUpdate.suggested_missing_checkout_source = suggestedSource;
      metadataUpdate.suggested_missing_checkout_calculated_at = nowIso;
      metadataUpdate.suggested_missing_checkout_google_error = null;
    } else {
      const haversineKmValue = Number((distance.meters / 1000).toFixed(2));
      suggestedKm = haversineKmValue;
      suggestedSource = 'haversine_fallback_review_only';
      googleError = skipGoogleDirections
        ? 'google_directions_skipped_for_batch_recalculation'
        : process.env.ENABLE_GOOGLE_DIRECTIONS === 'true'
        ? 'google_directions_unavailable'
        : 'google_directions_disabled';
      metadataUpdate.suggested_missing_checkout_haversine_km = haversineKmValue;
      metadataUpdate.suggested_missing_checkout_source = suggestedSource;
      metadataUpdate.suggested_missing_checkout_google_error = googleError;
    }
    metadataUpdate.suggested_missing_checkout_origin = {
      latitude: origin.latitude,
      longitude: origin.longitude,
      source: origin.source,
    };
    metadataUpdate.suggested_missing_checkout_destination = {
      latitude: destination.latitude,
      longitude: destination.longitude,
      source: destination.source,
    };
  }

  const { error } = await client
    .from('fo_site_visits')
    .update({
      metadata: metadataUpdate,
      updated_at: new Date().toISOString(),
    })
    .eq('id', visit.id);
  if (error) throw error;

  log('DELAYED_CHECKOUT_REVIEW_AUDITED', {
    visit_id: visit.id,
    employee_code: visit.employee_code || visit.fo_user_id || null,
    attendance_id: visit.attendance_id || null,
    checkout_distance_meters: distance.meters,
    checkout_distance_source: distance.source,
    suggested_missing_checkout_km: reviewRequired ? suggestedKm : null,
    suggested_missing_checkout_amount: reviewRequired && suggestedKm !== null
      ? Number((suggestedKm * RATE_PER_KM).toFixed(2))
      : null,
    review_required: reviewRequired,
    failure_reason: googleError,
  });

  return {
    audited: true,
    updated: true,
    review_required: reviewRequired,
    warning_only: warningOnly,
    checkout_distance_meters: distance.meters,
    suggested_missing_checkout_km: reviewRequired ? suggestedKm : null,
    suggested_missing_checkout_source: reviewRequired ? suggestedSource : null,
    suggested_missing_checkout_google_error: googleError,
  };
}

function normalizeTravelMode(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  return ['bike', 'own_vehicle', 'car', 'auto', 'bus', 'train', 'other'].includes(normalized)
    ? normalized
    : 'bike';
}

function isBikeTravelMode(value) {
  const mode = normalizeTravelMode(value);
  return mode === 'bike' || mode === 'own_vehicle';
}

function ratePerKmForTravelMode(value, fallback = RATE_PER_KM) {
  const mode = normalizeTravelMode(value);
  if (mode === 'car') return CAR_RATE_PER_KM;
  if (mode === 'bike' || mode === 'own_vehicle') return RATE_PER_KM;
  const explicit = normalizeNumber(fallback);
  return Number.isFinite(explicit) && explicit > 0 ? explicit : RATE_PER_KM;
}

function truthyMetadataFlag(value) {
  return value === true || String(value || '').trim().toLowerCase() === 'true';
}

function parseValidDate(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function suspectsMultipleTravelModeSwitches(metadata = {}) {
  const historyKeys = [
    'travel_mode_history',
    'travel_mode_switch_history',
    'travel_mode_switches',
    'mode_switch_history',
    'mode_switches',
  ];
  if (historyKeys.some((key) => Array.isArray(metadata[key]) && metadata[key].length > 1)) {
    return true;
  }
  const countValues = [
    metadata.travel_mode_switch_count,
    metadata.travel_mode_change_count,
    metadata.mode_switch_count,
    metadata.mode_change_count,
  ];
  return countValues.some((value) => Number(value) > 1);
}

function emptySwitchFallbackMetadata({ manualReviewRequired = false, reason = null } = {}) {
  return {
    temporary_switch_time_km_fallback: false,
    temporary_switch_km_recalc_run: true,
    temporary_logic_remove_after_travel_legs: true,
    switch_time_fallback_direction: null,
    switch_time_changed_at: null,
    switch_time_anchor_log_id: null,
    switch_time_anchor_captured_at: null,
    switch_time_anchor_lat: null,
    switch_time_anchor_lng: null,
    switch_time_payable_window_start: null,
    switch_time_payable_window_end: null,
    switch_time_payable_km: null,
    manual_review_required: manualReviewRequired,
    manual_review_reason: reason,
  };
}

function switchFallbackManualReview(reason, extra = {}) {
  return {
    applicable: false,
    overridePayableKm: true,
    approvedKm: 0,
    routeSyncStatus: 'manual_review_required_switch_time_fallback',
    reviewFlag: 'SWITCH_TIME_FALLBACK_MANUAL_REVIEW',
    metadata: {
      ...emptySwitchFallbackMetadata({ manualReviewRequired: true, reason }),
      ...extra,
    },
  };
}

async function hasTravelLegRows(client, attendance) {
  const { data, error } = await client
    .from('fo_travel_legs')
    .select('id')
    .eq('attendance_id', attendance.id)
    .limit(1);
  if (error) {
    const message = String(error.message || '').toLowerCase();
    const missingTable =
      error.code === 'PGRST205' ||
      error.code === '42P01' ||
      message.includes('fo_travel_legs') ||
      message.includes('schema cache');
    if (missingTable) return false;
    throw error;
  }
  return Boolean(data?.length);
}

async function loadPersistedTravelLegSnapshots(client, attendance) {
  const { data, error } = await client
    .from('fo_travel_legs')
    .select('id,attendance_id,travel_mode,payable_km_allowed,started_at,ended_at,start_lat,start_lng,end_lat,end_lng,payable_km,rate_per_km,payable_amount,fare_amount,status')
    .eq('attendance_id', attendance.id)
    .order('started_at', { ascending: true })
    .limit(1000);
  if (error) {
    const message = String(error.message || '').toLowerCase();
    const unavailable =
      error.code === 'PGRST205' ||
      error.code === '42P01' ||
      error.code === '42703' ||
      message.includes('fo_travel_legs') ||
      message.includes('schema cache') ||
      message.includes('rate_per_km') ||
      message.includes('payable_amount');
    if (unavailable) return [];
    throw error;
  }
  return Array.isArray(data) ? data : [];
}

function completedPersistedTravelLegs(snapshots = []) {
  return snapshots
    .map((snapshot) => {
      const from = coordinateFrom(snapshot, ['start_lat'], ['start_lng']);
      const to = coordinateFrom(snapshot, ['end_lat'], ['end_lng']);
      return {
        snapshot,
        from,
        to,
        fromTime: parseValidDate(snapshot?.started_at),
        toTime: parseValidDate(snapshot?.ended_at),
      };
    })
    .filter(({ snapshot, from, to, fromTime, toTime }) => (
      snapshot &&
      snapshot.status !== 'cancelled' &&
      from &&
      to &&
      fromTime &&
      toTime
    ))
    .map(({ snapshot, from, to, fromTime, toTime }) => ({
      type: 'persisted_travel_leg',
      fromTime,
      toTime,
      from,
      to,
      fromSource: 'fo_travel_legs',
      toSource: 'fo_travel_legs',
      travel_mode: snapshot.travel_mode,
      payable_km_allowed: snapshot.payable_km_allowed,
      persistedSnapshot: snapshot,
      reviewFlags: [],
    }));
}

function persistedSnapshotForLeg(leg, snapshots = []) {
  if (leg?.persistedSnapshot) return leg.persistedSnapshot;
  const legStart = parseValidDate(leg?.fromTime);
  const legEnd = parseValidDate(leg?.toTime);
  if (!legStart || !legEnd) return null;
  return snapshots.find((snapshot) => {
    if (!snapshot || snapshot.status === 'cancelled') return false;
    const startedAt = parseValidDate(snapshot.started_at);
    const endedAt = parseValidDate(snapshot.ended_at);
    if (!startedAt || !endedAt) return false;
    return Math.abs(startedAt.getTime() - legStart.getTime()) <= 60000 &&
      Math.abs(endedAt.getTime() - legEnd.getTime()) <= 60000;
  }) || null;
}

function closestPointAtOrBefore(points = [], switchTime) {
  return [...points]
    .filter((point) => point.capturedAt && point.capturedAt <= switchTime)
    .sort((a, b) => b.capturedAt - a.capturedAt)[0] || null;
}

function closestPointAtOrAfter(points = [], switchTime) {
  return [...points]
    .filter((point) => point.capturedAt && point.capturedAt >= switchTime)
    .sort((a, b) => a.capturedAt - b.capturedAt)[0] || null;
}

function minutesBetween(a, b) {
  if (!a || !b) return null;
  return Math.abs(a.getTime() - b.getTime()) / 60000;
}

function pointsInWindow(points = [], start, end) {
  return points.filter((point) => {
    if (!point.capturedAt) return false;
    if (start && point.capturedAt < start) return false;
    if (end && point.capturedAt > end) return false;
    return true;
  });
}

async function temporarySwitchTimeFallback(client, attendance, points, options = {}) {
  const metadata = safeAttendanceMetadata(attendance);
  const hasSwitchMetadata = Boolean(
    metadata.previous_travel_mode ||
      metadata.travel_mode_changed_at ||
      truthyMetadataFlag(metadata.phase2_travel_leg_todo),
  );
  if (!hasSwitchMetadata) {
    return options.requireSwitchTimeFallback
      ? switchFallbackManualReview('missing_switch_mode_metadata')
      : null;
  }

  if (await hasTravelLegRows(client, attendance)) {
    return options.requireSwitchTimeFallback
      ? switchFallbackManualReview('travel_legs_already_exist')
      : null;
  }

  const rawPreviousMode = String(metadata.previous_travel_mode || '').trim();
  const rawCurrentMode = String(attendance?.travel_mode || metadata.travel_mode || '').trim();
  if (!rawPreviousMode || !rawCurrentMode) {
    return switchFallbackManualReview('missing_previous_or_current_travel_mode', {});
  }

  const previousMode = normalizeTravelMode(rawPreviousMode);
  const currentMode = normalizeTravelMode(rawCurrentMode);
  const previousBike = isBikeTravelMode(previousMode);
  const currentBike = isBikeTravelMode(currentMode);
  const direction = previousBike && !currentBike
    ? 'bike_to_non_bike'
    : !previousBike && currentBike
      ? 'non_bike_to_bike'
      : null;

  if (suspectsMultipleTravelModeSwitches(metadata)) {
    return switchFallbackManualReview('multiple_switches_suspected', {
      switch_time_fallback_direction: direction,
    });
  }
  if (!direction) return null;

  const switchTime = parseValidDate(metadata.travel_mode_changed_at);
  if (!switchTime) {
    return switchFallbackManualReview('missing_or_invalid_travel_mode_changed_at', {
      switch_time_fallback_direction: direction,
    });
  }
  if (points.length < 5) {
    return switchFallbackManualReview('too_few_gps_logs_for_switch_time_fallback', {
      switch_time_fallback_direction: direction,
      switch_time_changed_at: switchTime.toISOString(),
    });
  }

  const anchor = direction === 'bike_to_non_bike'
    ? closestPointAtOrBefore(points, switchTime)
    : closestPointAtOrAfter(points, switchTime);
  if (!anchor) {
    return switchFallbackManualReview(
      direction === 'bike_to_non_bike'
        ? 'missing_gps_anchor_before_switch'
        : 'missing_gps_anchor_after_switch',
      {
        switch_time_fallback_direction: direction,
        switch_time_changed_at: switchTime.toISOString(),
      },
    );
  }

  const anchorGapMinutes = minutesBetween(anchor.capturedAt, switchTime);
  if (anchorGapMinutes !== null && anchorGapMinutes > SWITCH_TIME_ANCHOR_MAX_GAP_MINUTES) {
    return switchFallbackManualReview('switch_time_anchor_gap_too_large', {
      switch_time_fallback_direction: direction,
      switch_time_changed_at: switchTime.toISOString(),
      switch_time_anchor_log_id: anchor.id || null,
      switch_time_anchor_captured_at: anchor.capturedAt.toISOString(),
      switch_time_anchor_lat: anchor.latitude,
      switch_time_anchor_lng: anchor.longitude,
      switch_time_anchor_gap_minutes: Number(anchorGapMinutes.toFixed(1)),
    });
  }

  const windowStart = direction === 'bike_to_non_bike'
    ? parseValidDate(attendance.login_time)
    : anchor.capturedAt;
  const windowEnd = direction === 'bike_to_non_bike'
    ? anchor.capturedAt
    : parseValidDate(attendance.logout_time) || new Date();
  const windowPoints = pointsInWindow(points, windowStart, windowEnd);
  if (windowPoints.length < 2) {
    return switchFallbackManualReview('too_few_gps_points_in_payable_window', {
      switch_time_fallback_direction: direction,
      switch_time_changed_at: switchTime.toISOString(),
      switch_time_anchor_log_id: anchor.id || null,
      switch_time_anchor_captured_at: anchor.capturedAt.toISOString(),
      switch_time_anchor_lat: anchor.latitude,
      switch_time_anchor_lng: anchor.longitude,
      switch_time_payable_window_start: windowStart?.toISOString() || null,
      switch_time_payable_window_end: windowEnd?.toISOString() || null,
    });
  }

  const windowCalculation = await calculateActualTravelKm(windowPoints, options);
  const payableKm = Number(windowCalculation.actualTravelKm.toFixed(2));
  return {
    applicable: true,
    overridePayableKm: true,
    approvedKm: payableKm,
    routeSyncStatus: `temporary_switch_time_${direction}`,
    reviewFlag: 'TEMPORARY_SWITCH_TIME_KM_FALLBACK',
    metadata: {
      temporary_switch_time_km_fallback: true,
      temporary_switch_km_recalc_run: true,
      temporary_logic_remove_after_travel_legs: true,
      switch_time_fallback_direction: direction,
      switch_time_changed_at: switchTime.toISOString(),
      switch_time_anchor_log_id: anchor.id || null,
      switch_time_anchor_captured_at: anchor.capturedAt.toISOString(),
      switch_time_anchor_lat: anchor.latitude,
      switch_time_anchor_lng: anchor.longitude,
      switch_time_anchor_gap_minutes: anchorGapMinutes === null ? null : Number(anchorGapMinutes.toFixed(1)),
      switch_time_payable_window_start: windowStart?.toISOString() || null,
      switch_time_payable_window_end: windowEnd?.toISOString() || null,
      switch_time_payable_km: payableKm,
      switch_time_window_points_used: windowPoints.length,
      manual_review_required: false,
      manual_review_reason: null,
    },
  };
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
    payableKmAllowed: travelMode === 'bike' || travelMode === 'own_vehicle' || travelMode === 'car',
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

export async function calculateFinalReturnLegKm(attendance, visits = [], options = {}) {
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

export async function calculateRouteKmFromVisitAnchors(client, attendance, visits = [], options = {}) {
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

function isoOrNull(value) {
  const date = parseValidDate(value);
  return date ? date.toISOString() : null;
}

function visitCheckInTime(visit) {
  return visitTime(visit?.check_in_time);
}

function visitCheckOutTime(visit) {
  return visitTime(visit?.check_out_time || visit?.checkout_time);
}

function visitCheckInCoordinate(visit) {
  return coordinateFrom(
    visit,
    ['check_in_latitude', 'current_latitude', 'destination_lat'],
    ['check_in_longitude', 'current_longitude', 'destination_lng'],
  );
}

function visitCheckOutCoordinate(visit) {
  return coordinateFrom(
    visit,
    ['check_out_latitude', 'current_latitude', 'destination_lat', 'check_in_latitude'],
    ['check_out_longitude', 'current_longitude', 'destination_lng', 'check_in_longitude'],
  );
}

function attendanceStartCoordinate(attendance) {
  return coordinateFrom(
    attendance,
    ['start_latitude'],
    ['start_longitude'],
  );
}

function confirmedOpenSiteDeparture(validPoints = [], visit, effectiveEndTime) {
  const site = visitCheckInCoordinate(visit);
  const checkIn = visitCheckInTime(visit);
  if (!site || !checkIn) return null;
  const eligible = validPoints.filter((point) => (
    point.capturedAt >= checkIn && (!effectiveEndTime || point.capturedAt <= effectiveEndTime)
  ));
  for (let index = 1; index < eligible.length; index += 1) {
    const previous = eligible[index - 1];
    const current = eligible[index];
    if (
      haversineKm(site, pointCoordinate(previous)) * 1000 > OPEN_SITE_DEPARTURE_DISTANCE_METERS &&
      haversineKm(site, pointCoordinate(current)) * 1000 > OPEN_SITE_DEPARTURE_DISTANCE_METERS
    ) {
      return previous;
    }
  }
  return null;
}

function buildCompletedTravelLegs(attendance, visits = [], effectiveEnd = {}) {
  const legs = [];
  const orderedVisits = [...visits]
    .filter((visit) => visitCheckInTime(visit))
    .sort((a, b) => visitCheckInTime(a) - visitCheckInTime(b));
  const endTime = effectiveEnd.time || parseValidDate(attendance?.logout_time);
  const endCoordinate = effectiveEnd.coordinate || attendanceEndCoordinate(attendance);
  if (!orderedVisits.length) {
    legs.push({
      type: 'full_day_no_site',
      fromTime: parseValidDate(attendance?.login_time),
      toTime: endTime,
      from: attendanceStartCoordinate(attendance),
      to: endCoordinate,
      fromSource: 'attendance_start',
      toSource: effectiveEnd.source || 'attendance_end',
    });
    return legs;
  }

  const attendanceStart = attendanceStartCoordinate(attendance);
  const loginTime = parseValidDate(attendance?.login_time);
  const firstVisit = orderedVisits[0];
  const firstCheckIn = visitCheckInTime(firstVisit);
  const firstDestination = visitCheckInCoordinate(firstVisit);
  legs.push({
    type: 'start_to_first_checkin',
    fromTime: loginTime,
    toTime: firstCheckIn,
    from: attendanceStart,
    to: firstDestination,
    fromSource: 'attendance_start',
    toSource: 'first_site_checkin',
    toVisitId: firstVisit.id || null,
    toSiteName: firstVisit.store_name || firstVisit.site_name || firstVisit.client_name || null,
  });

  for (let index = 1; index < orderedVisits.length; index += 1) {
    const previousVisit = orderedVisits[index - 1];
    const nextVisit = orderedVisits[index];
    if (!visitCheckOutTime(previousVisit)) continue;
    legs.push({
      type: 'site_checkout_to_next_checkin',
      fromTime: visitCheckOutTime(previousVisit),
      toTime: visitCheckInTime(nextVisit),
      from: visitCheckOutCoordinate(previousVisit),
      to: visitCheckInCoordinate(nextVisit),
      fromSource: 'previous_site_checkout',
      toSource: 'next_site_checkin',
      fromVisitId: previousVisit.id || null,
      toVisitId: nextVisit.id || null,
      fromSiteName: previousVisit.store_name || previousVisit.site_name || previousVisit.client_name || null,
      toSiteName: nextVisit.store_name || nextVisit.site_name || nextVisit.client_name || null,
    });
  }

  const lastVisit = orderedVisits.at(-1);
  if (!visitCheckOutTime(lastVisit)) {
    if (isStaleAutoEndedAttendance(attendance)) {
      const departure = confirmedOpenSiteDeparture(effectiveEnd.validPoints || [], lastVisit, endTime);
      if (!departure) {
        legs.push({
          type: 'last_checkout_to_end_day',
          fromTime: null,
          toTime: endTime,
          from: visitCheckInCoordinate(lastVisit),
          to: endCoordinate,
          fromSource: 'open_site_no_confirmed_departure',
          toSource: effectiveEnd.source || 'attendance_end',
          fromVisitId: lastVisit.id || null,
          fromSiteName: lastVisit.store_name || lastVisit.site_name || lastVisit.client_name || null,
          forcedSkipReason: 'no_confirmed_departure_from_open_site',
          reviewFlags: ['AUTO_END_OPEN_SITE_NO_CONFIRMED_DEPARTURE_REVIEW'],
        });
        return legs;
      }
      legs.push({
        type: 'last_checkout_to_end_day',
        fromTime: departure.capturedAt,
        toTime: endTime,
        from: pointCoordinate(departure),
        to: endCoordinate,
        fromSource: 'confirmed_departure_from_open_site',
        toSource: effectiveEnd.source || 'attendance_end',
        fromVisitId: lastVisit.id || null,
        fromSiteName: lastVisit.store_name || lastVisit.site_name || lastVisit.client_name || null,
        reviewFlags: ['AUTO_END_OPEN_SITE_CONFIRMED_DEPARTURE'],
      });
    }
    return legs;
  }
  legs.push({
    type: 'last_checkout_to_end_day',
    fromTime: visitCheckOutTime(lastVisit),
    toTime: endTime,
    from: visitCheckOutCoordinate(lastVisit),
    to: endCoordinate,
    fromSource: 'last_site_checkout',
    toSource: effectiveEnd.source || 'attendance_end',
    fromVisitId: lastVisit.id || null,
    fromSiteName: lastVisit.store_name || lastVisit.site_name || lastVisit.client_name || null,
  });

  return legs;
}

function skippedLegAudit(leg, reason) {
  return {
    type: leg.type,
    status: 'skipped',
    reason,
    from_time: isoOrNull(leg.fromTime),
    to_time: isoOrNull(leg.toTime),
    from_source: leg.fromSource || null,
    to_source: leg.toSource || null,
    from_visit_id: leg.fromVisitId || null,
    to_visit_id: leg.toVisitId || null,
    km: 0,
    source: 'SKIPPED',
    payable: false,
    fallback_reason: reason,
    review_flags: leg.reviewFlags || [],
    gps_log_count: 0,
    valid_points: 0,
    rejected_points: 0,
  };
}

export async function calculateTravelLegKm({
  client,
  attendance,
  fromTime,
  toTime,
  fromLat,
  fromLng,
  toLat,
  toLng,
  employeeCode,
  attendanceId,
  legType = null,
  options = {},
}) {
  const legStart = parseValidDate(fromTime);
  const legEnd = parseValidDate(toTime);
  const fallbackBase = {
    employeeCode: employeeCode || attendance?.employee_code || attendance?.fo_user_id || null,
    attendanceId: attendanceId || attendance?.id || null,
    fromTime: isoOrNull(legStart),
    toTime: isoOrNull(legEnd),
    gpsLogCount: 0,
    validPoints: 0,
    rejectedPoints: 0,
  };
  if (!legStart || !legEnd || legEnd <= legStart) {
    return {
      ...fallbackBase,
      legKm: 0,
      legSource: 'SKIPPED',
      fallbackReason: 'missing_or_invalid_time_window',
    };
  }

  const evidence = await loadGpsLogsForWindowWithBinding(client, attendance, legStart, legEnd);
  const gpsRows = evidence.rows;
  const cleanedPoints = cleanGpsLogs(gpsRows);
  const rawGpsKm = Number(calculateRawGpsKm(cleanedPoints).toFixed(2));
  const preliminaryCalculation = cleanedPoints.length >= 2
    ? await calculateActualTravelKm(cleanedPoints, options)
    : {
        actualTravelKm: 0,
        acceptedKm: 0,
        reconstructedKm: 0,
        segmentsAccepted: 0,
        segmentsRejected: 0,
        segmentsReconstructed: 0,
        segmentSummary: [],
      };
  const preliminaryKm = Number(preliminaryCalculation.actualTravelKm.toFixed(2));
  const quality = gpsWindowQuality(gpsRows, cleanedPoints, preliminaryKm);
  const connectedPoints = quality.usable
    ? connectWindowAnchors(cleanedPoints, {
        latitude: normalizeNumber(fromLat),
        longitude: normalizeNumber(fromLng),
      }, legStart, {
        latitude: normalizeNumber(toLat),
        longitude: normalizeNumber(toLng),
      }, legEnd)
    : cleanedPoints;
  const gpsCalculation = quality.usable
    ? await calculateActualTravelKm(connectedPoints, options)
    : preliminaryCalculation;
  const gpsBasedKm = Number(gpsCalculation.actualTravelKm.toFixed(2));
  const gpsLogCount = gpsRows.length;
  const validPoints = cleanedPoints.length;
  const rejectedPoints = Math.max(0, gpsLogCount - validPoints);
  const gpsUsable = quality.usable && gpsBasedKm > 0;

  const from = {
    latitude: normalizeNumber(fromLat),
    longitude: normalizeNumber(fromLng),
  };
  const to = {
    latitude: normalizeNumber(toLat),
    longitude: normalizeNumber(toLng),
  };
  const hasRouteAnchors = isValidCoordinate(from.latitude, from.longitude) && isValidCoordinate(to.latitude, to.longitude);
  let googleDirectKm = null;
  if (hasRouteAnchors) {
    const directKm = await googleDirectionsKm(from, to, options);
    googleDirectKm = directKm === null ? null : Number(directKm.toFixed(2));
    if (googleDirectKm === null && gpsUsable && legType === 'last_checkout_to_end_day') {
      const metadata = safeAttendanceMetadata(attendance);
      const storedComparison = normalizeNumber(
        metadata.final_return_google_km ?? metadata.final_return_source_comparison?.route_km,
      );
      googleDirectKm = Number.isFinite(storedComparison) ? Number(storedComparison.toFixed(2)) : null;
    }
  }

  if (gpsUsable) {
    return {
      ...fallbackBase,
      legKm: gpsBasedKm,
      legSource: 'GPS_BASED',
      payable: true,
      gpsLogCount,
      validPoints,
      rejectedPoints,
      fallbackReason: null,
      rawGpsKm,
      filteredGpsKm: gpsBasedKm,
      acceptedGpsKm: Number(gpsCalculation.acceptedKm.toFixed(2)),
      reconstructedGapKm: Number(gpsCalculation.reconstructedKm.toFixed(2)),
      googleDirectRouteKm: googleDirectKm,
      gpsLogBindingSource: evidence.bindingSource,
      payableKmSourceReason: 'gps_cleaned_reconstructed_route_used',
      reviewFlags: [],
      segmentsAccepted: gpsCalculation.segmentsAccepted,
      segmentsReconstructed: gpsCalculation.segmentsReconstructed,
      segmentsRejected: gpsCalculation.segmentsRejected,
    };
  }

  if (!hasRouteAnchors) {
    return {
      ...fallbackBase,
      legKm: 0,
      legSource: 'SKIPPED',
      payable: false,
      gpsLogCount,
      validPoints,
      rejectedPoints,
      fallbackReason: 'gps_unusable_and_missing_route_anchors',
      rawGpsKm,
      filteredGpsKm: gpsBasedKm,
      gpsLogBindingSource: evidence.bindingSource,
    };
  }

  const googleKm = googleDirectKm !== null ? googleDirectKm : await googleDirectionsKm(from, to, options);
  if (googleKm !== null) {
    return {
      ...fallbackBase,
      legKm: Number(googleKm.toFixed(2)),
      legSource: 'GOOGLE_ROUTE_FALLBACK',
      payable: true,
      gpsLogCount,
      validPoints,
      rejectedPoints,
      rawGpsKm,
      filteredGpsKm: gpsBasedKm,
      googleDirectRouteKm: Number(googleKm.toFixed(2)),
      gpsLogBindingSource: evidence.bindingSource,
      payableKmSourceReason: 'google_route_used_because_gps_proof_did_not_pass_thresholds',
      reviewFlags: ['INSUFFICIENT_GPS_USED_GOOGLE_FALLBACK'],
      fallbackReason: validPoints < 5
        ? 'gps_valid_points_below_threshold'
        : gpsLogCount < 10
          ? 'gps_log_count_below_threshold'
          : gpsBasedKm <= 0
            ? 'gps_based_km_zero'
            : 'gps_valid_ratio_below_threshold',
    };
  }

  const haversineFallbackKm = Number(haversineKm(from, to).toFixed(2));
  if (haversineFallbackKm < MIN_MEANINGFUL_FINAL_RETURN_LEG_KM) {
    return {
      ...fallbackBase,
      legKm: 0,
      legSource: 'SKIPPED',
      payable: false,
      gpsLogCount,
      validPoints,
      rejectedPoints,
      rawGpsKm,
      filteredGpsKm: gpsBasedKm,
      googleDirectRouteKm: googleDirectKm,
      gpsLogBindingSource: evidence.bindingSource,
      payableKmSourceReason: 'no_usable_gps_or_meaningful_route_fallback',
      fallbackReason: 'no_usable_gps_or_meaningful_route_fallback',
      reviewFlags: ['INSUFFICIENT_GPS_NO_MEANINGFUL_ROUTE_FALLBACK'],
    };
  }
  return {
    ...fallbackBase,
    legKm: haversineFallbackKm,
    legSource: 'HAVERSINE_ROUTE_FALLBACK',
    payable: true,
    gpsLogCount,
    validPoints,
    rejectedPoints,
    rawGpsKm,
    filteredGpsKm: gpsBasedKm,
    googleDirectRouteKm: googleDirectKm,
    gpsLogBindingSource: evidence.bindingSource,
    payableKmSourceReason: 'haversine_used_because_google_route_unavailable',
    fallbackReason: 'google_route_unavailable',
    reviewFlags: ['GOOGLE_ROUTE_FAILED_USED_HAVERSINE'],
  };
}

export async function recalculateAttendanceTravelLegs(serviceRoleClient, attendanceId, options = {}) {
  const client = requireServiceRoleClient(serviceRoleClient);
  if (!attendanceId) {
    const error = new Error('attendanceId is required for travel-leg recalculation.');
    error.statusCode = 400;
    throw error;
  }
  const attendance = await findAttendance(client, { attendance_id: attendanceId });
  const visits = await loadSiteVisits(client, attendance);
  const travelPolicy = travelModeAllowsPayableKm(attendance);
  const ratePerKm = ratePerKmForTravelMode(attendance.travel_mode, attendance.rate_per_km);
  const effectiveEnd = await resolveEffectiveAttendanceEnd(client, attendance, { includeEvidence: true });
  const persistedLegSnapshots = await loadPersistedTravelLegSnapshots(client, attendance);
  if (persistedLegSnapshots.some((snapshot) => (
    snapshot?.status === 'active' || !snapshot?.ended_at
  ))) {
    const error = new Error(
      'Final travel leg closure is pending. Retry KM recalculation shortly.',
    );
    error.statusCode = 409;
    error.code = 'travel_leg_closure_pending';
    throw error;
  }
  const persistedCandidateLegs = completedPersistedTravelLegs(persistedLegSnapshots);
  const candidateLegs = persistedCandidateLegs.length > 0
    ? persistedCandidateLegs
    : buildCompletedTravelLegs(attendance, visits, effectiveEnd);
  const legAudit = [];
  const delayedCheckoutAudits = [];

  for (const visit of options.auditDelayedCheckout === false ? [] : visits) {
    try {
      const audit = await auditDelayedCheckoutMissingKmForVisit(client, visit, options);
      if (audit.audited || audit.updated) {
        delayedCheckoutAudits.push({
          visit_id: visit.id,
          ...audit,
        });
      }
    } catch (error) {
      delayedCheckoutAudits.push({
        visit_id: visit.id,
        audited: false,
        updated: false,
        reason: 'delayed_checkout_audit_failed',
        message: error.message,
      });
      log('DELAYED_CHECKOUT_REVIEW_AUDIT_FAILED', {
        visit_id: visit.id,
        employee_code: attendance.employee_code || attendance.fo_user_id || null,
        attendance_id: attendance.id,
        message: error.message,
      });
    }
  }

  for (const leg of candidateLegs) {
    if (leg.forcedSkipReason) {
      legAudit.push(skippedLegAudit(leg, leg.forcedSkipReason));
      continue;
    }
    if (!leg.fromTime || !leg.toTime || leg.toTime <= leg.fromTime) {
      legAudit.push(skippedLegAudit(leg, 'incomplete_time_window'));
      continue;
    }
    if (!leg.from || !leg.to) {
      legAudit.push(skippedLegAudit(leg, 'missing_leg_coordinates'));
      continue;
    }
    const result = await calculateTravelLegKm({
      client,
      attendance,
      fromTime: leg.fromTime,
      toTime: leg.toTime,
      fromLat: leg.from.latitude,
      fromLng: leg.from.longitude,
      toLat: leg.to.latitude,
      toLng: leg.to.longitude,
      employeeCode: attendance.employee_code || attendance.fo_user_id,
      attendanceId: attendance.id,
      legType: leg.type,
      options,
    });
    const source = leg.type === 'full_day_no_site' && result.legSource === 'GPS_BASED'
      ? 'FULL_DAY_GPS_NO_SITE'
      : result.legSource;
    const persistedLegSnapshot = persistedSnapshotForLeg(leg, persistedLegSnapshots);
    const legMode = normalizeTravelMode(
      leg.travel_mode ||
        persistedLegSnapshot?.travel_mode ||
        attendance.travel_mode,
    );
    const legPolicy = travelModeAllowsPayableKm({
      travel_mode: legMode,
      payable_km_allowed:
        leg.payable_km_allowed ??
        persistedLegSnapshot?.payable_km_allowed ??
        attendance.payable_km_allowed,
      metadata: {},
    });
    const legRatePerKm =
      normalizeNumber(persistedLegSnapshot?.rate_per_km) ||
      ratePerKmForTravelMode(legMode, attendance.rate_per_km);
    const legPayable = result.payable === true && legPolicy.payableKmAllowed;
    const legPayableKm = legPayable && Number.isFinite(Number(result.legKm))
      ? Number(Number(result.legKm).toFixed(2))
      : 0;
    const legPayableAmount = Number((legPayableKm * legRatePerKm).toFixed(2));
    legAudit.push({
      type: leg.type,
      status: result.legSource === 'SKIPPED' ? 'skipped' : 'calculated',
      reason: result.fallbackReason || null,
      from_time: isoOrNull(leg.fromTime),
      to_time: isoOrNull(leg.toTime),
      from_lat: leg.from.latitude,
      from_lng: leg.from.longitude,
      to_lat: leg.to.latitude,
      to_lng: leg.to.longitude,
      from_source: leg.fromSource || null,
      to_source: leg.toSource || null,
      from_visit_id: leg.fromVisitId || null,
      to_visit_id: leg.toVisitId || null,
      from_site_name: leg.fromSiteName || null,
      to_site_name: leg.toSiteName || null,
      km: result.legKm,
      source,
      payable: result.payable === true && travelPolicy.payableKmAllowed,
      fallback_reason: result.fallbackReason || null,
      gps_log_count: result.gpsLogCount,
      valid_points: result.validPoints,
      rejected_points: result.rejectedPoints,
      raw_gps_km: result.rawGpsKm ?? null,
      filtered_gps_km: result.filteredGpsKm ?? null,
      google_direct_route_km: result.googleDirectRouteKm ?? null,
      accepted_gps_km: result.acceptedGpsKm ?? null,
      reconstructed_gap_km: result.reconstructedGapKm ?? null,
      gps_log_binding_source: result.gpsLogBindingSource || 'none',
      payable_km_source_reason: result.payableKmSourceReason || null,
      travel_mode: legMode,
      rate_per_km: legRatePerKm,
      payable_km: legPayableKm,
      payable_amount: legPayableAmount,
      fare_amount: legPayableAmount,
      review_flags: [...new Set([...(leg.reviewFlags || []), ...(result.reviewFlags || [])])],
    });
  }

  const totalLegKmBeforePolicy = Number(legAudit.reduce((sum, leg) => (
    leg.status === 'calculated' && Number.isFinite(Number(leg.payable_km)) ? sum + Number(leg.payable_km) : sum
  ), 0).toFixed(2));
  const totalKm = totalLegKmBeforePolicy;
  const petrolAmount = Number(legAudit.reduce((sum, leg) => (
    leg.status === 'calculated' ? sum + Number(leg.payable_amount || 0) : sum
  ), 0).toFixed(2));
  const gpsLogCountTotal = legAudit.reduce((sum, leg) => sum + Number(leg.gps_log_count || 0), 0);
  const validPointsTotal = legAudit.reduce((sum, leg) => sum + Number(leg.valid_points || 0), 0);
  const rejectedPointsTotal = legAudit.reduce((sum, leg) => sum + Number(leg.rejected_points || 0), 0);
  const calculatedSources = new Set(
    legAudit
      .filter((leg) => leg.status === 'calculated')
      .map((leg) => leg.source),
  );
  const selectedKmSource = calculatedSources.size > 1
    ? 'MIXED_LEG_BASED'
    : calculatedSources.has('GPS_BASED') || calculatedSources.has('FULL_DAY_GPS_NO_SITE')
      ? 'GPS_BASED'
      : calculatedSources.has('GOOGLE_ROUTE_FALLBACK')
        ? 'GOOGLE_ROUTE_FALLBACK'
        : calculatedSources.has('HAVERSINE_ROUTE_FALLBACK')
          ? 'HAVERSINE_ROUTE_FALLBACK'
          : 'NO_COMPLETED_TRAVEL_LEGS';
  const reviewFlags = [];
  if (
    persistedCandidateLegs.length === 0 &&
    (
      safeAttendanceMetadata(attendance).previous_travel_mode ||
      safeAttendanceMetadata(attendance).travel_mode_changed_at ||
      suspectsMultipleTravelModeSwitches(safeAttendanceMetadata(attendance))
    )
  ) {
    reviewFlags.push('LEGACY_MIXED_MODE_WITHOUT_TRAVEL_LEG_SNAPSHOTS');
  }
  if (!travelPolicy.payableKmAllowed) reviewFlags.push('NON_PAYABLE_TRAVEL_MODE');
  if (legAudit.some((leg) => leg.status === 'skipped')) reviewFlags.push('INCOMPLETE_TRAVEL_LEGS_SKIPPED');
  if (calculatedSources.has('HAVERSINE_ROUTE_FALLBACK')) reviewFlags.push('GOOGLE_ROUTE_FAILED_USED_HAVERSINE');
  if (delayedCheckoutAudits.some((audit) => audit.review_required === true)) {
    reviewFlags.push('DELAYED_CHECKOUT_REVIEW_REQUIRED');
  }
  for (const leg of legAudit) {
    for (const flag of leg.review_flags || []) reviewFlags.push(flag);
  }
  const routeSyncStatus = totalKm > 0
    ? 'gps_travel_leg_based'
    : travelPolicy.payableKmAllowed
      ? 'travel_leg_based_zero'
      : 'non_payable_travel_mode';

  const googleFallbackKm = Number(legAudit.reduce((sum, leg) => (
    leg.source === 'GOOGLE_ROUTE_FALLBACK' ? sum + Number(leg.km || 0) : sum
  ), 0).toFixed(2));
  const haversineFallbackKm = Number(legAudit.reduce((sum, leg) => (
    leg.source === 'HAVERSINE_ROUTE_FALLBACK' ? sum + Number(leg.km || 0) : sum
  ), 0).toFixed(2));
  const acceptedGpsKm = Number(legAudit.reduce((sum, leg) => (
    ['GPS_BASED', 'FULL_DAY_GPS_NO_SITE'].includes(leg.source)
      ? sum + Number(leg.accepted_gps_km || 0)
      : sum
  ), 0).toFixed(2));
  const reconstructedGapKm = Number(legAudit.reduce((sum, leg) => (
    sum + Number(leg.reconstructed_gap_km || 0)
  ), 0).toFixed(2));
  const bindingSources = new Set(legAudit.map((leg) => leg.gps_log_binding_source).filter(Boolean));
  const gpsLogBindingSource = bindingSources.has('employee_time_window_fallback')
    ? 'employee_time_window_fallback'
    : bindingSources.has('attendance_id')
      ? 'attendance_id'
      : effectiveEnd.bindingSource || 'none';

  return {
    ok: true,
    attendance,
    visits,
    attendance_id: attendance.id,
    fo_user_id: attendance.fo_user_id,
    employee_code: attendance.employee_code,
    total_route_km: totalKm,
    approved_km: totalKm,
    petrol_amount: petrolAmount,
    selected_km_source: selectedKmSource,
    travel_legs: legAudit,
    delayed_checkout_audits: delayedCheckoutAudits,
    gps_log_count: gpsLogCountTotal,
    valid_points: validPointsTotal,
    rejected_points: rejectedPointsTotal,
    review_flags: reviewFlags,
    route_sync_status: routeSyncStatus,
    effective_end_time: isoOrNull(effectiveEnd.time),
    effective_end_coordinate: effectiveEnd.coordinate,
    effective_end_source: effectiveEnd.source,
    gps_log_binding_source: gpsLogBindingSource,
    accepted_gps_km: acceptedGpsKm,
    reconstructed_gap_km: reconstructedGapKm,
    google_fallback_km: googleFallbackKm,
    haversine_fallback_km: haversineFallbackKm,
    updated: false,
  };
}

function confidenceFor({ usedPoints, segmentsRejected, segmentsReconstructed }) {
  if (usedPoints >= 100 && segmentsRejected <= 10) return 'HIGH';
  if (usedPoints >= 25 && segmentsRejected <= Math.max(10, usedPoints * 0.15)) return 'MEDIUM';
  if (segmentsReconstructed > 0 && usedPoints >= 10) return 'MEDIUM';
  return 'LOW';
}

function buildGpsFallbackReviewCandidate({
  approvedKm,
  actualTravelKm,
  filteredGpsKm,
  validPoints,
  siteVisitsCount,
  travelPolicy,
  routeSyncStatus,
  reviewFlags = [],
}) {
  const gpsAuditKm = Number(actualTravelKm);
  const fallbackGpsKm = Number.isFinite(gpsAuditKm) && gpsAuditKm > 0
    ? gpsAuditKm
    : Number(filteredGpsKm);
  const shouldSuggest =
    Number(approvedKm || 0) <= 0 &&
    Number.isFinite(fallbackGpsKm) &&
    fallbackGpsKm > 0 &&
    Number(validPoints || 0) > 0 &&
    Number(siteVisitsCount || 0) > 0;

  if (!shouldSuggest) {
    return {
      applicable: false,
      fallback_gps_km: null,
      suggested_review_km: null,
      reason: null,
      flags: [],
    };
  }

  const reason = travelPolicy?.payableKmAllowed === false
    ? 'payable_km_blocked_by_travel_mode_policy'
    : 'route_payable_zero_with_positive_gps_evidence';
  return {
    applicable: true,
    fallback_gps_km: Number(fallbackGpsKm.toFixed(2)),
    suggested_review_km: Number(fallbackGpsKm.toFixed(2)),
    reason,
    flags: [
      'GPS_FALLBACK_REVIEW_REQUIRED',
      ...(travelPolicy?.payableKmAllowed === false ? ['NON_PAYABLE_TRAVEL_MODE'] : []),
      ...(routeSyncStatus === 'travel_leg_based_zero' ? ['TRAVEL_LEG_PAYABLE_ZERO'] : []),
      ...reviewFlags,
    ],
  };
}

export async function calculateFullDayGpsNoSiteVisitKm(client, attendance, options = {}) {
  const warnings = [];
  const source = 'full_day_gps_no_site_visit';
  const base = {
    success: true,
    dry_run: options.dryRun !== false,
    applied: false,
    source,
    attendance_id: attendance?.id || null,
    employee_code: attendance?.employee_code || attendance?.fo_user_id || null,
    date: attendance?.attendance_date || null,
    eligible_km: 0,
    petrol_amount: 0,
    gps_points_total: 0,
    gps_points_used: 0,
    gps_points_rejected: 0,
    raw_gps_km: 0,
    filtered_gps_km: 0,
    accepted_gps_km: 0,
    google_gap_km: null,
    haversine_gap_km: null,
    reconstructed_gap_km: null,
    payable_km_formula: 'cleaned_gps_plus_reconstructed_gaps',
    payable_km_source_detail:
      'Full-day GPS route from Start Day to End Day, after rejecting bad GPS points and reconstructing valid gaps.',
    whole_route_google_fallback_used: false,
    whole_route_google_fallback_km: 0,
    manual_review_required: false,
    skipped_reason: null,
    warnings,
  };

  if (!attendance?.login_time || !attendance?.logout_time) {
    return {
      ...base,
      skipped_reason: !attendance?.login_time
        ? 'skipped_missing_login_time'
        : 'skipped_missing_logout_time',
      warnings: [...warnings, 'Attendance must have Start Day and End Day.'],
    };
  }

  const visits = await loadSiteVisits(client, attendance);
  if (hasAnySiteCheckIn(visits)) {
    return {
      ...base,
      skipped_reason: 'skipped_site_visits_exist',
      warnings: [
        ...warnings,
        'Site visits/check-ins exist; existing site-visit KM remains payable.',
      ],
    };
  }

  const rows = await loadGpsLogsForWindow(
    client,
    attendance,
    attendance.login_time,
    attendance.logout_time,
  );
  const points = cleanGpsLogs(rows);
  const gpsPointsTotal = rows.length;
  const gpsPointsUsed = points.length;
  const gpsPointsRejected = Math.max(0, gpsPointsTotal - gpsPointsUsed);
  const validRatio = gpsPointsTotal > 0 ? gpsPointsUsed / gpsPointsTotal : 0;
  const calculation = gpsPointsUsed >= 2
    ? await calculateActualTravelKm(points, options)
    : {
        actualTravelKm: 0,
        acceptedKm: 0,
        reconstructedKm: 0,
        segmentsAccepted: 0,
        segmentsRejected: 0,
        segmentsReconstructed: 0,
        segmentSummary: [],
      };
  const rawGpsKm = Number(calculateRawGpsKm(points).toFixed(2));
  const filteredGpsKm = Number(calculation.actualTravelKm.toFixed(2));
  const acceptedGpsKm = Number(calculation.acceptedKm.toFixed(2));
  const googleGapKm = Number(
    (calculation.segmentSummary || [])
      .filter((segment) => segment.status === 'reconstructed_google')
      .reduce((sum, segment) => sum + Number(segment.distance_km || 0), 0)
      .toFixed(2),
  );
  const haversineGapKm = Number(
    (calculation.segmentSummary || [])
      .filter((segment) => segment.status === 'reconstructed_haversine')
      .reduce((sum, segment) => sum + Number(segment.distance_km || 0), 0)
      .toFixed(2),
  );
  const reconstructedGapKm = Number(calculation.reconstructedKm.toFixed(2));
  const proofValid =
    gpsPointsTotal >= 10 &&
    gpsPointsUsed >= 5 &&
    validRatio >= 0.6 &&
    filteredGpsKm > 0;
  const manualReviewRequired = !proofValid;
  if (gpsPointsTotal < 10) warnings.push('GPS_LOG_COUNT_BELOW_THRESHOLD');
  if (gpsPointsUsed < 5) warnings.push('VALID_GPS_POINTS_BELOW_THRESHOLD');
  if (gpsPointsTotal > 0 && validRatio < 0.6) warnings.push('GPS_VALID_RATIO_BELOW_THRESHOLD');
  if (filteredGpsKm <= 0) warnings.push('FILTERED_GPS_KM_ZERO');

  const ratePerKm = ratePerKmForTravelMode(attendance.travel_mode, attendance.rate_per_km);
  const travelPolicy = travelModeAllowsPayableKm(attendance);
  if (!travelPolicy.payableKmAllowed) warnings.push('NON_PAYABLE_TRAVEL_MODE');
  const eligibleKm = proofValid && travelPolicy.payableKmAllowed ? filteredGpsKm : 0;
  const petrolAmount = proofValid && travelPolicy.payableKmAllowed
    ? Number((eligibleKm * ratePerKm).toFixed(2))
    : 0;

  return {
    ...base,
    eligible_km: eligibleKm,
    petrol_amount: petrolAmount,
    gps_points_total: gpsPointsTotal,
    gps_points_used: gpsPointsUsed,
    gps_points_rejected: gpsPointsRejected,
    raw_gps_km: rawGpsKm,
    filtered_gps_km: filteredGpsKm,
    accepted_gps_km: acceptedGpsKm,
    google_gap_km: googleGapKm,
    haversine_gap_km: haversineGapKm,
    reconstructed_gap_km: reconstructedGapKm,
    payable_km_formula: base.payable_km_formula,
    payable_km_source_detail: base.payable_km_source_detail,
    whole_route_google_fallback_used: false,
    whole_route_google_fallback_km: 0,
    manual_review_required: manualReviewRequired,
    warnings: [...new Set(warnings)],
    rate_per_km: ratePerKm,
    travel_mode: travelPolicy.travelMode,
    payable_km_allowed: travelPolicy.payableKmAllowed,
    valid_ratio: Number(validRatio.toFixed(3)),
    segments_accepted: calculation.segmentsAccepted,
    segments_reconstructed: calculation.segmentsReconstructed,
    segments_rejected: calculation.segmentsRejected,
  };
}

export async function recalculateFullDayGpsNoSiteVisitKm(serviceRoleClient, payload = {}, options = {}) {
  const client = requireServiceRoleClient(serviceRoleClient);
  const attendance = await findAttendance(client, {
    attendance_id: payload.attendance_id || payload.id || null,
    fo_user_id: payload.attendance_id || payload.id ? null : payload.fo_user_id || null,
    employee_code: payload.attendance_id || payload.id ? null : payload.employee_code || null,
    date: payload.date || payload.attendance_date || null,
  });
  const dryRun = payload.dry_run !== false;
  const apply = payload.apply === true && !dryRun;
  const result = await calculateFullDayGpsNoSiteVisitKm(client, attendance, {
    ...options,
    dryRun,
  });

  if (!apply || result.skipped_reason || result.manual_review_required) {
    return {
      ...result,
      dry_run: dryRun,
      applied: false,
      petrol_amount: result.manual_review_required ? 0 : result.petrol_amount,
    };
  }

  const existingMetadata = safeAttendanceMetadata(attendance);
  const calculatedAt = new Date().toISOString();
  const metadata = {
    ...existingMetadata,
    km_source: result.source,
    no_site_visit_km_enabled: true,
    manual_review_required: false,
    payable_km_formula: result.payable_km_formula,
    payable_km_source_detail: result.payable_km_source_detail,
    gps_points_total: result.gps_points_total,
    gps_points_used: result.gps_points_used,
    gps_points_rejected: result.gps_points_rejected,
    raw_gps_km: result.raw_gps_km,
    accepted_gps_km: result.accepted_gps_km,
    reconstructed_gap_km: result.reconstructed_gap_km,
    google_gap_km: result.google_gap_km,
    haversine_gap_km: result.haversine_gap_km,
    filtered_gps_km: result.filtered_gps_km,
    filtered_gps_km_note:
      'For this endpoint, filtered_gps_km is the final cleaned/reconstructed GPS route KM used for payable calculation.',
    whole_route_google_fallback_used: false,
    whole_route_google_fallback_km: 0,
    rate_per_km: result.rate_per_km,
    petrol_amount: result.petrol_amount,
    audit_note: 'Calculated from Start Day to End Day GPS logs because no site visits were recorded.',
    calculated_at: calculatedAt,
    calculated_by: options.actor || null,
  };
  const attendanceUpdate = {
    total_route_km: result.eligible_km,
    eligible_km: result.eligible_km,
    total_approved_km: result.eligible_km,
    petrol_amount: result.petrol_amount,
    route_sync_status: 'canonical_end_day_recalculation',
    metadata,
  };
  const { error } = await client
    .from('fo_attendance')
    .update(attendanceUpdate)
    .eq('id', attendance.id);
  if (error) throw error;

  return {
    ...result,
    dry_run: false,
    applied: true,
  };
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
  const legRecalculation = await recalculateAttendanceTravelLegs(client, attendance.id, {
    ...options,
    persist: false,
    auditDelayedCheckout: false,
  });
  const finalTravelLeg = (legRecalculation.travel_legs || []).find(
    (leg) => leg.type === 'last_checkout_to_end_day',
  ) || null;
  const finalReturnLeg = {
    km: finalTravelLeg?.google_direct_route_km ?? null,
    calculated: finalTravelLeg?.status === 'calculated',
    includedInPayable: finalTravelLeg?.payable === true,
    provider: finalTravelLeg?.source || null,
    status: finalTravelLeg?.status || 'skipped',
    reason: finalTravelLeg?.fallback_reason || finalTravelLeg?.reason || null,
    site_visit_id: finalTravelLeg?.from_visit_id || null,
    site_name: finalTravelLeg?.from_site_name || null,
    origin: finalTravelLeg ? { latitude: finalTravelLeg.from_lat, longitude: finalTravelLeg.from_lng } : null,
    destination: finalTravelLeg ? { latitude: finalTravelLeg.to_lat, longitude: finalTravelLeg.to_lng } : null,
    origin_source: finalTravelLeg?.from_source || null,
  };
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
  const ratePerKm = ratePerKmForTravelMode(attendance.travel_mode, attendance.rate_per_km);
  const travelPolicy = travelModeAllowsPayableKm(attendance);
  const fullDayGpsSourcing = null;
  const switchFallback = options.enableSwitchTimeFallback === true
    ? await temporarySwitchTimeFallback(client, attendance, points, options)
    : null;
  const canonicalRouteCalculation = calculateCanonicalRoutePayableKm({
    attendance,
    visits,
    finalReturnLeg,
    gpsTravelLegs: legRecalculation.travel_legs || [],
    ratePerKm,
    options,
  });
  for (const flag of canonicalRouteCalculation.reviewFlags) reviewFlags.push(flag);
  const calculatedPayableKm = canonicalRouteCalculation.routeBasedSelected
    ? canonicalRouteCalculation.calculatedPayableKm
    : Number((legRecalculation.total_route_km || 0).toFixed(2));
  let approvedKm = calculatedPayableKm;
  if (
    switchFallback?.overridePayableKm &&
    (!canonicalRouteCalculation.routeBasedSelected || options.requireSwitchTimeFallback === true)
  ) {
    approvedKm = switchFallback.approvedKm;
  }
  let routeSyncStatus = canonicalRouteCalculation.routeBasedSelected
    ? 'gps_travel_leg_based'
    : legRecalculation.route_sync_status || (approvedKm > 0 ? 'travel_leg_based' : 'travel_leg_based_zero');
  if (
    switchFallback?.routeSyncStatus &&
    (!canonicalRouteCalculation.routeBasedSelected || options.requireSwitchTimeFallback === true)
  ) {
    routeSyncStatus = switchFallback.routeSyncStatus;
  } else if (!travelPolicy.payableKmAllowed) {
    reviewFlags.push('NON_PAYABLE_TRAVEL_MODE');
    routeSyncStatus = 'non_payable_travel_mode';
  }
  if (
    visits.length === 0 &&
    !canonicalRouteCalculation.routeBasedSelected &&
    switchFallback?.overridePayableKm !== true &&
    travelPolicy.payableKmAllowed &&
    Number(fullDayGpsSourcing?.eligible_km || 0) > 0
  ) {
    approvedKm = Number(Number(fullDayGpsSourcing.eligible_km).toFixed(2));
    routeSyncStatus = 'full_day_gps_sourcing';
    reviewFlags.push('FULL_DAY_NO_CHECKIN_GPS_PAYABLE');
    if (Number(fullDayGpsSourcing.gps_points_total || 0) < 10) {
      reviewFlags.push('LOW_GPS_LOG_COUNT');
    }
  } else if (visits.length === 0 && fullDayGpsSourcing?.warnings?.length) {
    for (const warning of fullDayGpsSourcing.warnings) reviewFlags.push(warning);
  }
  for (const flag of legRecalculation.review_flags || []) reviewFlags.push(flag);
  if (switchFallback?.metadata?.manual_review_required === true) {
    reviewFlags.push(switchFallback.reviewFlag || 'SWITCH_TIME_FALLBACK_MANUAL_REVIEW');
  }
  const petrolAmount = canonicalRouteCalculation.routeBasedSelected
    ? canonicalRouteCalculation.petrolAmount
    : Number((approvedKm * ratePerKm).toFixed(2));
  const filteredGpsKm = Number(calculation.acceptedKm.toFixed(2));
  const preSiteSourcingLeg = (legRecalculation.travel_legs || []).find((leg) => (
    leg.type === 'start_to_first_checkin' &&
    leg.status === 'calculated' &&
    (
      leg.source === 'PRE_SITE_GPS_SOURCING' ||
      (
        leg.source === 'GPS_BASED' &&
        (leg.review_flags || []).some((flag) => String(flag).includes('PRE_SITE_SOURCING'))
      )
    )
  ));
  const preSiteSourcingGpsUsed = Boolean(preSiteSourcingLeg);
  const gpsFallbackReview = buildGpsFallbackReviewCandidate({
    approvedKm,
    actualTravelKm,
    filteredGpsKm,
    validPoints: points.length,
    siteVisitsCount: visits.length,
    travelPolicy,
    routeSyncStatus,
    reviewFlags,
  });
  if (gpsFallbackReview.applicable) {
    reviewFlags.push('GPS_FALLBACK_REVIEW_REQUIRED');
  }
  log('FINAL_APPROVED_KM', {
    attendance_id: attendance.id,
    employee_code: attendance.employee_code || null,
    date: attendance.attendance_date || date || null,
    site_visit_route_km: storedRouteKm,
    final_return_leg_km: finalReturnLegKm,
    final_return_payable_km: canonicalRouteCalculation.routeBasedSelected
      ? canonicalRouteCalculation.finalReturnPayableKm
      : finalReturnLegKm,
    calculated_payable_km: calculatedPayableKm,
    travel_mode: travelPolicy.travelMode,
    payable_km_allowed: travelPolicy.payableKmAllowed,
    temporary_switch_time_km_fallback: switchFallback?.applicable === true,
    approved_km: approvedKm,
    route_source: routeSyncStatus,
    gps_audit_km: actualTravelKm,
    filtered_gps_km: filteredGpsKm,
    accepted_gps_km: legRecalculation.accepted_gps_km || 0,
    valid_points: points.length,
    site_visit_count: visits.length,
    flags: [...new Set(reviewFlags)],
    failure_reason:
      gpsFallbackReview.reason ||
      finalReturnLeg.reason ||
      legRecalculation.review_flags?.join(',') ||
      null,
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

  const switchFallbackMetadata = switchFallback?.metadata || {};
  const payableFinalReturnKm = canonicalRouteCalculation.routeBasedSelected
    ? canonicalRouteCalculation.finalReturnPayableKm
    : finalReturnLegKmForMetadata;
  const payableFinalReturnProvider = canonicalRouteCalculation.routeBasedSelected
    ? canonicalRouteCalculation.finalReturnPayableSource
    : finalReturnLeg.provider || null;
  const payableTravelLegAudit = canonicalRouteCalculation.routeBasedSelected
    ? canonicalRouteCalculation.auditTravelLegs
    : legRecalculation.travel_legs || [];
  const canonicalRouteSyncStatus = 'canonical_end_day_recalculation';
  const attendanceUpdate = {
    total_route_km: approvedKm,
    eligible_km: approvedKm,
    total_approved_km: approvedKm,
    petrol_amount: petrolAmount,
    travel_mode: travelPolicy.travelMode,
    payable_km_allowed: travelPolicy.payableKmAllowed,
    rate_per_km: ratePerKm,
    eligibility_status: reviewFlags.length ? [...new Set(reviewFlags)].join(',') : 'Approved',
    route_sync_status: canonicalRouteSyncStatus,
    metadata: {
      ...existingMetadata,
      final_return_leg_km: payableFinalReturnKm,
      final_return_leg_provider: payableFinalReturnProvider,
      final_return_leg_reason: canonicalRouteCalculation.routeBasedSelected
        ? canonicalRouteCalculation.finalReturnFallbackReason
        : finalReturnLeg.reason || null,
      final_return_leg_status: canonicalRouteCalculation.routeBasedSelected
        ? canonicalRouteCalculation.finalReturnIncluded
          ? canonicalRouteCalculation.finalReturnPayableSource === 'gps_quality_checked_fallback'
            ? 'calculated_gps_fallback'
            : 'calculated'
          : 'skipped'
        : finalReturnLeg.status || (finalReturnLegKm > 0 ? 'calculated' : 'skipped'),
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
        canonicalRouteCalculation.routeBasedSelected
          ? canonicalRouteCalculation.finalReturnIncluded
          : finalReturnLeg.includedInPayable === true && travelPolicy.payableKmAllowed,
      final_return_google_km: canonicalRouteCalculation.finalReturnGoogleKm,
      final_return_gps_audit_km: canonicalRouteCalculation.finalReturnGpsAuditKm,
      final_return_source_comparison: canonicalRouteCalculation.finalReturnSourceComparison,
      final_return_fallback_reason: canonicalRouteCalculation.finalReturnFallbackReason,
      site_visit_route_km_sum: canonicalRouteCalculation.routeBasedSelected
        ? canonicalRouteCalculation.siteVisitRouteKm
        : storedRouteKm,
      site_visit_count: visits.length,
      calculated_payable_km_before_travel_mode_policy: calculatedPayableKm,
      calculated_payable_km: approvedKm,
      payable_km_formula: canonicalRouteCalculation.payableKmFormula || (
        routeSyncStatus === 'full_day_gps_sourcing'
          ? fullDayGpsSourcing?.payable_km_formula || 'cleaned_gps_plus_reconstructed_gaps'
          : existingMetadata.payable_km_formula || null
      ),
      gps_audit_km: actualTravelKm,
      gps_travel_leg_total: canonicalRouteCalculation.gpsTravelLegTotal,
      approved_adjustment_km: canonicalRouteCalculation.routeBasedSelected
        ? canonicalRouteCalculation.approvedAdjustmentKm
        : 0,
      approved_adjustment_included_in_payable: canonicalRouteCalculation.routeBasedSelected,
      approved_adjustments: canonicalRouteCalculation.adjustmentAudits || [],
      approved_adjustment_km_included: canonicalRouteCalculation.approvedAdjustmentKm,
      payable_km_source: routeSyncStatus,
      selected_km_source_reason: canonicalRouteCalculation.routeBasedSelected
        ? canonicalRouteCalculation.selectedKmSourceReason
        : routeSyncStatus === 'full_day_gps_sourcing'
          ? 'Full-day GPS movement accepted for sourcing / manpower follow-up without site check-ins'
          : preSiteSourcingGpsUsed
            ? 'GPS trail shows valid sourcing movement before first check-in'
            : legRecalculation.selected_km_source || routeSyncStatus,
      payable_km_source_reason: canonicalRouteCalculation.routeBasedSelected
        ? canonicalRouteCalculation.selectedKmSourceReason
        : routeSyncStatus === 'full_day_gps_sourcing'
        ? 'Full-day GPS movement accepted for sourcing / manpower follow-up without site check-ins'
        : preSiteSourcingGpsUsed
          ? 'GPS trail shows valid sourcing movement before first check-in'
          : legRecalculation.selected_km_source || routeSyncStatus,
      full_day_gps_sourcing_used: routeSyncStatus === 'full_day_gps_sourcing',
      full_day_gps_sourcing_km: routeSyncStatus === 'full_day_gps_sourcing' ? approvedKm : null,
      full_day_no_checkin_gps_payable: routeSyncStatus === 'full_day_gps_sourcing',
      full_day_gps_sourcing_result: fullDayGpsSourcing ? {
        skipped_reason: fullDayGpsSourcing.skipped_reason || null,
        manual_review_required: fullDayGpsSourcing.manual_review_required === true,
        gps_log_count: fullDayGpsSourcing.gps_points_total || 0,
        valid_gps_log_count: fullDayGpsSourcing.gps_points_used || 0,
        rejected_gps_log_count: fullDayGpsSourcing.gps_points_rejected || 0,
        raw_gps_km: fullDayGpsSourcing.raw_gps_km || 0,
        filtered_gps_km: fullDayGpsSourcing.filtered_gps_km || 0,
        accepted_gps_km: fullDayGpsSourcing.accepted_gps_km || 0,
        payable_km: fullDayGpsSourcing.eligible_km || 0,
        warnings: fullDayGpsSourcing.warnings || [],
      } : null,
      sourcing_gps_review_required:
        routeSyncStatus === 'full_day_gps_sourcing' &&
        (fullDayGpsSourcing?.warnings || []).length > 0,
      sourcing_gps_review_reason:
        routeSyncStatus === 'full_day_gps_sourcing' && (fullDayGpsSourcing?.warnings || []).length > 0
          ? (fullDayGpsSourcing.warnings || []).join(',')
          : null,
      accepted_gps_km: legRecalculation.accepted_gps_km || 0,
      rejected_gps_km: Number(Math.max(0, actualTravelKm - Number(calculation.acceptedKm || 0)).toFixed(2)),
      gps_log_count: rows.length,
      valid_gps_log_count: points.length,
      pre_site_sourcing_gps_used: preSiteSourcingGpsUsed,
      pre_site_sourcing_gps_km: preSiteSourcingGpsUsed ? Number(preSiteSourcingLeg.km || 0) : null,
      pre_site_direct_route_km: preSiteSourcingGpsUsed ? preSiteSourcingLeg.google_direct_route_km ?? null : null,
      pre_site_sourcing_reason: preSiteSourcingGpsUsed
        ? 'GPS trail shows valid sourcing movement before first check-in'
        : null,
      travel_legs: payableTravelLegAudit,
      travel_leg_recalculation_enabled: true,
      travel_leg_recalculated_at: new Date().toISOString(),
      travel_leg_selected_km_source: legRecalculation.selected_km_source || null,
      selected_km_source: legRecalculation.selected_km_source || null,
      travel_leg_payable_km: canonicalRouteCalculation.routeBasedSelected
        ? canonicalRouteCalculation.calculatedPayableKm
        : approvedKm,
      travel_leg_payable_role: canonicalRouteCalculation.routeBasedSelected
        ? 'canonical_payable_travel_windows'
        : 'payable',
      travel_leg_gps_log_count: legRecalculation.gps_log_count || 0,
      travel_leg_valid_points: legRecalculation.valid_points || 0,
      travel_leg_rejected_points: legRecalculation.rejected_points || 0,
      gps_fallback_review_required: gpsFallbackReview.applicable,
      fallback_gps_km: gpsFallbackReview.fallback_gps_km,
      suggested_review_km: gpsFallbackReview.suggested_review_km,
      gps_fallback_review_reason: gpsFallbackReview.reason,
      gps_fallback_review_flags: [...new Set(gpsFallbackReview.flags)],
      travel_mode: travelPolicy.travelMode,
      payable_km_allowed: travelPolicy.payableKmAllowed,
      recalculated_total_route_km: approvedKm,
      recalculated_petrol_amount: petrolAmount,
      ...switchFallbackMetadata,
      km_recalculated_at: new Date().toISOString(),
      checked_in_gps_excluded: true,
      gps_log_binding_source: legRecalculation.gps_log_binding_source,
      effective_end_source: legRecalculation.effective_end_source,
      effective_end_time: legRecalculation.effective_end_time,
      effective_end_latitude: legRecalculation.effective_end_coordinate?.latitude ?? null,
      effective_end_longitude: legRecalculation.effective_end_coordinate?.longitude ?? null,
      gps_points_total: legRecalculation.gps_log_count || 0,
      gps_points_used: legRecalculation.valid_points || 0,
      gps_points_rejected: legRecalculation.rejected_points || 0,
      reconstructed_gap_km: legRecalculation.reconstructed_gap_km || 0,
      google_fallback_km: legRecalculation.google_fallback_km || 0,
      haversine_fallback_km: legRecalculation.haversine_fallback_km || 0,
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
      final_return_leg_calculated: canonicalRouteCalculation.routeBasedSelected
        ? canonicalRouteCalculation.finalReturnIncluded
        : finalReturnLeg.calculated === true,
      final_return_leg_skip_reason: canonicalRouteCalculation.routeBasedSelected
        ? canonicalRouteCalculation.finalReturnIncluded
          ? null
          : canonicalRouteCalculation.finalReturnFallbackReason
        : finalReturnLegKm > 0
          ? null
          : finalReturnLeg.reason || null,
      final_return_leg_reused_existing: false,
      final_return_leg_updated_at: new Date().toISOString(),
    },
    updated_at: new Date().toISOString(),
  };
  const dryRun = payload.dry_run === true || payload.dryRun === true || options.persist === false;
  let liveStatusUpdated = false;
  if (!dryRun) {
    const { error: attendanceUpdateError } = await client
      .from('fo_attendance')
      .update(attendanceUpdate)
      .eq('id', attendance.id);
    if (attendanceUpdateError) throw attendanceUpdateError;
    log('FO_KM_ATTENDANCE_UPDATED', { attendance_id: attendance.id, actualTravelKm });

    if (attendance.attendance_date === indiaDateKey() && attendance.fo_user_id) {
      const { data: liveStatus, error: liveStatusLoadError } = await client
        .from('fo_live_status')
        .select('fo_user_id, attendance_id')
        .eq('fo_user_id', attendance.fo_user_id)
        .maybeSingle();
      if (liveStatusLoadError) throw liveStatusLoadError;
      if (liveStatus?.attendance_id === attendance.id) {
        const { error: liveStatusError } = await client
          .from('fo_live_status')
          .update({
            route_km_today: approvedKm,
            travel_mode: travelPolicy.travelMode,
            rate_per_km: ratePerKm,
            last_seen_at: new Date().toISOString(),
            source: 'backend_km_recalculation',
            sync_status: 'synced',
            updated_at: new Date().toISOString(),
          })
          .eq('fo_user_id', attendance.fo_user_id)
          .eq('attendance_id', attendance.id);
        if (liveStatusError) throw liveStatusError;
        liveStatusUpdated = true;
        log('FO_KM_LIVE_STATUS_UPDATED', { fo_user_id: attendance.fo_user_id, route_km_today: approvedKm });
      }
    }
  }

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
    final_return_leg_km: payableFinalReturnKm,
    final_return_leg_provider: payableFinalReturnProvider,
    final_return_leg_status: canonicalRouteCalculation.routeBasedSelected
      ? canonicalRouteCalculation.finalReturnIncluded
        ? canonicalRouteCalculation.finalReturnPayableSource === 'gps_quality_checked_fallback'
          ? 'calculated_gps_fallback'
          : 'calculated'
        : 'skipped'
      : finalReturnLeg.status || (finalReturnLegKm > 0 ? 'calculated' : 'skipped'),
    final_return_leg_reason: canonicalRouteCalculation.routeBasedSelected
      ? canonicalRouteCalculation.finalReturnFallbackReason
      : finalReturnLeg.reason || null,
    final_return_leg_calculated: canonicalRouteCalculation.routeBasedSelected
      ? canonicalRouteCalculation.finalReturnIncluded
      : finalReturnLeg.calculated,
    final_return_leg_reused_existing: false,
    final_return_leg_skip_reason: canonicalRouteCalculation.routeBasedSelected
      ? canonicalRouteCalculation.finalReturnIncluded
        ? null
        : canonicalRouteCalculation.finalReturnFallbackReason
      : finalReturnLegKm > 0
        ? null
        : finalReturnLeg.reason,
    final_return_leg_site_visit_id: finalReturnLeg.site_visit_id || existingMetadata.final_return_leg_from?.site_visit_id || null,
    backend_route_legs_calculated: finalReturnLeg.calculated ? 1 : 0,
    travel_leg_selected_km_source: legRecalculation.selected_km_source || null,
    travel_leg_count: legRecalculation.travel_legs?.filter((leg) => leg.status === 'calculated').length || 0,
    travel_leg_skipped_count: legRecalculation.travel_legs?.filter((leg) => leg.status === 'skipped').length || 0,
    travel_leg_gps_log_count: legRecalculation.gps_log_count || 0,
    travel_leg_valid_points: legRecalculation.valid_points || 0,
    travel_leg_rejected_points: legRecalculation.rejected_points || 0,
    travel_legs: payableTravelLegAudit,
    gps_log_binding_source: legRecalculation.gps_log_binding_source,
    effective_end_source: legRecalculation.effective_end_source,
    effective_end_time: legRecalculation.effective_end_time,
    google_fallback_km: legRecalculation.google_fallback_km || 0,
    haversine_fallback_km: legRecalculation.haversine_fallback_km || 0,
    site_visits_missing_route_km: visitsMissingRouteKm,
    review_flags: [...new Set(reviewFlags)],
    route_sync_status: canonicalRouteSyncStatus,
    canonical_km_source: routeSyncStatus,
    payable_km_source: routeSyncStatus,
    payable_km_formula: canonicalRouteCalculation.payableKmFormula,
    site_visit_route_km_sum: canonicalRouteCalculation.routeBasedSelected
      ? canonicalRouteCalculation.siteVisitRouteKm
      : storedRouteKm,
    gps_audit_km: actualTravelKm,
    gps_travel_leg_total: canonicalRouteCalculation.gpsTravelLegTotal,
    approved_adjustment_km: canonicalRouteCalculation.routeBasedSelected
      ? canonicalRouteCalculation.approvedAdjustmentKm
      : 0,
    approved_adjustments: canonicalRouteCalculation.adjustmentAudits || [],
    calculated_payable_km: approvedKm,
    gps_fallback_review_required: gpsFallbackReview.applicable,
    fallback_gps_km: gpsFallbackReview.fallback_gps_km,
    suggested_review_km: gpsFallbackReview.suggested_review_km,
    gps_fallback_review_reason: gpsFallbackReview.reason,
    temporary_switch_time_km_fallback: switchFallback?.metadata?.temporary_switch_time_km_fallback === true,
    switch_time_fallback_direction: switchFallback?.metadata?.switch_time_fallback_direction || null,
    switch_time_payable_km: switchFallback?.metadata?.switch_time_payable_km ?? null,
    manual_review_required: switchFallback?.metadata?.manual_review_required === true,
    manual_review_reason: switchFallback?.metadata?.manual_review_reason || null,
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
    dry_run: dryRun,
    live_status_updated: liveStatusUpdated,
    updated: !dryRun,
    skipped: !canonicalRouteCalculation.routeBasedSelected,
    skip_reason: canonicalRouteCalculation.routeBasedSelected
      ? null
      : legRecalculation.review_flags?.join(',') || 'no_eligible_travel_window',
  };
  log('FO_KM_RECALC_SUMMARY', {
    attendance_id: attendance.id,
    employee_code: attendance.employee_code || null,
    date: attendance.attendance_date || date || null,
    route_source: routeSyncStatus,
    gps_audit_km: actualTravelKm,
    filtered_gps_km: filteredGpsKm,
    accepted_gps_km: Number(calculation.acceptedKm.toFixed(2)),
    payable_km: approvedKm,
    site_visit_count: visits.length,
    source: routeSyncStatus === 'full_day_gps_sourcing'
      ? 'full_day_gps_sourcing'
      : preSiteSourcingGpsUsed
        ? 'pre_site_sourcing_gps'
        : routeSyncStatus,
    flags: result.review_flags,
    failure_reason:
      gpsFallbackReview.reason ||
      finalReturnLeg.reason ||
      legRecalculation.review_flags?.join(',') ||
      null,
    suggested_review_km: gpsFallbackReview.suggested_review_km,
  });
  log('FO_KM_RECALC_COMPLETED', result);
  return result;
}

export async function recalculateSwitchModeKmTemporary(serviceRoleClient, payload = {}, options = {}) {
  return recalculateFoKm(serviceRoleClient, payload, {
    ...options,
    enableSwitchTimeFallback: true,
    requireSwitchTimeFallback: true,
  });
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

function decodeBatchCursor(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(parsed.date) || !parsed.id) throw new Error('invalid');
    return parsed;
  } catch {
    const error = new Error('Invalid batch cursor.');
    error.statusCode = 400;
    throw error;
  }
}

function encodeBatchCursor(row) {
  return Buffer.from(JSON.stringify({ date: row.attendance_date, id: row.id }), 'utf8').toString('base64url');
}

function normalizedBatchFilter(value, allLabel) {
  const text = String(value || '').trim();
  return !text || text.toLowerCase() === allLabel.toLowerCase() ? null : text;
}

async function loadBatchProfileScope(client, payload) {
  const state = normalizedBatchFilter(payload.state, 'All States');
  const business = normalizedBatchFilter(payload.business, 'All Business');
  if (!state && !business) return null;
  let query = client.from('profiles').select('id, employee_code, state, business');
  if (state) query = query.eq('state', state);
  if (business) query = query.eq('business', business);
  const { data, error } = await query.limit(10000);
  if (error) throw error;
  return {
    profileIds: [...new Set((data || []).map((row) => String(row.id || '').trim()).filter(Boolean))],
    employeeCodes: [...new Set((data || []).map((row) => String(row.employee_code || '').trim()).filter(Boolean))],
  };
}

function postgrestInValues(values = []) {
  return values.map((value) => `"${String(value).replaceAll('"', '')}"`).join(',');
}

async function runWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
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

  const requestedBatchSize = Number(payload.batchSize || payload.batch_size || 50);
  const batchSize = Math.min(100, Math.max(1, Number.isFinite(requestedBatchSize) ? Math.floor(requestedBatchSize) : 50));
  const cursor = decodeBatchCursor(payload.cursor);
  const profileScope = await loadBatchProfileScope(client, payload);
  if (profileScope && profileScope.profileIds.length === 0 && profileScope.employeeCodes.length === 0) {
    return {
      fromDate,
      toDate,
      processed: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      nextCursor: null,
      done: true,
      counters: {
        gps_recalculated: 0,
        google_fallback_used: 0,
        haversine_fallback_used: 0,
        auto_end_last_gps_used: 0,
        historical_log_binding_used: 0,
        insufficient_gps: 0,
      },
      results: [],
    };
  }

  let query = client
    .from('fo_attendance')
    .select(ATTENDANCE_SELECT_COLUMNS)
    .gte('attendance_date', fromDate)
    .lte('attendance_date', toDate)
    .not('logout_time', 'is', null)
    .order('attendance_date', { ascending: true })
    .order('id', { ascending: true })
    .limit(batchSize + 1);
  if (cursor) {
    query = query.or(`attendance_date.gt.${cursor.date},and(attendance_date.eq.${cursor.date},id.gt.${cursor.id})`);
  }
  if (payload.fo_user_id) query = query.eq('fo_user_id', payload.fo_user_id);
  if (payload.employee_code) query = query.eq('employee_code', payload.employee_code);
  if (profileScope) {
    const clauses = [];
    if (profileScope.employeeCodes.length) clauses.push(`employee_code.in.(${postgrestInValues(profileScope.employeeCodes)})`);
    if (profileScope.profileIds.length) clauses.push(`fo_user_id.in.(${postgrestInValues(profileScope.profileIds)})`);
    query = query.or(clauses.join(','));
  }
  const status = normalizedBatchFilter(payload.status, 'All Status');
  if (status && status.toUpperCase() !== 'ENDED') {
    query = query.ilike('status', status);
  }
  const { data, error } = await query;
  if (error) throw error;

  const pageRows = (data || []).slice(0, batchSize);
  const hasMore = (data || []).length > batchSize;
  const results = await runWithConcurrency(pageRows, 4, async (attendance) => {
    try {
      const result = await recalculateFoKm(client, {
        attendance_id: attendance.id,
        dry_run: payload.dryRun === true || payload.dry_run === true,
      }, options);
      return {
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
        gps_log_binding_source: result.gps_log_binding_source,
        effective_end_source: result.effective_end_source,
        counters: {
          gps_recalculated: result.travel_legs?.some((leg) => ['GPS_BASED', 'FULL_DAY_GPS_NO_SITE'].includes(leg.source)) ? 1 : 0,
          google_fallback_used: Number(result.google_fallback_km || 0) > 0 ? 1 : 0,
          haversine_fallback_used: Number(result.haversine_fallback_km || 0) > 0 ? 1 : 0,
          auto_end_last_gps_used: result.effective_end_source === 'last_mobile_gps_before_auto_end' ? 1 : 0,
          historical_log_binding_used: result.gps_log_binding_source === 'employee_time_window_fallback' ? 1 : 0,
          insufficient_gps: result.review_flags?.some((flag) => String(flag).includes('INSUFFICIENT_GPS')) ? 1 : 0,
        },
      };
    } catch (error) {
      return {
        fo_user_id: attendance.fo_user_id,
        employee_code: attendance.employee_code,
        attendance_id: attendance.id,
        status: 'failed',
        message: error.message,
        counters: {},
      };
    }
  });
  const counterNames = [
    'gps_recalculated',
    'google_fallback_used',
    'haversine_fallback_used',
    'auto_end_last_gps_used',
    'historical_log_binding_used',
    'insufficient_gps',
  ];
  const counters = Object.fromEntries(counterNames.map((name) => [
    name,
    results.reduce((sum, result) => sum + Number(result.counters?.[name] || 0), 0),
  ]));
  const updated = results.filter((result) => result.status === 'updated').length;
  const skipped = results.filter((result) => result.status === 'skipped').length;
  const failed = results.filter((result) => result.status === 'failed').length;
  const nextCursor = hasMore && pageRows.length ? encodeBatchCursor(pageRows.at(-1)) : null;
  return {
    fromDate,
    toDate,
    state: payload.state || null,
    business: payload.business || null,
    status: payload.status || null,
    processed: results.length,
    updated,
    skipped,
    failed,
    nextCursor,
    done: !nextCursor,
    counters,
    results: results.map((result) => {
      const responseResult = { ...result };
      delete responseResult.counters;
      return responseResult;
    }),
  };
}

export async function recalculateFoKmForToday(serviceRoleClient, payload = {}, options = {}) {
  const date = payload.date || indiaDateKey();
  return recalculateFoKmBatch(serviceRoleClient, { ...payload, fromDate: date, toDate: date }, options);
}
