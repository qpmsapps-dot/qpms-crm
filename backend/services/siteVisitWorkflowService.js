import { createClient } from '@supabase/supabase-js';

const RPC_BY_OPERATION = Object.freeze({
  convert: 'rpc_convert_lead_to_assessment',
  saveSection: 'rpc_save_assessment_section',
  saveDraft: 'rpc_save_assessment_draft',
  saveMom: 'rpc_save_site_mom',
  registerImage: 'rpc_register_site_image',
  submit: 'rpc_submit_for_review',
  decide: 'rpc_record_approval_decision',
  returnForCorrection: 'rpc_return_assessment_for_correction',
  generateProposal: 'rpc_generate_proposal_record',
  markProposalSent: 'rpc_mark_proposal_sent',
});

export function createSiteVisitUserClient({
  supabaseUrl,
  supabaseAnonKey,
  accessToken,
  clientFactory = createClient,
}) {
  if (!supabaseUrl || !supabaseAnonKey || !accessToken) {
    const error = new Error('Site Visit user-scoped Supabase access is not configured.');
    error.statusCode = 503;
    throw error;
  }
  return clientFactory(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function throwIfError(result, context) {
  if (!result?.error) return result?.data;
  const error = new Error(`${context} failed.`);
  error.code = result.error.code || null;
  error.statusCode = result.error.code === '42501' ? 403 : 500;
  error.cause = result.error;
  throw error;
}

function groupBy(rows, key) {
  return (rows || []).reduce((grouped, row) => {
    grouped[row[key]] = [...(grouped[row[key]] || []), row];
    return grouped;
  }, {});
}

export async function loadSiteVisitWorkflowData(client) {
  const visits = throwIfError(
    await client.from('site_visits').select('*').order('created_at', { ascending: false }),
    'Site Visit load',
  ) || [];
  const visitIds = visits.map((visit) => visit.id);
  if (!visitIds.length) return { siteVisits: [] };

  const [assessmentResult, momResult, approvalResult, eventResult, workflowResult, proposalResult] =
    await Promise.all([
      client.from('site_assessments').select('*').in('site_visit_id', visitIds),
      client.from('site_mom').select('*').in('site_visit_id', visitIds),
      client.from('approval_requests').select('*').in('site_visit_id', visitIds),
      client.from('workflow_events').select('*').in('site_visit_id', visitIds).order('created_at'),
      client.from('workflow_instances').select('*, workflow_assignments(*)').in('site_visit_id', visitIds),
      client.from('proposals').select('*').in('site_visit_id', visitIds),
    ]);
  const assessments = throwIfError(assessmentResult, 'Assessment load') || [];
  const assessmentIds = assessments.map((assessment) => assessment.id);
  const sections = assessmentIds.length
    ? throwIfError(
      await client.from('assessment_sections').select('*').in('assessment_id', assessmentIds).order('version'),
      'Assessment section load',
    ) || []
    : [];

  const assessmentsByVisit = groupBy(assessments, 'site_visit_id');
  const sectionsByAssessment = groupBy(sections, 'assessment_id');
  const momsByVisit = groupBy(throwIfError(momResult, 'Site MOM load') || [], 'site_visit_id');
  const approvalsByVisit = groupBy(
    throwIfError(approvalResult, 'Approval request load') || [],
    'site_visit_id',
  );
  const eventsByVisit = groupBy(throwIfError(eventResult, 'Workflow event load') || [], 'site_visit_id');
  const workflowsByVisit = groupBy(
    throwIfError(workflowResult, 'Workflow instance load') || [],
    'site_visit_id',
  );
  const proposalsByVisit = groupBy(throwIfError(proposalResult, 'Proposal load') || [], 'site_visit_id');

  return {
    siteVisits: visits.map((visit) => ({
      ...visit,
      site_assessments: (assessmentsByVisit[visit.id] || []).map((assessment) => ({
        ...assessment,
        assessment_sections: sectionsByAssessment[assessment.id] || [],
      })),
      site_mom: momsByVisit[visit.id] || [],
      approval_requests: approvalsByVisit[visit.id] || [],
      workflow_events: eventsByVisit[visit.id] || [],
      workflow_instance: workflowsByVisit[visit.id]?.[0] || null,
      proposals: proposalsByVisit[visit.id] || [],
    })),
  };
}

export async function executeSiteVisitWorkflowOperation(client, operation, payload = {}) {
  const functionName = RPC_BY_OPERATION[operation];
  if (!functionName) {
    const error = new Error('Unsupported Site Visit workflow operation.');
    error.statusCode = 400;
    throw error;
  }
  return throwIfError(await client.rpc(functionName, payload), `Site Visit ${operation}`);
}

export const siteVisitWorkflowOperations = Object.freeze(Object.keys(RPC_BY_OPERATION));
