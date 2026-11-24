const errors = {
  '42501': [403, 'ATTENDANCE_FORBIDDEN', 'Attendance authorization or batch ownership could not be verified.'],
  '40001': [409, 'ATTENDANCE_PREVIEW_STALE', 'Attendance changed or this preview is incomplete. Validate the original workbook again before committing.'],
  '55P03': [409, 'ATTENDANCE_BUSY', 'Another attendance writer is active. Check batch status before retrying.'],
  '57014': [503, 'ATTENDANCE_CANCELLED', 'The database cancelled this attendance transaction; it was rolled back. Check status before retrying.'],
  '23505': [409, 'ATTENDANCE_CONFLICT', 'Attendance records conflict. Validate the workbook again.'],
  '23514': [400, 'ATTENDANCE_INVALID', 'Attendance validation failed; no correction was committed.'],
  'P0001': [409, 'ATTENDANCE_INVALID', 'Attendance validation or correction confirmation failed; no correction was committed.'],
  '22P02': [400, 'ATTENDANCE_INVALID', 'Invalid attendance batch or input.'],
};
function invalid() { return Object.assign(Error('A batch, preview key and explicit correction selection are required.'), { statusCode: 400, code: 'ATTENDANCE_INVALID', outcome: 'not_committed' }); }
async function call(client, name, args, { signal, log = console.info } = {}) {
  const started = performance.now(); let outcome = 'unconfirmed';
  try {
    const query = client.rpc(name, args), deadline = AbortSignal.timeout(45000);
    const bounded = typeof query.abortSignal === 'function' ? query.abortSignal(signal ? AbortSignal.any([signal, deadline]) : deadline) : query;
    const result = await bounded;
    if (result.error) throw result.error;
    if (name === 'rpc_retail_mis_attendance_commit' ? result.data !== args.p_batch
      : result.data?.id !== args.p_batch || !['preview','committed'].includes(result.data?.status) || typeof result.data?.writer_busy !== 'boolean') throw Error('Unconfirmed attendance receipt');
    outcome = 'confirmed'; return result.data;
  } catch (error) {
    const known = errors[error.code];
    const [statusCode, code, message] = known || [503, 'ATTENDANCE_UNCONFIRMED', 'No attendance result could be confirmed. Check batch status; do not submit the correction again yet.'];
    outcome = known ? 'not_committed' : 'unconfirmed';
    throw Object.assign(Error(message), { statusCode, code, outcome });
  } finally {
    try { log('[RetailAttendanceCommit]', JSON.stringify({ operation: name, batch_id: args.p_batch, duration_ms: Math.round(performance.now() - started), outcome })); } catch { /* Diagnostics cannot affect transactions. */ }
  }
}
export async function commitMisAttendance(client, profile, input, context) {
  if (typeof input?.id !== 'string' || !input.id || input.id.length > 64 || typeof input.preview_key !== 'string' || !input.preview_key || input.preview_key.length > 100 || typeof input.replace !== 'boolean') throw invalid();
  if (input.replace && !String(input.reason || '').trim()) throw invalid();
  return call(client, 'rpc_retail_mis_attendance_commit', { p_batch: input.id, p_actor: profile.id, p_replace: input.replace,
    p_reason: String(input.reason || '').trim() || null, p_preview_key: input.preview_key }, context);
}
export async function misAttendanceStatus(client, profile, input, context) {
  if (typeof input?.id !== 'string' || !input.id || input.id.length > 64 || typeof input.preview_key !== 'string' || !input.preview_key || input.preview_key.length > 100) throw invalid();
  return call(client, 'rpc_retail_mis_attendance_status', { p_batch: input.id, p_actor: profile.id, p_preview_key: input.preview_key }, context);
}
