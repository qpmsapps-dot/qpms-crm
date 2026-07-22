export const DEMO_READ_ONLY_CODE = 'READ_ONLY_DEMO';
export const DEMO_READ_ONLY_MESSAGE =
  'This action is disabled for the tender demo account.';

const DEMO_EMAILS = new Set(['admin@qpms.co.in']);
const DEMO_ROLES = new Set(['DEMOADMIN', 'TENDERDEMO', 'READONLYADMIN']);

export const DEMO_ALLOWED_STATES = ['TN', 'KL', 'KA', 'TG', 'AP-1', 'AP-2'];
export const DEMO_ALLOWED_BUSINESSES = [
  'Reliance Retail',
  'Hospitals',
  'Tirupati Devasthanam',
  'Standalone operations',
  'IFMS',
];

export function normalizeDemoAccessRole(role = '') {
  return String(role || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '');
}

export function isDemoUser(identity = {}, authUser = {}) {
  const email = String(
    identity.email ||
      identity.username ||
      authUser.email ||
      authUser.user_metadata?.email ||
      '',
  ).trim().toLowerCase();
  const role = normalizeDemoAccessRole(identity.rawRole || identity.role);
  const metadata = identity.metadata && typeof identity.metadata === 'object'
    ? identity.metadata
    : {};
  return Boolean(identity.is_demo) ||
    Boolean(identity.isDemo) ||
    Boolean(identity.isDemoReadOnly) ||
    Boolean(metadata.is_demo) ||
    DEMO_EMAILS.has(email) ||
    DEMO_ROLES.has(role);
}

export function isReadOnlyUser(identity = {}, authUser = {}) {
  const metadata = identity.metadata && typeof identity.metadata === 'object'
    ? identity.metadata
    : {};
  return isDemoUser(identity, authUser) &&
    (
      identity.read_only !== false ||
      identity.readOnly !== false ||
      metadata.read_only !== false
    );
}

export function isMutationRequest(request) {
  return !['GET', 'HEAD', 'OPTIONS'].includes(String(request.method || 'GET').toUpperCase());
}

export function getDemoAccessScope(identity = {}) {
  const metadata = identity.metadata && typeof identity.metadata === 'object'
    ? identity.metadata
    : {};
  return {
    is_demo: isDemoUser(identity),
    read_only: isReadOnlyUser(identity),
    label: metadata.demo_label || identity.demo_label || 'Tender Demo',
    states: Array.isArray(metadata.permitted_states) ? metadata.permitted_states : DEMO_ALLOWED_STATES,
    businesses: Array.isArray(metadata.permitted_businesses) ? metadata.permitted_businesses : DEMO_ALLOWED_BUSINESSES,
    modules: Array.isArray(metadata.permitted_modules)
      ? metadata.permitted_modules
      : ['field_operations', 'deep_cleaning', 'fault_tracker', 'store_master', 'client_ticketing', 'reports'],
  };
}

export function rejectDemoMutation(request, response, identity = {}, authUser = {}) {
  if (!isMutationRequest(request)) return false;
  if (!isReadOnlyUser(identity, authUser)) return false;
  response.status(403).json({
    ok: false,
    error: DEMO_READ_ONLY_CODE,
    code: DEMO_READ_ONLY_CODE,
    message: DEMO_READ_ONLY_MESSAGE,
  });
  return true;
}

export function sanitizeDemoRecord(row = {}, deniedKeys = []) {
  if (!row || typeof row !== 'object') return row;
  const deny = new Set([
    'aadhaar',
    'aadhaar_number',
    'account_number',
    'bank_account',
    'bank_account_number',
    'ifsc',
    'pan',
    'pan_number',
    'password',
    'password_hash',
    'token',
    'access_token',
    'refresh_token',
    'mobile',
    'phone',
    'phone_number',
    'email',
    'personal_email',
    'supervisor_mobile',
    'supervisor_email',
    'vendor_mobile',
    'vendor_email',
    'employee_code',
    'created_by_employee_code',
    'username',
    'full_name',
    'display_name',
    'supervisor_name',
    'supervisor_employee_code',
    'metadata',
    ...deniedKeys,
  ]);
  return Object.fromEntries(
    Object.entries(row).filter(([key]) => !deny.has(String(key).toLowerCase())),
  );
}
