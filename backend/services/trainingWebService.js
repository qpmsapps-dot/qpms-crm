import { trainingRpc } from './trainingEntitlementService.js';
import { trainingError } from './trainingAccessService.js';

// The database release gate is authoritative; there is no client activation flag.
export async function createWebTrainingSession(client, profile, input = {}) {
  const allowed = ['retail_store_id', 'training_date', 'training_type_id', 'actual_trainer_profile_id', 'creation_key', 'remarks'];
  if (Object.keys(input).some(k => !allowed.includes(k)) || typeof input.creation_key !== 'string'
      || !input.creation_key.trim() || input.creation_key.length > 160
      || !/^\d{4}-\d{2}-\d{2}$/.test(input.training_date || '')
      || Number.isNaN(Date.parse(input.training_date + 'T00:00:00Z'))
      || new Date(input.training_date + 'T00:00:00Z').toISOString().slice(0, 10) !== input.training_date) {
    throw trainingError(400, 'training_web_invalid_request', 'A valid conducted date, store, trainer and creation key are required.');
  }
  const id = await trainingRpc(client, 'rpc_create_reliance_training_web_v2', {
    p_actor: profile.id, p_store: input.retail_store_id, p_date: input.training_date,
    p_type: input.training_type_id, p_trainer: input.actual_trainer_profile_id,
    p_key: input.creation_key, p_remarks: input.remarks || null,
  });
  const duplicateCandidates = await trainingRpc(client, 'rpc_training_v2_duplicate_candidates', {
    p_actor: profile.id, p_store: input.retail_store_id, p_date: input.training_date,
  });
  return { id, duplicate_candidates: (duplicateCandidates || []).filter(s => s.id !== id) };
}
