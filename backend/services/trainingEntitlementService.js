import { RETAIL_MIS_ASSIGNMENT_ADMIN } from '../shared/retailMisAccess.js';
import { trainingError, translateTrainingDatabaseError } from './trainingAccessService.js';

export function assertTrainingEntitlementAdmin(profile) {
  const a = RETAIL_MIS_ASSIGNMENT_ADMIN;
  if (!profile || profile.id !== a.profile_id || profile.auth_user_id !== a.auth_user_id
      || profile.employee_code !== a.employee_code || !['Admin', 'QPMS Admin'].includes(profile.role)
      || profile.is_active !== true || String(profile.status).toUpperCase() !== 'ACTIVE'
      || profile.web_access_enabled !== true) {
    throw trainingError(403, 'training_entitlement_admin_required', 'Super Admin access is required.');
  }
}
export async function trainingRpc(client, name, args) {
  const { data, error } = await client.rpc(name, args);
  if (error) throw translateTrainingDatabaseError(error);
  return data;
}
export async function readTrainingEntitlements(client, profile, target) {
  assertTrainingEntitlementAdmin(profile);
  return trainingRpc(client, 'rpc_training_category_entitlements', { p_actor: profile.id, p_target: target });
}
export async function saveTrainingEntitlements(client, profile, target, input = {}) {
  assertTrainingEntitlementAdmin(profile);
  if (Object.keys(input).some(k => !['changes', 'reason'].includes(k))
      || typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 500
      || !Array.isArray(input.changes) || input.changes.length < 1 || input.changes.length > 2
      || new Set(input.changes.map(c => c.code)).size !== input.changes.length
      || input.changes.some(c => !['hk', 'technical_mep'].includes(c.code)
        || typeof c.active !== 'boolean' || !Number.isSafeInteger(c.expected_revision) || c.expected_revision < 0
        || Object.keys(c).some(k => !['code', 'active', 'expected_revision', 'effective_from', 'effective_to'].includes(k)))) {
    throw trainingError(400, 'training_entitlement_invalid_request', 'Valid categories, revisions and a change reason are required.');
  }
  return trainingRpc(client, 'rpc_set_training_category_entitlements', {
    p_actor: profile.id, p_target: target, p_changes: input.changes, p_reason: input.reason.trim(),
  });
}
