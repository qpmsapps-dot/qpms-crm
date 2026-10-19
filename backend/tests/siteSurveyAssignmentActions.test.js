import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  acceptSiteSurveyAssignment,
  declineSiteSurveyAssignment,
  listOperationsManagerSurveyTasks,
} from '../services/opportunityWorkflowService.js';

const operationsManager = { role: 'Operations Manager', profileId: 'om-1' };

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

function assignedSurveyClient(rows) {
  const calls = [];
  const emptyTables = new Set(['lead_mom', 'leads', 'lead_handoffs', 'profiles']);
  return {
    calls,
    from(table) {
      const query = {
        select(columns) { calls.push({ table, method: 'select', columns }); return query; },
        order() { return query; },
        eq(column, value) { calls.push({ table, method: 'eq', column, value }); return query; },
        in() { return query; },
        then(resolve) {
          return resolve({ data: emptyTables.has(table) ? [] : rows, error: null });
        },
      };
      return query;
    },
  };
}

test('assigned-surveys returns persisted acceptance/version fields and remains actor-scoped', async () => {
  const row = {
    id: 'visit-1',
    acceptance_status: 'pending_acceptance',
    assignment_version: 4,
    assigned_operations_manager_profile_id: 'om-1',
  };
  const client = assignedSurveyClient([row]);
  const [result] = await listOperationsManagerSurveyTasks(client, operationsManager);
  assert.equal(result.acceptance_status, 'pending_acceptance');
  assert.equal(result.assignment_version, 4);
  const select = client.calls.find((call) => call.table === 'site_visits' && call.method === 'select');
  assert.match(select.columns, /acceptance_status/);
  assert.match(select.columns, /assignment_version/);
  assert.ok(client.calls.some((call) => call.method === 'eq'
    && call.column === 'assigned_operations_manager_profile_id' && call.value === 'om-1'));
});

test('accept and decline use actor-bound versioned RPCs and decline requires a reason', async () => {
  const client = rpcClient();
  await acceptSiteSurveyAssignment(client, operationsManager, 'visit-1', { assignment_version: 4 });
  await declineSiteSurveyAssignment(client, operationsManager, 'visit-2', { assignment_version: 7, reason: 'Client emergency' });
  assert.deepEqual(client.calls, [
    { name: 'rpc_accept_site_survey_assignment', payload: {
      p_site_visit_id: 'visit-1', p_operations_manager_profile_id: 'om-1', p_expected_assignment_version: 4,
    } },
    { name: 'rpc_decline_site_survey_assignment', payload: {
      p_site_visit_id: 'visit-2', p_operations_manager_profile_id: 'om-1', p_expected_assignment_version: 7, p_reason: 'Client emergency',
    } },
  ]);
  await assert.rejects(
    declineSiteSurveyAssignment(client, operationsManager, 'visit-3', { assignment_version: 1, reason: ' ' }),
    (error) => error.statusCode === 400 && error.code === 'unable_to_attend_reason_required',
  );
});

test('unauthorized and stale-version scenarios are rejected without bypasses', async () => {
  const client = rpcClient();
  await assert.rejects(
    acceptSiteSurveyAssignment(client, { role: 'Branch Head', profileId: 'branch-1' }, 'visit-1', { assignment_version: 1 }),
    (error) => error.statusCode === 403 && error.code === 'operations_survey_denied',
  );
  assert.equal(client.calls.length, 0);

  const stale = rpcClient({ data: null, error: { code: '40001', message: 'site_survey_assignment_version_conflict' } });
  await assert.rejects(
    acceptSiteSurveyAssignment(stale, operationsManager, 'visit-1', { assignment_version: 2 }),
    (error) => error.statusCode === 409 && error.code === 'site_survey_assignment_version_conflict',
  );
});

test('pre-sales routes register authenticated accept and decline mutations', () => {
  const source = readFileSync(new URL('../routes/preSalesRoutes.js', import.meta.url), 'utf8');
  assert.match(source, /site-surveys\/:siteVisitId\/accept'[\s\S]*workflowMutationGuards/);
  assert.match(source, /site-surveys\/:siteVisitId\/unable-to-attend'[\s\S]*workflowMutationGuards/);
});
