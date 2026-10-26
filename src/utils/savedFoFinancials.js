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
