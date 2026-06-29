export const demoReadOnlyMessage =
  'Demo access is read-only. Changes are disabled for this account.';

export const demoReadOnlyEmails = new Set(['admin@qpms.co.in']);
export const demoReadOnlyRoles = new Set(['DEMOADMIN', 'READONLYADMIN']);

const authStorageKey = 'qpms-crm-auth-user';

export function normalizeDemoRole(value = '') {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '');
}

export function isDemoReadOnlyUser(user = {}) {
  const email = String(user?.email || user?.username || '').trim().toLowerCase();
  const role = normalizeDemoRole(user?.rawRole || user?.role);
  return Boolean(user?.isDemoReadOnly) ||
    demoReadOnlyEmails.has(email) ||
    demoReadOnlyRoles.has(role);
}

export function readStoredAuthUser() {
  if (typeof window === 'undefined') return null;
  try {
    const value = window.localStorage.getItem(authStorageKey);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

export function isCurrentDemoReadOnly() {
  return isDemoReadOnlyUser(readStoredAuthUser());
}

export function notifyDemoReadOnly() {
  if (typeof window !== 'undefined') {
    window.alert(demoReadOnlyMessage);
  }
}

export function assertDemoWriteAllowed(user = readStoredAuthUser()) {
  if (!isDemoReadOnlyUser(user)) return;
  notifyDemoReadOnly();
  throw new Error(demoReadOnlyMessage);
}
