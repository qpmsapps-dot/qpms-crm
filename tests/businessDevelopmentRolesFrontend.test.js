import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  canAccessNavRoute,
  normalizeAppRole,
  normalizeCanonicalRole,
} from '../src/utils/authRoles.js';

const drawerSource = await readFile(new URL('../src/components/user-management/UserFormDrawer.jsx', import.meta.url), 'utf8');
const callFormSource = await readFile(new URL('../src/components/preSales/AddCallUpdateForm.jsx', import.meta.url), 'utf8');

test('User Management offers canonical BD roles and retains legacy values only for compatibility edits', () => {
  const roleOptions = drawerSource.slice(
    drawerSource.indexOf('const roleOptions'),
    drawerSource.indexOf('const compatibilityRoleOptions'),
  );
  const compatibility = drawerSource.slice(
    drawerSource.indexOf('const compatibilityRoleOptions'),
    drawerSource.indexOf('const stateOptions'),
  );
  assert.match(roleOptions, /Business Development Head/);
  assert.match(roleOptions, /Business Development Executive/);
  assert.doesNotMatch(roleOptions, /['"]BD Head['"]/);
  assert.doesNotMatch(roleOptions, /['"]BD Executive['"]/);
  assert.match(compatibility, /BD Head/);
  assert.match(compatibility, /BD Executive/);
});

test('canonical and legacy BD roles receive the existing BD navigation family without unrelated module access', () => {
  for (const role of ['Business Development Head', 'Business Development Executive', 'BD Head', 'BD Executive']) {
    assert.equal(normalizeAppRole(role), 'BD', role);
    assert.equal(canAccessNavRoute({ role, rawRole: role }, '/pre-sales'), true, role);
    assert.equal(canAccessNavRoute({ role, rawRole: role }, '/proposals'), true, role);
    assert.equal(canAccessNavRoute({ role, rawRole: role }, '/site-survey-requests'), false, role);
    assert.equal(canAccessNavRoute({ role, rawRole: role }, '/tasks'), false, role);
    assert.equal(canAccessNavRoute({ role, rawRole: role }, '/settings/user-management'), false, role);
  }
  assert.equal(normalizeCanonicalRole('Business Development Executive'), 'BD Executive');
  assert.equal(normalizeCanonicalRole('Business Development Head'), 'BD Head');
});

test('Pre-Sales handover renders the backend canonical BD role label with the user name', () => {
  assert.match(callFormSource, /person\.full_name/);
  assert.match(callFormSource, /person\.role/);
});
