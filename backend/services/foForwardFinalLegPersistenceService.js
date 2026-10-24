import { KM_ENGINE_VERSION } from './foCanonicalKmEngineV2.js';
import { assertKmFinancialWritesAvailable } from './kmFinancialWriteMaintenanceService.js';

export const FORWARD_FINAL_LEG_PERSISTENCE_RPC = 'rpc_persist_fo_forward_final_leg_v1';

const DATABASE_ERROR_CODES = new Set([
  'forward_final_leg_before_effective_date',
  'forward_final_leg_attendance_not_pending',
  'forward_final_leg_financial_state_protected',
  'forward_final_leg_already_finalized',
  'forward_final_leg_boundary_mismatch',
  'forward_final_leg_evidence_not_payable',
  'forward_final_leg_stale_input',
]);

function databaseErrorCode(error) {
  const message = String(error?.message || '');
  return message.match(/(forward_final_leg_[a-z0-9_]+)/i)?.[1] || null;
}

export async function persistForwardFinalLeg(client, {
  attendanceId,
  expectedAttendanceUpdatedAt,
  calculation,
  sourceEntryPoint,
  actorSource = null,
  environment = process.env,
} = {}) {
  // Preserve the legacy hold exemption of forward-only writes, but honor the
  // explicit emergency pause shared by all financial persistence adapters.
  assertKmFinancialWritesAvailable({ environment: {
    KM_FINANCIAL_WRITES_EMERGENCY_PAUSE: environment.KM_FINANCIAL_WRITES_EMERGENCY_PAUSE,
  } });
  if (!client || typeof client.rpc !== 'function') {
    const error = new Error('A service-role Supabase client with RPC support is required.');
    error.code = 'forward_final_leg_service_role_rpc_required';
    error.statusCode = 503;
    throw error;
  }
  if (
    !attendanceId ||
    !expectedAttendanceUpdatedAt ||
    calculation?.calculationVersion !== KM_ENGINE_VERSION ||
    !/^[0-9a-f]{64}$/.test(String(calculation?.inputDigest || ''))
  ) {
    const error = new Error('Forward final-leg persistence input is invalid.');
    error.code = 'forward_final_leg_persistence_input_invalid';
    error.statusCode = 400;
    error.retryable = false;
    throw error;
  }

  const { data, error } = await client.rpc(FORWARD_FINAL_LEG_PERSISTENCE_RPC, {
    p_attendance_id: attendanceId,
    p_input_digest: calculation.inputDigest,
    p_expected_attendance_updated_at: expectedAttendanceUpdatedAt,
    p_calculation: calculation,
    p_source_entry_point: sourceEntryPoint || 'end_day_auto_recalculation',
    p_actor_source: actorSource,
  });
  if (error) {
    const code = databaseErrorCode(error) || error.code || 'forward_final_leg_persistence_failed';
    const persistenceError = new Error(error.message || 'Forward final-leg persistence failed.');
    persistenceError.code = code;
    persistenceError.details = error.details || null;
    persistenceError.hint = error.hint || null;
    persistenceError.retryable = !DATABASE_ERROR_CODES.has(code) || code === 'forward_final_leg_stale_input';
    persistenceError.statusCode = code === 'forward_final_leg_stale_input'
      ? 409
      : DATABASE_ERROR_CODES.has(code)
        ? 422
        : 500;
    throw persistenceError;
  }
  return data;
}
