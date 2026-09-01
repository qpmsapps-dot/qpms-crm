export const EXECUTIVE_ASSISTANT_ROLE = 'Executive Assistant';

export function normalizeWebRoleKey(role = '') {
  return String(role || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '');
}

export function hasCooWebVisibility(role) {
  return new Set(['COO', 'EXECUTIVEASSISTANT']).has(normalizeWebRoleKey(role));
}

export function hasCooAuthority(role) {
  return normalizeWebRoleKey(role) === 'COO';
}

export function activeWebProfile(profile) {
  if (!profile || profile.is_active !== true) return false;
  if (profile.web_access_enabled === false) return false;
  return !['INACTIVE', 'DISABLED', 'DEACTIVATED'].includes(
    normalizeWebRoleKey(profile.status || 'ACTIVE'),
  );
}
