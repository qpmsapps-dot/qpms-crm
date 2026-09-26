import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function source(relative) {
  return readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf8');
}

test('Pre-Sales meeting form requires a legitimate BD assignment and uses the atomic endpoint', () => {
  const form = source('src/components/preSales/AddCallUpdateForm.jsx');
  const details = source('src/pages/preSales/PreSalesLeadDetails.jsx');
  const api = source('src/services/preSalesApi.js');
  assert.match(form, /getBdHandoffAssignees/);
  assert.match(form, /Select a BD user before scheduling the meeting/);
  assert.match(form, /Schedule Meeting & Handover to BD/);
  assert.doesNotMatch(form, /qualified:/);
  assert.match(details, /scheduleMeetingAndHandoff/);
  assert.match(details, /meetingHandoffKey/);
  assert.match(api, /meeting-handover/);
});

test('BD owns handoff decisions, meeting MOM, survey decision, and final outcome UI', () => {
  const sourceText = source('src/components/preSales/BdOpportunityWork.jsx');
  assert.match(sourceText, /acceptHandoff/);
  assert.match(sourceText, /rejectHandoff/);
  assert.match(sourceText, /Complete Meeting & Create MOM/);
  assert.match(sourceText, /Site Survey Required/);
  assert.match(sourceText, /prepareOpportunityProposal/);
  assert.match(sourceText, /Prepare Proposal/);
  assert.match(sourceText, /sendOpportunityProposal/);
  assert.match(sourceText, /Send Proposal/);
  assert.match(sourceText, /recordProposalOutcome/);
  assert.match(sourceText, /Mark Converted/);
  assert.match(sourceText, /Mark Lost/);
});

test('Branch Head and Operations Manager use an assignment-specific queue', () => {
  const page = source('src/pages/SiteSurveyRequests.jsx');
  const roles = source('src/utils/authRoles.js');
  const service = source('backend/services/opportunityWorkflowService.js');
  const surveyProjection = service.slice(
    service.indexOf('export async function listBranchHeadSurveyRequests'),
    service.indexOf('export async function listBranchOperationsManagers'),
  );
  assert.match(page, /getBranchHeadSiteSurveys/);
  assert.match(page, /getAssignedOperationsSiteSurveys/);
  assert.match(page, /Only validated direct reports are available/);
  assert.match(page, /Lead State/);
  assert.match(page, /Preferred Survey Date/);
  assert.match(page, /Assigned BD/);
  assert.match(page, /Originating Pre-Sales/);
  assert.match(page, /Assigned Branch Head/);
  assert.match(roles, /site-survey-requests/);
  assert.match(surveyProjection, /\.eq\('branch_head_profile_id', actor\.profileId\)/);
  assert.match(surveyProjection, /\.eq\('assigned_operations_manager_profile_id', actor\.profileId\)/);
  assert.match(surveyProjection, /lead_state/);
  assert.match(surveyProjection, /preferred_survey_date/);
  assert.match(surveyProjection, /assigned_bd_name/);
  assert.match(surveyProjection, /originating_pre_sales_name/);
  assert.match(surveyProjection, /assigned_branch_head_name/);
  assert.doesNotMatch(surveyProjection, /\bbusiness\b/i);
  for (const sensitive of ['proposal_value', 'margin_percent', 'finance_remarks', 'commercial_remarks', 'proposal_payload', 'kyc']) {
    assert.doesNotMatch(surveyProjection, new RegExp(sensitive, 'i'));
  }
});

test('READ_ONLY_UAT_MODE still guards every new mutation route', () => {
  const routes = source('backend/routes/preSalesRoutes.js');
  assert.match(routes, /meeting-handover'.*mutationGuards/s);
  assert.match(routes, /meetings\/:meetingId\/mom'.*workflowMutationGuards/s);
  assert.match(routes, /assign-operations-manager'.*workflowMutationGuards/s);
  assert.match(routes, /leads\/:leadId\/proposals'.*workflowMutationGuards/s);
  assert.match(routes, /proposals\/:proposalId\/send'.*workflowMutationGuards/s);
  assert.match(routes, /proposals\/:proposalId\/outcome'.*workflowMutationGuards/s);
  assert.match(routes, /createRequireWritablePreSalesEnvironment/);
});

test('Opportunity Progress remains sanitized and includes pending-with lifecycle fields', () => {
  const progress = source('backend/services/preSalesOpportunityProgressService.js');
  for (const field of [
    'pending_with_department',
    'pending_with_user_safe_label',
    'pending_with_user',
    'meeting_status',
    'bd_handover_status',
    'mom_status',
    'site_survey_required',
    'branch_assignment_status',
    'operations_manager_assignment_status',
    'proposal_sent_at',
    'client_decision_status',
    'final_outcome',
  ]) assert.match(progress, new RegExp(field));
  for (const sensitive of ['proposal_value', 'margin_percent', 'commercial_costing_summary', 'proposal_payload', 'kyc']) {
    assert.doesNotMatch(progress, new RegExp(sensitive, 'i'));
  }
});

test('new-business UI treats missing Business as unassigned rather than an access failure', () => {
  const details = source('src/pages/preSales/PreSalesLeadDetails.jsx');
  const bdWork = source('src/components/preSales/BdOpportunityWork.jsx');
  assert.match(details, /label === 'Business' \? 'To be finalized'/);
  assert.match(bdWork, /Business to be finalized/);
});
