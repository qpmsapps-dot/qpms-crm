export const KM_FINANCIAL_WRITES_MAINTENANCE_CODE = 'KM_FINANCIAL_WRITES_MAINTENANCE';

export function kmFinancialWritesMaintenanceEnabled(environment = process.env) {
  return String(environment?.KM_FINANCIAL_WRITES_MAINTENANCE || '').trim().toLowerCase() === 'true';
}

export function assertKmFinancialWritesAvailable({ dryRun = false, environment = process.env, authorizedAdminAction = false, scopedAdminAction = false } = {}) {
  const emergencyValue = String(environment?.KM_FINANCIAL_WRITES_EMERGENCY_PAUSE || '').trim().toLowerCase();
  // Scoped acceptance requires an explicit release; unset/invalid is not consent.
  const emergencyPause = emergencyValue === 'true' || (scopedAdminAction && emergencyValue !== 'false');
  // A scoped request may reach ONLY the scope-validating RPC. It does not grant
  // database authority; emergency pause still blocks it unconditionally.
  if (dryRun || (!emergencyPause && (authorizedAdminAction || scopedAdminAction || !kmFinancialWritesMaintenanceEnabled(environment)))) return true;
  const error = new Error(
    'KM financial writes are temporarily paused for a controlled maintenance window. Raw GPS and attendance tracking remain available.',
  );
  error.statusCode = 503;
  error.code = KM_FINANCIAL_WRITES_MAINTENANCE_CODE;
  error.retryable = true;
  throw error;
}
