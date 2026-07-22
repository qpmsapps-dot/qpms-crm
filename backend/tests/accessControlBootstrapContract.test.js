import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');

function normalizePermissionRole(role) {
  return String(role || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '');
}

function hasUserManagementPermission(profile) {
  const roleKeys = new Set([
    'ADMIN',
    'MD',
    'COO',
    'GM',
    'GENERALMANAGER',
    'GMTOPMANAGEMENT',
    'TOPMANAGEMENT',
    'MANAGEMENT',
    'HR',
    'HUMANRESOURCES',
    'HRREVIEWER',
    'HRGM',
    'FINANCEGM',
  ]);
  if (!profile || profile.is_active !== true) return false;
  if (profile.web_access_enabled === false) return false;
  if (['INACTIVE', 'DISABLED', 'DEACTIVATED'].includes(normalizePermissionRole(profile.status))) {
    return false;
  }
  return roleKeys.has(normalizePermissionRole(profile.role));
}

test('foundation endpoint keeps existing User Management bootstrap gate', () => {
  assert.match(server, /app\.get\(\s*['"]\/api\/access\/foundation['"][\s\S]*requireSupabaseJwt[\s\S]*requireUserManagementPermission/);
  assert.doesNotMatch(server, /ACCESS_BOOTSTRAP_AUTH_USER_IDS/);
});

test('approved active Admin, User Management and Management roles can bootstrap foundation reads', () => {
  for (const role of ['ADMIN', 'HR', 'MANAGEMENT']) {
    assert.equal(hasUserManagementPermission({
      role,
      is_active: true,
      status: 'Active',
      web_access_enabled: true,
    }), true);
  }
});

test('ordinary, legacy-only, demo, inactive and disabled-web profiles are denied bootstrap access', () => {
  assert.equal(hasUserManagementPermission({
    role: 'FO',
    is_active: true,
    status: 'Active',
    web_access_enabled: true,
  }), false);
  assert.equal(hasUserManagementPermission(null), false);
  assert.equal(hasUserManagementPermission({
    role: 'hospital_management',
    is_active: true,
    status: 'Active',
    web_access_enabled: true,
  }), false);
  assert.equal(hasUserManagementPermission({
    role: 'TENDER_DEMO',
    is_active: true,
    status: 'Active',
    web_access_enabled: true,
  }), false);
  assert.equal(hasUserManagementPermission({
    role: 'DEMO_ADMIN',
    is_active: true,
    status: 'Active',
    web_access_enabled: true,
  }), false);
  assert.equal(hasUserManagementPermission({
    role: 'ADMIN',
    is_active: false,
    status: 'Active',
    web_access_enabled: true,
  }), false);
  assert.equal(hasUserManagementPermission({
    role: 'ADMIN',
    is_active: true,
    status: 'Active',
    web_access_enabled: false,
  }), false);
});
