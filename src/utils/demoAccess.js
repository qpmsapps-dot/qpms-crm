export const demoReadOnlyMessage =
  'This action is disabled for the tender demo account.';

export const demoReadOnlyEmails = new Set(['admin@qpms.co.in']);
export const demoReadOnlyRoles = new Set(['DEMOADMIN', 'TENDERDEMO', 'READONLYADMIN']);
export const demoReadOnlyPassword = '123456';
export const demoLabel = 'Tender Demo';
export const demoAllowedStates = ['TN', 'KL', 'KA', 'TG', 'AP-1', 'AP-2'];
export const demoAllowedBusinesses = [
  'Reliance Retail',
  'Hospitals',
  'Tirupati Devasthanam',
  'Standalone operations',
  'IFMS',
];

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
  const metadata = user?.metadata && typeof user.metadata === 'object' ? user.metadata : {};
  return Boolean(user?.is_demo) ||
    Boolean(user?.isDemo) ||
    Boolean(user?.isDemoReadOnly) ||
    Boolean(metadata.is_demo) ||
    demoReadOnlyEmails.has(email) ||
    demoReadOnlyRoles.has(role);
}

export function isDemoUser(user = {}) {
  return isDemoReadOnlyUser(user);
}

export function isReadOnlyUser(user = {}) {
  const metadata = user?.metadata && typeof user.metadata === 'object' ? user.metadata : {};
  return isDemoUser(user) && user?.read_only !== false && user?.readOnly !== false && metadata.read_only !== false;
}

export function getDemoAccessScope(user = {}) {
  const metadata = user?.metadata && typeof user.metadata === 'object' ? user.metadata : {};
  return {
    is_demo: isDemoUser(user),
    read_only: isReadOnlyUser(user),
    label: metadata.demo_label || user?.demo_label || demoLabel,
    states: Array.isArray(metadata.permitted_states) ? metadata.permitted_states : demoAllowedStates,
    businesses: Array.isArray(metadata.permitted_businesses) ? metadata.permitted_businesses : demoAllowedBusinesses,
    modules: Array.isArray(metadata.permitted_modules)
      ? metadata.permitted_modules
      : ['field_operations', 'deep_cleaning', 'fault_tracker', 'store_master', 'client_ticketing', 'reports'],
  };
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
    is_demo: true,
    read_only: true,
    metadata: getDemoAccessScope({ isDemoReadOnly: true }),
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
  if (!isReadOnlyUser(user)) return;
  notifyDemoReadOnly();
  throw new Error(demoReadOnlyMessage);
}
