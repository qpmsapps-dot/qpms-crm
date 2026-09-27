import { normalizeRoleKey } from '../services/roleNormalizationService.js';

// These are the existing technical aliases already treated as full Admin
// identities in myQPMS. Demo/read-only identities are intentionally excluded.
const PLATFORM_ADMIN_ROLE_KEYS = new Set([
  'ADMIN',
  'QPMSADMIN',
  'DEVELOPER',
  'DEV',
  'ITADMIN',
  'MANAGEMENTITADMIN',
]);

export function isPlatformAdminRole(role = '') {
  return PLATFORM_ADMIN_ROLE_KEYS.has(normalizeRoleKey(role));
}

export function isPlatformAdmin(actor = null) {
  if (!actor) return false;
  const role = typeof actor === 'string'
    ? actor
    : actor.rawRole || actor.raw_role || actor.role;
  return isPlatformAdminRole(role);
}

export function hasAdminOverride(actor = null) {
  return isPlatformAdmin(actor);
}

export const platformAdminRoleKeys = Object.freeze([...PLATFORM_ADMIN_ROLE_KEYS]);
