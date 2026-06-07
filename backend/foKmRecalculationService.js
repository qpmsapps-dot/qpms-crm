const RATE_PER_KM = 4;
const MAX_ACCURACY_METERS = 50;
const HIGH_CONFIDENCE_ACCURACY_METERS = 40;
const MIN_SEGMENT_METERS = 5;
const MAX_NORMAL_GAP_SECONDS = 600;
const MAX_NORMAL_SEGMENT_METERS = 2500;
const MAX_SPEED_KMPH = 120;
const DUPLICATE_WINDOW_SECONDS = 10;

function log(event, detail = {}) {
  console.log(`[${event}]`, detail);
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
  const apiKey =
    options.googleMapsApiKey ||
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.VITE_GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;
  const url = new URL('https://maps.googleapis.com/maps/api/directions/json');
  url.searchParams.set('origin', `${start.latitude},${start.longitude}`);
  url.searchParams.set('destination', `${end.latitude},${end.longitude}`);
  url.searchParams.set('mode', 'driving');
  url.searchParams.set('key', apiKey);

  const response = await fetch(url);
  if (!response.ok) return null;
  const payload = await response.json();
  if (payload.status !== 'OK') return null;
  const meters = payload.routes?.[0]?.legs?.reduce(
    (sum, leg) => sum + Number(leg.distance?.value || 0),
    0,
  );
  return Number.isFinite(meters) && meters > 0 ? meters / 1000 : null;
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
  log('FO_KM_GPS_LOGS_LOADED', {
    fo_user_id: attendance.fo_user_id,
    attendance_id: attendance.id,
    count: rows.length,
  });

  const points = cleanGpsLogs(rows);
  const calculation = await calculateActualTravelKm(points, options);
  const actualTravelKm = Number(calculation.actualTravelKm.toFixed(2));
  const petrolAmount = Number((actualTravelKm * RATE_PER_KM).toFixed(2));

  const attendanceUpdate = {
    actual_km: actualTravelKm,
    total_route_km: actualTravelKm,
    eligible_km: actualTravelKm,
    total_raw_km: actualTravelKm,
    total_approved_km: actualTravelKm,
    petrol_amount: petrolAmount,
    rate_per_km: RATE_PER_KM,
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
        route_km_today: actualTravelKm,
        last_seen_at: new Date().toISOString(),
        source: 'backend_km_recalculation',
        sync_status: 'synced',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'fo_user_id' },
    );
  if (liveStatusError) throw liveStatusError;
  log('FO_KM_LIVE_STATUS_UPDATED', { fo_user_id: attendance.fo_user_id, route_km_today: actualTravelKm });

  const result = {
    fo_user_id: attendance.fo_user_id,
    attendance_id: attendance.id,
    actual_travel_km: actualTravelKm,
    petrol_amount: petrolAmount,
    gps_points_total: rows.length,
    gps_points_used: points.length,
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
