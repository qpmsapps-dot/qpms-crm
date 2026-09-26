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

test('Business Development Executive may optionally report to a compatible Business Development Head', () => {
  assert.match(server, /businessDevelopmentHeads:\s*byBusinessDevelopmentCapability\(BUSINESS_DEVELOPMENT_CAPABILITIES\.HEAD\)/);
  assert.match(server, /\['BUSINESSDEVELOPMENTEXECUTIVE', 'BDEXECUTIVE'\]\.includes\(roleKey\)\s*&& reportingManagerCode/);
  assert.match(server, /Select a valid Business Development Head/);
  assert.match(server, /inheritExecutiveChain\(reportingManager\)/);
  assert.match(server, /\['FO', 'KAM', 'OPERATIONSMANAGER', 'BRANCHHEAD'\]\.includes\(roleKey\)/);
  assert.doesNotMatch(server, /\['FO', 'KAM', 'OPERATIONSMANAGER', 'BRANCHHEAD', 'BUSINESSDEVELOPMENTEXECUTIVE'/);
  assert.match(drawer, /businessDevelopmentHeads/);
  assert.match(drawer, /const reportingOptionalRoles = new Set\(\['Business Development Executive', 'BD Executive'\]\)/);
  assert.match(drawer, /required=\{reportingRequiredRoles\.has\(values\.role\)\}/);
});

test('other hierarchy-dependent roles remain mandatory', () => {
  assert.match(drawer, /const reportingRequiredRoles = new Set\(\[\s*'FO', 'KAM', 'Operations Manager', 'Branch Head'/);
  assert.match(drawer, /reportingRequiredRoles\.has\(values\.role\) && !values\.manager_employee_code/);
});

test('role cleanup does not rewrite hierarchy rows automatically', () => {
  assert.doesNotMatch(server, /Business Development Executive[\s\S]{0,300}\.from\('employee_hierarchy'\)[\s\S]{0,120}\.update/);
});
