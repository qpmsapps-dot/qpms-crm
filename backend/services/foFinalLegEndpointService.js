// Boundary recovery is calculation evidence only, never a replacement checkout snapshot.
export function resolveFinalLegEndpoint(recorded, boundary, points = [], source = 'recorded') {
  if (recorded) return { coordinate: recorded, source, observed_at: boundary.toISOString(), recovered: false };
  const candidates = points.filter(point => point.capturedAt instanceof Date &&
    Number.isFinite(point.latitude) && Number.isFinite(point.longitude) &&
    Math.abs(point.latitude) <= 90 && Math.abs(point.longitude) <= 180 &&
    !(point.latitude === 0 && point.longitude === 0) &&
    Number.isFinite(point.accuracy) && point.accuracy <= 40 && point.accuracy >= 0 &&
    String(point.source).toLowerCase() === 'mobile' &&
    Math.abs(point.capturedAt-boundary) <= 120000)
    .sort((a,b) => Math.abs(a.capturedAt-boundary)-Math.abs(b.capturedAt-boundary));
  const point = candidates[0];
  return { coordinate: point ? { latitude: point.latitude, longitude: point.longitude } : null,
    source: point ? 'quality_filtered_mobile_gps_boundary' : 'insufficient_endpoint_evidence',
    boundary_at: boundary.toISOString(), observed_at: point?.capturedAt.toISOString() || null,
    accuracy_meters: point?.accuracy ?? null, recovered: Boolean(point) };
}
