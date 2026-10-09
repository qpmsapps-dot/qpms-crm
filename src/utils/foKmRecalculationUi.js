export const KM_RECALCULATION_MAINTENANCE_MESSAGE =
  'KM recalculation is temporarily unavailable during maintenance. Existing KM and reimbursement values have not changed.';

export const KM_RECALCULATION_REQUEST_TIMEOUT_MS = 2 * 60 * 1000;
export const KM_RECALCULATION_REFRESH_TIMEOUT_MS = 60 * 1000;

export async function runWithAbortTimeout(operation, {
  timeoutMs,
  timeoutCode,
  timeoutMessage,
} = {}) {
  const boundedTimeoutMs = Number(timeoutMs);
  if (!Number.isFinite(boundedTimeoutMs) || boundedTimeoutMs <= 0) {
    return operation(undefined);
  }

  const controller = new AbortController();
  let timeoutId;
  const timeoutPromise = new Promise((resolve, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      const error = new Error(timeoutMessage || 'Request timed out.');
      error.code = timeoutCode || 'REQUEST_TIMEOUT';
      reject(error);
    }, boundedTimeoutMs);
  });

  try {
    return await Promise.race([
      Promise.resolve().then(() => operation(controller.signal)),
      timeoutPromise,
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}

export function employeeRangeRecalculationPresentation(payload = {}) {
  const updated = Number(payload.updated || 0);
  const eligible = Number(payload.eligible || 0);
  const failed = Number(payload.failed || 0);
  const outcome = String(payload.outcome || '').trim().toLowerCase();
  const code = String(payload.code || '').trim().toUpperCase();

  if (outcome === 'maintenance_blocked' || code === 'KM_FINANCIAL_WRITES_MAINTENANCE') {
    return {
      ok: false,
      outcome: 'maintenance_blocked',
      message: KM_RECALCULATION_MAINTENANCE_MESSAGE,
      shouldRefresh: false,
    };
  }
  if (outcome === 'already_running') {
    return {
      ok: false,
      outcome,
      message: payload.message || 'Recalculation is already running for this employee and period.',
      shouldRefresh: false,
    };
  }
  if (outcome === 'partial_success' || (updated > 0 && failed > 0)) {
    return {
      ok: false,
      outcome: 'partial_success',
      message: `${updated} of ${eligible} eligible attendance records recalculated; ${failed} failed. Review the failed dates before retrying.`,
      shouldRefresh: true,
    };
  }
  if (outcome === 'complete_failure' || (eligible > 0 && updated === 0 && failed > 0)) {
    return {
      ok: false,
      outcome: 'complete_failure',
      message: `KM recalculation failed for all ${eligible} eligible attendance records. Existing values were not replaced by the failed operations.`,
      shouldRefresh: false,
    };
  }
  if (payload.ok === false) {
    return {
      ok: false,
      outcome: outcome || 'request_failed',
      message: payload.message || 'KM recalculation failed.',
      shouldRefresh: false,
    };
  }
  if (outcome === 'no_eligible_records' || eligible === 0) {
    return {
      ok: true,
      outcome: 'no_eligible_records',
      message: 'No completed attendance records were eligible for recalculation in the selected period.',
      shouldRefresh: false,
    };
  }
  return {
    ok: true,
    outcome: 'complete_success',
    message: `${updated} of ${eligible} eligible attendance records recalculated successfully.`,
    shouldRefresh: true,
  };
}
