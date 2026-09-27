import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { canAccessRoute } from '../src/utils/authRoles.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('canonical, legacy, and Platform Admin roles can open the dedicated BD workspace', () => {
  for (const role of [
    'Business Development Executive',
    'Business Development Head',
    'BD Executive',
    'BD Head',
    'Admin',
  ]) assert.equal(canAccessRoute({ role, rawRole: role }, '/business-development'), true, role);

  for (const role of ['Pre-Sales', 'Branch Head', 'Operations Manager', 'FO', 'HR', 'Finance']) {
    assert.equal(canAccessRoute({ role, rawRole: role }, '/business-development'), false, role);
  }
});

test('Sidebar gives BD roles a top-level Business Development workspace instead of Pre-Sales', async () => {
  const sidebar = await read('src/components/Sidebar.jsx');
  const bdNavigation = sidebar.slice(
    sidebar.indexOf('const businessDevelopmentNavGroups'),
    sidebar.indexOf('const operationsManagerNavGroups'),
  );
  assert.match(sidebar, /Business Development.*\/business-development/);
  assert.match(sidebar, /\['BD Executive', 'BD Head'\]\.includes\(canonicalRole\)/);
  assert.match(bdNavigation, /businessDevelopmentNavItem/);
  assert.doesNotMatch(bdNavigation, /preSalesNavItem/);
});

test('BD workspace composes existing workflow actions and safe downstream progress', async () => {
  const [page, work, routes, service] = await Promise.all([
    read('src/pages/BusinessDevelopment.jsx'),
    read('src/components/preSales/BdOpportunityWork.jsx'),
    read('src/routes/AppRoutes.jsx'),
    read('backend/services/opportunityWorkflowService.js'),
  ]);
  for (const label of [
    'My Opportunities', 'Pending Handovers', 'Meetings & MOM', 'Site Survey Progress',
    'Approval Tracking', 'Proposals', 'Notifications',
  ]) assert.match(page, new RegExp(label.replace(/[&]/g, '\\&')));
  assert.match(routes, /path: 'business-development'.*<BusinessDevelopment/s);
  assert.match(work, /acceptHandoff/);
  assert.match(work, /rejectHandoff/);
  assert.match(work, /submitBdMeetingMom/);
  assert.match(work, /OpportunityProgress/);
  assert.match(work, /Branch Head/);
  assert.match(work, /Operations Manager/);
  assert.match(work, /Tender Review/);
  assert.match(work, /This section is read-only/);
  assert.match(service, /\.eq\('to_profile_id', actor\.profileId\)/);
  assert.match(service, /approval_requests/);
  for (const sensitive of ['margin_percent', 'finance_remarks', 'commercial_remarks', 'proposal_payload', 'kyc']) {
    assert.doesNotMatch(service.slice(service.indexOf('export async function listBdOpportunityWork'), service.indexOf('export async function recordProposalOutcome')), new RegExp(sensitive, 'i'));
  }
});

test('proposal controls remain stage-derived and assigned-actor RPC backed', async () => {
  const [work, service] = await Promise.all([
    read('src/components/preSales/BdOpportunityWork.jsx'),
    read('backend/services/opportunityWorkflowService.js'),
  ]);
  assert.match(work, /current_stage_code === 'returned_to_bd'/);
  assert.match(work, /proposal_status === 'Generated'/);
  assert.match(work, /proposal_status === 'Sent'/);
  assert.match(service, /rpc_prepare_opportunity_proposal/);
  assert.match(service, /rpc_send_opportunity_proposal/);
  assert.match(service, /p_actor_profile_id: actor\.profileId/);
});
