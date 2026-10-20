import {
  RELIANCE_TRAINING_CLIENT_ID,
  assertTrainingActor,
  cleanTrainingText,
  loadAuthorizedTrainingSession,
  loadTrainingCreateContext,
  normalizeTrainingKey,
  resolveTrainingReadScope,
  trainingEmployeeCode,
  trainingError,
  translateTrainingDatabaseError,
} from './trainingAccessService.js';
import { isRelianceRetailStore, isRelianceRetailValue } from './clientDeepCleaningService.js';

function nullableText(value) {
  const valueText = cleanTrainingText(value);
  return valueText || null;
}
function validDate(value, field = 'training_date') {
  const clean = cleanTrainingText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean) || Number.isNaN(Date.parse(`${clean}T00:00:00Z`))) {
    throw trainingError(400, `invalid_${field}`, `${field} must be a valid YYYY-MM-DD date.`);
  }
  return clean;
}

function boundedText(value, { required = false, max = 500, code, label }) {
  const clean = cleanTrainingText(value);
  if (required && !clean) throw trainingError(400, code, `${label} is required.`);
  if (clean.length > max) throw trainingError(400, `${code}_too_long`, `${label} must be ${max} characters or fewer.`);
  return clean || null;
}

async function rows(query) {
  const { data, error } = await query;
  if (error) throw translateTrainingDatabaseError(error);
  return data || [];
}

async function rpc(client, name, params) {
  const { data, error } = await client.rpc(name, params);
  if (error) throw translateTrainingDatabaseError(error);
  return data;
}

async function activeMaster(client, table, id, code) {
  if (!id) throw trainingError(400, `${code}_required`, `${code} is required.`);
  const { data, error } = await client.from(table).select('*').eq('id', id).eq('is_active', true).maybeSingle();
  if (error) throw error;
  if (!data) throw trainingError(404, `${code}_not_found`, `${code} was not found or is inactive.`);
  return data;
}

export async function listTrainingCategories(client, profile) {
  assertTrainingActor(profile);
  return rows(client.from('training_categories').select('*').eq('is_active', true).order('sort_order').order('name'));
}

export async function listTrainingTypes(client, profile) {
  assertTrainingActor(profile);
  return rows(client.from('training_types').select('*').eq('is_active', true).order('sort_order').order('name'));
}

export async function listTrainingTopics(client, profile, input = {}) {
  assertTrainingActor(profile);
  let categoryId = cleanTrainingText(input.category_id);
  if (!categoryId && input.category_code) {
    const { data, error } = await client.from('training_categories')
      .select('id').eq('code', cleanTrainingText(input.category_code).toLowerCase()).eq('is_active', true).maybeSingle();
    if (error) throw error;
    categoryId = data?.id || '';
  }
  if (!categoryId) throw trainingError(400, 'category_required', 'category_id or category_code is required.');
  await activeMaster(client, 'training_categories', categoryId, 'category');
  return rows(client.from('training_topics').select('*').eq('category_id', categoryId).eq('is_active', true).order('sort_order').order('module_name'));
}

export async function searchTrainingSiteStaff(client, profile, input = {}) {
  assertTrainingActor(profile);
  const storeId = cleanTrainingText(input.site_id || input.store_id);
  if (!storeId) throw trainingError(400, 'site_required', 'site_id is required.');
  const { data: store, error } = await client.from('store_master').select('*').eq('id', storeId).maybeSingle();
  if (error) throw error;
  if (!store || !isRelianceRetailStore(store)) throw trainingError(403, 'non_reliance_store', 'A Reliance Retail site is required.');
  const actorState = normalizeTrainingKey(profile.state);
  if (actorState && actorState !== normalizeTrainingKey(store.state)) {
    throw trainingError(403, 'cross_state_forbidden', 'Site is outside your state scope.');
  }
  const limit = Math.min(50, Math.max(1, Number.parseInt(input.limit, 10) || 20));
  const q = cleanTrainingText(input.q).replace(/[%_,()]/g, ' ').slice(0, 80);
  let query = client.from('profiles')
    .select('id,employee_code,username,full_name,display_name,designation,role,state,business,status,is_active')
    .eq('is_active', true)
    .limit(limit);
  if (store.state) query = query.ilike('state', cleanTrainingText(store.state));
  if (q) query = query.or(`employee_code.ilike.%${q}%,username.ilike.%${q}%,full_name.ilike.%${q}%,display_name.ilike.%${q}%`);
  const candidates = await rows(query);
  return candidates.filter((row) => isRelianceRetailValue(row.business)).map((row) => ({
    profile_id: row.id,
    employee_code: cleanTrainingText(row.employee_code || row.username),
    name: cleanTrainingText(row.full_name || row.display_name || row.employee_code || row.username),
    designation: nullableText(row.designation),
    role: nullableText(row.role),
  }));
}

function normalizeSessionInput(input = {}) {
  const remarks = boundedText(input.remarks, { max: 500, code: 'remarks', label: 'Remarks' });
  return {
    categoryId: cleanTrainingText(input.category_id),
    trainingTypeId: cleanTrainingText(input.training_type_id),
    trainingDate: validDate(input.training_date),
    trainerName: boundedText(input.trainer_name, { required: true, max: 200, code: 'trainer_name', label: 'Trainer name' }),
    remarks,
  };
}

export async function createTrainingSession(client, profile, input = {}) {
  assertTrainingActor(profile, { mutation: true });
  await loadTrainingCreateContext(client, profile, input);
  const normalized = normalizeSessionInput(input);
  await Promise.all([
    activeMaster(client, 'training_categories', normalized.categoryId, 'category'),
    activeMaster(client, 'training_types', normalized.trainingTypeId, 'training_type'),
  ]);
  const id = await rpc(client, 'rpc_create_reliance_training_session', {
    p_actor_profile_id: profile.id,
    p_attendance_id: cleanTrainingText(input.attendance_id),
    p_site_visit_id: cleanTrainingText(input.site_visit_id),
    p_category_id: normalized.categoryId,
    p_training_type_id: normalized.trainingTypeId,
    p_training_date: normalized.trainingDate,
    p_trainer_name: normalized.trainerName,
    p_remarks: normalized.remarks,
  });
  return getTrainingSession(client, profile, id);
}

export async function listTrainingSessions(client, profile, input = {}) {
  const scope = await resolveTrainingReadScope(client, profile);
  const mine = ['1', 'true', 'yes'].includes(cleanTrainingText(input.mine).toLowerCase());
  const actorCode = trainingEmployeeCode(profile);
  const codes = mine ? [actorCode] : [...scope.employeeCodes];
  if (!codes.length) return [];
  const envelopes = await rows(client.from('fo_activity_submissions')
    .select('id,employee_code,fo_user_id,created_at')
    .eq('activity_type', 'training')
    .in('employee_code', codes)
    .limit(2000));
  const envelopeById = new Map(envelopes.map((row) => [row.id, row]));
  if (!envelopeById.size) return [];
  let query = client.from('training_sessions').select('*')
    .eq('access_client_id', RELIANCE_TRAINING_CLIENT_ID)
    .in('id', [...envelopeById.keys()])
    .order('created_at', { ascending: false })
    .limit(Math.min(200, Math.max(1, Number.parseInt(input.limit, 10) || 100)));
  if (input.status) query = query.eq('status', cleanTrainingText(input.status).toLowerCase());
  if (input.date_from) query = query.gte('training_date', validDate(input.date_from, 'date_from'));
  if (input.date_to) query = query.lte('training_date', validDate(input.date_to, 'date_to'));
  if (input.category_id) query = query.eq('category_id', cleanTrainingText(input.category_id));
  if (input.store_id) query = query.eq('store_id', cleanTrainingText(input.store_id));
  const sessions = await rows(query);
  if (!sessions.length) return [];
  const ids = sessions.map((row) => row.id);
  const [categories, types, stores, attendees, topics, evidence] = await Promise.all([
    rows(client.from('training_categories').select('id,code,name').in('id', [...new Set(sessions.map((row) => row.category_id))])),
    rows(client.from('training_types').select('id,code,name').in('id', [...new Set(sessions.map((row) => row.training_type_id))])),
    rows(client.from('store_master').select('id,store_code,store_name,state').in('id', [...new Set(sessions.map((row) => row.store_id))])),
    rows(client.from('training_session_attendees').select('training_session_id').in('training_session_id', ids)),
    rows(client.from('training_session_topics').select('training_session_id').in('training_session_id', ids)),
    rows(client.from('training_evidence').select('training_session_id,metadata').in('training_session_id', ids)),
  ]);
  const lookup = (items) => new Map(items.map((row) => [row.id, row]));
  const count = (items, id) => items.filter((row) => row.training_session_id === id).length;
  const categoryById = lookup(categories);
  const typeById = lookup(types);
  const storeById = lookup(stores);
  return sessions.map((session) => ({
    id: session.id,
    status: session.status,
    training_date: session.training_date,
    category: categoryById.get(session.category_id) || null,
    training_type: typeById.get(session.training_type_id) || null,
    trainer_name: session.trainer_name_snapshot,
    store: storeById.get(session.store_id) || null,
    attendee_count: count(attendees, session.id),
    topic_count: count(topics, session.id),
    evidence_count: evidence.filter((row) => row.training_session_id === session.id && row.metadata?.upload_status === 'uploaded').length,
    submitted_at: session.submitted_at,
    created_at: session.created_at,
  }));
}

export async function getTrainingSession(client, profile, sessionId) {
  const context = await loadAuthorizedTrainingSession(client, profile, cleanTrainingText(sessionId));
  const session = context.session;
  const [categoryRows, typeRows, attendees, selectedTopics, evidence, events] = await Promise.all([
    rows(client.from('training_categories').select('*').eq('id', session.category_id)),
    rows(client.from('training_types').select('*').eq('id', session.training_type_id)),
    rows(client.from('training_session_attendees').select('*').eq('training_session_id', session.id).order('created_at')),
    rows(client.from('training_session_topics').select('*').eq('training_session_id', session.id).order('created_at')),
    rows(client.from('training_evidence').select('id,training_session_id,training_session_topic_id,evidence_type,file_name,mime_type,file_size,metadata,created_at').eq('training_session_id', session.id).order('created_at')),
    rows(client.from('training_events').select('id,event_type,actor_profile_id,metadata,created_at').eq('training_session_id', session.id).order('created_at')),
  ]);
  const topicIds = selectedTopics.map((row) => row.topic_id);
  const topics = topicIds.length ? await rows(client.from('training_topics').select('*').in('id', topicIds)) : [];
  const topicById = new Map(topics.map((row) => [row.id, row]));
  const uploadedEvidence = evidence.filter((row) => row.metadata?.upload_status === 'uploaded');
  return {
    session,
    category: categoryRows[0] || null,
    training_type: typeRows[0] || null,
    store: {
      id: context.store.id,
      store_code: context.store.store_code,
      store_name: context.store.store_name,
      state: context.store.state,
    },
    attendees,
    topics: selectedTopics.map((row) => ({ ...row, topic: topicById.get(row.topic_id) || null })),
    evidence: uploadedEvidence,
    events,
    counts: {
      attendees: attendees.length,
      topics: selectedTopics.length,
      topics_covered: selectedTopics.filter((row) => row.is_covered).length,
      evidence: uploadedEvidence.length,
    },
  };
}

export async function updateTrainingSession(client, profile, sessionId, input = {}) {
  await loadAuthorizedTrainingSession(client, profile, sessionId, { editable: true });
  const normalized = normalizeSessionInput(input);
  await Promise.all([
    activeMaster(client, 'training_categories', normalized.categoryId, 'category'),
    activeMaster(client, 'training_types', normalized.trainingTypeId, 'training_type'),
  ]);
  await rpc(client, 'rpc_update_reliance_training_draft', {
    p_session_id: sessionId,
    p_actor_profile_id: profile.id,
    p_category_id: normalized.categoryId,
    p_training_type_id: normalized.trainingTypeId,
    p_training_date: normalized.trainingDate,
    p_trainer_name: normalized.trainerName,
    p_remarks: normalized.remarks,
  });
  return getTrainingSession(client, profile, sessionId);
}

export async function addTrainingAttendee(client, profile, sessionId, input = {}) {
  await loadAuthorizedTrainingSession(client, profile, sessionId, { editable: true });
  const profileId = cleanTrainingText(input.profile_id);
  if (!profileId) throw trainingError(400, 'profile_id_required', 'profile_id is required.');
  const id = await rpc(client, 'rpc_add_reliance_training_attendee', {
    p_session_id: sessionId,
    p_actor_profile_id: profile.id,
    p_attendee_profile_id: profileId,
  });
  return (await rows(client.from('training_session_attendees').select('*').eq('id', id)))[0];
}

export async function removeTrainingAttendee(client, profile, sessionId, attendeeId) {
  await loadAuthorizedTrainingSession(client, profile, sessionId, { editable: true });
  await rpc(client, 'rpc_remove_reliance_training_attendee', {
    p_session_id: sessionId,
    p_actor_profile_id: profile.id,
    p_attendee_id: attendeeId,
  });
  return { id: attendeeId };
}

export async function setTrainingTopics(client, profile, sessionId, input = {}) {
  await loadAuthorizedTrainingSession(client, profile, sessionId, { editable: true });
  if (!Array.isArray(input.topic_ids)) throw trainingError(400, 'topic_ids_required', 'topic_ids must be an array.');
  const topicIds = input.topic_ids.map(cleanTrainingText);
  if (topicIds.some((id) => !id)) throw trainingError(400, 'invalid_topic_id', 'Topic IDs cannot be blank.');
  const count = await rpc(client, 'rpc_set_reliance_training_topics', {
    p_session_id: sessionId,
    p_actor_profile_id: profile.id,
    p_topic_ids: topicIds,
  });
  return { count };
}

export async function updateTrainingTopic(client, profile, sessionId, sessionTopicId, input = {}) {
  await loadAuthorizedTrainingSession(client, profile, sessionId, { editable: true });
  if (typeof input.is_covered !== 'boolean') throw trainingError(400, 'is_covered_required', 'is_covered must be boolean.');
  const remarks = boundedText(input.remarks, { max: 1000, code: 'topic_remarks', label: 'Topic remarks' });
  await rpc(client, 'rpc_update_reliance_training_topic', {
    p_session_id: sessionId,
    p_actor_profile_id: profile.id,
    p_session_topic_id: sessionTopicId,
    p_is_covered: input.is_covered,
    p_remarks: remarks,
  });
  return (await rows(client.from('training_session_topics').select('*').eq('id', sessionTopicId)))[0];
}

export async function submitTrainingSession(client, profile, sessionId, { verifyEvidenceObjects } = {}) {
  await loadAuthorizedTrainingSession(client, profile, sessionId, { editable: true });
  if (verifyEvidenceObjects) await verifyEvidenceObjects(client, profile, sessionId);
  await rpc(client, 'rpc_submit_reliance_training_session', {
    p_session_id: sessionId,
    p_actor_profile_id: profile.id,
  });
  return getTrainingSession(client, profile, sessionId);
}

export async function cancelTrainingSession(client, profile, sessionId) {
  await loadAuthorizedTrainingSession(client, profile, sessionId, { editable: true });
  await rpc(client, 'rpc_cancel_reliance_training_session', {
    p_session_id: sessionId,
    p_actor_profile_id: profile.id,
  });
  return getTrainingSession(client, profile, sessionId);
}
