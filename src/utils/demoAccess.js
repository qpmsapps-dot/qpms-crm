export const demoReadOnlyMessage =
  'Demo access is read-only. Changes are disabled for this account.';

export const demoReadOnlyEmails = new Set(['admin@qpms.co.in']);
export const demoReadOnlyRoles = new Set(['DEMOADMIN', 'READONLYADMIN']);
export const demoReadOnlyPassword = '123456';

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

export function isDemoReadOnlyCredentials(email = '', password = '') {
  return demoReadOnlyEmails.has(String(email || '').trim().toLowerCase()) &&
    String(password || '') === demoReadOnlyPassword;
}

export function createDemoReadOnlyUser(email = 'admin@qpms.co.in') {
  const normalizedEmail = String(email || 'admin@qpms.co.in').trim().toLowerCase();
  return {
    id: 'demo-read-only-admin',
    profileId: 'demo-read-only-admin',
    name: 'QPMS Demo Admin',
    username: normalizedEmail,
    email: normalizedEmail,
    role: 'DEMO_ADMIN',
    rawRole: 'DEMO_ADMIN',
    access: 'Demo read-only admin access',
    isActive: true,
    status: 'Active',
    webAccessEnabled: true,
    authProvider: 'demo-read-only',
    isDemoReadOnly: true,
    read_only: true,
  };
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
