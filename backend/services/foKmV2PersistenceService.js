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
  scopedAuthorizationReference = null,
}) {
  if (calculation?.incrementalRecovery === true) {
    const scoped = scopedAuthorizationReference != null;
    const policy = !scoped && environment.KM_CANONICAL_POLICY_ENABLED === 'true';
    if (scoped && (sourceEntryPoint !== 'admin_recalculation' || !adminAuthorization?.userId || actorSource || !/^[A-Z0-9_-]{8,100}$/.test(scopedAuthorizationReference))) throw Object.assign(new Error('Scoped KM authorization requires a trusted Admin action.'),{code:'KM_SCOPE_ADMIN_REQUIRED',statusCode:403});
    // No exemption for automatic credits. Scoped requests must use the database
    // scope validator, which independently checks the actor, plan and expiry.
    // Policy mode reaches only the DB policy validator. It shares the explicit
    // emergency-stop requirement with scoped acceptance, never a general RPC.
    assertKmFinancialWritesAvailable({dryRun:false,environment,authorizedAdminAction:false,scopedAdminAction:scoped || policy});
    if(environment.KM_SHARED_RECONCILIATION_ENABLED!=='true'||environment.KM_INCREMENTAL_REPORTING_ENABLED!=='true')throw Object.assign(new Error('Shared reconciliation/reporting is inactive.'),{code:'KM_SHARED_RECONCILIATION_INACTIVE',retryable:true});
    const {data,error}=await client.rpc(scoped ? 'rpc_reconcile_fo_scoped_km_v1' : policy ? 'rpc_reconcile_fo_policy_km_v1' : 'rpc_reconcile_fo_incremental_km_v1',{
      ...(scoped ? {p_reference:scopedAuthorizationReference} : {p_trigger:sourceEntryPoint,p_lease:actorSource||null}),
      p_attendance_id:attendanceId,p_calculation:calculation,
      p_admin:adminAuthorization?.userId||null,
    });
    if(error)throw Object.assign(new Error(error.message),{code:error.code,retryable:['40001','40P01','55P03','55000'].includes(error.code)});
    return data;
  }
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
