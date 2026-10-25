import { reconcileSupportedKm, sharedKmReconciliationEnabled, kmReconciliationDependencyError } from './foKmIncrementalReconciliationService.js';

// Database outbox is written in the attendance/GPS transaction. A worker never
// reports posting merely because attendance closure or evidence calculation succeeded.
export async function processKmReconciliationJobs(client, { environment = process.env, limit = 10, reconcile = reconcileSupportedKm } = {}) {
  if (!sharedKmReconciliationEnabled(environment) || environment.END_DAY_KM_AUTO_RECALC_ENABLED !== 'true') return { disabled: true, processed: 0 };
  const policy = environment.KM_CANONICAL_POLICY_ENABLED === 'true';
  // Do not claim/mutate the outbox when an explicit policy shutdown is active.
  if (policy && String(environment.KM_FINANCIAL_WRITES_EMERGENCY_PAUSE).toLowerCase() !== 'false') return { disabled: true, processed: 0, code: 'KM_FINANCIAL_WRITES_MAINTENANCE' };
  const results = [];
  for (let i = 0; i < Math.min(limit, 50); i++) {
    const { data: job, error } = await client.rpc(policy ? 'rpc_claim_fo_policy_km_v1' : 'rpc_claim_fo_km_reconciliation_v1');
    if (error) throw kmReconciliationDependencyError(error);
    if (!job) break;
    let result;
    try {
      const held=String(environment.KM_FINANCIAL_WRITES_EMERGENCY_PAUSE).toLowerCase()==='true'||(!policy && String(environment.KM_FINANCIAL_WRITES_MAINTENANCE).toLowerCase()==='true');
      result = held ? {status:'deferred',code:'KM_FINANCIAL_WRITES_MAINTENANCE',financial_posted:false} : await reconcile(client, { attendance_id: job.attendance_id }, { environment, persist: true, trigger: job.trigger_source, actorSource: job.lease,deadlineAt:Date.now()+20000,maxGoogleDirectionsCalls:6 });
    } catch (error) { result = { status: 'deferred', code: error.code || 'km_reconciliation_failed', financial_posted: false }; }
    const done = result.financial_posted === true || ['unchanged','partial_unresolved'].includes(result.status);
    const finished = await client.rpc('rpc_finish_fo_km_reconciliation_v1', {
      p_attendance: job.attendance_id, p_lease: job.lease, p_posted: done,
      p_error: !result.financial_posted && done ? 'unchanged' : done ? null : result.code || result.status,
    });
    if (finished.error) throw kmReconciliationDependencyError(finished.error);
    results.push({ attendance_id: job.attendance_id, ...result });
  }
  return { processed: results.length, results };
}
