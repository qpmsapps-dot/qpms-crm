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
    .select('id,client_name,status,lead_stage,pre_sales_stage,created_at,updated_at,last_activity_at,created_by_name,created_by_user_id,pre_sales_owner_profile_id,assigned_bd_email')
    .eq('id', leadId).maybeSingle();
  if (leadResult.error) throw leadResult.error;
  if (!leadResult.data) throw httpError(404, 'lead_not_found', 'Lead not found.');
  const lead = leadResult.data;
  if (!canViewLead(actor, lead)) throw httpError(403, 'lead_access_denied', 'You do not have access to this lead.');

  const [calls, followups, meetings, handoffs, visits, assessments, workflows, approvals, proposals] = await Promise.all([
    rows(client.from('lead_call_updates').select('id,feedback_type,notes,created_at,created_by_name').eq('lead_id', leadId)),
    rows(client.from('lead_followups').select('id,followup_type,status,scheduled_at,completed_at,created_at').eq('lead_id', leadId)),
    rows(client.from('lead_meetings').select('id,meeting_status,requirement_identified,scheduled_at,completed_at,created_at').eq('lead_id', leadId)),
    rows(client.from('lead_handoffs').select('id,handoff_status,created_at,accepted_at,rejected_at').eq('lead_id', leadId)),
    rows(client.from('site_visits').select('id,status,current_stage,pending_with,assigned_profile_id,created_at,updated_at').eq('lead_id', leadId)),
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
  const assignedProfileIds = [...new Set(assignments.map((item) => item.assigned_profile_id).filter(Boolean))];
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
  for (const row of meetings) timeline.push(timelineItem({ id: `meeting-${row.id}`, category: 'meeting', stageLabel: row.requirement_identified ? 'Requirement Identified' : 'Meeting', status: row.meeting_status, at: row.completed_at || row.scheduled_at || row.created_at, department: 'Pre-Sales', summary: row.requirement_identified ? 'Requirement identified' : 'Meeting activity', source: 'lead_meetings' }));
  for (const row of handoffs) timeline.push(timelineItem({ id: `handoff-${row.id}`, category: 'handover', stageLabel: 'Handed to BD', status: row.handoff_status, at: row.accepted_at || row.rejected_at || row.created_at, department: 'Business Development', summary: `BD handover ${row.handoff_status}`, source: 'lead_handoffs' }));
  for (const row of visits) timeline.push(timelineItem({ id: `visit-${row.id}`, category: 'site_visit', stageCode: row.current_stage, stageLabel: 'Site Visit / Survey', status: row.status, at: row.updated_at || row.created_at, department: 'Business Development', user: row.pending_with, summary: 'Site visit workflow started', source: 'site_visits' }));
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

  timeline.sort((left, right) => new Date(left.occurred_at || 0) - new Date(right.occurred_at || 0));
  const workflow = latestByDate(workflows);
  const workflowStatus = latestByDate(workflowStatuses);
  const pendingAssignment = latestByDate(assignments.filter((item) => item.status === 'Pending'), ['created_at']);
  const visit = latestByDate(visits);
  const proposal = latestByDate(proposals, ['sent_at', 'generated_at', 'updated_at', 'created_at']);
  const stageCode = workflowStatus?.stage_code || workflow?.current_stage_code || visit?.current_stage || (proposal ? 'proposal' : lead.pre_sales_stage || 'new_lead');
  const stage = stageMap.get(stageCode);
  const finalOutcome = ['Converted', 'Lost'].includes(lead.status) ? lead.status : ['Converted', 'Lost'].includes(lead.lead_stage) ? lead.lead_stage : null;
  const state = await getPostHandoverState(client, lead);
  const nextStage = stage ? STAGES[stage.index + 1]?.[0] || null : null;

  return {
    lead_id: lead.id,
    access_mode: state.post_handover && normalizeLeadRole(actor.role) === 'Pre-Sales' ? 'read_only' : 'action',
    current_stage: stageCode,
    current_stage_label: finalOutcome || workflowStatus?.stage_label || stage?.label || stageCode,
    current_status: finalOutcome || workflowStatus?.status || workflow?.status || visit?.status || lead.status,
    responsible_department: finalOutcome ? null : stage?.department || (state.post_handover ? 'Business Development' : 'Pre-Sales'),
    responsible_user: profileName.get(pendingAssignment?.assigned_profile_id) || workflowStatus?.pending_role || workflow?.pending_role || visit?.pending_with || null,
    last_updated: timeline.at(-1)?.occurred_at || lead.last_activity_at || lead.updated_at || lead.created_at,
    next_stage: finalOutcome ? null : nextStage,
    proposal_status: proposal?.proposal_status || null,
    final_outcome: finalOutcome,
    timeline,
  };
}
