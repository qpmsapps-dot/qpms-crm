import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const apiSource = fs.readFileSync(new URL('../src/services/api.js', import.meta.url), 'utf8');
const builderSource = fs.readFileSync(new URL('../src/components/user-management/HierarchyBuilder.jsx', import.meta.url), 'utf8');
const serverSource = fs.readFileSync(new URL('../backend/server.js', import.meta.url), 'utf8');

test('Hierarchy Builder persists only changed immediate-manager assignments through authenticated API', () => {
  assert.match(apiSource, /export function updateAdminUsersHierarchy\(assignments\)/);
  assert.match(apiSource, /method:\s*'PATCH'[\s\S]*url:\s*'\/api\/admin\/users\/hierarchy'[\s\S]*data:\s*\{ assignments \}/);
  assert.match(builderSource, /Object\.entries\(localManagerByCode\)/);
  assert.match(builderSource, /await updateAdminUsersHierarchy\(assignments\)/);
  assert.match(builderSource, /await loadHierarchy\(\)/);
});

test('Hierarchy Builder exposes searchable immediate-manager details without changing Command Center roles', () => {
  assert.match(builderSource, /Immediate Manager Assignments/);
  assert.match(builderSource, /Name, code, role, state or business/);
  assert.match(builderSource, /Reports To for \$\{employeeCode\}/);
  assert.match(builderSource, /Manager code:/);
  assert.doesNotMatch(builderSource, /canAccessOperationsCommandCenter|operationsCommandCenterAllowedEmployeeCodes/);
});

test('backend hierarchy route preserves validation and audit trail', () => {
  assert.match(serverSource, /app\.patch\([\s\S]*?'\/api\/admin\/users\/hierarchy'[\s\S]*?requireSupabaseJwt[\s\S]*?requireUserManagementPermission/);
  assert.match(serverSource, /saveHierarchyAssignments\([\s\S]*?request\.body\?\.assignments/);
  assert.match(serverSource, /action:\s*'UPDATE_USER_HIERARCHY_ASSIGNMENTS'/);
});
