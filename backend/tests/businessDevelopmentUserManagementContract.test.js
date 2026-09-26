import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const server = readFileSync('backend/server.js', 'utf8');
const drawer = readFileSync('src/components/user-management/UserFormDrawer.jsx', 'utf8');

test('backend provisioning accepts canonical Business Development roles', () => {
  assert.match(server, /'BUSINESSDEVELOPMENTHEAD'/);
  assert.match(server, /'BUSINESSDEVELOPMENTEXECUTIVE'/);
  assert.match(server, /Business Development Head, Business Development Executive/);
});

test('Business Development Executive reports to a compatible Business Development Head', () => {
  assert.match(server, /businessDevelopmentHeads:\s*byBusinessDevelopmentCapability\(BUSINESS_DEVELOPMENT_CAPABILITIES\.HEAD\)/);
  assert.match(server, /Business Development Head is required for Business Development Executive/);
  assert.match(server, /inheritExecutiveChain\(reportingManager\)/);
  assert.match(drawer, /businessDevelopmentHeads/);
  assert.match(drawer, /\['Business Development Executive', 'BD Executive'\]/);
});

test('role cleanup does not rewrite hierarchy rows automatically', () => {
  assert.doesNotMatch(server, /Business Development Executive[\s\S]{0,300}\.from\('employee_hierarchy'\)[\s\S]{0,120}\.update/);
});
