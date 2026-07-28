import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const api = await readFile(new URL('../src/services/api.js', import.meta.url), 'utf8');
const crm = await readFile(new URL('../src/pages/CRM.jsx', import.meta.url), 'utf8');
const workflow = await readFile(new URL('../src/context/WorkflowContext.jsx', import.meta.url), 'utf8');
const server = await readFile(new URL('../backend/server.js', import.meta.url), 'utf8');

test('lead APIs distinguish expired sessions from forbidden roles', () => {
  assert.match(api, /status === 401[\s\S]*Your session has expired\. Please sign in again\./);
  assert.match(api, /status === 403[\s\S]*You do not have permission to access Lead Management\./);
  assert.match(server, /lead_access_denied/);
});

test('failed workflow refresh preserves the last successful lead snapshot', () => {
  const failureBlock = workflow.match(/\.catch\(\(error\) => \{[\s\S]*?throw error;\s*\}\);/)?.[0] || '';
  assert.doesNotMatch(failureBlock, /setLeads\(\[\]\)/);
  assert.doesNotMatch(failureBlock, /setSiteVisits\(\[\]\)/);
});

test('web assignment controls are role-aware and show useful BD labels', () => {
  assert.match(crm, /This lead will be assigned to you\./);
  assert.match(crm, /Assign to BD Executive/);
  assert.match(crm, /employee_code/);
  assert.match(crm, /canAssignLead/);
});

test('assignee lookup remains JWT protected and management restricted', () => {
  assert.match(
    server,
    /app\.get\('\/api\/lead-management\/assignees',\s*requireSupabaseJwt,\s*requireLeadManagementAccess,\s*requireLeadAssignmentAccess,\s*listLeadAssignees\)/,
  );
});
