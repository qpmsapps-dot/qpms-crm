const MOM_MUTATION_ROLES = new Set(['FO', 'FIELDOFFICER', 'ADMIN']);
const MOM_PRIORITIES = new Set(['Low', 'Medium', 'High', 'Critical']);
const MOM_ACTION_STATUSES = new Set(['Open', 'In Progress', 'Completed', 'Verified', 'Closed']);
const MOM_DESIGNATIONS = new Set(['Director', 'RMO', 'Dean', 'Medical Superintendent', 'Administrator', 'Other']);
const MOM_FOLLOW_UP_MODES = new Set(['Physical Visit', 'Call', 'Email', 'Other']);

export class MomError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = 'MomError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export const momError = (statusCode, code, message) => new MomError(statusCode, code, message);
export const cleanMomText = (value) => String(value ?? '').trim();
export const normalizeMomKey = (value) => cleanMomText(value).toUpperCase().replace(/[^A-Z0-9]+/g, '');

function employeeCode(profile = {}) {
  return cleanMomText(profile.employee_code || profile.username).toUpperCase();
}

function recordBelongsTo(profile, record = {}) {
  const actor = employeeCode(profile);
  return [record.employee_code, record.fo_user_id, record.username]
    .map((value) => cleanMomText(value).toUpperCase())
    .filter(Boolean)
    .includes(actor);
}

export function assertMomActor(profile, { mutation = false } = {}) {
  if (!profile) throw momError(401, 'unauthenticated', 'Authentication is required.');
  const active = profile.is_active !== false && !['INACTIVE', 'DISABLED'].includes(normalizeMomKey(profile.status));
  if (!active) throw momError(403, 'inactive_profile', 'An active user is required.');
  const role = normalizeMomKey(profile.role);
  if (mutation && !MOM_MUTATION_ROLES.has(role)) {
    throw momError(403, 'forbidden_role', 'This role cannot change Minutes of Meeting.');
  }
  if (!profile.id || !employeeCode(profile)) {
    throw momError(403, 'profile_incomplete', 'Authenticated profile identity is incomplete.');
  }
  return profile;
}

export function validateMomPayload(input = {}, { submit = false } = {}) {
  const discussionPoints = Array.isArray(input.discussion_points) ? input.discussion_points : [];
  const actionItems = Array.isArray(input.action_items) ? input.action_items : [];
  for (const point of discussionPoints) {
    const priority = cleanMomText(point?.priority || 'Medium');
    if (!MOM_PRIORITIES.has(priority)) throw momError(400, 'priority_invalid', 'Discussion priority is invalid.');
  }
  for (const action of actionItems) {
    const status = cleanMomText(action?.status || 'Open');
    if (!MOM_ACTION_STATUSES.has(status)) throw momError(400, 'action_status_invalid', 'Action status is invalid.');
  }
  if (!submit) return;
  if (!cleanMomText(input.meeting_with)) throw momError(400, 'meeting_with_required', 'Meeting With is required.');
  const designation = cleanMomText(input.meeting_designation);
  if (!MOM_DESIGNATIONS.has(designation)) throw momError(400, 'meeting_designation_required', 'Select a valid meeting designation.');
  if (designation === 'Other' && !cleanMomText(input.meeting_designation_other)) {
    throw momError(400, 'meeting_designation_other_required', 'Enter the other designation.');
  }
  if (!discussionPoints.some((point) => cleanMomText(point?.observation_issue))) {
    throw momError(400, 'discussion_required', 'Add at least one discussion point.');
  }
  if (actionItems.some((action) => !cleanMomText(action?.issue_observation) || !cleanMomText(action?.corrective_action))) {
    throw momError(400, 'action_incomplete', 'Complete or remove incomplete action items.');
  }
  if (input.follow_up_required === true) {
    if (!cleanMomText(input.follow_up_date)) throw momError(400, 'follow_up_date_required', 'Select the next review date.');
    const mode = cleanMomText(input.follow_up_mode);
    if (!MOM_FOLLOW_UP_MODES.has(mode)) throw momError(400, 'follow_up_mode_required', 'Select a valid follow-up mode.');
    if (mode === 'Other' && !cleanMomText(input.follow_up_mode_other)) {
      throw momError(400, 'follow_up_mode_other_required', 'Enter the other follow-up mode.');
    }
  }
}

async function one(query, code, message) {
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) throw momError(404, code, message);
  return data;
}

export async function loadMomVisitContext(client, profile, { attendance_id: attendanceId, site_visit_id: visitId } = {}) {
  assertMomActor(profile, { mutation: true });
  if (!cleanMomText(attendanceId) || !cleanMomText(visitId)) {
    throw momError(400, 'visit_context_required', 'Attendance and site visit are required.');
  }
  const attendance = await one(client.from('fo_attendance').select('*').eq('id', attendanceId), 'attendance_not_found', 'Attendance was not found.');
  if (!recordBelongsTo(profile, attendance)) throw momError(403, 'attendance_forbidden', 'This visit could not be verified.');
  const visit = await one(client.from('fo_site_visits').select('*').eq('id', visitId), 'site_visit_not_found', 'Site visit was not found.');
  if (visit.attendance_id !== attendance.id) throw momError(400, 'visit_attendance_mismatch', 'Site visit does not belong to the selected attendance.');
  if (!recordBelongsTo(profile, visit)) throw momError(403, 'site_visit_forbidden', 'This visit could not be verified.');
  const storeId = visit.store_id || visit.site_id;
  if (!storeId) throw momError(400, 'visit_site_missing', 'Site visit has no verified site.');
  const store = await one(client.from('store_master').select('*').eq('id', storeId), 'site_not_found', 'Site was not found.');
  const eligibilityFilters = [];
  const businessKey = normalizeMomKey(store.business);
  const clientKey = normalizeMomKey(store.client_name);
  if (businessKey) eligibilityFilters.push(`business_key.eq.${businessKey}`);
  if (clientKey) eligibilityFilters.push(`client_key.eq.${clientKey}`);
  if (!eligibilityFilters.length) throw momError(403, 'visit_not_eligible', 'This visit is not eligible for Minutes of Meeting.');
  const { data: capability, error } = await client.from('mom_business_capabilities')
    .select('*').eq('is_enabled', true)
    .or(eligibilityFilters.join(','))
    .limit(1).maybeSingle();
  if (error) throw error;
  if (!capability) throw momError(403, 'visit_not_eligible', 'This visit is not eligible for Minutes of Meeting.');
  return { attendance, visit, store, capability };
}

export async function loadAuthorizedMom(client, profile, momId, { editable = false } = {}) {
  assertMomActor(profile, { mutation: editable });
  const mom = await one(client.from('visit_moms').select('*').eq('id', momId), 'mom_not_found', 'Minutes of Meeting was not found.');
  if (!recordBelongsTo(profile, mom)) throw momError(403, 'mom_forbidden', 'This Minutes of Meeting is outside your access.');
  if (editable && mom.status !== 'draft') throw momError(409, 'mom_immutable', 'This MoM has already been submitted.');
  return mom;
}

export function translateMomError(error) {
  if (error instanceof MomError) return error;
  const message = cleanMomText(error?.message || error?.details || error?.code);
  const known = {
    mom_not_owner: [403, 'mom_forbidden', 'This Minutes of Meeting is outside your access.'],
    mom_visit_mismatch: [400, 'visit_attendance_mismatch', 'This visit could not be verified.'],
    mom_not_eligible: [403, 'visit_not_eligible', 'This visit is not eligible for Minutes of Meeting.'],
    mom_immutable: [409, 'mom_immutable', 'This MoM has already been submitted.'],
    mom_meeting_with_required: [400, 'meeting_with_required', 'Meeting With is required.'],
    mom_discussion_required: [400, 'discussion_required', 'Add at least one discussion point.'],
    mom_follow_up_date_required: [400, 'follow_up_date_required', 'Select the next review date.'],
    mom_meeting_designation_required: [400, 'meeting_designation_required', 'Select a valid meeting designation.'],
    mom_meeting_designation_other_required: [400, 'meeting_designation_other_required', 'Enter the other designation.'],
    mom_action_incomplete: [400, 'action_incomplete', 'Complete or remove incomplete action items.'],
    mom_action_status_invalid: [400, 'action_status_invalid', 'Action status is invalid.'],
    mom_priority_invalid: [400, 'priority_invalid', 'Discussion priority is invalid.'],
    mom_follow_up_mode_required: [400, 'follow_up_mode_required', 'Select a valid follow-up mode.'],
    mom_follow_up_mode_other_required: [400, 'follow_up_mode_other_required', 'Enter the other follow-up mode.'],
  };
  for (const [needle, mapped] of Object.entries(known)) if (message.includes(needle)) return momError(...mapped);
  if (error?.code === '23505') return momError(409, 'duplicate_mom', 'A Minutes of Meeting already exists for this visit.');
  if (error?.code === '42501') return momError(403, 'forbidden', 'Minutes of Meeting access is not allowed.');
  return error;
}

export function safeMomError(response, rawError) {
  const error = translateMomError(rawError);
  const status = Number(error?.statusCode || 500);
  response.status(status).json({
    ok: false,
    code: error?.code || (status >= 500 ? 'mom_internal_error' : 'mom_request_failed'),
    message: status >= 500 ? 'Minutes of Meeting request failed.' : error.message,
  });
}
