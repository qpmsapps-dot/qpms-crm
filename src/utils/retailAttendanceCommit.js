export function attendancePendingKey(actor, module) { return `retail-attendance-pending:${actor}:${module}`; }
export function readPendingAttendance(storage, key) {
  try {
    const v = JSON.parse(storage.getItem(key));
    return v && typeof v.id === 'string' && v.id && v.id.length <= 64 && typeof v.preview_key === 'string' && v.preview_key && v.preview_key.length <= 100 ? { id: v.id, preview_key: v.preview_key } : null;
  } catch { return null; }
}
export function savePendingAttendance(storage, key, batch) {
  try { if (batch) storage.setItem(key, JSON.stringify({ id: batch.id, preview_key: batch.preview_key })); else storage.removeItem(key); } catch { /* In-memory recovery remains available. */ }
}
export async function checkAttendanceCommit(request, batch) {
  const status = await request(`/attendance/status/${encodeURIComponent(batch.id)}`, { params: { preview_key: batch.preview_key } });
  if (!status || status.id !== batch.id || !['preview', 'committed'].includes(status.status) || typeof status.writer_busy !== 'boolean') throw Error('Attendance batch status could not be verified. Do not submit again yet.');
  return status;
}
export async function submitAttendanceOnce(request, batch, { replace, reason }) {
  let error;
  try {
    const id = await request('/attendance/commit', { method: 'POST', data: { id: batch.id, preview_key: batch.preview_key, replace, reason } });
    if (id === batch.id) return { id, status: 'committed', writer_busy: false };
    error = Error('Attendance commit returned an unconfirmed result.');
  } catch (e) { error = e; }
  if (error.response?.data?.outcome === 'not_committed' && ['ATTENDANCE_PREVIEW_STALE','ATTENDANCE_INVALID','ATTENDANCE_CONFLICT'].includes(error.response?.data?.code)) {
    throw Object.assign(Error(error.response.data.message || 'Validate the original workbook again.'), { requires_preview: true });
  }
  // Never POST automatically again after timeout, lock contention or lost reply.
  // A preview remains unconfirmed if any attendance writer is still active.
  try { return { ...await checkAttendanceCommit(request, batch), failure: error.response?.data?.message || error.message }; }
  catch { throw Error(`${error.response?.data?.message || error.message} Batch status remains unconfirmed. Check status before any retry.`); }
}
