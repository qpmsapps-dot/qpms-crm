import test from 'node:test';
import assert from 'node:assert/strict';
import {
  listBranchOperationsManagers,
  prepareOpportunityProposal,
  sendOpportunityProposal,
} from '../services/opportunityWorkflowService.js';

function rpcClient(response = { data: { ok: true }, error: null }) {
  const calls = [];
  return {
    calls,
    async rpc(name, payload) {
      calls.push({ name, payload });
      return response;
    },
  };
}

const assignedBd = { role: 'BD Executive', profileId: 'bd-profile-1' };

function queryClient(fixtures) {
  const calls = [];
  return {
    calls,
    from(table) {
      const fixture = fixtures[table];
      const query = {};
      for (const method of ['select', 'eq', 'in', 'ilike', 'order']) {
        query[method] = (...args) => {
          calls.push({ table, method, args });
          return query;
        };
      }
      query.maybeSingle = async () => ({ data: fixture, error: null });
      query.then = (resolve) => resolve({ data: fixture, error: null });
      return query;
    },
  };
}

test('assigned BD prepares a proposal through the actor-specific atomic RPC', async () => {
  const client = rpcClient();
  await prepareOpportunityProposal(client, assignedBd, 'lead-1', {
    proposal_number: 'PROP-1', template_name: 'Standard', summary: 'Client scope',
  }, 'prepare-key');
  assert.deepEqual(client.calls, [{
    name: 'rpc_prepare_opportunity_proposal',
    payload: {
      p_lead_id: 'lead-1',
      p_actor_profile_id: 'bd-profile-1',
      p_payload: { proposal_number: 'PROP-1', template_name: 'Standard', summary: 'Client scope' },
      p_idempotency_key: 'prepare-key',
    },
  }]);
});

test('assigned BD sends a prepared proposal through the actor-specific atomic RPC', async () => {
  const client = rpcClient();
  await sendOpportunityProposal(client, assignedBd, 'proposal-1', 'send-key');
  assert.deepEqual(client.calls, [{
    name: 'rpc_send_opportunity_proposal',
    payload: {
      p_proposal_id: 'proposal-1',
      p_actor_profile_id: 'bd-profile-1',
      p_idempotency_key: 'send-key',
    },
  }]);
});

test('non-BD users cannot invoke proposal preparation or sending', async () => {
  const client = rpcClient();
  await assert.rejects(
    prepareOpportunityProposal(client, { role: 'Pre-Sales', profileId: 'pre-1' }, 'lead-1', {}, 'key'),
    (error) => error.statusCode === 403 && error.code === 'proposal_prepare_denied',
  );
  await assert.rejects(
    sendOpportunityProposal(client, { role: 'Branch Head', profileId: 'branch-1' }, 'proposal-1', 'key'),
    (error) => error.statusCode === 403 && error.code === 'proposal_send_denied',
  );
  assert.equal(client.calls.length, 0);
});

test('KA Branch Head resolves only State-compatible direct-report Operations Managers without Business filtering', async () => {
  const client = queryClient({
    site_visits: { id: 'visit-ka-1', branch_head_profile_id: 'branch-ka-1', owner_state: 'KA' },
    employee_hierarchy: [{ employee_code: 'OM-KA-1' }, { employee_code: 'OM-TN-1' }],
    profiles: [
      { id: 'om-ka-1', employee_code: 'OM-KA-1', full_name: 'Abhishek Kutre', role: 'Operations Manager', state: 'KA' },
      { id: 'om-tn-1', employee_code: 'OM-TN-1', full_name: 'Different State OM', role: 'Operations Manager', state: 'TN' },
    ],
  });

  const result = await listBranchOperationsManagers(client, {
    role: 'Branch Head',
    profileId: 'branch-ka-1',
    employeeCode: 'BH-KA-1',
  }, 'visit-ka-1');

  assert.deepEqual(result.map((profile) => profile.id), ['om-ka-1']);
  assert.ok(client.calls.some((call) => call.table === 'employee_hierarchy'
    && call.method === 'eq' && call.args[0] === 'manager_employee_code' && call.args[1] === 'BH-KA-1'));
  assert.ok(client.calls.some((call) => call.table === 'profiles'
    && call.method === 'eq' && call.args[0] === 'role' && call.args[1] === 'Operations Manager'));
  assert.equal(client.calls.some((call) => call.args[0] === 'business'), false);
});
