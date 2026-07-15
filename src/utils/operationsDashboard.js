export const EMPTY_OPERATIONS_SUMMARY = Object.freeze({
  payable_km: 0,
  petrol_amount: 0,
  matching_attendance_count: 0,
  matching_employee_count: 0,
  applied_filters: null,
});

export function operationsSummaryQuery(filters) {
  const params = new URLSearchParams({
    date_from: filters.dateFrom,
    date_to: filters.dateTo,
    state: filters.state,
    business: filters.business,
    status: filters.status,
  });
  return params.toString();
}

export function nextPreviewIndex(current, length, direction) {
  if (!Number.isInteger(length) || length <= 0) return 0;
  const candidate = current + direction;
  return Math.max(0, Math.min(length - 1, candidate));
}

export function activityPreviewFileKind(file = {}) {
  const type = String(file.file_type || '').toLowerCase();
  const name = String(file.file_name || file.file_url || '').toLowerCase();
  if (type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp)($|\?)/i.test(name)) return 'image';
  if (type.includes('pdf') || /\.pdf($|\?)/i.test(name)) return 'pdf';
  return 'document';
}

export function previewMenuState(currentCardId, actionCardId) {
  return currentCardId === actionCardId ? null : actionCardId;
}

export function shouldAcceptSummaryResponse(responseSequence, currentSequence) {
  return responseSequence === currentSequence;
}
