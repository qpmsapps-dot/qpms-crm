import test from 'node:test';
import assert from 'node:assert/strict';

import {
  hasAdminOverride,
  isPlatformAdmin,
  isPlatformAdminRole,
} from '../shared/platformAdmin.js';
import { canAccessLeadModule, canViewLead } from '../services/leadManagementService.js';
import {
  listBdOpportunityWork,
  listBranchHeadSurveyRequests,
  listOperationsManagerSurveyTasks,
  prepareOpportunityProposal,
} from '../services/opportunityWorkflowService.js';

function activeActor(role) {
  return { role, profileId: 'admin-profile', is_active: true, status: 'Active' };
}

function queryClient(fixtures = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      const query = {};
      for (const method of ['select', 'eq', 'in', 'order', 'limit']) {
        query[method] = (...args) => {
          calls.push({ table, method, args });
          return query;
        };
      }
      query.then = (resolve) => resolve({ data: fixtures[table] || [], error: null });
      return query;
    },
    async rpc(name, payload) {
      calls.push({ table: 'rpc', method: name, args: [payload] });
      return { data: { ok: true }, error: null };
    },
  };
}

test('central Platform Admin capability preserves established technical aliases only', () => {
  for (const role of ['Admin', 'QPMS Admin', 'Developer', 'Dev', 'IT Admin', 'Management IT Admin']) {
    assert.equal(isPlatformAdminRole(role), true, role);
    assert.equal(isPlatformAdmin({ role }), true, role);
    assert.equal(hasAdminOverride({ rawRole: role }), true, role);
  }
  for (const role of ['Management', 'GM', 'COO', 'DEMO_ADMIN', 'Pre-Sales', '']) {
    assert.equal(isPlatformAdminRole(role), false, role);
  }
});

test('Admin has global Pre-Sales read visibility without changing normal actor scope', () => {
  const unrelatedLead = { id: 'lead-1', state: 'KL', pre_sales_owner_profile_id: 'someone-else' };
  assert.equal(canAccessLeadModule(activeActor('Admin')), true);
  assert.equal(canViewLead(activeActor('Admin'), unrelatedLead), true);
  assert.equal(canViewLead({ role: 'Pre-Sales', profileId: 'pre-1', state: 'TN' }, unrelatedLead), false);
  assert.equal(canAccessLeadModule(activeActor('FO')), false);
});

test('Admin can inspect all BD, Branch Head and OM queues without assignment filters', async () => {
  const client = queryClient();
  await listBdOpportunityWork(client, activeActor('Admin'));
  await listBranchHeadSurveyRequests(client, activeActor('Admin'));
  await listOperationsManagerSurveyTasks(client, activeActor('Admin'));

  assert.equal(client.calls.some((call) => call.table === 'lead_handoffs' && call.method === 'eq' && call.args[0] === 'to_profile_id'), false);
  assert.equal(client.calls.some((call) => call.table === 'site_visits' && call.method === 'eq' && ['branch_head_profile_id', 'assigned_operations_manager_profile_id'].includes(call.args[0])), false);
});

test('Admin may enter a workflow RPC but normal wrong roles remain denied', async () => {
  const client = queryClient();
  await prepareOpportunityProposal(client, activeActor('Admin'), 'lead-1', { summary: 'Admin UAT' }, 'admin-key');
  assert.ok(client.calls.some((call) => call.table === 'rpc' && call.method === 'rpc_prepare_opportunity_proposal'));
  await assert.rejects(
    prepareOpportunityProposal(client, activeActor('FO'), 'lead-1', {}, 'fo-key'),
    (error) => error.statusCode === 403 && error.code === 'proposal_prepare_denied',
  );
});
