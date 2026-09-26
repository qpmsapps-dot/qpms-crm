import test from 'node:test';
import assert from 'node:assert/strict';
import {
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
