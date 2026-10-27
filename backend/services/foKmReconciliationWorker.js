import { reconcileSupportedKm, sharedKmReconciliationEnabled, kmReconciliationDependencyError } from './foKmIncrementalReconciliationService.js';

// Database outbox is written in the attendance/GPS transaction. A worker never
// reports posting merely because attendance closure or evidence calculation succeeded.
export async function processKmReconciliationJobs(client, { environment = process.env, limit = 10, reconcile = reconcileSupportedKm } = {}) {
  if (!sharedKmReconciliationEnabled(environment) || environment.END_DAY_KM_AUTO_RECALC_ENABLED !== 'true') return { disabled: true, processed: 0 };
  const policy = environment.KM_CANONICAL_POLICY_ENABLED === 'true';
  const automatic = environment.KM_CANONICAL_AUTOMATION_ENABLED === 'true';
  if (!policy) return { disabled: true, processed: 0, code: 'KM_ATTENDANCE_AUTHORIZATION_REQUIRED' };
  // Do not claim/mutate the outbox when an explicit policy shutdown is active.
  if (!automatic && String(environment.KM_FINANCIAL_WRITES_EMERGENCY_PAUSE).toLowerCase() !== 'false') return { disabled: true, processed: 0, code: 'KM_FINANCIAL_WRITES_MAINTENANCE' };
  const version = await client.rpc(automatic ? 'rpc_fo_km_automatic_authorization_version_v1' : 'rpc_fo_km_attendance_authorization_version_v1');
  if (version.error) throw kmReconciliationDependencyError(version.error);
  if (version.data !== (automatic ? 247 : 246)) throw Object.assign(new Error('Compatible database authorization is required before claiming any KM job.'), {code:'KM_ATTENDANCE_AUTHORIZATION_REQUIRED',retryable:true});
  const results = [];
  for (let i = 0; i < Math.min(limit, 50); i++) {
    const { data: job, error } = await client.rpc(automatic ? 'rpc_claim_fo_automatic_km_v1' : 'rpc_claim_fo_policy_km_v1');
    if (error) throw kmReconciliationDependencyError(error);
    if (!job) break;
    if (job.authorization_version !== (automatic ? 247 : 246) || !/^[A-Z0-9_-]{8,100}$/.test(job.authorization_reference || '') ||
        !Number.isInteger(job.generation) || job.generation < 1 || job.claimed_generation !== job.generation) {
      throw Object.assign(new Error('Database returned a job without current attendance authorization.'), {code:'KM_ATTENDANCE_AUTHORIZATION_REQUIRED',retryable:true});
    }
    let result;
    try {
      const held=(automatic ? environment.KM_CANONICAL_AUTOMATION_ENABLED!=='true' : String(environment.KM_FINANCIAL_WRITES_EMERGENCY_PAUSE).toLowerCase()!=='false')||environment.KM_CANONICAL_POLICY_ENABLED!=='true';
      result = held ? {status:'deferred',code:'KM_FINANCIAL_WRITES_MAINTENANCE',financial_posted:false} : await reconcile(client, { attendance_id: job.attendance_id }, { environment, persist: true, trigger: job.trigger_source, actorSource: job.lease,automaticKm:automatic,deadlineAt:Date.now()+20000,maxGoogleDirectionsCalls:0 });
    } catch (error) { result = { status: 'deferred', code: error.code || 'km_reconciliation_failed', message:error.message, financial_posted: false }; }
    const done = result.financial_posted === true || ['unchanged','partial_unresolved'].includes(result.status);
    const finished = await client.rpc('rpc_finish_fo_km_reconciliation_v1', {
      p_attendance: job.attendance_id, p_lease: job.lease, p_posted: done,
      p_error: !result.financial_posted && done ? (automatic ? result.status : 'unchanged') : done ? null : result.code || result.status,
    });
    if (finished.error) throw kmReconciliationDependencyError(finished.error);
    results.push({ attendance_id: job.attendance_id, ...result });
  }
  return { processed: results.length, results };
}
