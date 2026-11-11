const stored = value => value != null && String(value).trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
function hasReceipt(attendance) {
  return attendance.route_sync_status === 'canonical_v2_incremental_persisted' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(attendance.metadata?.shared_km_last_receipt || '');
}
export function savedFoPayableKm(attendance = {}) {
  if (attendance.payable_km_allowed === false && !hasReceipt(attendance)) return 0;
  // These are saved attendance columns. Zero is authoritative; GPS, visit route
  // evidence and live-status estimates are never reimbursement fallbacks.
  return stored(attendance.total_approved_km) ?? stored(attendance.eligible_km) ?? stored(attendance.total_route_km) ?? 0;
}
export function savedFoPetrolAmount(attendance = {}) {
  if (attendance.payable_km_allowed === false && !hasReceipt(attendance)) return 0;
  return stored(attendance.petrol_amount);
}

// Evidence only: never use this sum as a reimbursement fallback. Require the
// attendance identity so a selected range cannot borrow another day's visits.
export function savedSiteRouteKm(attendanceId, visits = []) {
  const seen = new Set();
  let total = 0;
  let count = 0;
  for (const visit of visits) {
    if (!attendanceId || visit.attendance_id !== attendanceId || !visit.id || seen.has(visit.id)) continue;
    seen.add(visit.id);
    const km = stored(visit.route_km);
    if (km === null) continue;
    total += km;
    count++;
  }
  return count ? Math.round(total * 100) / 100 : null;
}

export function savedRouteKmLabel(value) {
  const km = stored(value);
  return km === null ? 'Unknown' : `${km.toFixed(2)} km`;
}

export function assertReadOnlyKmPreview(result) {
  if (result?.evidence_preview !== true || result.read_only !== true || result.dry_run !== true ||
      result.financial_eligible !== false || result.preview_token || result.updated === true) {
    throw new Error('Read-only route preview is unavailable on this backend. Saved route evidence remains visible; no financial save was requested.');
  }
}
