import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { isSiteVisitWorkflowEnabled } from '../backend/services/siteVisitFeatureFlag.js';

const routes = await readFile(new URL('../src/routes/AppRoutes.jsx', import.meta.url), 'utf8');
const frontendFlag = await readFile(new URL('../src/config/siteVisitFeature.js', import.meta.url), 'utf8');
const playwrightConfig = await readFile(new URL('../playwright.config.js', import.meta.url), 'utf8');
const server = await readFile(new URL('../backend/server.js', import.meta.url), 'utf8');

test('Site Visit rollout flag fails closed unless explicitly true', () => {
  assert.equal(isSiteVisitWorkflowEnabled({}), false);
  assert.equal(isSiteVisitWorkflowEnabled({ SITE_VISIT_WORKFLOW_ENABLED: 'false' }), false);
  assert.equal(isSiteVisitWorkflowEnabled({ SITE_VISIT_WORKFLOW_ENABLED: 'true' }), true);
  assert.equal(isSiteVisitWorkflowEnabled({ SITE_VISIT_WORKFLOW_ENABLED: 'yes' }), false);
});

test('frontend and backend gate the Site Visit V2 workflow', () => {
  assert.match(frontendFlag, /VITE_SITE_VISIT_V2_ENABLED/);
  assert.match(playwrightConfig, /VITE_SITE_VISIT_V2_ENABLED: 'true'/);
  assert.match(routes, /isSiteVisitV2Enabled \? <Sites \/> : <Navigate/);
  assert.match(server, /requireSiteVisitWorkflowEnabled/);
  assert.match(server, /response\.status\(404\)\.json\(\{ ok: false, message: 'Not found\.' \}\)/);
});
