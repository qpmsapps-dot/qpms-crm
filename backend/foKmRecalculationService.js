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

function log(event, detail = {}) {
  console.log(`[${event}]`, detail);
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
  const number = Number(value);
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

async function findAttendance(client, { attendance_id, fo_user_id, date }) {
  if (attendance_id) {
    const { data, error } = await client
      .from('fo_attendance')
      .select('*')
      .eq('id', attendance_id)
      .single();
    if (error) throw error;
    return data;
  }
  if (!fo_user_id) {
    const error = new Error('fo_user_id or attendance_id is required.');
    error.statusCode = 400;
    throw error;
  }
  const attendanceDate = date || indiaDateKey();
  const { data, error } = await client
    .from('fo_attendance')
    .select('*')
    .eq('fo_user_id', fo_user_id)
    .eq('attendance_date', attendanceDate)
    .order('login_time', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    const missing = new Error(`No attendance found for ${fo_user_id} on ${attendanceDate}.`);
    missing.statusCode = 404;
    throw missing;
  }
  return data;
}

async function loadGpsLogs(client, attendance) {
  const { data: attendanceLogs, error: attendanceLogsError } = await client
    .from('fo_location_logs')
    .select('*')
    .eq('attendance_id', attendance.id)
    .order('captured_at', { ascending: true })
    .limit(20000);
  if (attendanceLogsError) throw attendanceLogsError;
  if (attendanceLogs?.length) return attendanceLogs;

  const start = attendance.login_time;
  const end = attendance.logout_time || new Date().toISOString();
  const { data, error } = await client
    .from('fo_location_logs')
    .select('*')
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
    .select('*')
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
    .filter((visit) => coordinateFrom(visit, ['check_out_latitude'], ['check_out_longitude']))
    .sort((a, b) => {
      const aTime = visitTime(a.checkout_time || a.check_out_time || a.updated_at || a.check_in_time);
      const bTime = visitTime(b.checkout_time || b.check_out_time || b.updated_at || b.check_in_time);
      return (bTime?.getTime() || 0) - (aTime?.getTime() || 0);
    })[0] || null;
}

function attendanceEndCoordinate(attendance) {
  return coordinateFrom(
    attendance,
    ['end_latitude', 'logout_latitude', 'end_lat', 'logout_lat'],
    ['end_longitude', 'logout_longitude', 'end_lng', 'logout_lng'],
  );
}

function attendanceEndedWithOpenSite(attendance) {
  const metadata = attendance?.metadata && typeof attendance.metadata === 'object' && !Array.isArray(attendance.metadata)
    ? attendance.metadata
    : {};
  return metadata.end_day_with_open_site === true || String(metadata.end_day_with_open_site || '').toLowerCase() === 'true';
}

async function calculateFinalReturnLegKm(attendance, visits = [], options = {}) {
  if (attendanceEndedWithOpenSite(attendance)) {
    const reason = 'end_day_with_open_site';
    log('FINAL_RETURN_LEG_SKIPPED', {
      attendance_id: attendance.id,
      reason,
    });
    return { km: 0, calculated: false, reason };
  }
  const checkedOutVisit = latestCheckedOutVisit(visits);
  const origin = checkedOutVisit
    ? coordinateFrom(checkedOutVisit, ['check_out_latitude'], ['check_out_longitude'])
    : null;
  const destination = attendanceEndCoordinate(attendance);

  log('FINAL_RETURN_LEG_CHECK', {
    attendance_id: attendance.id,
    site_visit_id: checkedOutVisit?.id,
    has_origin: Boolean(origin),
    has_destination: Boolean(destination),
  });

  if (!checkedOutVisit || !origin) {
    const reason = 'missing_checkout_gps';
    log('FINAL_RETURN_LEG_SKIPPED', { attendance_id: attendance.id, reason });
    return { km: 0, calculated: false, reason };
  }
  if (!destination) {
    const reason = 'missing_end_day_gps';
    log('FINAL_RETURN_LEG_SKIPPED', { attendance_id: attendance.id, site_visit_id: checkedOutVisit.id, reason });
    return { km: 0, calculated: false, reason };
  }

  const straightLineKm = haversineKm(origin, destination);
  if (!Number.isFinite(straightLineKm) || straightLineKm < MIN_MEANINGFUL_FINAL_RETURN_LEG_KM) {
    const reason = 'distance_not_meaningful';
    log('FINAL_RETURN_LEG_SKIPPED', {
      attendance_id: attendance.id,
      site_visit_id: checkedOutVisit.id,
      reason,
      straight_line_km: Number((straightLineKm || 0).toFixed(3)),
    });
    return { km: 0, calculated: false, reason };
  }

  const googleKm = await googleDirectionsKm(origin, destination, options);
  if (googleKm === null) {
    const reason = 'google_route_failed';
    log('FINAL_RETURN_LEG_GOOGLE_FAILED', {
      attendance_id: attendance.id,
      site_visit_id: checkedOutVisit.id,
      reason,
      straight_line_km: Number(straightLineKm.toFixed(3)),
    });
    return { km: 0, calculated: false, reason };
  }

  const km = Number(googleKm.toFixed(2));
  log('FINAL_RETURN_LEG_GOOGLE_SUCCESS', {
    attendance_id: attendance.id,
    site_visit_id: checkedOutVisit.id,
    route_km: km,
    straight_line_km: Number(straightLineKm.toFixed(3)),
  });
  return { km, calculated: true, reason: null, site_visit_id: checkedOutVisit.id };
}

async function calculateRouteKmFromVisitAnchors(client, attendance, visits = [], options = {}) {
  const reviewFlags = [];
  let origin = coordinateFrom(
    attendance,
    ['start_latitude', 'start_lat', 'latitude'],
    ['start_longitude', 'start_lng', 'longitude'],
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
    ['end_latitude', 'end_lat'],
    ['end_longitude', 'end_lng'],
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

export async function recalculateFoKm(client, payload = {}, options = {}) {
  log('FO_KM_RECALC_STARTED', payload);
  const attendance = await findAttendance(client, payload);
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
  const finalReturnLeg = await calculateFinalReturnLegKm(attendance, visits, options);
  const finalReturnLegKm = finalReturnLeg.km;
  const reviewFlags = [];
  const visitsMissingRouteKm = visits.filter((visit) => {
    const routeKm = normalizeNumber(visit.route_km);
    return !Number.isFinite(routeKm) || routeKm <= 0;
  }).length;
  if (visitsMissingRouteKm > 0) reviewFlags.push('SITE_VISIT_ROUTE_KM_MISSING');
  if (storedRouteKm <= 0 && visits.length > 0 && finalReturnLegKm <= 0) reviewFlags.push('ROUTE_KM_ZERO_WITH_VISITS');
  if (finalReturnLeg.reason) reviewFlags.push(`FINAL_RETURN_LEG_${finalReturnLeg.reason.toUpperCase()}`);
  if (rows.length < 5) reviewFlags.push('LOW_GPS_LOG_COUNT');
  const approvedKm = Number((storedRouteKm + finalReturnLegKm).toFixed(2));
  const petrolAmount = Number((approvedKm * RATE_PER_KM).toFixed(2));
  const routeSyncStatus = approvedKm > 0
    ? (finalReturnLegKm > 0 ? 'site_visit_route_km_sum_plus_final_return_leg' : 'site_visit_route_km_sum')
    : 'review_required';
  log('FINAL_APPROVED_KM', {
    attendance_id: attendance.id,
    site_visit_route_km: storedRouteKm,
    final_return_leg_km: finalReturnLegKm,
    approved_km: approvedKm,
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
    rate_per_km: RATE_PER_KM,
    eligibility_status: reviewFlags.length ? reviewFlags.join(',') : 'Approved',
    route_sync_status: routeSyncStatus,
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
    fo_user_id: attendance.fo_user_id,
    attendance_id: attendance.id,
    actual_travel_km: actualTravelKm,
    approved_km: approvedKm,
    total_route_km: approvedKm,
    petrol_amount: petrolAmount,
    gps_points_total: rows.length,
    gps_points_used: points.length,
    site_visits_count: visits.length,
    stored_site_visit_route_km: storedRouteKm,
    final_return_leg_km: finalReturnLegKm,
    final_return_leg_calculated: finalReturnLeg.calculated,
    final_return_leg_skip_reason: finalReturnLeg.reason,
    final_return_leg_site_visit_id: finalReturnLeg.site_visit_id,
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
  };
  log('FO_KM_RECALC_COMPLETED', result);
  return result;
}

export async function recalculateFoKmForToday(client, payload = {}, options = {}) {
  const date = payload.date || indiaDateKey();
  let query = client
    .from('fo_attendance')
    .select('*')
    .eq('attendance_date', date)
    .in('status', ['Active', 'Completed'])
    .order('login_time', { ascending: false })
    .limit(500);
  if (payload.fo_user_id) query = query.eq('fo_user_id', payload.fo_user_id);
  const { data, error } = await query;
  if (error) throw error;

  const results = [];
  for (const attendance of data || []) {
    try {
      results.push(await recalculateFoKm(client, { attendance_id: attendance.id }, options));
    } catch (error) {
      results.push({
        fo_user_id: attendance.fo_user_id,
        attendance_id: attendance.id,
        ok: false,
        message: error.message,
      });
    }
  }
  return {
    date,
    count: results.length,
    results,
  };
}
