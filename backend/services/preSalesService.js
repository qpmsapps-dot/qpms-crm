import {
  FEEDBACK_REQUIRING_FOLLOWUP,
  FOLLOWUP_STATUSES,
  HANDOFF_STATUSES,
  MEETING_MODES,
  MEETING_STATUSES,
  PRE_SALES_FEEDBACK,
  PRE_SALES_FEEDBACK_LABELS,
  PRE_SALES_STAGES,
} from '../../shared/preSalesConstants.js';
import {
  canAssignLead,
  canEditLead,
  canViewLead,
  cleanText,
  leadResponse,
  loadLeadRelations,
} from './leadManagementService.js';

const FULL_PRE_SALES_ROLES = new Set([
  'BD Head', 'Admin', 'QPMS Admin', 'Developer', 'COO', 'Executive Assistant', 'GM', 'MD',
]);
const SORT_COLUMNS = new Set(['updated_at', 'created_at', 'last_activity_at', 'client_name', 'lead_priority']);

function httpError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function integer(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function isoTimestamp(value, field, { required = false, future = false } = {}) {
  const text = cleanText(value);
  if (!text && !required) return null;
  if (!text && required) throw httpError(400, 'timestamp_required', `${field} is required.`);
  const parsed = new Date(text);
  if (!text || Number.isNaN(parsed.getTime())) throw httpError(400, 'invalid_timestamp', `${field} must be a valid date and time.`);
  if (future && parsed.getTime() <= Date.now()) throw httpError(400, 'future_timestamp_required', `${field} must be in the future.`);
  return parsed.toISOString();
}

function indiaDayBounds(date = new Date()) {
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
  return {
    day,
    from: new Date(`${day}T00:00:00+05:30`).toISOString(),
    to: new Date(`${day}T23:59:59.999+05:30`).toISOString(),
  };
}

function actorOwnFilters(actor) {
  return [
    actor?.profileId ? `pre_sales_owner_profile_id.eq.${actor.profileId}` : '',
    actor?.email ? `assigned_bd_email.eq.${actor.email}` : '',
    actor?.authUserId ? `created_by_user_id.eq.${actor.authUserId}` : '',
    actor?.profileId ? `created_by_user_id.eq.${actor.profileId}` : '',
  ].filter(Boolean).join(',');
}

export function applyPreSalesLeadScope(query, actor) {
  if (FULL_PRE_SALES_ROLES.has(actor?.role)) return query;
  if (actor?.role === 'Pre-Sales Manager') {
    if (!actor.business && !actor.state && !actor.branch) return query.eq('id', '00000000-0000-0000-0000-000000000000');
    if (actor.business) query = query.eq('business', actor.business);
    if (actor.state) query = query.eq('state', actor.state);
    if (actor.branch) query = query.eq('branch', actor.branch);
    return query;
  }
  if (actor?.role === 'Business Head') return query.eq('business', actor.business || '__NO_SCOPE__');
  if (actor?.role === 'Branch Head') {
    query = query.eq('state', actor.state || '__NO_SCOPE__');
    if (actor.branch) query = query.eq('branch', actor.branch);
    if (actor.business) query = query.eq('business', actor.business);
    return query;
  }
  const filters = actorOwnFilters(actor);
  return filters ? query.or(filters) : query.eq('id', '00000000-0000-0000-0000-000000000000');
}

async function authorizedLead(client, actor, leadId, { edit = false } = {}) {
  const result = await client.from('leads').select('*,pre_sales_owner:profiles!leads_pre_sales_owner_profile_id_fkey(id,full_name,employee_code)').eq('id', leadId).maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) throw httpError(404, 'lead_not_found', 'Lead not found.');
  if (!(edit ? canEditLead(actor, result.data) : canViewLead(actor, result.data))) {
    throw httpError(403, 'lead_access_denied', 'You do not have access to this lead.');
  }
  return result.data;
}

function primaryContact(contacts = []) {
  return contacts.find((item) => item.is_primary) || contacts[0] || null;
}

function publicLead(lead, relations = {}, extras = {}) {
  const response = leadResponse(lead, relations);
  const contact = primaryContact(response.contacts || []);
  return {
    ...response,
    pre_sales_stage: lead.pre_sales_stage || PRE_SALES_STAGES.NEW_LEAD,
    owner_profile_id: lead.pre_sales_owner_profile_id || null,
    owner_name: lead.pre_sales_owner?.full_name || lead.pre_sales_owner?.employee_code || lead.assigned_bd_executive || lead.created_by_name || 'Unassigned',
    contact_name: contact?.contact_person_name || '',
    contact_phone: contact?.contact_number || '',
    contact_email: contact?.email_id || '',
    last_update: lead.last_activity_at || lead.updated_at || lead.created_at,
    ...extras,
  };
}

async function leadIdsForActor(client, actor) {
  let query = client.from('leads').select('id,status,pre_sales_stage,updated_at');
  query = applyPreSalesLeadScope(query, actor);
  const result = await query;
  if (result.error) throw result.error;
  return result.data || [];
}

export async function listPreSalesLeads(client, actor, params = {}) {
  const page = integer(params.page, 1, 1, 100000);
  const pageSize = integer(params.page_size, 20, 1, 100);
  const sortBy = SORT_COLUMNS.has(params.sort_by) ? params.sort_by : 'updated_at';
  const ascending = String(params.sort_direction || 'desc').toLowerCase() === 'asc';
  let query = client.from('leads').select('*,pre_sales_owner:profiles!leads_pre_sales_owner_profile_id_fkey(id,full_name,employee_code)', { count: 'exact' });
  query = applyPreSalesLeadScope(query, actor);
  if (cleanText(params.search)) {
    const search = cleanText(params.search).replaceAll(',', ' ');
    query = query.or(`client_name.ilike.%${search}%,site_location.ilike.%${search}%,city.ilike.%${search}%`);
  }
  if (cleanText(params.stage)) query = query.eq('pre_sales_stage', cleanText(params.stage));
  if (cleanText(params.owner)) query = query.eq('pre_sales_owner_profile_id', cleanText(params.owner));
  if (cleanText(params.priority)) query = query.eq('lead_priority', cleanText(params.priority));
  if (cleanText(params.date_from)) query = query.gte('created_at', `${cleanText(params.date_from)}T00:00:00.000Z`);
  if (cleanText(params.date_to)) query = query.lte('created_at', `${cleanText(params.date_to)}T23:59:59.999Z`);
  const from = (page - 1) * pageSize;
  const result = await query.order(sortBy, { ascending }).range(from, from + pageSize - 1);
  if (result.error) throw result.error;
  const rows = result.data || [];
  const relations = await loadLeadRelations(client, rows.map((row) => row.id));
  const leadIds = rows.map((row) => row.id);
  let pendingByLead = {};
  if (leadIds.length) {
    const followups = await client.from('lead_followups').select('*').in('lead_id', leadIds).eq('status', 'pending').order('scheduled_at');
    if (followups.error) throw followups.error;
    pendingByLead = (followups.data || []).reduce((mapped, row) => {
      if (!mapped[row.lead_id]) mapped[row.lead_id] = row;
      return mapped;
    }, {});
  }
  const visibleSummaryRows = await leadIdsForActor(client, actor);
  const visibleIds = visibleSummaryRows.map((row) => row.id);
  let followupsDue = 0;
  if (visibleIds.length) {
    const due = await client.from('lead_followups').select('id', { count: 'exact', head: true }).in('lead_id', visibleIds).eq('status', 'pending').lte('scheduled_at', new Date().toISOString());
    if (due.error) throw due.error;
    followupsDue = due.count || 0;
  }
  return {
    items: rows.map((row) => publicLead(row, relations, {
      next_action: pendingByLead[row.id]?.followup_type || '',
      next_action_at: pendingByLead[row.id]?.scheduled_at || null,
    })),
    total: result.count || 0,
    page,
    page_size: pageSize,
    summary: {
      total_leads: visibleSummaryRows.length,
      qualified_leads: visibleSummaryRows.filter((row) => row.status === 'Qualified' || row.pre_sales_stage === PRE_SALES_STAGES.PENDING_HANDOVER).length,
      followups_due: followupsDue,
      invalid_leads: visibleSummaryRows.filter((row) => row.status === 'Invalid' || row.pre_sales_stage === PRE_SALES_STAGES.INVALID).length,
    },
  };
}

export async function getPreSalesLead(client, actor, leadId) {
  const lead = await authorizedLead(client, actor, leadId);
  const relations = await loadLeadRelations(client, [lead.id]);
  const [calls, followups, meetings, handoffs] = await Promise.all([
    client.from('lead_call_updates').select('id', { count: 'exact', head: true }).eq('lead_id', lead.id),
    client.from('lead_followups').select('id', { count: 'exact', head: true }).eq('lead_id', lead.id),
    client.from('lead_meetings').select('id', { count: 'exact', head: true }).eq('lead_id', lead.id),
    client.from('lead_handoffs').select('id', { count: 'exact', head: true }).eq('lead_id', lead.id),
  ]);
  for (const result of [calls, followups, meetings, handoffs]) if (result.error) throw result.error;
  return publicLead(lead, relations, {
    summary_counts: {
      calls: calls.count || 0,
      followups: followups.count || 0,
      meetings: meetings.count || 0,
      handoffs: handoffs.count || 0,
    },
  });
}

export async function getPreSalesDashboard(client, actor) {
  const visible = await leadIdsForActor(client, actor);
  const ids = visible.map((row) => row.id);
  const empty = {
    summary: { today_followups: 0, today_meetings: 0, callbacks_due: 0, overdue_followups: 0, qualified_leads: 0, pending_handover: 0 },
    my_leads: [], today_schedule: [], upcoming_followups: [],
  };
  if (!ids.length) return empty;
  const { from, to } = indiaDayBounds();
  const now = new Date().toISOString();
  const [leadList, todayFollowups, overdue, upcoming, todayMeetings, pendingHandoffs] = await Promise.all([
    listPreSalesLeads(client, actor, { page: 1, page_size: 5, sort_by: 'updated_at', sort_direction: 'desc' }),
    client.from('lead_followups').select('*,lead:leads(id,client_name,company_name)').in('lead_id', ids).eq('status', 'pending').gte('scheduled_at', from).lte('scheduled_at', to).order('scheduled_at'),
    client.from('lead_followups').select('id,followup_type').in('lead_id', ids).eq('status', 'pending').lt('scheduled_at', now),
    client.from('lead_followups').select('*,lead:leads(id,client_name,company_name)').in('lead_id', ids).eq('status', 'pending').gt('scheduled_at', to).order('scheduled_at').limit(5),
    client.from('lead_meetings').select('*,lead:leads(id,client_name,company_name)').in('lead_id', ids).in('meeting_status', ['scheduled', 'rescheduled']).gte('scheduled_at', from).lte('scheduled_at', to).order('scheduled_at'),
    client.from('lead_handoffs').select('id').in('lead_id', ids).eq('handoff_status', 'pending'),
  ]);
  for (const result of [todayFollowups, overdue, upcoming, todayMeetings, pendingHandoffs]) if (result.error) throw result.error;
  const schedule = [
    ...(todayFollowups.data || []).map((row) => ({ ...row, item_type: row.followup_type === 'call_back' ? 'Call' : 'Follow-up' })),
    ...(todayMeetings.data || []).map((row) => ({ ...row, item_type: 'Meeting', purpose: row.meeting_notes || row.meeting_mode })),
  ].sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
  return {
    summary: {
      today_followups: todayFollowups.data?.length || 0,
      today_meetings: todayMeetings.data?.length || 0,
      callbacks_due: (todayFollowups.data || []).filter((row) => row.followup_type === 'call_back').length,
      overdue_followups: overdue.data?.length || 0,
      qualified_leads: visible.filter((row) => row.status === 'Qualified' || row.pre_sales_stage === PRE_SALES_STAGES.PENDING_HANDOVER).length,
      pending_handover: pendingHandoffs.data?.length || 0,
    },
    my_leads: leadList.items,
    today_schedule: schedule,
    upcoming_followups: upcoming.data || [],
  };
}

export function validateCallUpdate(payload = {}) {
  const feedbackType = cleanText(payload.feedback_type).toLowerCase();
  if (!Object.values(PRE_SALES_FEEDBACK).includes(feedbackType)) throw httpError(400, 'invalid_feedback_type', 'Select a valid calling feedback.');
  const notes = cleanText(payload.notes);
  if (!notes) throw httpError(400, 'notes_required', 'Notes / Summary is required.');
  const meetingRequired = payload.meeting_required === true;
  const followupRequired = FEEDBACK_REQUIRING_FOLLOWUP.includes(feedbackType)
    || (feedbackType === PRE_SALES_FEEDBACK.INTERESTED && !meetingRequired);
  const followupAt = isoTimestamp(payload.followup_at, 'Follow-up date/time', { required: followupRequired, future: Boolean(payload.followup_at) });
  if (feedbackType === PRE_SALES_FEEDBACK.INVALID_LEAD && notes.length < 3) throw httpError(400, 'invalid_reason_required', 'Enter the invalid lead reason.');
  let meeting = null;
  if (feedbackType === PRE_SALES_FEEDBACK.INTERESTED && meetingRequired) {
    meeting = {
      scheduled_at: isoTimestamp(payload.meeting?.scheduled_at, 'Meeting date/time', { required: true, future: true }),
      meeting_mode: cleanText(payload.meeting?.meeting_mode),
      location_or_link: cleanText(payload.meeting?.location_or_link) || null,
      meeting_notes: cleanText(payload.meeting?.meeting_notes) || notes,
    };
    if (!MEETING_MODES.includes(meeting.meeting_mode)) throw httpError(400, 'invalid_meeting_mode', 'Select a valid meeting mode.');
  }
  return {
    feedback_type: feedbackType,
    notes,
    next_action: cleanText(payload.next_action) || null,
    followup_at: followupAt,
    meeting_required: meetingRequired,
    qualified: payload.qualified === true,
    meeting,
  };
}

function stageForCall(input) {
  if (input.feedback_type === PRE_SALES_FEEDBACK.INVALID_LEAD) return PRE_SALES_STAGES.INVALID;
  if (input.qualified) return PRE_SALES_STAGES.PENDING_HANDOVER;
  if (input.meeting) return PRE_SALES_STAGES.MEETING_SCHEDULED;
  if (input.followup_at) return PRE_SALES_STAGES.FOLLOW_UP;
  if (input.feedback_type === PRE_SALES_FEEDBACK.INTERESTED) return PRE_SALES_STAGES.QUALIFICATION;
  return PRE_SALES_STAGES.CALLING;
}

export async function addCallUpdate(client, actor, leadId, payload) {
  await authorizedLead(client, actor, leadId, { edit: true });
  const input = validateCallUpdate(payload);
  const stage = stageForCall(input);
  const result = await client.rpc('rpc_add_pre_sales_call_update', {
    p_lead_id: leadId,
    p_payload: { ...input, pre_sales_stage: stage, feedback_label: PRE_SALES_FEEDBACK_LABELS[input.feedback_type] },
    p_actor: { profile_id: actor.profileId || null, name: actor.name || actor.employeeCode || actor.email || 'Unknown' },
  });
  if (result.error) throw result.error;
  return result.data;
}

export async function listCallHistory(client, actor, leadId) {
  await authorizedLead(client, actor, leadId);
  const result = await client.from('lead_call_updates').select('*').eq('lead_id', leadId).order('created_at', { ascending: false });
  if (result.error) throw result.error;
  return result.data || [];
}

export async function listFollowups(client, actor, params = {}) {
  const visible = await leadIdsForActor(client, actor);
  const ids = visible.map((row) => row.id);
  if (!ids.length) return [];
  let query = client.from('lead_followups').select('*,lead:leads(id,client_name,company_name,lead_priority,pre_sales_stage)').in('lead_id', ids);
  const { from, to } = indiaDayBounds();
  const filter = cleanText(params.filter || params.status).toLowerCase();
  if (FOLLOWUP_STATUSES.includes(filter)) query = query.eq('status', filter);
  if (filter === 'today') query = query.eq('status', 'pending').gte('scheduled_at', from).lte('scheduled_at', to);
  if (filter === 'overdue') query = query.eq('status', 'pending').lt('scheduled_at', new Date().toISOString());
  if (filter === 'upcoming') query = query.eq('status', 'pending').gt('scheduled_at', to);
  if (cleanText(params.lead_id)) query = query.eq('lead_id', cleanText(params.lead_id));
  if (cleanText(params.owner)) query = query.eq('owner_profile_id', cleanText(params.owner));
  if (cleanText(params.date_from)) query = query.gte('scheduled_at', new Date(`${params.date_from}T00:00:00`).toISOString());
  if (cleanText(params.date_to)) query = query.lte('scheduled_at', new Date(`${params.date_to}T23:59:59`).toISOString());
  const result = await query.order('scheduled_at');
  if (result.error) throw result.error;
  return result.data || [];
}

async function authorizedFollowup(client, actor, followupId) {
  const result = await client.from('lead_followups').select('*').eq('id', followupId).maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) throw httpError(404, 'followup_not_found', 'Follow-up not found.');
  await authorizedLead(client, actor, result.data.lead_id, { edit: true });
  return result.data;
}

async function logActivity(client, actor, leadId, type, message, metadata = {}) {
  const result = await client.from('activity_logs').insert({
    lead_id: leadId, activity_type: type, activity_message: message,
    created_by: actor.name || actor.employeeCode || actor.email || 'Unknown', metadata,
  });
  if (result.error) throw result.error;
}

export async function completeFollowup(client, actor, followupId, payload = {}) {
  const current = await authorizedFollowup(client, actor, followupId);
  if (current.status !== 'pending') throw httpError(409, 'followup_not_pending', 'Only a pending follow-up can be completed.');
  const now = new Date().toISOString();
  const result = await client.from('lead_followups').update({ status: 'completed', outcome: cleanText(payload.outcome) || null, remarks: cleanText(payload.remarks) || current.remarks, completed_at: now, updated_at: now }).eq('id', current.id).eq('status', 'pending').select('*').single();
  if (result.error) throw result.error;
  await logActivity(client, actor, current.lead_id, 'Follow-up Completed', cleanText(payload.outcome) || 'Follow-up completed', { followup_id: current.id });
  return result.data;
}

export async function rescheduleFollowup(client, actor, followupId, payload = {}) {
  const current = await authorizedFollowup(client, actor, followupId);
  if (current.status !== 'pending') throw httpError(409, 'followup_not_pending', 'Only a pending follow-up can be rescheduled.');
  const scheduledAt = isoTimestamp(payload.scheduled_at, 'Rescheduled date/time', { required: true, future: true });
  const now = new Date().toISOString();
  const cancelled = await client.from('lead_followups').update({ status: 'cancelled', outcome: 'rescheduled', completed_at: now, updated_at: now }).eq('id', current.id).eq('status', 'pending');
  if (cancelled.error) throw cancelled.error;
  const next = await client.from('lead_followups').insert({
    lead_id: current.lead_id, source_type: 'reschedule', source_id: current.id,
    followup_type: current.followup_type, scheduled_at: scheduledAt, status: 'pending',
    remarks: cleanText(payload.remarks) || current.remarks, owner_profile_id: current.owner_profile_id,
    created_by_profile_id: actor.profileId || null,
  }).select('*').single();
  if (next.error) throw next.error;
  await logActivity(client, actor, current.lead_id, 'Follow-up Rescheduled', `Follow-up rescheduled to ${scheduledAt}`, { previous_followup_id: current.id, followup_id: next.data.id });
  return next.data;
}

export async function listMeetings(client, actor, leadId) {
  await authorizedLead(client, actor, leadId);
  const result = await client.from('lead_meetings').select('*').eq('lead_id', leadId).order('scheduled_at', { ascending: false });
  if (result.error) throw result.error;
  return result.data || [];
}

export async function createMeeting(client, actor, leadId, payload = {}) {
  await authorizedLead(client, actor, leadId, { edit: true });
  const mode = cleanText(payload.meeting_mode);
  if (!MEETING_MODES.includes(mode)) throw httpError(400, 'invalid_meeting_mode', 'Select a valid meeting mode.');
  const scheduledAt = isoTimestamp(payload.scheduled_at, 'Meeting date/time', { required: true, future: true });
  const result = await client.from('lead_meetings').insert({
    lead_id: leadId, scheduled_at: scheduledAt, meeting_mode: mode,
    location_or_link: cleanText(payload.location_or_link) || null,
    meeting_notes: cleanText(payload.meeting_notes) || null,
    meeting_status: 'scheduled', created_by_profile_id: actor.profileId || null,
  }).select('*').single();
  if (result.error) throw result.error;
  await client.from('leads').update({ pre_sales_stage: PRE_SALES_STAGES.MEETING_SCHEDULED, last_activity_at: new Date().toISOString() }).eq('id', leadId);
  await logActivity(client, actor, leadId, 'Meeting Scheduled', `Meeting scheduled for ${scheduledAt}`, { meeting_id: result.data.id });
  return result.data;
}

export async function updateMeeting(client, actor, meetingId, payload = {}) {
  const existing = await client.from('lead_meetings').select('*').eq('id', meetingId).maybeSingle();
  if (existing.error) throw existing.error;
  if (!existing.data) throw httpError(404, 'meeting_not_found', 'Meeting not found.');
  await authorizedLead(client, actor, existing.data.lead_id, { edit: true });
  const status = cleanText(payload.meeting_status || existing.data.meeting_status);
  if (!MEETING_STATUSES.includes(status)) throw httpError(400, 'invalid_meeting_status', 'Select a valid meeting status.');
  const patch = {
    meeting_status: status,
    meeting_notes: Object.hasOwn(payload, 'meeting_notes') ? cleanText(payload.meeting_notes) || null : existing.data.meeting_notes,
    requirement_identified: typeof payload.requirement_identified === 'boolean' ? payload.requirement_identified : existing.data.requirement_identified,
    location_or_link: Object.hasOwn(payload, 'location_or_link') ? cleanText(payload.location_or_link) || null : existing.data.location_or_link,
    updated_at: new Date().toISOString(),
    completed_at: status === 'completed' ? new Date().toISOString() : null,
  };
  if (payload.scheduled_at) patch.scheduled_at = isoTimestamp(payload.scheduled_at, 'Meeting date/time', { required: true });
  const result = await client.from('lead_meetings').update(patch).eq('id', meetingId).select('*').single();
  if (result.error) throw result.error;
  if (status === 'completed') {
    const stage = patch.requirement_identified ? PRE_SALES_STAGES.QUALIFICATION : PRE_SALES_STAGES.FOLLOW_UP;
    await client.from('leads').update({ pre_sales_stage: stage, last_activity_at: patch.completed_at }).eq('id', existing.data.lead_id);
    await logActivity(client, actor, existing.data.lead_id, 'Meeting Completed', patch.meeting_notes || 'Meeting completed', { meeting_id: meetingId, requirement_identified: patch.requirement_identified });
  }
  return result.data;
}

export async function listHandoffs(client, actor, leadId) {
  await authorizedLead(client, actor, leadId);
  const result = await client.from('lead_handoffs').select('*,to_profile:profiles!lead_handoffs_to_profile_id_fkey(id,full_name,employee_code)').eq('lead_id', leadId).order('created_at', { ascending: false });
  if (result.error) throw result.error;
  return result.data || [];
}

export async function createHandoff(client, actor, leadId, payload = {}) {
  const lead = await authorizedLead(client, actor, leadId, { edit: true });
  if (lead.status !== 'Qualified' && lead.pre_sales_stage !== PRE_SALES_STAGES.PENDING_HANDOVER) {
    throw httpError(409, 'lead_not_qualified', 'Qualify the lead before handing it over to Business Development.');
  }
  const toProfileId = cleanText(payload.to_profile_id);
  const summary = cleanText(payload.qualification_summary);
  if (!toProfileId || !summary) throw httpError(400, 'handoff_fields_required', 'BD owner and qualification summary are required.');
  const pending = await client.from('lead_handoffs').select('id').eq('lead_id', lead.id).eq('handoff_status', 'pending').maybeSingle();
  if (pending.error) throw pending.error;
  if (pending.data) throw httpError(409, 'handoff_already_pending', 'This lead already has a pending Business Development handover.');
  const assignee = await client.from('profiles').select('id,role,status,is_active,full_name,employee_code').eq('id', toProfileId).maybeSingle();
  if (assignee.error) throw assignee.error;
  if (!assignee.data || assignee.data.is_active !== true || String(assignee.data.status || '').toLowerCase() !== 'active' || !['BD Executive', 'BD Head'].includes(assignee.data.role)) {
    throw httpError(400, 'invalid_bd_owner', 'Select an active Business Development owner.');
  }
  const result = await client.from('lead_handoffs').insert({
    lead_id: lead.id, from_profile_id: actor.profileId || null, to_profile_id: toProfileId,
    handoff_status: 'pending', qualification_summary: summary,
    handoff_notes: cleanText(payload.handoff_notes) || null,
    metadata: { created_by_name: actor.name || actor.employeeCode || actor.email || null },
  }).select('*').single();
  if (result.error) throw result.error;
  await client.from('leads').update({ pre_sales_stage: PRE_SALES_STAGES.PENDING_HANDOVER, last_activity_at: new Date().toISOString() }).eq('id', lead.id);
  await logActivity(client, actor, lead.id, 'BD Handover Created', `Pending handover to ${assignee.data.full_name || assignee.data.employee_code}`, { handoff_id: result.data.id, to_profile_id: toProfileId });
  return result.data;
}

export async function listBdHandoffAssignees(client) {
  const result = await client.from('profiles').select('id,full_name,employee_code,role').in('role', ['BD Executive', 'BD Head']).eq('is_active', true).ilike('status', 'active').order('full_name');
  if (result.error) throw result.error;
  return (result.data || []).map((profile) => ({ id: profile.id, full_name: profile.full_name || profile.employee_code, employee_code: profile.employee_code, role: profile.role }));
}

export async function listPreSalesOwners(client, actor) {
  let query = client.from('profiles').select('id,full_name,employee_code,role,state,business,branch').in('role', ['Pre-Sales Executive', 'Pre-Sales Manager', 'BD Executive']).eq('is_active', true).ilike('status', 'active');
  if (actor.role === 'Pre-Sales Manager') {
    if (!actor.business && !actor.state && !actor.branch) return [];
    if (actor.business) query = query.eq('business', actor.business);
    if (actor.state) query = query.eq('state', actor.state);
    if (actor.branch) query = query.eq('branch', actor.branch);
  } else if (!FULL_PRE_SALES_ROLES.has(actor.role)) {
    query = query.eq('id', actor.profileId || '00000000-0000-0000-0000-000000000000');
  }
  const result = await query.order('full_name');
  if (result.error) throw result.error;
  return (result.data || []).map((profile) => ({ id: profile.id, full_name: profile.full_name || profile.employee_code, employee_code: profile.employee_code, role: profile.role }));
}

export async function assignPreSalesOwner(client, actor, leadId, ownerProfileId) {
  if (!canAssignLead(actor)) throw httpError(403, 'pre_sales_assignment_denied', 'You do not have permission to assign Pre-Sales leads.');
  const lead = await authorizedLead(client, actor, leadId, { edit: true });
  const ownerId = cleanText(ownerProfileId);
  const owner = await client.from('profiles').select('id,full_name,employee_code,role,status,is_active').eq('id', ownerId).maybeSingle();
  if (owner.error) throw owner.error;
  if (!owner.data || owner.data.is_active !== true || String(owner.data.status || '').toLowerCase() !== 'active' || !['Pre-Sales Executive', 'Pre-Sales Manager', 'BD Executive'].includes(owner.data.role)) {
    throw httpError(400, 'invalid_pre_sales_owner', 'Select an active Pre-Sales owner.');
  }
  const now = new Date().toISOString();
  const updated = await client.from('leads').update({ pre_sales_owner_profile_id: ownerId, pre_sales_stage: PRE_SALES_STAGES.ASSIGNED, last_activity_at: now, updated_at: now }).eq('id', lead.id).select('*').single();
  if (updated.error) throw updated.error;
  await logActivity(client, actor, lead.id, 'Pre-Sales Assigned', `Assigned to ${owner.data.full_name || owner.data.employee_code}`, { pre_sales_owner_profile_id: ownerId });
  return updated.data;
}

export const preSalesPolicy = Object.freeze({
  feedback: Object.values(PRE_SALES_FEEDBACK), followupStatuses: FOLLOWUP_STATUSES,
  meetingStatuses: MEETING_STATUSES, handoffStatuses: HANDOFF_STATUSES,
});
