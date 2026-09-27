import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assignSurveyOperationsManager,
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
      { id: 'om-ka-1', employee_code: 'OM-KA-1', full_name: 'Abhishek Kutre', role: 'Operations Manager', state: 'KA', auth_user_id: 'auth-ka-1' },
      { id: 'om-tn-1', employee_code: 'OM-TN-1', full_name: 'Different State OM', role: 'Operations Manager', state: 'TN', auth_user_id: 'auth-tn-1' },
    ],
    new_business_operations_manager_state_scope: [
      { operations_manager_profile_id: 'om-ka-1', state: 'KA' },
      { operations_manager_profile_id: 'om-tn-1', state: 'TN' },
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
  assert.ok(client.calls.some((call) => call.table === 'new_business_operations_manager_state_scope'
    && call.method === 'eq' && call.args[0] === 'is_active' && call.args[1] === true));
  assert.equal(client.calls.some((call) => call.args[0] === 'business'), false);
});

test('new-business OM candidates require explicit State scope, auth mapping and direct hierarchy', async () => {
  const client = queryClient({
    site_visits: { id: 'visit-ap-1', branch_head_profile_id: 'branch-ap-1', owner_state: 'AP-1' },
    employee_hierarchy: [
      { employee_code: 'OM-AP-SCOPED' },
      { employee_code: 'OM-AP-NO-SCOPE' },
      { employee_code: 'OM-AP-NO-AUTH' },
    ],
    profiles: [
      { id: 'om-ap-scoped', employee_code: 'OM-AP-SCOPED', full_name: 'Scoped OM', role: 'Operations Manager', state: 'AP', auth_user_id: 'auth-ap' },
      { id: 'om-ap-no-scope', employee_code: 'OM-AP-NO-SCOPE', full_name: 'Unscoped OM', role: 'Operations Manager', state: 'AP', auth_user_id: 'auth-ap-2' },
      { id: 'om-ap-no-auth', employee_code: 'OM-AP-NO-AUTH', full_name: 'No Auth OM', role: 'Operations Manager', state: 'AP', auth_user_id: null },
    ],
    new_business_operations_manager_state_scope: [
      { operations_manager_profile_id: 'om-ap-scoped', state: 'AP-1' },
      { operations_manager_profile_id: 'om-ap-no-auth', state: 'AP-1' },
    ],
  });

  const result = await listBranchOperationsManagers(client, {
    role: 'Branch Head', profileId: 'branch-ap-1', employeeCode: 'BH-AP',
  }, 'visit-ap-1');

  assert.deepEqual(result.map((profile) => profile.id), ['om-ap-scoped']);
  assert.equal(Object.hasOwn(result[0], 'auth_user_id'), false);
});

test('KL and AP fail closed when no explicit OM State scope exists', async () => {
  for (const ownerState of ['KL', 'AP-1', 'AP-2']) {
    const client = queryClient({
      site_visits: { id: `visit-${ownerState}`, branch_head_profile_id: 'branch-1', owner_state: ownerState },
      employee_hierarchy: [{ employee_code: 'OM-1' }],
      profiles: [{ id: 'om-1', employee_code: 'OM-1', full_name: 'Direct OM', role: 'Operations Manager', state: ownerState === 'KL' ? 'KL' : 'AP', auth_user_id: 'auth-1' }],
      new_business_operations_manager_state_scope: [],
    });
    const result = await listBranchOperationsManagers(client, {
      role: 'Branch Head', profileId: 'branch-1', employeeCode: 'BH-1',
    }, `visit-${ownerState}`);
    assert.deepEqual(result, []);
  }
});

test('one OM may be explicitly scoped to multiple new-business States', async () => {
  for (const ownerState of ['AP-1', 'AP-2']) {
    const client = queryClient({
      site_visits: { id: `visit-${ownerState}`, branch_head_profile_id: 'branch-ap', owner_state: ownerState },
      employee_hierarchy: [{ employee_code: 'OM-AP' }],
      profiles: [{ id: 'om-ap', employee_code: 'OM-AP', full_name: 'Multi-State OM', role: 'Operations Manager', state: 'AP', auth_user_id: 'auth-ap' }],
      new_business_operations_manager_state_scope: [
        { operations_manager_profile_id: 'om-ap', state: 'AP-1' },
        { operations_manager_profile_id: 'om-ap', state: 'AP-2' },
      ],
    });
    const result = await listBranchOperationsManagers(client, {
      role: 'Branch Head', profileId: 'branch-ap', employeeCode: 'BH-AP',
    }, `visit-${ownerState}`);
    assert.deepEqual(result.map((profile) => profile.id), ['om-ap']);
  }
});

test('OM assignment maps precise database eligibility failures', async () => {
  for (const [message, expectedCode] of [
    ['operations_manager_not_eligible', 'operations_manager_not_eligible'],
    ['operations_manager_not_active', 'operations_manager_not_active'],
    ['operations_manager_auth_mapping_missing', 'operations_manager_auth_mapping_missing'],
    ['operations_manager_state_scope_missing', 'operations_manager_state_scope_missing'],
    ['operations_manager_not_direct_report', 'operations_manager_not_direct_report'],
  ]) {
    const client = rpcClient({ data: null, error: { code: '42501', message } });
    await assert.rejects(
      assignSurveyOperationsManager(client, {
        role: 'Branch Head', profileId: 'branch-1', employeeCode: 'BH-1',
      }, 'visit-1', 'om-1'),
      (error) => error.code === expectedCode,
    );
  }
});
