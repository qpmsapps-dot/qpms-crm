const explicitDemoAuthFlag = String(
  import.meta.env.VITE_ENABLE_DEMO_AUTH ?? import.meta.env.VITE_DEMO_MODE ?? '',
).trim().toLowerCase();

export const isDemoAuthEnabled = explicitDemoAuthFlag === 'true';
export const appMode = isDemoAuthEnabled ? 'demo' : 'production';
export const isProductionAuthMode = !isDemoAuthEnabled;

export const roleGroups = {
  BD: ['BD', 'BD Team', 'BD Executive', 'BD Head'],
  Operations: ['Operations', 'Operations Team'],
  Coordinator: ['Coordinator'],
  HR: ['HR', 'HR Reviewer', 'HR GM'],
  Commercial: ['Commercial', 'Commercial Team', 'Commercial Reviewer'],
  Finance: ['Finance', 'Finance Team', 'Finance Reviewer'],
  FinanceLeadership: ['Finance GM', 'CFO'],
  Management: ['Management', 'MD', 'COO', 'GM', 'Top Management', 'GM / Top Management'],
  ExistingOperations: ['Existing Business Operations Team'],
  FieldOfficer: ['Field Officer', 'FO'],
  Client: ['Client', 'Client Login'],
  Admin: ['Admin'],
};

export const protectedNavRoutes = ['/dashboard', '/crm', '/sites', '/site-visit', '/site-monitoring', '/proposals', '/approvals', '/tasks', '/existing-business', '/fo-activities', '/tickets', '/assets', '/reports', '/employees', '/settings'];

export function normalizeAppRole(role = '') {
  const match = Object.entries(roleGroups).find(([, aliases]) => aliases.includes(role));
  return match?.[0] || role || 'BD';
}

export function hasAnyRole(user, allowedRoles = []) {
  if (!allowedRoles.length) return true;
  if (!user) return false;
  const normalized = normalizeAppRole(user.role);
  return allowedRoles.some((role) => normalizeAppRole(role) === normalized || role === user.role);
}

export function routeAllowedRoles(pathname = '') {
  if (pathname.startsWith('/dashboard')) return [];
  if (pathname.startsWith('/settings/user-management')) {
    return ['Admin', 'Management', 'HR', 'FinanceLeadership'];
  }
  if (pathname.startsWith('/settings')) return [];
  if (pathname.startsWith('/crm')) return ['Admin', 'Management', 'FinanceLeadership', 'BD'];
  if (pathname.startsWith('/sites') || pathname.startsWith('/site-visit')) return ['Admin', 'BD'];
  if (pathname.startsWith('/site-monitoring')) return ['Admin', 'Management', 'FinanceLeadership', 'ExistingOperations'];
  if (pathname.startsWith('/proposals')) return ['Admin', 'Management', 'FinanceLeadership', 'BD'];
  if (pathname.startsWith('/approvals')) return ['Admin', 'Management', 'FinanceLeadership'];
  if (pathname.startsWith('/tasks')) return ['Admin', 'Management', 'FinanceLeadership', 'Operations', 'Coordinator', 'HR', 'Commercial', 'Finance'];
  if (pathname.startsWith('/existing-business')) return ['Admin', 'Management', 'FinanceLeadership', 'ExistingOperations'];
  if (pathname.startsWith('/fo-activities')) return ['Admin', 'Management', 'FinanceLeadership', 'ExistingOperations'];
  if (pathname.startsWith('/assets')) return ['Admin', 'Management', 'FinanceLeadership', 'ExistingOperations'];
  if (pathname.startsWith('/employees')) return ['Admin', 'Management'];
  if (pathname.startsWith('/reports')) return ['Admin', 'Management', 'FinanceLeadership', 'ExistingOperations'];
  if (pathname.startsWith('/tickets')) return ['Admin', 'Management', 'FinanceLeadership', 'ExistingOperations'];
  return [];
}

export function canAccessRoute(user, pathname) {
  return hasAnyRole(user, routeAllowedRoles(pathname));
}

export function canAccessNavRoute(user, pathname) {
  if (!protectedNavRoutes.some((route) => pathname === route || pathname.startsWith(`${route}/`))) return true;
  return canAccessRoute(user, pathname);
}
