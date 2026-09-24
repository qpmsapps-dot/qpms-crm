const TRUE_VALUES = new Set(['true', '1', 'yes', 'on']);

export const READ_ONLY_UAT_DISABLED_WORKERS = Object.freeze([
  'hospital_ticket_sla_scheduler',
  'smtp_transport_verification',
  'daily_operations_report_scheduler',
  'end_day_km_auto_recalculation',
  'fo_stale_session_cleanup',
]);

export function isReadOnlyUatMode(environment = process.env) {
  return TRUE_VALUES.has(String(environment?.READ_ONLY_UAT_MODE || '').trim().toLowerCase());
}

const READ_ONLY_HTTP_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function createRequireWritablePreSalesEnvironment(environment = process.env) {
  return function requireWritablePreSalesEnvironment(request, response, next) {
    const method = String(request?.method || '').trim().toUpperCase();
    if (!isReadOnlyUatMode(environment) || READ_ONLY_HTTP_METHODS.has(method)) {
      next();
      return;
    }

    response.status(423).json({
      ok: false,
      error: 'READ_ONLY_UAT_MODE',
      code: 'read_only_uat_mode',
      message: 'Pre-Sales changes are disabled during read-only UAT.',
    });
  };
}

export function startAutomaticBackgroundWorkers({
  environment = process.env,
  logger = console,
  workers = {},
} = {}) {
  if (isReadOnlyUatMode(environment)) {
    logger.warn(
      'READ_ONLY_UAT_MODE enabled: automatic background writes and dispatch workers are disabled.',
      { disabledWorkers: READ_ONLY_UAT_DISABLED_WORKERS },
    );
    return { readOnlyUatMode: true, startedWorkers: [] };
  }

  const startedWorkers = [];
  for (const workerName of READ_ONLY_UAT_DISABLED_WORKERS) {
    const startWorker = workers[workerName];
    if (typeof startWorker !== 'function') continue;
    startWorker();
    startedWorkers.push(workerName);
  }
  return { readOnlyUatMode: false, startedWorkers };
}
