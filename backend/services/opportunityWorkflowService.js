import { normalizeLeadRole } from './leadManagementService.js';
import { assertPreSalesLeadMutable } from './preSalesService.js';
import { stateScopeAllows } from './workMappingScope.js';

function httpError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function text(value) {
  return String(value || '').trim();
}

function rpcError(error) {
  const message = text(error?.message);
  const known = {
    idempotency_key_required: [400, 'idempotency_key_required', 'A request key is required. Please retry.'],
    future_meeting_required: [400, 'future_meeting_required', 'Select a future meeting date and time.'],
    invalid_meeting_mode: [400, 'invalid_meeting_mode', 'Select a valid meeting mode.'],
    meeting_requirement_required: [400, 'meeting_requirement_required', 'Enter the client requirement / meeting notes.'],
    bd_actor_not_eligible: [400, 'invalid_bd_owner', 'Select an active Business Development user.'],
    handoff_already_pending: [409, 'handoff_already_pending', 'This opportunity is already waiting for BD acceptance.'],
    pre_sales_opportunity_read_only: [409, 'pre_sales_opportunity_read_only', 'This opportunity has been handed over and is now read-only.'],
    meeting_not_owned_by_actor: [403, 'meeting_not_owned_by_actor', 'This meeting is assigned to another BD user.'],
    mom_requirement_required: [400, 'mom_requirement_required', 'Enter the requirement discussed before submitting MOM.'],
    mom_already_exists_for_another_meeting: [409, 'mom_already_exists_for_another_meeting', 'A MOM already exists for a different meeting on this opportunity.'],
    branch_head_unresolved: [409, 'branch_head_unresolved', 'No Branch Head mapping could be resolved for the lead State.'],
    branch_head_ambiguous: [409, 'branch_head_ambiguous', 'Multiple valid Branch Heads were found; assignment requires review.'],
    site_survey_not_assigned_to_branch_head: [403, 'site_survey_not_assigned_to_branch_head', 'This Site Survey request is assigned to another Branch Head.'],
    operations_manager_outside_branch_hierarchy: [403, 'operations_manager_outside_branch_hierarchy', 'Select an Operations Manager in your reporting hierarchy.'],
    operations_manager_already_assigned: [409, 'operations_manager_already_assigned', 'An Operations Manager is already assigned.'],
    proposal_not_owned_by_actor: [403, 'proposal_not_owned_by_actor', 'This opportunity is assigned to another BD user.'],
    proposal_requires_completed_mom: [409, 'proposal_requires_completed_mom', 'Complete the BD meeting and MOM before preparing a proposal.'],
    opportunity_not_returned_to_bd: [409, 'opportunity_not_returned_to_bd', 'The assessment workflow has not returned this opportunity to BD.'],
    opportunity_already_final: [409, 'opportunity_already_final', 'The client decision has already been recorded.'],
    proposal_not_ready: [409, 'proposal_not_ready', 'Prepare the proposal before sending it.'],
    idempotency_key_in_use: [409, 'idempotency_key_in_use', 'This request key has already been used. Please refresh and retry.'],
    'Proposal must be sent before recording the client decision': [409, 'proposal_not_sent', 'Send the proposal before recording the client decision.'],
    'Proposal outcome has already been recorded': [409, 'proposal_outcome_already_recorded', 'The client decision has already been recorded.'],
    'A loss reason is required': [400, 'proposal_loss_reason_required', 'A loss reason is required.'],
    'Final outcome must be Converted or Lost': [400, 'invalid_proposal_outcome', 'Select Converted or Lost.'],
  };
  if (known[message]) return httpError(...known[message]);
  if (error?.code === '42501') return httpError(403, 'opportunity_action_denied', 'You do not have permission to perform this opportunity action.');
  if (error?.code === 'P0002') return httpError(404, 'opportunity_record_not_found', 'The requested opportunity record was not found.');
  if (error?.code === '40001' || error?.code === '23505') return httpError(409, 'opportunity_conflict', 'This opportunity changed or the action was already completed.');
  return error;
}

function requireRole(actor, roles, code, message) {
  const role = normalizeLeadRole(actor?.role);
  if (!roles.includes(role)) throw httpError(403, code, message);
  return role;
}

export async function scheduleMeetingAndHandoff(client, actor, leadId, payload = {}, idempotencyKey) {
  requireRole(actor, ['Pre-Sales'], 'pre_sales_action_denied', 'Only the associated Pre-Sales owner can schedule and hand over this meeting.');
  await assertPreSalesLeadMutable(client, actor, leadId);
  const bdProfileId = text(payload.bd_profile_id || payload.to_profile_id);
  if (!bdProfileId) throw httpError(400, 'bd_owner_required', 'Select a BD user before scheduling the meeting.');
  try {
    const result = await client.rpc('rpc_schedule_pre_sales_meeting_handoff', {
      p_lead_id: leadId,
      p_actor_profile_id: actor.profileId,
      p_bd_profile_id: bdProfileId,
      p_payload: {
        scheduled_at: payload.scheduled_at,
        meeting_mode: payload.meeting_mode,
        location_or_link: text(payload.location_or_link) || null,
        client_contact_person: text(payload.client_contact_person) || null,
        client_contact_number: text(payload.client_contact_number) || null,
        requirement_summary: text(payload.requirement_summary || payload.meeting_notes),
        handoff_notes: text(payload.handoff_notes) || null,
      },
      p_idempotency_key: text(idempotencyKey),
    });
    if (result.error) throw rpcError(result.error);
    return result.data;
  } catch (error) {
    throw rpcError(error);
  }
}

export async function listBdOpportunityWork(client, actor) {
  requireRole(actor, ['BD Executive', 'BD Head'], 'bd_work_denied', 'Business Development access is required.');
  let handoffQuery = client.from('lead_handoffs')
    .select('*,from_profile:profiles!lead_handoffs_from_profile_id_fkey(id,full_name,employee_code),to_profile:profiles!lead_handoffs_to_profile_id_fkey(id,full_name,employee_code)')
    .order('created_at', { ascending: false });
  handoffQuery = handoffQuery.eq('to_profile_id', actor.profileId);
  const handoffResult = await handoffQuery;
  if (handoffResult.error) throw handoffResult.error;
  const handoffs = handoffResult.data || [];
  const leadIds = [...new Set(handoffs.map((row) => row.lead_id).filter(Boolean))];
  const meetingIds = [...new Set(handoffs.map((row) => row.meeting_id).filter(Boolean))];
  const [leadsResult, meetingsResult, momsResult, visitsResult, workflowsResult, proposalsResult] = await Promise.all([
    leadIds.length ? client.from('leads').select('id,client_name,state,business,site_location,status,pre_sales_stage,pre_sales_owner_profile_id,created_by_name').in('id', leadIds) : { data: [], error: null },
    meetingIds.length ? client.from('lead_meetings').select('*').in('id', meetingIds) : { data: [], error: null },
    meetingIds.length ? client.from('lead_mom').select('id,lead_id,meeting_id,mom_status,site_survey_required,sent_at,updated_at').in('meeting_id', meetingIds) : { data: [], error: null },
    leadIds.length ? client.from('site_visits').select('id,lead_id,status,current_stage,pending_with,routing_status,updated_at').in('lead_id', leadIds) : { data: [], error: null },
    leadIds.length ? client.from('workflow_instances').select('id,lead_id,current_stage_code,status,pending_role,approval_status,updated_at').in('lead_id', leadIds) : { data: [], error: null },
    leadIds.length ? client.from('proposals').select('id,lead_id,proposal_status,sent_at,updated_at,metadata').in('lead_id', leadIds) : { data: [], error: null },
  ]);
  if (leadsResult.error) throw leadsResult.error;
  if (meetingsResult.error) throw meetingsResult.error;
  if (momsResult.error) throw momsResult.error;
  if (visitsResult.error) throw visitsResult.error;
  if (workflowsResult.error) throw workflowsResult.error;
  if (proposalsResult.error) throw proposalsResult.error;
  const leads = new Map((leadsResult.data || []).map((row) => [row.id, row]));
  const meetings = new Map((meetingsResult.data || []).map((row) => [row.id, row]));
  const moms = new Map((momsResult.data || []).map((row) => [row.meeting_id, row]));
  const visits = new Map((visitsResult.data || []).map((row) => [row.lead_id, row]));
  const workflows = new Map((workflowsResult.data || []).map((row) => [row.lead_id, row]));
  const proposals = new Map((proposalsResult.data || []).map((row) => [row.lead_id, row]));
  return handoffs.map((handoff) => ({
    ...handoff,
    lead: leads.get(handoff.lead_id) || null,
    meeting: meetings.get(handoff.meeting_id) || null,
    mom: moms.get(handoff.meeting_id) || null,
    site_visit: visits.get(handoff.lead_id) || null,
    workflow: workflows.get(handoff.lead_id) || null,
    proposal: proposals.get(handoff.lead_id) || null,
  }));
}

export async function recordProposalOutcome(client, actor, proposalId, payload = {}, idempotencyKey) {
  requireRole(actor, ['BD Executive', 'BD Head'], 'proposal_outcome_denied', 'Business Development access is required.');
  const outcome = text(payload.outcome);
  const reason = text(payload.reason);
  if (!['Converted', 'Lost'].includes(outcome)) {
    throw httpError(400, 'invalid_proposal_outcome', 'Select Converted or Lost.');
  }
  if (outcome === 'Lost' && !reason) {
    throw httpError(400, 'proposal_loss_reason_required', 'A loss reason is required.');
  }
  try {
    const result = await client.rpc('rpc_record_proposal_outcome', {
      p_proposal_id: proposalId,
      p_actor_profile_id: actor.profileId,
      p_outcome: outcome,
      p_reason: reason || null,
      p_idempotency_key: text(idempotencyKey),
    });
    if (result.error) throw rpcError(result.error);
    return result.data;
  } catch (error) {
    throw rpcError(error);
  }
}

export async function prepareOpportunityProposal(client, actor, leadId, payload = {}, idempotencyKey) {
  requireRole(actor, ['BD Executive', 'BD Head'], 'proposal_prepare_denied', 'Business Development access is required.');
  try {
    const result = await client.rpc('rpc_prepare_opportunity_proposal', {
      p_lead_id: leadId,
      p_actor_profile_id: actor.profileId,
      p_payload: {
        proposal_number: text(payload.proposal_number) || null,
        template_name: text(payload.template_name) || null,
        summary: text(payload.summary) || null,
      },
      p_idempotency_key: text(idempotencyKey),
    });
    if (result.error) throw rpcError(result.error);
    return result.data;
  } catch (error) {
    throw rpcError(error);
  }
}

export async function sendOpportunityProposal(client, actor, proposalId, idempotencyKey) {
  requireRole(actor, ['BD Executive', 'BD Head'], 'proposal_send_denied', 'Business Development access is required.');
  try {
    const result = await client.rpc('rpc_send_opportunity_proposal', {
      p_proposal_id: proposalId,
      p_actor_profile_id: actor.profileId,
      p_idempotency_key: text(idempotencyKey),
    });
    if (result.error) throw rpcError(result.error);
    return result.data;
  } catch (error) {
    throw rpcError(error);
  }
}

export async function listOpportunityNotifications(client, actor, limit = 20) {
  if (!actor?.profileId) throw httpError(403, 'opportunity_notifications_denied', 'An active employee profile is required.');
  const result = await client.from('opportunity_notifications')
    .select('id,lead_id,notification_type,title,message,action_url,read_at,metadata,created_at')
    .eq('recipient_profile_id', actor.profileId)
    .order('created_at', { ascending: false })
    .limit(Math.min(50, Math.max(1, Number(limit) || 20)));
  if (result.error) throw result.error;
  return result.data || [];
}

export async function submitBdMeetingMom(client, actor, meetingId, payload = {}) {
  requireRole(actor, ['BD Executive', 'BD Head'], 'bd_mom_denied', 'Business Development access is required to submit MOM.');
  if (typeof payload.site_survey_required !== 'boolean') {
    throw httpError(400, 'site_survey_decision_required', 'Select whether a Site Survey is required.');
  }
  try {
    const result = await client.rpc('rpc_submit_bd_meeting_mom', {
      p_meeting_id: meetingId,
      p_actor_profile_id: actor.profileId,
      p_payload: {
        subject: text(payload.subject) || null,
        attendees: text(payload.attendees) || null,
        requirement_discussed: text(payload.requirement_discussed),
        scope_summary: text(payload.scope_summary) || null,
        key_points: text(payload.key_points) || null,
        client_expectations: text(payload.client_expectations) || null,
        follow_up_actions: text(payload.follow_up_actions) || null,
        remarks: text(payload.remarks) || null,
        site_survey_required: payload.site_survey_required,
        preferred_survey_date: payload.site_survey_required ? text(payload.preferred_survey_date) || null : null,
        site_contact: payload.site_survey_required ? text(payload.site_contact) || null : null,
        site_address: payload.site_survey_required ? text(payload.site_address) || null : null,
        survey_notes: payload.site_survey_required ? text(payload.survey_notes) || null : null,
      },
    });
    if (result.error) throw rpcError(result.error);
    return result.data;
  } catch (error) {
    throw rpcError(error);
  }
}

export async function listBranchHeadSurveyRequests(client, actor) {
  requireRole(actor, ['Branch Head'], 'branch_survey_denied', 'Branch Head access is required.');
  const result = await client.from('site_visits')
    .select('id,lead_id,client_name,site_name,site_location,owner_state,scheduled_visit_date,status,current_stage,pending_with,source_lead_mom_id,branch_head_profile_id,assigned_operations_manager_profile_id,routing_status,created_at,updated_at')
    .eq('branch_head_profile_id', actor.profileId)
    .order('created_at', { ascending: false });
  if (result.error) throw result.error;
  return enrichSurveyRequestsWithContext(client, result.data || []);
}

export async function listOperationsManagerSurveyTasks(client, actor) {
  requireRole(actor, ['Operations Manager'], 'operations_survey_denied', 'Operations Manager access is required.');
  const result = await client.from('site_visits')
    .select('id,lead_id,client_name,site_name,site_location,owner_state,scheduled_visit_date,status,current_stage,pending_with,source_lead_mom_id,branch_head_profile_id,assigned_operations_manager_profile_id,routing_status,created_at,updated_at')
    .eq('assigned_operations_manager_profile_id', actor.profileId)
    .order('created_at', { ascending: false });
  if (result.error) throw result.error;
  return enrichSurveyRequestsWithContext(client, result.data || []);
}

function safeProfileName(profile) {
  return profile?.full_name || profile?.employee_code || null;
}

function selectActiveHandoff(handoffs) {
  return handoffs.find((handoff) => handoff.handoff_status === 'accepted')
    || handoffs.find((handoff) => handoff.handoff_status === 'pending')
    || handoffs[0]
    || null;
}

async function enrichSurveyRequestsWithContext(client, visits) {
  if (!visits.length) return [];
  const momIds = [...new Set(visits.map((visit) => visit.source_lead_mom_id).filter(Boolean))];
  const leadIds = [...new Set(visits.map((visit) => visit.lead_id).filter(Boolean))];
  const [moms, leads, handoffs] = await Promise.all([
    momIds.length
      ? client.from('lead_mom')
        .select('id,subject,requirement_discussed,scope_summary,key_points,client_expectations,site_survey_required,preferred_survey_date,site_contact,site_address,survey_notes,mom_status,sent_at')
        .in('id', momIds)
      : { data: [], error: null },
    leadIds.length
      ? client.from('leads')
        .select('id,state,pre_sales_owner_profile_id,created_by_name')
        .in('id', leadIds)
      : { data: [], error: null },
    leadIds.length
      ? client.from('lead_handoffs')
        .select('id,lead_id,from_profile_id,to_profile_id,handoff_status,accepted_at,created_at')
        .in('lead_id', leadIds)
        .order('created_at', { ascending: false })
      : { data: [], error: null },
  ]);
  if (moms.error) throw moms.error;
  if (leads.error) throw leads.error;
  if (handoffs.error) throw handoffs.error;

  const momById = new Map((moms.data || []).map((mom) => [mom.id, mom]));
  const leadById = new Map((leads.data || []).map((lead) => [lead.id, lead]));
  const handoffsByLead = new Map();
  for (const handoff of handoffs.data || []) {
    const rows = handoffsByLead.get(handoff.lead_id) || [];
    rows.push(handoff);
    handoffsByLead.set(handoff.lead_id, rows);
  }

  const activeHandoffByLead = new Map(
    leadIds.map((leadId) => [leadId, selectActiveHandoff(handoffsByLead.get(leadId) || [])]),
  );
  const profileIds = [...new Set(visits.flatMap((visit) => {
    const lead = leadById.get(visit.lead_id);
    const handoff = activeHandoffByLead.get(visit.lead_id);
    return [
      lead?.pre_sales_owner_profile_id,
      handoff?.from_profile_id,
      handoff?.to_profile_id,
      visit.branch_head_profile_id,
      visit.assigned_operations_manager_profile_id,
    ];
  }).filter(Boolean))];
  const profiles = profileIds.length
    ? await client.from('profiles').select('id,full_name,employee_code').in('id', profileIds)
    : { data: [], error: null };
  if (profiles.error) throw profiles.error;
  const profileById = new Map((profiles.data || []).map((profile) => [profile.id, profile]));

  return visits.map((visit) => {
    const mom = momById.get(visit.source_lead_mom_id) || null;
    const lead = leadById.get(visit.lead_id) || null;
    const handoff = activeHandoffByLead.get(visit.lead_id) || null;
    const preSalesProfile = profileById.get(lead?.pre_sales_owner_profile_id)
      || profileById.get(handoff?.from_profile_id);
    return {
      ...visit,
      lead_state: lead?.state || visit.owner_state || null,
      preferred_survey_date: mom?.preferred_survey_date || null,
      assigned_bd_name: safeProfileName(profileById.get(handoff?.to_profile_id)),
      originating_pre_sales_name: safeProfileName(preSalesProfile) || lead?.created_by_name || null,
      assigned_branch_head_name: safeProfileName(profileById.get(visit.branch_head_profile_id)),
      assigned_operations_manager_name: safeProfileName(profileById.get(visit.assigned_operations_manager_profile_id)),
      mom,
    };
  });
}

export async function listBranchOperationsManagers(client, actor, siteVisitId) {
  requireRole(actor, ['Branch Head'], 'branch_survey_denied', 'Branch Head access is required.');
  const visit = await client.from('site_visits').select('id,branch_head_profile_id,owner_state').eq('id', siteVisitId).maybeSingle();
  if (visit.error) throw visit.error;
  if (!visit.data) throw httpError(404, 'site_survey_not_found', 'Site Survey request not found.');
  if (visit.data.branch_head_profile_id !== actor.profileId) throw httpError(403, 'site_survey_not_assigned_to_branch_head', 'This Site Survey request is assigned to another Branch Head.');
  const hierarchy = await client.from('employee_hierarchy').select('employee_code').eq('manager_employee_code', actor.employeeCode).eq('is_active', true);
  if (hierarchy.error) throw hierarchy.error;
  const codes = [...new Set((hierarchy.data || []).map((row) => row.employee_code).filter(Boolean))];
  if (!codes.length) return [];
  const profiles = await client.from('profiles').select('id,employee_code,full_name,role,state,branch').in('employee_code', codes).eq('role', 'Operations Manager').eq('is_active', true).ilike('status', 'active').order('full_name');
  if (profiles.error) throw profiles.error;
  return (profiles.data || []).filter((profile) => (
    stateScopeAllows(profile.state, visit.data.owner_state)
  ));
}

export async function assignSurveyOperationsManager(client, actor, siteVisitId, operationsManagerProfileId) {
  requireRole(actor, ['Branch Head'], 'branch_survey_denied', 'Branch Head access is required.');
  const managerId = text(operationsManagerProfileId);
  if (!managerId) throw httpError(400, 'operations_manager_required', 'Select an Operations Manager.');
  try {
    const result = await client.rpc('rpc_assign_site_survey_operations_manager', {
      p_site_visit_id: siteVisitId,
      p_branch_head_profile_id: actor.profileId,
      p_operations_manager_profile_id: managerId,
    });
    if (result.error) throw rpcError(result.error);
    return result.data;
  } catch (error) {
    throw rpcError(error);
  }
}
