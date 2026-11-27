import { trainingRpc } from './trainingEntitlementService.js';
import { trainingError, assertTrainingActor, canonicalTrainingRole } from './trainingAccessService.js';

// Exact-code lookup, scoped by the same authoritative DB contract as creation.
// No FO attendance/visit context is manufactured for Web reports.
export async function loadWebTrainingSetup(client, profile, input = {}) {
  assertTrainingActor(profile);
  if (profile.web_access_enabled !== true ||
      !['MISMEPC', 'OPERATIONSMANAGER', 'ADMIN', 'QPMSADMIN'].includes(canonicalTrainingRole(profile.role))) {
    throw trainingError(403, 'training_web_scope_forbidden', 'Web Training upload is not authorized.');
  }
  const storeCode = String(input.store_code || '').trim();
  const trainerCode = String(input.trainer_employee_code || '').trim();
  const date = input.training_date;
  if (Object.keys(input).some(k => !['store_code', 'trainer_employee_code', 'training_date'].includes(k)) ||
      !storeCode || storeCode.length > 80 || !trainerCode || trainerCode.length > 80 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date || '') ||
      Number.isNaN(Date.parse(date + 'T00:00:00Z')) ||
      new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date) {
    throw trainingError(400, 'training_web_invalid_request', 'Enter an exact store code, trainer employee code and conducted date.');
  }
  const {data: store, error: storeError} = await client.from('reliance_retail_store_master')
    .select('id,store_code,store_name,state').eq('store_code', storeCode).eq('status', 'Active').maybeSingle();
  if (storeError) throw storeError;
  if (!store) throw trainingError(403, 'training_web_scope_forbidden', 'An authorized active store is required.');
  await trainingRpc(client, 'training_v2_assert_web', {p_actor:profile.id, p_store:store.id, p_date:date});
  const {data: trainer, error: trainerError} = await client.from('profiles')
    .select('id,employee_code,full_name').eq('employee_code', trainerCode).eq('is_active', true).maybeSingle();
  if (trainerError) throw trainerError;
  if (!trainer || await trainingRpc(client, 'training_retail_actor_v4', {p_actor_profile_id:trainer.id}) !== true) {
    throw trainingError(400, 'training_actual_trainer_invalid', 'Select an active Reliance Retail trainer.');
  }
  const {data: category, error: categoryError} = await client.from('training_categories')
    .select('id,code,name').eq('code', 'technical_mep').eq('is_active', true).maybeSingle();
  if (categoryError) throw categoryError;
  if (!category) throw trainingError(503, 'training_master_inactive', 'MEPC Training is unavailable.');
  const [{data:types,error:typeError},{data:topics,error:topicError}] = await Promise.all([
    client.from('training_types').select('id,name').eq('is_active', true).order('sort_order'),
    client.from('training_topics').select('id,module_name').eq('category_id', category.id).eq('is_active', true).order('sort_order'),
  ]);
  if (typeError || topicError) throw typeError || topicError;
  return {store, trainer, category, types, topics, training_date:date};
}

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
