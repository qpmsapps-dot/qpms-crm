import { isRelianceRetailValue } from './clientDeepCleaningService.js';
import { foOperationalAllowedEmployeeCodes } from './foOperationalAccessService.js';
import { retailFoStateAllows } from './retailFoStoreScope.js';
import { isRetailHkTrainingReader, resolveRetailHkTrainingScope, resolveRetailLeadershipTrainingScope, retailTrainingFoCodes, retailTrainingFoProfiles } from './retailTrainingReadScopeService.js';

export const RELIANCE_TRAINING_CLIENT_ID = '369d2d5f-396f-49f9-a47d-bfbc8f7cb922';
export const RELIANCE_TRAINING_CLIENT_CODE = 'reliance_retail';
export const TRAINING_CREATE_ROLES = new Set(['FO']);

export class TrainingError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = 'TrainingError';
    this.statusCode = statusCode;
    this.code = code;
  }
}
export function trainingError(statusCode, code, message) {
  return new TrainingError(statusCode, code, message);
}

export function cleanTrainingText(value) {
  return String(value ?? '').trim();
}

export function normalizeTrainingKey(value) {
  return cleanTrainingText(value).toUpperCase().replace(/[^A-Z0-9]+/g, '');
}

export function canonicalTrainingRole(value) {
  const role = normalizeTrainingKey(value);
  return ({FIELDOFFICER:'FO',KEYACCOUNTMANAGER:'KAM',OM:'OPERATIONSMANAGER',OPERATIONMANAGER:'OPERATIONSMANAGER',OPSMANAGER:'OPERATIONSMANAGER',BH:'BRANCHHEAD'})[role] || role;
}

export function trainingEmployeeCode(profile = {}) {
  return cleanTrainingText(profile.employee_code || profile.username).toUpperCase();
}

export function isActiveTrainingProfile(profile) {
  if (!profile || profile.is_active === false) return false;
  const status = normalizeTrainingKey(profile.status || 'ACTIVE');
  return !status || status === 'ACTIVE';
}

export function assertTrainingActor(profile, { mutation = false } = {}) {
  if (!profile) throw trainingError(401, 'unauthenticated', 'Authentication is required.');
  if (!isActiveTrainingProfile(profile)) {
    throw trainingError(403, 'inactive_profile', 'An active profile is required.');
  }
  const canonicalRole = canonicalTrainingRole(profile.role);
  if (mutation && !TRAINING_CREATE_ROLES.has(canonicalRole)) {
    throw trainingError(403, 'forbidden_role', 'This role cannot change structured Training.');
  }
  if (mutation && !isRelianceRetailValue(profile.business) && !profile.trainingRetailVerified) {
    throw trainingError(403, 'forbidden_business', 'Reliance Retail authorization is required.');
  }
  if (!profile.id || !trainingEmployeeCode(profile)) {
    throw trainingError(403, 'profile_incomplete', 'Authenticated profile identity is incomplete.');
  }
  return profile;
}

function dbErrorMessage(error) {
  return cleanTrainingText(error?.message || error?.details || error?.code);
}

export function translateTrainingDatabaseError(error) {
  if (error instanceof TrainingError) return error;
  const message = dbErrorMessage(error);
  const code = cleanTrainingText(error?.code);
  const known = {
    training_category_forbidden: [403, 'category_forbidden', 'Your role cannot initiate or submit this Training category.'],
    training_creation_key_conflict: [409, 'creation_key_conflict', 'This creation identity belongs to a different draft.'],
    training_attendance_not_active: [409, 'attendance_not_active', 'Start Day and an active Check-In are required.'],
    training_site_visit_not_active: [409, 'site_visit_not_active', 'This visit has ended. Training is read-only.'],
    training_visit_not_active: [409, 'site_visit_not_active', 'This visit has ended. Training is read-only.'],
    training_store_scope_forbidden: [403, 'store_scope_forbidden', 'Select an active Training store in your authorized state and zone.'],
    training_session_not_found: [404, 'session_not_found', 'Training session was not found.'],
    training_attendance_not_found: [404, 'attendance_not_found', 'Attendance was not found.'],
    training_site_visit_not_found: [404, 'site_visit_not_found', 'Site visit was not found.'],
    training_store_not_found: [404, 'store_not_found', 'Store was not found.'],
    training_category_not_found: [404, 'category_not_found', 'Training category was not found.'],
    training_type_not_found: [404, 'training_type_not_found', 'Training type was not found.'],
    training_attendee_not_found: [404, 'attendee_not_found', 'Training attendee was not found.'],
    training_session_topic_not_found: [404, 'session_topic_not_found', 'Selected training topic was not found.'],
    training_evidence_not_found: [404, 'evidence_not_found', 'Training evidence was not found.'],
    training_session_immutable: [409, 'session_immutable', 'Submitted or cancelled Training sessions cannot be changed.'],
    training_not_session_creator: [403, 'not_session_creator', 'Only the session creator may change this draft.'],
    training_create_role_forbidden: [403, 'forbidden_role', 'This role cannot create structured Training.'],
    training_mutation_forbidden: [403, 'forbidden_role', 'This profile cannot change structured Training.'],
    training_actor_business_forbidden: [403, 'forbidden_business', 'Reliance Retail authorization is required.'],
    training_attendance_forbidden: [403, 'attendance_forbidden', 'Attendance is outside your authorized scope.'],
    training_site_visit_forbidden: [403, 'site_visit_forbidden', 'Site visit is outside your authorized scope.'],
    training_cross_state_forbidden: [403, 'cross_state_forbidden', 'Cross-state Training access is not allowed.'],
    training_non_reliance_store: [403, 'non_reliance_store', 'Structured Training is available only for Reliance Retail sites.'],
    training_duplicate_topic_ids: [409, 'duplicate_topics', 'Duplicate topic IDs are not allowed.'],
    training_topic_category_mismatch: [400, 'topic_category_mismatch', 'All selected topics must belong to the session category.'],
    training_topic_has_evidence: [409, 'topic_has_evidence', 'A topic with evidence cannot be removed.'],
    training_category_change_has_topics: [409, 'category_change_has_topics', 'Remove selected topics before changing category.'],
    training_evidence_upload_incomplete: [409, 'evidence_upload_incomplete', 'All evidence uploads must complete before submission.'],
    training_attendee_required: [400, 'attendee_required', 'At least one attendee is required.'],
    training_topic_required: [400, 'topic_required', 'At least one topic is required.'],
    training_topic_evidence_required: [400, 'topic_evidence_required', 'Each selected topic requires evidence.'],
    training_topic_evidence_at_least_one: [400, 'topic_evidence_required', 'At least one selected topic requires evidence.'],
    training_group_photo_required: [400, 'group_photo_required', 'A group photo is required.'],
    training_attendance_sheet_required: [400, 'attendance_sheet_required', 'An attendance sheet is required.'],
    training_document_required: [400, 'training_document_required', 'A training document is required.'],
  };
  for (const [needle, mapped] of Object.entries(known)) {
    if (message.includes(needle)) return trainingError(...mapped);
  }
  if (code === 'PGRST202' || code === '42883') return trainingError(503, 'training_contract_unavailable', 'The Training database contract is unavailable. Contact your administrator before retrying.');
  if (code === '23505') return trainingError(409, 'duplicate_record', 'This Training record already exists.');
  if (code === '42501') return trainingError(403, 'forbidden', 'Training access is not allowed.');
  if (code === 'P0002') return trainingError(404, 'not_found', 'Training resource was not found.');
  if (code === '40001') return trainingError(409, 'training_conflict', 'Training changed. Refresh before retrying.');
  if (['22003','22007','22008','22P02','23514'].includes(code)) return trainingError(400,'training_invalid_request','Training fields or validity are invalid.');
  if (code === '22023') return trainingError(400, 'validation_error', 'Training request validation failed.');
  return error;
}

export function safeTrainingError(response, rawError) {
  const error = translateTrainingDatabaseError(rawError);
  const status = Number(error?.statusCode || 500);
  response.status(status).json({
    ok: false,
    code: error?.code || (status >= 500 ? 'training_internal_error' : 'training_request_failed'),
    message: status >= 500 ? 'Training request failed.' : error.message,
  });
}

async function one(query, fallbackCode, fallbackMessage) {
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) throw trainingError(404, fallbackCode, fallbackMessage);
  return data;
}

function employeeMatches(profile, record) {
  const actor = trainingEmployeeCode(profile);
  return [record?.employee_code, record?.fo_user_id, record?.username]
    .map((value) => cleanTrainingText(value).toUpperCase())
    .filter(Boolean)
    .includes(actor);
}

export async function loadTrainingCreateContext(client, profile, input = {}) {
  profile = await resolveTrainingMutationProfile(client, profile);
  assertTrainingActor(profile, { mutation: true });
  const attendanceId = cleanTrainingText(input.attendance_id);
  const siteVisitId = cleanTrainingText(input.site_visit_id);
  if (!attendanceId || !siteVisitId) {
    throw trainingError(400, 'attendance_context_required', 'Attendance and site visit are required.');
  }
  const attendance = await one(
    client.from('fo_attendance').select('*').eq('id', attendanceId),
    'attendance_not_found',
    'Attendance was not found.',
  );
  if (!employeeMatches(profile, attendance)) {
    throw trainingError(403, 'attendance_forbidden', 'Attendance is outside your authorized scope.');
  }
  if (attendance.logout_time || normalizeTrainingKey(attendance.status) !== 'ACTIVE') {
    throw trainingError(409, 'attendance_not_active', 'A current active attendance is required.');
  }
  const visit = await one(
    client.from('fo_site_visits').select('*').eq('id', siteVisitId),
    'site_visit_not_found',
    'Site visit was not found.',
  );
  if (visit.attendance_id !== attendance.id) {
    throw trainingError(400, 'visit_attendance_mismatch', 'Site visit does not belong to the selected attendance.');
  }
  if (!employeeMatches(profile, visit)) {
    throw trainingError(403, 'site_visit_forbidden', 'Site visit is outside your authorized scope.');
  }
  if (!visit.check_in_time || visit.check_out_time || visit.checkout_time) {
    throw trainingError(409, 'site_visit_not_active', 'A current checked-in site visit is required.');
  }
  return { attendance, visit };
}

async function loadScopeRows(client) {
  const [{ data: profiles, error: profileError }, { data: hierarchy, error: hierarchyError }] = await Promise.all([
    client.from('profiles').select('*').eq('is_active', true).limit(5000),
    client.from('employee_hierarchy').select('*').eq('is_active', true).limit(5000),
  ]);
  if (profileError) throw profileError;
  if (hierarchyError) throw hierarchyError;
  return { profiles: profiles || [], hierarchy: hierarchy || [] };
}

export async function resolveTrainingReadScope(client, profile) {
  assertTrainingActor(profile);
  const retailScope = await resolveRetailLeadershipTrainingScope(client,profile)
    || await resolveRetailHkTrainingScope(client, profile);
  if (retailScope) {
    const profiles = await retailTrainingFoProfiles(client);
    return { profiles, hierarchy: [], retailScope, employeeCodes: new Set(retailTrainingFoCodes(profiles)) };
  }
  const { profiles, hierarchy } = await loadScopeRows(client);
  const codes = foOperationalAllowedEmployeeCodes(profile, profiles, hierarchy);
  const selfCode = trainingEmployeeCode(profile);
  if (selfCode) codes.add(selfCode);
  return { profiles, hierarchy, employeeCodes: codes };
}

export async function loadAuthorizedTrainingSession(client, profile, sessionId, { editable = false } = {}) {
  assertTrainingActor(profile);
  const legacyHkScope = isRetailHkTrainingReader(profile) ? await resolveRetailHkTrainingScope(client,profile) : null;
  const allowed = await client.rpc('rpc_training_v2_read_allowed', {p_actor: profile.id, p_session: sessionId});
  if (allowed.error) throw translateTrainingDatabaseError(allowed.error);
  if (allowed.data !== true) throw trainingError(403, 'session_read_forbidden', 'Training session is outside your authorized scope.');
  if (editable) {
    const edit = await client.rpc('training_assert_draft_editor', {p_session_id: sessionId, p_actor_profile_id: profile.id});
    if (edit.error) throw translateTrainingDatabaseError(edit.error);
  }
  const session = await one(client.from('training_sessions').select('*').eq('id',sessionId),'session_not_found','Training session was not found.');
  const envelope = await one(client.from('fo_activity_submissions').select('*').eq('id',sessionId).eq('activity_type','training'),'session_not_found','Training envelope was not found.');
  const store = await one(client.from(session.retail_store_id ? 'reliance_retail_store_master' : 'store_master').select('*').eq('id',session.retail_store_id || session.store_id),'store_not_found','Training store was not found.');
  if (legacyHkScope && !legacyHkScope.stores.some(s=>s.id===session.retail_store_id || (!session.retail_store_id && s.store_code===store.store_code && retailFoStateAllows(s.state,store.state)))) throw trainingError(403,'training_scope_unverified','Training store is outside the verified HK scope.');
  return {session,envelope,store};
}

// Only server-loaded assignments may supplement the authenticated profile business.
export async function resolveTrainingMutationProfile(client, profile) {
  assertTrainingActor(profile);
  if (isRelianceRetailValue(profile.business)) return loadTrainingEntitlements(client, profile);
  const {data, error} = await client.from('access_user_assignments').select('*,access_roles!inner(code,active)')
    .eq('profile_id', profile.id).eq('auth_user_id', profile.auth_user_id)
    .eq('client_id', RELIANCE_TRAINING_CLIENT_ID).eq('active', true).eq('verification_status', 'verified');
  if (error) throw error;
  const now = Date.now();
  const verified = (data || []).some(a => a.access_roles?.active === true
    && canonicalTrainingRole(a.access_roles.code) === canonicalTrainingRole(profile.role)
    && a.effective_from && Date.parse(a.effective_from) <= now
    && (!a.effective_to || Date.parse(a.effective_to) > now));
  return loadTrainingEntitlements(client, {...profile, trainingRetailVerified: verified});
}
async function loadTrainingEntitlements(client, profile) {
  const {data, error} = await client.from('training_categories').select('id,code').eq('is_active',true);
  if (error) throw error;
  const trainingCategories = [];
  for (const c of data || []) {
    const grant = await client.rpc('training_category_allowed_v4', {p_actor_profile_id:profile.id,p_category_id:c.id});
    if (grant.error) throw translateTrainingDatabaseError(grant.error);
    if (grant.data === true) trainingCategories.push(c.code);
  }
  return {...profile,trainingCategories};
}
export function assertTrainingCategory(profile, categoryCode) {
  assertTrainingActor(profile, {mutation:true});
  if (!profile.trainingCategories?.includes(categoryCode)) throw trainingError(403,'category_forbidden','An active individual Training category entitlement is required.');
}
