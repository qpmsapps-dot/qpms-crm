import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const routesUrl = new URL('../routes/preSalesRoutes.js', import.meta.url);
const serviceUrl = new URL('../services/preSalesService.js', import.meta.url);

test('all Pre-Sales endpoints use the shared JWT and lead-access guards', async () => {
  const source = await readFile(routesUrl, 'utf8');
  assert.match(source, /const guards = \[requireJwt, requireLeadAccess\]/);
  assert.match(source, /const mutationGuards = \[\.\.\.guards, createRequireWritablePreSalesEnvironment\(\)\]/);
  for (const endpoint of [
    '/api/pre-sales/dashboard', '/api/pre-sales/leads', 'call-history', 'call-update',
    '/api/pre-sales/followups', '/complete', '/reschedule', '/meetings', '/handover',
  ]) assert.ok(source.includes(endpoint), `missing ${endpoint}`);
  for (const readEndpoint of [
    "app.get('/api/pre-sales/dashboard'",
    "app.get('/api/pre-sales/leads'",
    "app.get('/api/pre-sales/leads/:leadId'",
    "app.get('/api/pre-sales/followups'",
  ]) {
    const routeLine = source.split('\n').find((line) => line.includes(readEndpoint));
    assert.match(routeLine || '', /\.\.\.guards/, `${readEndpoint} must retain the normal read/auth guards`);
    assert.doesNotMatch(routeLine || '', /mutationGuards/, `${readEndpoint} must not be blocked in UAT mode`);
  }
  assert.match(source, /app\.post\('\/api\/pre-sales\/leads', \.\.\.mutationGuards, createLeadHandler\)/);
  assert.match(source, /app\.patch\('\/api\/pre-sales\/leads\/:leadId', \.\.\.mutationGuards, requireMutableLead, updateLeadHandler\)/);
  assert.match(source, /app\.get\('\/api\/pre-sales\/leads\/:leadId\/opportunity-progress', \.\.\.guards/);
  for (const mutationEndpoint of [
    "app.post('/api/pre-sales/leads'",
    "app.patch('/api/pre-sales/leads/:leadId'",
    "app.patch('/api/pre-sales/leads/:leadId/owner'",
    "app.post('/api/pre-sales/leads/:leadId/call-update'",
    "app.patch('/api/pre-sales/followups/:followupId/complete'",
    "app.patch('/api/pre-sales/followups/:followupId/reschedule'",
    "app.post('/api/pre-sales/leads/:leadId/meetings'",
    "app.patch('/api/pre-sales/meetings/:meetingId'",
    "app.post('/api/pre-sales/leads/:leadId/handover'",
    "app.post('/api/pre-sales/handoffs/:handoffId/accept'",
    "app.post('/api/pre-sales/handoffs/:handoffId/reject'",
  ]) {
    const routeLine = source.split('\n').find((line) => line.includes(mutationEndpoint));
    assert.match(routeLine || '', /\.\.\.mutationGuards/, `${mutationEndpoint} must use the UAT mutation guard`);
  }
});

test('dashboard counters and schedule are derived from scoped database records', async () => {
  const source = await readFile(serviceUrl, 'utf8');
  for (const counter of ['today_followups', 'today_meetings', 'callbacks_due', 'overdue_followups', 'qualified_leads', 'pending_handover']) assert.match(source, new RegExp(counter));
  assert.match(source, /leadIdsForActor\(client, actor\)/);
  assert.match(source, /\.eq\('status', 'pending'\)/);
  assert.doesNotMatch(source, /Math\.random|mockLead|sampleLead/);
});

test('lead pagination is server-side and capped', async () => {
  const source = await readFile(serviceUrl, 'utf8');
  assert.match(source, /pageSize = integer\(params\.page_size, 20, 1, 100\)/);
  assert.match(source, /\.range\(from, from \+ pageSize - 1\)/);
  assert.match(source, /from\('leads'\)\.select\('[^']+', \{ count: 'exact' \}\)/);
});

test('follow-up completion preserves history and reschedule creates a linked successor', async () => {
  const source = await readFile(serviceUrl, 'utf8');
  assert.match(source, /status: 'completed'/);
  assert.match(source, /source_type: 'reschedule', source_id: current\.id/);
  assert.match(source, /status: 'cancelled', outcome: 'rescheduled'/);
  assert.doesNotMatch(source, /from\('lead_followups'\)\.delete/);
});

test('all lead mutation paths enforce the centralized post-handover boundary', async () => {
  const source = await readFile(serviceUrl, 'utf8');
  for (const signature of [
    'export async function addCallUpdate',
    'async function authorizedFollowup',
    'export async function createMeeting',
    'export async function updateMeeting',
    'export async function createHandoff',
    'export async function assignPreSalesOwner',
  ]) {
    const start = source.indexOf(signature);
    assert.notEqual(start, -1, signature);
    const body = source.slice(start, source.indexOf('\n}', start) + 2);
    assert.match(body, /assertPreSalesLeadMutable/, `${signature} must enforce post-handover read-only`);
  }
});
