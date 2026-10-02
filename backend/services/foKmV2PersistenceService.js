import { KM_ENGINE_VERSION } from './foCanonicalKmEngineV2.js';

export const KM_V2_PERSISTENCE_RPC = 'rpc_persist_fo_canonical_km_v2';

export async function persistCanonicalKmV2(client, {
  attendanceId,
  expectedAttendanceUpdatedAt,
  calculation,
  sourceEntryPoint,
  actorSource = null,
}) {
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

  const { data, error } = await client.rpc(KM_V2_PERSISTENCE_RPC, {
    p_attendance_id: attendanceId,
    p_input_digest: calculation.inputDigest,
    p_expected_attendance_updated_at: expectedAttendanceUpdatedAt,
    p_calculation: calculation,
    p_source_entry_point: sourceEntryPoint || 'backend_recalculation',
    p_actor_source: actorSource,
  });
  if (error) {
    const persistenceError = new Error(error.message || 'Canonical KM V2 persistence failed.');
    persistenceError.code = error.code || 'km_v2_persistence_failed';
    persistenceError.details = error.details || null;
    persistenceError.hint = error.hint || null;
    persistenceError.statusCode = error.code === '40001' ? 409 : 500;
    throw persistenceError;
  }
  return data;
}
