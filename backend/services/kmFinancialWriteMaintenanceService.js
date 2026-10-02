export const KM_FINANCIAL_WRITES_MAINTENANCE_CODE = 'KM_FINANCIAL_WRITES_MAINTENANCE';

export function kmFinancialWritesMaintenanceEnabled(environment = process.env) {
  return String(environment?.KM_FINANCIAL_WRITES_MAINTENANCE || '').trim().toLowerCase() === 'true';
}

export function assertKmFinancialWritesAvailable({ dryRun = false, environment = process.env } = {}) {
  if (dryRun || !kmFinancialWritesMaintenanceEnabled(environment)) return true;
  const error = new Error(
    'KM financial writes are temporarily paused for a controlled maintenance window. Raw GPS and attendance tracking remain available.',
  );
  error.statusCode = 503;
  error.code = KM_FINANCIAL_WRITES_MAINTENANCE_CODE;
  error.retryable = true;
  throw error;
}
