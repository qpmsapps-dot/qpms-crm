import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSiteVisitUserClient,
  executeSiteVisitWorkflowOperation,
  loadSiteVisitWorkflowData,
} from '../backend/services/siteVisitWorkflowService.js';

test('backend user-scoped client forwards the caller JWT without service-role impersonation', () => {
  let received;
  const client = createSiteVisitUserClient({
    supabaseUrl: 'https://safe-project.supabase.co',
    supabaseAnonKey: 'anon-test-key',
    accessToken: 'caller-jwt',
    clientFactory: (...args) => {
      received = args;
      return { scoped: true };
    },
  });
  assert.deepEqual(client, { scoped: true });
  assert.equal(received[2].global.headers.Authorization, 'Bearer caller-jwt');
  assert.equal(received[2].auth.persistSession, false);
});

test('backend rejects unrecognized workflow operations before any RPC call', async () => {
  let called = false;
  await assert.rejects(
    executeSiteVisitWorkflowOperation(
      { rpc: async () => { called = true; } },
      'skipToProposal',
      {},
    ),
    /Unsupported Site Visit workflow operation/,
  );
  assert.equal(called, false);
});

test('backend maps approved operations only to hardened RPC names', async () => {
  let invocation;
  const result = await executeSiteVisitWorkflowOperation(
    {
      rpc: async (name, payload) => {
        invocation = { name, payload };
        return { data: { ok: true }, error: null };
      },
    },
    'saveSection',
    { p_section_code: 'commercial' },
  );
  assert.deepEqual(invocation, {
    name: 'rpc_save_assessment_section',
    payload: { p_section_code: 'commercial' },
  });
  assert.deepEqual(result, { ok: true });
});

function queryResult(data) {
  const query = {
    select: () => query,
    order: () => query,
    in: () => query,
    then(resolve) {
      return Promise.resolve({ data, error: null }).then(resolve);
    },
  };
  return query;
}

test('workflow loader returns a complete assessment with current sections in one normalized dataset', async () => {
  const rowsByTable = {
    site_visits: [{ id: 'visit-1' }],
    site_assessments: [{ id: 'assessment-1', site_visit_id: 'visit-1' }],
    assessment_sections: [{
      id: 'section-1',
      assessment_id: 'assessment-1',
      section_key: 'commercial',
      section_data: { paymentTerms: '30 days' },
      version: 2,
    }],
    site_mom: [],
    approval_requests: [],
    workflow_events: [],
    workflow_instances: [{
      id: 'workflow-1',
      site_visit_id: 'visit-1',
      workflow_assignments: [],
    }],
    proposals: [],
  };
  const result = await loadSiteVisitWorkflowData({
    from(table) {
      return queryResult(rowsByTable[table] || []);
    },
  });
  assert.equal(result.siteVisits.length, 1);
  assert.equal(
    result.siteVisits[0].site_assessments[0].assessment_sections[0].section_data.paymentTerms,
    '30 days',
  );
});

test('workflow load fails clearly instead of returning false empty data on schema errors', async () => {
  const failingQuery = {
    select: () => failingQuery,
    order: () => failingQuery,
    then(resolve) {
      return Promise.resolve({
        data: null,
        error: { code: 'PGRST205', message: 'missing relation' },
      }).then(resolve);
    },
  };
  await assert.rejects(
    loadSiteVisitWorkflowData({ from: () => failingQuery }),
    /Site Visit load failed/,
  );
});
