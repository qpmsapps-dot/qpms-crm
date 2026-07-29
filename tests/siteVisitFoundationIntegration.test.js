import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const server = await readFile(new URL('../backend/server.js', import.meta.url), 'utf8');
const api = await readFile(new URL('../src/services/api.js', import.meta.url), 'utf8');
const repository = await readFile(
  new URL('../src/services/workflowRepository.js', import.meta.url),
  'utf8',
);

test('Site Visit backend routes require a verified Supabase JWT', () => {
  assert.match(
    server,
    /app\.get\('\/api\/site-visit-workflow', requireSupabaseJwt, listSiteVisitWorkflow\)/,
  );
  assert.match(
    server,
    /'\/api\/site-visit-workflow\/operations\/:operation',[\s\S]*?requireSupabaseJwt,[\s\S]*?runSiteVisitWorkflowOperation/,
  );
});

test('backend workflow operations use a caller-scoped Supabase client', () => {
  assert.match(server, /createSiteVisitUserClient\(\{[\s\S]*?accessToken: getBearerToken\(request\)/);
  const handler = server.match(
    /async function runSiteVisitWorkflowOperation[\s\S]*?\n\}\n\napp\.get\('\/api\/lead-management/,
  )?.[0] || '';
  assert.ok(handler);
  assert.doesNotMatch(handler, /requireServiceRoleSupabase|service_role/i);
});

test('web workflow load and writes use the secured backend integration', () => {
  assert.match(api, /url: '\/api\/site-visit-workflow'/);
  assert.match(api, /url: `\/api\/site-visit-workflow\/operations\/\$\{encodeURIComponent\(operation\)\}`/);
  assert.match(repository, /getSiteVisitWorkflowData\(\)/);
  assert.match(repository, /runSiteVisitWorkflowOperation\(operation, params\)/);
});

test('site evidence is private, constrained, and registered through the secured backend', () => {
  assert.match(repository, /image\/jpeg[\s\S]*image\/png[\s\S]*image\/webp/);
  assert.match(repository, /10 \* 1024 \* 1024/);
  assert.match(repository, /rpc_register_site_image/);
  assert.match(repository, /createSignedUrl\(path, 3600\)/);
  assert.doesNotMatch(repository, /getPublicUrl\(path\)/);
});

test('authoritative loader no longer queries modern activity logs as Site Visit storage', () => {
  const loader = repository.match(
    /async function fetchWorkflowDataOnce\(\) \{[\s\S]*?\r?\n\}\r?\n\r?\nexport function fetchWorkflowData/,
  )?.[0] || '';
  assert.ok(loader);
  assert.doesNotMatch(loader, /\.from\(['"]activity_logs['"]\)/);
  assert.doesNotMatch(loader, /\.from\(['"]site_assessments['"]\)/);
  assert.match(loader, /getSiteVisitWorkflowData\(\)/);
});
