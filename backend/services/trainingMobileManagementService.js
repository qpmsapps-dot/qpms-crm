import {assertTrainingActor, canonicalTrainingRole, trainingError} from './trainingAccessService.js';
import {loadWebTrainingSetup} from './trainingWebService.js';
import {trainingRpc} from './trainingEntitlementService.js';

export function assertMobileManagementActor(profile) {
  assertTrainingActor(profile);
  if (profile.mobile_access_enabled !== true || profile.web_access_enabled !== true ||
      !['MISMEPC', 'OPERATIONSMANAGER'].includes(canonicalTrainingRole(profile.role))) {
    throw trainingError(403, 'training_mobile_management_forbidden', 'Mobile management Training is not authorized.');
  }
}
export function todayInIndia(now = new Date()) {
  return new Date(now.getTime() + 330 * 60000).toISOString().slice(0, 10);
}
function assertToday(date) {
  if (date !== todayInIndia()) throw trainingError(400, 'training_mobile_date_not_allowed', 'Training must be conducted today (IST).');
}
export async function loadMobileManagementSetup(client, profile, input = {}) {
  assertMobileManagementActor(profile);
  assertToday(input.training_date);
  const setup = await loadWebTrainingSetup(client, profile, input);
  await trainingRpc(client, 'rpc_training_mobile_management_setup_allowed_v3', {
    p_actor:profile.id, p_store:setup.store.id, p_date:input.training_date,
  });
  return setup;
}
export async function createMobileManagementSession(client, profile, input = {}) {
  assertMobileManagementActor(profile);
  const allowed = ['retail_store_id', 'training_date', 'training_type_id', 'actual_trainer_profile_id', 'creation_key', 'remarks'];
  if (Object.keys(input).some(k => !allowed.includes(k)) ||
      typeof input.creation_key !== 'string' || !input.creation_key.trim() || input.creation_key.length > 160) {
    throw trainingError(400, 'training_mobile_invalid_request', 'A valid management Training request is required.');
  }
  assertToday(input.training_date);
  const id = await trainingRpc(client, 'rpc_create_reliance_training_mobile_management_v3', {
    p_actor:profile.id, p_store:input.retail_store_id, p_date:input.training_date,
    p_type:input.training_type_id, p_trainer:input.actual_trainer_profile_id,
    p_key:input.creation_key, p_remarks:input.remarks || null,
  });
  const candidates = await trainingRpc(client, 'rpc_training_v2_duplicate_candidates', {
    p_actor:profile.id, p_store:input.retail_store_id, p_date:input.training_date,
  });
  return {id, submission_channel:'Mobile Management', duplicate_candidates:(candidates || []).filter(s => s.id !== id)};
}
