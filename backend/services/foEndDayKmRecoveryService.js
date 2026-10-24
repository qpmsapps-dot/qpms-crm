const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

export function historicalIndiaDateStart(dateKey, lookbackDays) {
  const parsed = new Date(`${String(dateKey || '').slice(0, 10)}T12:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime())) throw new Error('A valid India date is required.');
  parsed.setUTCDate(parsed.getUTCDate() - Math.max(0, Number(lookbackDays) || 0));
  return parsed.toISOString().slice(0, 10);
}

export function canonicalEndDayCompletionMatches(result, attendanceId) {
  return Boolean(
    result &&
    String(result.attendance_id || '').trim() === String(attendanceId || '').trim() &&
    result.updated === true &&
    result.dry_run === false &&
    result.route_sync_status === 'canonical_v2_persisted' &&
    UUID_PATTERN.test(String(result.calculation_run_id || '')) &&
    DIGEST_PATTERN.test(String(result.input_digest || ''))
  );
}

export async function runBoundedEndDayRecoveryAttempt(
  operation,
  { maxAttempts = 2, retryDelaysMs = [0, 1000], wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {},
) {
  const attempts = Math.max(1, Math.min(3, Number(maxAttempts) || 1));
  let lastError;
  let attemptsMade = 0;
  for (let index = 0; index < attempts; index += 1) {
    attemptsMade = index + 1;
    if (index > 0) await wait(Math.max(0, Number(retryDelaysMs[index] ?? retryDelaysMs.at(-1) ?? 0)));
    try {
      return { result: await operation(index + 1), attempts: index + 1 };
    } catch (error) {
      lastError = error;
      if (error?.retryable === false || error?.code === 'km_v2_financial_approval_required' ||
          error?.code === 'km_v2_final_leg_evidence_unresolved' ||
          error?.code === 'km_v2_final_leg_exceeds_approved_evidence') break;
    }
  }
  if (lastError && typeof lastError === 'object') lastError.recoveryAttempts = attemptsMade;
  throw lastError || new Error('End Day canonical recovery failed.');
}
