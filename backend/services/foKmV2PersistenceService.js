import { KM_ENGINE_VERSION } from './foCanonicalKmEngineV2.js';
import { assertKmFinancialWritesAvailable } from './kmFinancialWriteMaintenanceService.js';

export const KM_V2_PERSISTENCE_RPC = 'rpc_persist_fo_canonical_km_v2';
export async function persistCanonicalKmV2(client, {
  attendanceId,
  expectedAttendanceUpdatedAt,
  calculation,
  sourceEntryPoint,
  actorSource = null,
  environment = process.env,
  adminAuthorization = null,
  reviewDecision = null,
}) {
  // This selects a service-only RPC which independently validates the Admin.
  // It does not grant permission to the ordinary canonical persistence RPC.
  assertKmFinancialWritesAvailable({ dryRun: false, environment, authorizedAdminAction: Boolean(adminAuthorization?.userId) });
  if (!client || typeof client.rpc !== 'function') {
    const error = new Error('A service-role Supabase client with RPC support is required.');
    error.code = 'km_v2_service_role_rpc_required';
    error.statusCode = 503;
    throw error;
  }
  if (!attendanceId || calculation?.calculationVersion !== KM_ENGINE_VERSION) {
    const error = new Error('Canonical KM V2 persistence input is invalid.');
    error.code = 'km_v2_persistence_input_invalid';
    error.statusCode = 400;
    throw error;
  }

  const rpc = adminAuthorization ? 'rpc_apply_fo_admin_km_correction_v1' : KM_V2_PERSISTENCE_RPC;
  const { data, error } = await client.rpc(rpc, {
    p_attendance_id: attendanceId,
    p_input_digest: calculation.inputDigest,
    p_expected_attendance_updated_at: expectedAttendanceUpdatedAt,
    p_calculation: calculation,
    p_source_entry_point: adminAuthorization
      ? reviewDecision ? 'missing_km_approval' : 'admin_correction'
      : sourceEntryPoint || 'backend_recalculation',
    p_actor_source: actorSource,
    ...(adminAuthorization ? {
      p_admin_user_id: adminAuthorization.userId,
      p_approval_reason: adminAuthorization.reason,
      p_review_decision: reviewDecision,
    } : {}),
  });
  if (error) {
    const persistenceError = new Error(error.message || 'Canonical KM V2 persistence failed.');
    const databaseCode = String(error.message || '').match(/(km_v2_[a-z0-9_]+)/i)?.[1] || null;
    persistenceError.code = error.code === '55000' && databaseCode
      ? databaseCode
      : error.code || databaseCode || 'km_v2_persistence_failed';
    persistenceError.details = error.details || null;
    persistenceError.hint = error.hint || null;
    persistenceError.statusCode = databaseCode === 'km_v2_database_financial_writes_closed'
      ? 503
      : databaseCode === 'km_v2_financial_approval_required' ||
          databaseCode === 'km_v2_final_leg_evidence_unresolved' ||
          databaseCode === 'km_v2_final_leg_exceeds_approved_evidence'
        ? 409
        : error.code === '42501'
          ? 403
        : error.code === '22023'
          ? 400
        : error.code === '40001'
          ? 409
          : 500;
    persistenceError.retryable = databaseCode === 'km_v2_database_financial_writes_closed';
    throw persistenceError;
  }
  return data;
}
