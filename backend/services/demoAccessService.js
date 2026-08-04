export const DEMO_READ_ONLY_CODE = 'READ_ONLY_DEMO';
export const DEMO_READ_ONLY_MESSAGE =
  'This action is disabled for read-only demonstration access.';

const DEMO_EMAILS = new Set(['admin@qpms.co.in']);
const DEMO_ROLES = new Set(['DEMOADMIN', 'TENDERDEMO', 'READONLYADMIN', 'DEMOVIEWER']);
const DEMO_VIEWER_ROLE = 'DEMOVIEWER';

const SENSITIVE_DEMO_GET_PATTERNS = [
  /^\/api\/admin(?:\/|$)/i,
  /^\/api\/access\/foundation(?:\/|$)/i,
  /^\/api\/access\/scope-options(?:\/|$)/i,
  /^\/api\/store-master(?:\/|$)/i,
  /^\/api\/profile\/avatar(?:\/|$)/i,
  /^\/api\/profile\/password/i,
  /^\/api\/fo\/reports(?:\/|$)/i,
  /\/(?:export|download|pdf|upload|import|reset|recalculate|sync-auth|hard-delete|repair-employee-code|enable-login|reset-password)(?:\/|$|\?)/i,
];

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

export function isReadOnlyDemoUser(identity = {}) {
  return normalizeDemoAccessRole(identity.rawRole || identity.role) === DEMO_VIEWER_ROLE;
}

export function isReadOnlyUser(identity = {}, authUser = {}) {
  const metadata = identity.metadata && typeof identity.metadata === 'object'
    ? identity.metadata
    : {};
  if (isReadOnlyDemoUser(identity)) return true;
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
  const defaultModules = isReadOnlyDemoUser(identity)
    ? ['dashboard', 'lead_management', 'site_visit', 'reviews', 'operations', 'client_ticketing', 'hospital_feedback', 'fault_tracker', 'deep_cleaning', 'assets', 'reports']
    : ['field_operations', 'deep_cleaning', 'fault_tracker', 'store_master', 'client_ticketing', 'reports'];
  return {
    is_demo: isDemoUser(identity),
    read_only: isReadOnlyUser(identity),
    label: metadata.demo_label || identity.demo_label || 'Tender Demo',
    states: Array.isArray(metadata.permitted_states) ? metadata.permitted_states : DEMO_ALLOWED_STATES,
    businesses: Array.isArray(metadata.permitted_businesses) ? metadata.permitted_businesses : DEMO_ALLOWED_BUSINESSES,
    modules: Array.isArray(metadata.permitted_modules)
      ? metadata.permitted_modules
      : defaultModules,
  };
}

export function isSensitiveReadOnlyDemoGet(request) {
  if (isMutationRequest(request)) return false;
  const path = String(request.originalUrl || request.url || request.path || '').split('#')[0];
  return SENSITIVE_DEMO_GET_PATTERNS.some((pattern) => pattern.test(path));
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

export function rejectReadOnlyDemoRequest(request, response, identity = {}, authUser = {}) {
  if (!isReadOnlyUser(identity, authUser)) return false;
  if (rejectDemoMutation(request, response, identity, authUser)) return true;
  if (!isSensitiveReadOnlyDemoGet(request)) return false;
  response.status(403).json({
    ok: false,
    error: DEMO_READ_ONLY_CODE,
    code: DEMO_READ_ONLY_CODE,
    message: 'This read-only demonstration account cannot access sensitive administration, export, import, upload or system endpoints.',
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
