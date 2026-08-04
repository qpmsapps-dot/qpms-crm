const viteEnv = import.meta.env || {};
const explicitDemoAuthFlag = String(
  viteEnv.VITE_ENABLE_DEMO_AUTH ?? viteEnv.VITE_DEMO_MODE ?? '',
).trim().toLowerCase();

export const isDemoAuthEnabled = explicitDemoAuthFlag === 'true';
export const appMode = isDemoAuthEnabled ? 'demo' : 'production';
export const isProductionAuthMode = !isDemoAuthEnabled;

export const roleGroups = {
  BD: ['BD', 'BD Team', 'BD Executive', 'BD Head'],
  Operations: ['Operations', 'Operations Team', 'Operations Manager', 'Branch Head', 'Business Head', 'KAM'],
  Coordinator: ['Coordinator'],
  HR: ['HR', 'HR Reviewer', 'HR GM'],
  Commercial: ['Commercial', 'Commercial Team', 'Commercial Reviewer'],
  Finance: ['Finance', 'Finance Team', 'Finance Reviewer'],
  FinanceLeadership: ['Finance GM', 'CFO'],
  Management: ['Management', 'MD', 'COO', 'GM', 'Top Management', 'GM / Top Management'],
  ExistingOperations: ['Existing Business Operations Team'],
  FieldOfficer: ['Field Officer', 'FO'],
  Client: ['Client', 'Client Login'],
  Admin: ['Admin', 'QPMS Admin', 'Developer', 'DEMO_ADMIN', 'Demo Admin', 'Read Only Admin', 'Read-Only Admin'],
  DemoViewer: ['DEMO_VIEWER'],
};

export const protectedNavRoutes = ['/dashboard', '/crm', '/sites', '/site-visit', '/site-monitoring', '/proposals', '/approvals', '/tasks', '/existing-business', '/fo-activities', '/tickets', '/fault-tracker', '/deep-cleaning', '/assets', '/reports', '/employees', '/store-master', '/settings', '/hospital-feedback', '/operations/hospital-feedback'];

function normalizedRoleKey(role = '') {
  return String(role || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '');
}

export function normalizeCanonicalRole(role = '') {
  const aliases = {
    BDEXECUTIVE: 'BD Executive',
    BUSINESSDEVELOPMENTEXECUTIVE: 'BD Executive',
    BDHEAD: 'BD Head',
    BUSINESSDEVELOPMENTHEAD: 'BD Head',
    BUSINESSHEAD: 'Business Head',
    BRANCHHEAD: 'Branch Head',
    BH: 'Branch Head',
    ADMIN: 'Admin',
    QPMSADMIN: 'QPMS Admin',
    DEVELOPER: 'Developer',
    DEV: 'Developer',
    ITADMIN: 'Developer',
    MANAGEMENTITADMIN: 'Developer',
    DEMOADMIN: 'DEMO_ADMIN',
    TENDERDEMO: 'DEMO_ADMIN',
    READONLYADMIN: 'DEMO_ADMIN',
    DEMOVIEWER: 'DEMO_VIEWER',
    COO: 'COO',
    GM: 'GM',
    GENERALMANAGER: 'GM',
    GMTOPMANAGEMENT: 'GM',
    MD: 'MD',
  };
  return aliases[normalizedRoleKey(role)] || String(role || '').trim();
}

export function normalizeAppRole(role = '') {
  const canonical = normalizeCanonicalRole(role);
  const match = Object.entries(roleGroups).find(([, aliases]) => aliases.includes(canonical));
  return match?.[0] || canonical || 'BD';
}

export function hasAnyRole(user, allowedRoles = []) {
  if (!allowedRoles.length) return true;
  if (!user) return false;
  const normalized = normalizeAppRole(user.role);
  return allowedRoles.some((role) => normalizeAppRole(role) === normalized || role === user.role);
}

export function routeAllowedRoles(pathname = '') {
  if (pathname.startsWith('/dashboard')) return [];
  if (pathname.startsWith('/store-master')) return ['StoreMasterAdmin'];
  if (pathname.startsWith('/settings/user-management')) {
    return ['Admin', 'Management', 'HR', 'FinanceLeadership'];
  }
  if (pathname.startsWith('/settings/hospital-feedback')) {
    return ['Admin', 'Management', 'FinanceLeadership', 'ExistingOperations', 'Operations'];
  }
  if (pathname.startsWith('/operations/hospital-feedback')) {
    return ['Admin', 'Management', 'FinanceLeadership', 'ExistingOperations', 'Operations', 'DemoViewer'];
  }
  if (pathname.startsWith('/settings')) return [];
  if (pathname.startsWith('/crm')) return ['Admin', 'Management', 'FinanceLeadership', 'BD', 'DemoViewer'];
  if (pathname.startsWith('/sites') || pathname.startsWith('/site-visit')) return ['Admin', 'BD', 'DemoViewer'];
  if (pathname.startsWith('/site-monitoring')) return ['Admin', 'Management', 'FinanceLeadership', 'ExistingOperations', 'Operations', 'DemoViewer'];
  if (pathname.startsWith('/proposals')) return ['Admin', 'Management', 'FinanceLeadership', 'BD', 'DemoViewer'];
  if (pathname.startsWith('/approvals')) return ['Admin', 'Management', 'FinanceLeadership', 'DemoViewer'];
  if (pathname.startsWith('/tasks')) return ['Admin', 'Management', 'FinanceLeadership', 'Operations', 'Coordinator', 'HR', 'Commercial', 'Finance', 'DemoViewer'];
  if (pathname.startsWith('/existing-business')) return ['Admin', 'Management', 'FinanceLeadership', 'ExistingOperations', 'Operations', 'DemoViewer'];
  if (pathname.startsWith('/fo-activities')) return ['Admin', 'Management', 'FinanceLeadership', 'ExistingOperations', 'Operations', 'FieldOfficer', 'DemoViewer'];
  if (pathname.startsWith('/fault-tracker')) return ['FaultTracker', 'DemoViewer'];
  if (pathname.startsWith('/deep-cleaning')) return ['Admin', 'Management', 'FinanceLeadership', 'ExistingOperations', 'Operations', 'DemoViewer'];
  if (pathname.startsWith('/assets')) return ['Admin', 'Management', 'FinanceLeadership', 'ExistingOperations', 'Operations', 'DemoViewer'];
  if (pathname.startsWith('/employees')) return ['Admin', 'Management'];
  if (pathname.startsWith('/reports')) return ['Admin', 'Management', 'FinanceLeadership', 'ExistingOperations', 'Operations', 'DemoViewer'];
  if (pathname.startsWith('/tickets')) return ['Admin', 'Management', 'FinanceLeadership', 'ExistingOperations', 'Operations', 'FieldOfficer', 'DemoViewer'];
  return [];
}

function normalizeRawRole(role = '') {
  return String(role || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '');
}

function canonicalUserRole(user) {
  return normalizeCanonicalRole(user?.rawRole || user?.role || user);
}

export function canCreateLead(user) {
  if (normalizeAppRole(user?.rawRole || user?.role) === 'DemoViewer') return false;
  return new Set(['BD Executive', 'Admin', 'COO', 'GM', 'MD']).has(canonicalUserRole(user));
}

export function canAssignLead(user) {
  if (normalizeAppRole(user?.rawRole || user?.role) === 'DemoViewer') return false;
  return new Set(['Admin', 'COO', 'GM', 'MD']).has(canonicalUserRole(user));
}

export function canSendLeadMom(user) {
  if (normalizeAppRole(user?.rawRole || user?.role) === 'DemoViewer') return false;
  return new Set(['BD Executive', 'Admin', 'COO', 'GM', 'MD']).has(canonicalUserRole(user));
}

export function canAccessFaultTracker(user) {
  if (!user) return false;
  return new Set([
    'ADMIN',
    'QPMSADMIN',
    'DEVELOPER',
    'DEMOADMIN',
    'TENDERDEMO',
    'READONLYADMIN',
    'DEMOVIEWER',
    'COO',
    'IFMSSOUTHHEAD',
    'SOUTHHEAD',
    'OPERATIONMANAGER',
    'OPERATIONSMANAGER',
    'OPSMANAGER',
    'BRANCHHEAD',
    'PROJECTCOORDINATOR',
    'MIS',
  ]).has(normalizeRawRole(user.rawRole || user.role));
}

export function canAccessStoreMaster(user) {
  if (!user) return false;
  if (normalizeAppRole(user.rawRole || user.role) === 'DemoViewer') return false;
  return new Set(['DEVELOPER', 'ADMIN', 'QPMSADMIN', 'MD', 'COO', 'DEMOADMIN', 'TENDERDEMO', 'READONLYADMIN']).has(
    normalizeRawRole(user.rawRole || user.role),
  );
}

export function canAccessRoute(user, pathname) {
  if (normalizeAppRole(user?.rawRole || user?.role) === 'DemoViewer') {
    if (pathname.startsWith('/store-master') || pathname.startsWith('/settings') || pathname.startsWith('/employees')) return false;
  }
  if (pathname.startsWith('/store-master')) return canAccessStoreMaster(user);
  if (pathname.startsWith('/fault-tracker')) return canAccessFaultTracker(user);
  if (pathname.startsWith('/crm') && ['Business Head', 'Branch Head'].includes(normalizeCanonicalRole(user?.rawRole || user?.role))) return true;
  return hasAnyRole(user, routeAllowedRoles(pathname));
}

export function canAccessNavRoute(user, pathname) {
  if (!protectedNavRoutes.some((route) => pathname === route || pathname.startsWith(`${route}/`))) return true;
  return canAccessRoute(user, pathname);
}
