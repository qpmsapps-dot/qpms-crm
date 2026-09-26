import { canViewLead, cleanText, normalizeLeadRole } from './leadManagementService.js';
import { getPostHandoverState } from './preSalesService.js';

const STAGES = Object.freeze([
  ['bd_survey', 'Site Visit / Survey', 'Business Development'],
  ['operations_review', 'Operations Review', 'Operations'],
  ['coordinator_costing', 'Coordinator Costing', 'Coordinator'],
  ['hr_validation', 'HR Validation', 'Human Resources'],
  ['commercial_review', 'Commercial Review', 'Commercial'],
  ['finance_review', 'Finance Review', 'Finance'],
  ['returned_to_bd', 'Returned to BD', 'Business Development'],
  ['proposal_preparation', 'Proposal Preparation', 'Business Development'],
  ['proposal', 'Proposal', 'Business Development'],
]);
const stageMap = new Map(STAGES.map(([code, label, department], index) => [code, { code, label, department, index }]));

function httpError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function safeSummary(value, fallback) {
  const text = cleanText(value || fallback);
  return text.length > 240 ? `${text.slice(0, 237)}...` : text;
}

function timelineItem({ id, category, stageCode, stageLabel, status, at, department, user, summary, source }) {
  return {
    id: String(id), category, stage_code: stageCode || null, stage_label: stageLabel,
    status: status || null, occurred_at: at || null, responsible_department: department || null,
    responsible_user: user || null, summary: safeSummary(summary, stageLabel), source,
  };
}

function latestByDate(rows, fields = ['updated_at', 'created_at']) {
  return [...rows].sort((left, right) => {
    const leftAt = fields.map((field) => left?.[field]).find(Boolean);
    const rightAt = fields.map((field) => right?.[field]).find(Boolean);
    return new Date(rightAt || 0) - new Date(leftAt || 0);
  })[0] || null;
}

async function rows(query) {
  const result = await query;
  if (result.error) throw result.error;
  return result.data || [];
}

export async function getOpportunityProgress(client, actor, leadId) {
  const leadResult = await client.from('leads')
    .select('id,client_name,status,lead_stage,pre_sales_stage,state,business,branch,created_at,updated_at,last_activity_at,created_by_name,created_by_user_id,pre_sales_owner_profile_id,assigned_bd_email')
    .eq('id', leadId).maybeSingle();
  if (leadResult.error) throw leadResult.error;
  if (!leadResult.data) throw httpError(404, 'lead_not_found', 'Lead not found.');
  const lead = leadResult.data;
  if (!canViewLead(actor, lead)) throw httpError(403, 'lead_access_denied', 'You do not have access to this lead.');

  const [calls, followups, meetings, handoffs, moms, visits, assessments, workflows, approvals, proposals] = await Promise.all([
    rows(client.from('lead_call_updates').select('id,feedback_type,notes,created_at,created_by_name').eq('lead_id', leadId)),
    rows(client.from('lead_followups').select('id,followup_type,status,scheduled_at,completed_at,created_at').eq('lead_id', leadId)),
    rows(client.from('lead_meetings').select('id,meeting_status,requirement_identified,scheduled_at,completed_at,created_at,assigned_bd_profile_id').eq('lead_id', leadId)),
    rows(client.from('lead_handoffs').select('id,meeting_id,to_profile_id,handoff_status,created_at,accepted_at,rejected_at').eq('lead_id', leadId)),
    rows(client.from('lead_mom').select('id,meeting_id,mom_status,site_survey_required,sent_at,created_at,updated_at').eq('lead_id', leadId)),
    rows(client.from('site_visits').select('id,status,current_stage,pending_with,assigned_profile_id,branch_head_profile_id,assigned_operations_manager_profile_id,routing_status,created_at,updated_at').eq('lead_id', leadId)),
    rows(client.from('site_assessments').select('id,status,assessment_status,current_stage,created_at,updated_at').eq('lead_id', leadId)),
    rows(client.from('workflow_instances').select('id,assessment_id,current_stage_code,status,pending_role,approval_status,created_at,updated_at,completed_at').eq('lead_id', leadId)),
    rows(client.from('approval_requests').select('id,stage_code,approval_stage,pending_with,status,requested_at,decided_at,created_at,updated_at').eq('lead_id', leadId)),
    rows(client.from('proposals').select('id,proposal_status,generated_at,sent_at,created_at,updated_at').eq('lead_id', leadId)),
  ]);

  // Reviews are fetched only for authorized workflow IDs and contain no remarks/metadata.
  let authorizedReviews = [];
  let workflowStatuses = [];
  let assignments = [];
  const workflowIds = workflows.map((item) => item.id);
  if (workflowIds.length) {
    [authorizedReviews, workflowStatuses, assignments] = await Promise.all([
      rows(client.from('site_assessment_reviews')
        .select('id,stage_code,decision,reviewer_role,created_at,workflow_instance_id')
        .in('workflow_instance_id', workflowIds)),
      rows(client.from('workflow_status')
        .select('workflow_instance_id,stage_code,stage_label,pending_role,status,updated_at')
        .in('workflow_instance_id', workflowIds)),
      rows(client.from('workflow_assignments')
        .select('id,workflow_instance_id,stage_code,assigned_role,assigned_profile_id,status,created_at,completed_at')
        .in('workflow_instance_id', workflowIds)),
    ]);
  }
  const assignedProfileIds = [...new Set([
    ...assignments.map((item) => item.assigned_profile_id),
    ...handoffs.map((item) => item.to_profile_id),
    ...meetings.map((item) => item.assigned_bd_profile_id),
    ...visits.flatMap((item) => [item.assigned_profile_id, item.branch_head_profile_id, item.assigned_operations_manager_profile_id]),
  ].filter(Boolean))];
  const assignedProfiles = assignedProfileIds.length
    ? await rows(client.from('profiles').select('id,full_name,employee_code').in('id', assignedProfileIds))
    : [];
  const profileName = new Map(assignedProfiles.map((profile) => [profile.id, profile.full_name || profile.employee_code]));

  const timeline = [timelineItem({
    id: `lead-${lead.id}`, category: 'lead', stageLabel: 'Lead Created', status: lead.status,
    at: lead.created_at, department: 'Pre-Sales', user: lead.created_by_name, summary: 'Lead created', source: 'leads',
  })];
  for (const row of calls) timeline.push(timelineItem({ id: `call-${row.id}`, category: 'call', stageLabel: 'Call Activity', status: row.feedback_type, at: row.created_at, department: 'Pre-Sales', user: row.created_by_name, summary: row.notes, source: 'lead_call_updates' }));
  for (const row of followups) timeline.push(timelineItem({ id: `followup-${row.id}`, category: 'followup', stageLabel: 'Follow-up', status: row.status, at: row.completed_at || row.scheduled_at || row.created_at, department: 'Pre-Sales', summary: row.followup_type, source: 'lead_followups' }));
  for (const row of meetings) timeline.push(timelineItem({ id: `meeting-${row.id}`, category: 'meeting', stageLabel: row.requirement_identified ? 'Requirement Identified' : 'Client Meeting', status: row.meeting_status, at: row.completed_at || row.scheduled_at || row.created_at, department: row.assigned_bd_profile_id ? 'Business Development' : 'Pre-Sales', user: profileName.get(row.assigned_bd_profile_id), summary: row.requirement_identified ? 'Requirement identified' : 'Client meeting activity', source: 'lead_meetings' }));
  for (const row of handoffs) timeline.push(timelineItem({ id: `handoff-${row.id}`, category: 'handover', stageLabel: 'Handed to BD', status: row.handoff_status, at: row.accepted_at || row.rejected_at || row.created_at, department: 'Business Development', summary: `BD handover ${row.handoff_status}`, source: 'lead_handoffs' }));
  for (const row of moms) timeline.push(timelineItem({ id: `mom-${row.id}`, category: 'mom', stageLabel: 'Meeting MOM', status: row.mom_status, at: row.sent_at || row.updated_at || row.created_at, department: 'Business Development', summary: row.site_survey_required ? 'MOM submitted; Site Survey required' : 'MOM submitted; Site Survey not required', source: 'lead_mom' }));
  for (const row of visits) timeline.push(timelineItem({ id: `visit-${row.id}`, category: 'site_visit', stageCode: row.current_stage, stageLabel: 'Site Visit / Survey', status: row.status, at: row.updated_at || row.created_at, department: row.assigned_operations_manager_profile_id ? 'Operations' : 'Branch Head', user: profileName.get(row.assigned_operations_manager_profile_id) || profileName.get(row.branch_head_profile_id), summary: 'Site visit workflow started', source: 'site_visits' }));
  for (const row of assessments) timeline.push(timelineItem({ id: `assessment-${row.id}`, category: 'site_assessment', stageCode: row.current_stage, stageLabel: 'Site Visit / Survey', status: row.assessment_status || row.status, at: row.updated_at || row.created_at, department: 'Business Development', summary: 'Site assessment status updated', source: 'site_assessments' }));
  for (const row of workflows) {
    const stage = stageMap.get(row.current_stage_code);
    timeline.push(timelineItem({ id: `workflow-${row.id}`, category: 'workflow', stageCode: row.current_stage_code, stageLabel: stage?.label || row.current_stage_code, status: row.status || row.approval_status, at: row.completed_at || row.updated_at || row.created_at, department: stage?.department, user: row.pending_role, summary: `${stage?.label || row.current_stage_code}: ${row.status}`, source: 'workflow_instances' }));
  }
  for (const row of approvals) {
    const stage = stageMap.get(row.stage_code);
    timeline.push(timelineItem({ id: `approval-${row.id}`, category: 'approval', stageCode: row.stage_code, stageLabel: stage?.label || row.approval_stage || row.stage_code, status: row.status, at: row.decided_at || row.requested_at || row.updated_at || row.created_at, department: stage?.department, user: row.pending_with, summary: `${stage?.label || row.approval_stage}: ${row.status}`, source: 'approval_requests' }));
  }
  for (const row of authorizedReviews) {
    const stage = stageMap.get(row.stage_code);
    timeline.push(timelineItem({ id: `review-${row.id}`, category: 'review', stageCode: row.stage_code, stageLabel: stage?.label || row.stage_code, status: row.decision, at: row.created_at, department: stage?.department, user: row.reviewer_role, summary: `${stage?.label || row.stage_code}: ${row.decision}`, source: 'site_assessment_reviews' }));
  }
  for (const row of proposals) timeline.push(timelineItem({ id: `proposal-${row.id}`, category: 'proposal', stageCode: 'proposal', stageLabel: row.proposal_status === 'Sent' ? 'Proposal Sent' : 'Proposal Prepared', status: row.proposal_status, at: row.sent_at || row.generated_at || row.updated_at || row.created_at, department: 'Business Development', summary: `Proposal ${row.proposal_status}`, source: 'proposals' }));
  if (['Converted', 'Lost'].includes(lead.status) || ['Converted', 'Lost'].includes(lead.lead_stage)) {
    const outcome = ['Converted', 'Lost'].includes(lead.status) ? lead.status : lead.lead_stage;
    timeline.push(timelineItem({ id: `outcome-${lead.id}`, category: 'final_outcome', stageCode: outcome.toLowerCase(), stageLabel: outcome, status: outcome, at: lead.updated_at, department: 'Business Development', summary: `Client decision: ${outcome}`, source: 'leads' }));
  }

  timeline.sort((left, right) => new Date(left.occurred_at || 0) - new Date(right.occurred_at || 0));
  const workflow = latestByDate(workflows);
  const workflowStatus = latestByDate(workflowStatuses);
  const pendingAssignment = latestByDate(assignments.filter((item) => item.status === 'Pending'), ['created_at']);
  const visit = latestByDate(visits);
  const proposal = latestByDate(proposals, ['sent_at', 'generated_at', 'updated_at', 'created_at']);
  const meeting = latestByDate(meetings, ['completed_at', 'scheduled_at', 'created_at']);
  const handoff = latestByDate(handoffs, ['accepted_at', 'rejected_at', 'created_at']);
  const mom = latestByDate(moms, ['sent_at', 'updated_at', 'created_at']);
  const noSurveyProposalPreparation = handoff?.handoff_status === 'accepted'
    && mom?.mom_status === 'Sent' && mom?.site_survey_required === false && !proposal;
  const stageCode = workflowStatus?.stage_code || workflow?.current_stage_code || visit?.current_stage
    || (proposal ? 'proposal' : noSurveyProposalPreparation ? 'proposal_preparation' : lead.pre_sales_stage || 'new_lead');
  const stage = stageMap.get(stageCode);
  const finalOutcome = ['Converted', 'Lost'].includes(lead.status) ? lead.status : ['Converted', 'Lost'].includes(lead.lead_stage) ? lead.lead_stage : null;
  const clientDecisionPending = proposal?.proposal_status === 'Sent' && !finalOutcome;
  const state = await getPostHandoverState(client, lead);
  const nextStage = finalOutcome || clientDecisionPending
    ? null
    : proposal?.proposal_status === 'Generated'
      ? 'proposal_sent'
      : noSurveyProposalPreparation
        ? 'proposal'
        : stage ? STAGES[stage.index + 1]?.[0] || null : null;

  return {
    lead_id: lead.id,
    access_mode: state.post_handover && normalizeLeadRole(actor.role) === 'Pre-Sales' ? 'read_only' : 'action',
    current_stage: stageCode,
    current_stage_label: finalOutcome || (clientDecisionPending ? 'Client Decision Pending' : workflowStatus?.stage_label || stage?.label || stageCode),
    current_status: finalOutcome || (clientDecisionPending ? 'Client Decision Pending' : workflowStatus?.status || workflow?.approval_status || workflow?.status || visit?.status || lead.status),
    responsible_department: finalOutcome ? null : clientDecisionPending ? 'Client Decision' : stage?.department || (state.post_handover ? 'Business Development' : 'Pre-Sales'),
    responsible_user: profileName.get(pendingAssignment?.assigned_profile_id)
      || profileName.get(visit?.assigned_operations_manager_profile_id)
      || profileName.get(visit?.branch_head_profile_id)
      || profileName.get(handoff?.to_profile_id)
      || workflowStatus?.pending_role || workflow?.pending_role || visit?.pending_with || null,
    pending_with_user: profileName.get(pendingAssignment?.assigned_profile_id)
      || profileName.get(visit?.assigned_operations_manager_profile_id)
      || profileName.get(visit?.branch_head_profile_id)
      || profileName.get(handoff?.to_profile_id)
      || null,
    pending_with_department: finalOutcome ? null : clientDecisionPending ? 'Client Decision' : workflowStatus?.pending_role || workflow?.pending_role || visit?.pending_with || stage?.department || (state.post_handover ? 'Business Development' : 'Pre-Sales'),
    pending_with_user_safe_label: profileName.get(pendingAssignment?.assigned_profile_id)
      || profileName.get(visit?.assigned_operations_manager_profile_id)
      || profileName.get(visit?.branch_head_profile_id)
      || profileName.get(handoff?.to_profile_id)
      || null,
    last_updated: timeline.at(-1)?.occurred_at || lead.last_activity_at || lead.updated_at || lead.created_at,
    next_stage: finalOutcome || clientDecisionPending ? null : nextStage,
    proposal_status: proposal?.proposal_status || null,
    proposal_sent_at: proposal?.sent_at || null,
    client_decision_status: finalOutcome || (clientDecisionPending ? 'Pending' : null),
    final_outcome: finalOutcome,
    meeting_status: meeting?.meeting_status || null,
    bd_handover_status: handoff?.handoff_status || null,
    handover_status: handoff?.handoff_status || null,
    mom_status: mom?.mom_status || null,
    site_survey_required: mom?.site_survey_required ?? null,
    site_survey_status: visit?.status || null,
    branch_assignment_status: visit?.routing_status || null,
    branch_head_status: visit?.branch_head_profile_id
      ? (visit?.assigned_operations_manager_profile_id ? 'assigned_operations_manager' : 'pending_operations_manager_assignment')
      : visit?.routing_status || null,
    operations_manager_assignment_status: visit?.assigned_operations_manager_profile_id ? 'assigned' : null,
    operations_manager_status: visit?.assigned_operations_manager_profile_id
      ? (latestByDate(assessments)?.assessment_status || 'assigned')
      : null,
    assessment_status: latestByDate(assessments)?.assessment_status || null,
    approval_stage: workflowStatus?.stage_code || workflow?.current_stage_code || null,
    timeline,
  };
}
