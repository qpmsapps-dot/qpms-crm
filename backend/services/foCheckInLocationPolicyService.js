export const FO_CHECKIN_NORMAL_RADIUS_METERS = 100;
export const FO_CHECKIN_WARNING_RADIUS_METERS = 1000;
export const FO_CHECKIN_MAX_ACCURACY_METERS = 50;
export const FO_CHECKIN_MAX_LOCATION_AGE_MS = 30_000;

function httpError(statusCode, message, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function finiteNumber(value, label) {
  if (value === null || value === undefined || value === '') {
    throw httpError(400, `${label} is required and must be numeric.`, `invalid_${label}`);
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw httpError(400, `${label} is required and must be numeric.`, `invalid_${label}`);
  }
  return number;
}

function validCoordinates(latitude, longitude) {
  return latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
}

export function foCheckInDistanceMeters(startLatitude, startLongitude, endLatitude, endLongitude) {
  const toRadians = (degrees) => degrees * Math.PI / 180;
  const earthRadiusMeters = 6_371_000;
  const dLat = toRadians(endLatitude - startLatitude);
  const dLng = toRadians(endLongitude - startLongitude);
  const startLat = toRadians(startLatitude);
  const endLat = toRadians(endLatitude);
  const haversine =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(startLat) * Math.cos(endLat) * Math.sin(dLng / 2) ** 2;
  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

export function evaluateFoCheckInLocation(payload, site, { now = new Date() } = {}) {
  const latitude = finiteNumber(payload?.latitude, 'latitude');
  const longitude = finiteNumber(payload?.longitude, 'longitude');
  const accuracy = finiteNumber(payload?.accuracy, 'accuracy');
  const siteLatitude = finiteNumber(site?.latitude, 'site_latitude');
  const siteLongitude = finiteNumber(site?.longitude, 'site_longitude');
  if (!validCoordinates(latitude, longitude) || !validCoordinates(siteLatitude, siteLongitude)) {
    throw httpError(400, 'Check-In or site coordinates are invalid.', 'invalid_coordinates');
  }
  if (latitude === 0 || longitude === 0) {
    throw httpError(400, 'A valid current GPS position is required.', 'invalid_current_coordinates');
  }
  if (accuracy <= 0 || accuracy > FO_CHECKIN_MAX_ACCURACY_METERS) {
    throw httpError(
      422,
      `GPS accuracy is currently ±${Math.round(accuracy)} m. Wait for a fix of ±${FO_CHECKIN_MAX_ACCURACY_METERS} m or better.`,
      'gps_accuracy_too_poor',
    );
  }
  const gpsTimestamp = new Date(payload?.gps_timestamp || '');
  if (Number.isNaN(gpsTimestamp.getTime())) {
    throw httpError(400, 'A valid GPS timestamp is required.', 'invalid_gps_timestamp');
  }
  const ageMs = now.getTime() - gpsTimestamp.getTime();
  if (ageMs < -5_000 || ageMs > FO_CHECKIN_MAX_LOCATION_AGE_MS) {
    throw httpError(422, 'The GPS fix is stale. Get a fresh location and retry.', 'stale_gps_fix');
  }

  const measuredDistance = foCheckInDistanceMeters(
    latitude,
    longitude,
    siteLatitude,
    siteLongitude,
  );
  const minimumPlausibleDistance = Math.max(0, measuredDistance - accuracy);
  const radiusOutcome = minimumPlausibleDistance <= FO_CHECKIN_NORMAL_RADIUS_METERS
    ? 'normal'
    : minimumPlausibleDistance <= FO_CHECKIN_WARNING_RADIUS_METERS
      ? 'warning_100m_to_1km'
      : 'strong_warning_over_1km';

  return {
    actual_latitude: latitude,
    actual_longitude: longitude,
    accuracy_meters: accuracy,
    gps_timestamp: gpsTimestamp.toISOString(),
    site_latitude: siteLatitude,
    site_longitude: siteLongitude,
    calculated_distance_meters: measuredDistance,
    minimum_plausible_distance_meters: minimumPlausibleDistance,
    normal_radius_meters: FO_CHECKIN_NORMAL_RADIUS_METERS,
    warning_radius_meters: FO_CHECKIN_WARNING_RADIUS_METERS,
    radius_outcome: radiusOutcome,
    warning_category: radiusOutcome === 'normal' ? null : radiusOutcome,
  };
}

export async function validateFoCheckInLocation(client, payload, options = {}) {
  const storeId = String(payload?.store_id || '').trim();
  if (!storeId) throw httpError(400, 'store_id is required.', 'missing_store_id');
  const { data: store, error } = await client
    .from('store_master')
    .select('id, latitude, longitude, status, updated_at')
    .eq('id', storeId)
    .maybeSingle();
  if (error) throw error;
  if (!store) throw httpError(404, 'The selected site was not found.', 'site_not_found');
  if (String(store.status || '').trim().toLowerCase() !== 'active') {
    throw httpError(409, 'The selected site is no longer active.', 'site_inactive');
  }
  return {
    ...evaluateFoCheckInLocation(payload, store, options),
    store_id: store.id,
    site_coordinates_updated_at: store.updated_at || null,
  };
}
