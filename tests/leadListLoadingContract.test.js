import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const api = await readFile(new URL('../src/services/api.js', import.meta.url), 'utf8');
const crm = await readFile(new URL('../src/pages/CRM.jsx', import.meta.url), 'utf8');
const repository = await readFile(new URL('../src/services/workflowRepository.js', import.meta.url), 'utf8');
const workflow = await readFile(new URL('../src/context/WorkflowContext.jsx', import.meta.url), 'utf8');

test('valid authenticated workflow calls the secured lead-list endpoint once logically', () => {
  assert.match(api, /url:\s*'\/api\/lead-management\/leads'/);
  assert.match(api, /Authorization:\s*`Bearer \$\{accessToken\}`/);
  assert.match(repository, /getLeadManagementLeads\(\)/);
  assert.match(repository, /workflowFetchesByIdentity\.get\(key\)/);
  assert.match(workflow, /authStatus !== 'ready'/);
  assert.match(workflow, /hasRemoteCredential/);
  assert.match(workflow, /fetchWorkflowData\(\{ requestKey \}\)/);
});

test('remote lead loading never queries the leads table directly', () => {
  const loader = repository.match(
    /async function fetchWorkflowDataOnce\(\) \{[\s\S]*?\n\}\n\nexport function fetchWorkflowData/,
  )?.[0] || '';
  assert.ok(loader);
  assert.doesNotMatch(loader, /\.from\(['"]leads['"]\)/);
});

test('lead-list errors are classified by HTTP status without a Supabase prefix', () => {
  assert.match(api, /status === 401[\s\S]*Your session has expired\. Please sign in again\./);
  assert.match(api, /status === 403[\s\S]*You do not have permission to access Lead Management\./);
  assert.match(api, /status === 404[\s\S]*Lead Management service is unavailable\./);
  assert.match(api, /Unable to load Lead Management data\. Please retry\./);
  assert.doesNotMatch(workflow, /Supabase fetch failed:/);
  assert.match(workflow, /error\?\.isLeadManagementRequestError/);
});

test('successful and new lead loads clear stale errors while stale responses are ignored', () => {
  assert.match(workflow, /setWorkflowError\(''\);[\s\S]*fetchWorkflowData/);
  assert.match(workflow, /requestId !== workflowRequestIdRef\.current/);
  assert.match(workflow, /setBackendStatus\('connected'\);[\s\S]*setWorkflowError\(''\)/);
});

test('empty successful lead data keeps zero counters and no error banner', () => {
  assert.match(crm, /backendStatus === 'error' && leads\.length === 0 \? '--' : visibleLeads\.length/);
  assert.match(crm, /No active leads/);
  assert.match(crm, /workflowError/);
});

test('assignee loading stays independent from workflow lead errors', () => {
  assert.match(crm, /getLeadManagementAssignees\(\)/);
  assert.match(crm, /setLiveAssignees\(result\.assignees \|\| \[\]\)/);
  const assigneeEffect = crm.match(/getLeadManagementAssignees\(\)[\s\S]*?\}, \[canAssignLeads\]\);/)?.[0] || '';
  assert.doesNotMatch(assigneeEffect, /setWorkflowError/);
});
