import { hasCooWebVisibility, normalizeWebRoleKey } from './webRoleAccessService.js';

export const FO_ACCESS_MODES = Object.freeze({
  LEGACY: 'legacy',
  SHADOW: 'shadow',
  NORMALIZED: 'normalized',
});

const FULL_VISIBILITY_ROLES = new Set([
  'ADMIN', 'QPMSADMIN', 'DEVELOPER', 'DEV', 'ITADMIN', 'MD', 'COO',
  'DEMOADMIN', 'TENDERDEMO', 'DEMOVIEWER',
]);

const OPERATIONS_ROLES = new Set([
  ...FULL_VISIBILITY_ROLES,
  'GM', 'GENERALMANAGER', 'SOUTHHEAD', 'BRANCHHEAD', 'BH',
  'OPERATIONSMANAGER', 'OPERATIONMANAGER', 'OM', 'MANAGER',
  'BUSINESSHEAD', 'KAM', 'KEYACCOUNTMANAGER', 'FO', 'FIELDOFFICER',
]);

const OPERATIONAL_EMPLOYEE_ROLES = new Set([
  'GM', 'GENERALMANAGER', 'SOUTHHEAD', 'BRANCHHEAD', 'BH',
  'OPERATIONSMANAGER', 'OPERATIONMANAGER', 'OM', 'MANAGER',
  'KAM', 'KEYACCOUNTMANAGER', 'FO', 'FIELDOFFICER',
]);

const COMMAND_CENTER_RELIANCE_ALL_STATES_ACTORS = new Set([
  'QPMSTNC16972',
]);

const COMMAND_CENTER_TN_STANDALONE_ACTORS = new Set([
  'QPMSTN3082',
]);

const COMMAND_CENTER_RELIANCE_STATES = Object.freeze(['AP', 'KA', 'KL', 'TG', 'TN']);
const COMMAND_CENTER_BRANCH_HEAD_MULTI_BUSINESS_STATES = new Set(['ap', 'ka', 'kl', 'tg']);
const COMMAND_CENTER_STANDARD_BUSINESS_GROUPS = new Set(['standalone', 'reliance_retail']);
const COMMAND_CENTER_STATE_BUSINESS_ROLES = new Set(['BRANCHHEAD']);
const CONFIGURED_MANAGEMENT_ROLES = new Set(['GM', 'BRANCHHEAD']);

export const FO_FEATURES = Object.freeze([
  { key: 'DASHBOARD_VIEW', label: 'View Dashboard', category: 'Overview', module: 'FO Operations' },
  { key: 'MAP_VIEW', label: 'Map View', category: 'Live Operations', module: 'FO Operations' },
  { key: 'LIVE_FO_VIEW', label: 'Live FO', category: 'Live Operations', module: 'FO Operations' },
  { key: 'GPS_HISTORY_VIEW', label: 'GPS History', category: 'Live Operations', module: 'FO Operations' },
  { key: 'ROUTE_VIEW', label: 'Route View', category: 'Live Operations', module: 'FO Operations' },
  { key: 'ATTENDANCE_VIEW', label: 'Attendance', category: 'Attendance', module: 'FO Operations' },
  { key: 'VISITS_VIEW', label: 'Visits', category: 'Attendance', module: 'FO Operations' },
  { key: 'ACTIVITIES_VIEW', label: 'Activities', category: 'Activities', module: 'FO Operations' },
  { key: 'ACTIVITY_PHOTOS_VIEW', label: 'Activity Photos', category: 'Activities', module: 'FO Operations' },
  { key: 'KM_VIEW', label: 'KM View', category: 'KM', module: 'FO Operations' },
  { key: 'KM_RECALCULATE', label: 'KM Recalculate', category: 'KM', module: 'FO Operations' },
  { key: 'KM_APPROVE', label: 'KM Approval', category: 'KM', module: 'FO Operations' },
  { key: 'KM_AUDIT_VIEW', label: 'KM Audit', category: 'KM', module: 'FO Operations' },
  { key: 'REPORTS_VIEW', label: 'View Reports', category: 'Reporting', module: 'Reports' },
  { key: 'EXPORT', label: 'Export', category: 'Reporting', module: 'Reports' },
  { key: 'USER_VIEW', label: 'View Users', category: 'User Management', module: 'User Management' },
  { key: 'USER_CREATE', label: 'Create User', category: 'User Management', module: 'User Management' },
  { key: 'USER_EDIT', label: 'Edit User', category: 'User Management', module: 'User Management' },
  { key: 'USER_DEACTIVATE', label: 'Deactivate', category: 'User Management', module: 'User Management' },
  { key: 'USER_RESET_LOGIN', label: 'Reset Login', category: 'User Management', module: 'User Management' },
  { key: 'FAULT_TRACKER', label: 'Fault Tracker', category: 'Other Modules', module: 'Fault Tracker' },
  { key: 'DEEP_CLEANING', label: 'Deep Cleaning', category: 'Other Modules', module: 'Deep Cleaning' },
  { key: 'HOSPITAL_OPERATIONS', label: 'Hospital Operations', category: 'Other Modules', module: 'Hospital Operations' },
  { key: 'HOSPITAL_FEEDBACK', label: 'Hospital Feedback', category: 'Other Modules', module: 'Hospital Feedback' },
  { key: 'NEW_BUSINESS', label: 'New Business', category: 'Other Modules', module: 'Lead Management' },
  { key: 'TRAINING', label: 'Training', category: 'Other Modules', module: 'Training' },
]);

const MATRIX_ROLES = Object.freeze([
  { role: 'Admin', key: 'ADMIN', targetScope: 'Global' },
  { role: 'QPMS Admin', key: 'QPMSADMIN', targetScope: 'Global' },
  { role: 'Developer', key: 'DEVELOPER', targetScope: 'Global' },
  { role: 'MD', key: 'MD', targetScope: 'Global' },
  { role: 'COO', key: 'COO', targetScope: 'Global' },
  { role: 'Executive Assistant', key: 'EXECUTIVEASSISTANT', targetScope: 'COO delegated read visibility' },
  { role: 'GM', key: 'GM', targetScope: 'Assigned vertical + reporting tree' },
  { role: 'South Head', key: 'SOUTHHEAD', targetScope: 'Assigned region + reporting tree' },
  { role: 'Business Head', key: 'BUSINESSHEAD', targetScope: 'Assigned vertical/client' },
  { role: 'Branch Head', key: 'BRANCHHEAD', targetScope: 'Assigned vertical/client + branch + reporting tree' },
  { role: 'Operations Manager', key: 'OPERATIONSMANAGER', targetScope: 'Own reporting field team' },
  { role: 'KAM', key: 'KAM', targetScope: 'Current hierarchy / assigned accounts' },
  { role: 'FO', key: 'FO', targetScope: 'Self' },
]);

const FULL_FO_FEATURES = new Set([
  'DASHBOARD_VIEW', 'MAP_VIEW', 'LIVE_FO_VIEW', 'GPS_HISTORY_VIEW', 'ROUTE_VIEW',
  'ATTENDANCE_VIEW', 'VISITS_VIEW', 'ACTIVITIES_VIEW', 'ACTIVITY_PHOTOS_VIEW',
  'KM_VIEW', 'REPORTS_VIEW', 'EXPORT',
]);

const TECHNICAL_KM_ROLES = new Set(['ADMIN', 'QPMSADMIN', 'DEVELOPER', 'DEV', 'ITADMIN', 'MANAGEMENTITADMIN', 'MD']);
const BATCH_KM_ROLES = new Set(['ADMIN', 'QPMSADMIN', 'DEVELOPER', 'MD', 'COO']);
const KM_APPROVAL_ROLES = new Set(['ADMIN', 'QPMSADMIN', 'DEVELOPER']);
const CHECKOUT_REVIEW_ROLES = new Set(['ADMIN', 'QPMSADMIN', 'DEVELOPER', 'OPERATIONSMANAGER', 'OPERATIONMANAGER', 'OM', 'BRANCHHEAD', 'BH', 'MANAGEMENT']);
const USER_MANAGEMENT_ROLES = new Set(['ADMIN', 'QPMSADMIN', 'DEVELOPER', 'MD', 'COO', 'GM', 'GENERALMANAGER', 'GMTOPMANAGEMENT', 'TOPMANAGEMENT', 'MANAGEMENT', 'HR', 'HUMANRESOURCES', 'HRREVIEWER', 'HRGM', 'FINANCEGM']);
const FAULT_TRACKER_READ_ALL = new Set(['ADMIN', 'QPMSADMIN', 'DEVELOPER', 'DEV', 'ITADMIN', 'MANAGEMENTITADMIN', 'DEMOVIEWER', 'COO', 'EXECUTIVEASSISTANT', 'IFMSSOUTHHEAD', 'SOUTHHEAD', 'OPERATIONMANAGER', 'OPERATIONSMANAGER', 'OPSMANAGER', 'BRANCHHEAD']);
const LEAD_ROLES = new Set(['BDEXECUTIVE', 'BDHEAD', 'BUSINESSHEAD', 'BRANCHHEAD', 'ADMIN', 'QPMSADMIN', 'DEVELOPER', 'COO', 'EXECUTIVEASSISTANT', 'GM', 'MD']);

function text(value) {
  return String(value || '').trim();
}

function comparable(value) {
  return text(value).toLowerCase();
}

export function normalizeFoOperationalRole(role = '') {
  const key = normalizeWebRoleKey(role);
  const aliases = {
    QPMSADMIN: 'QPMSADMIN',
    DEV: 'DEVELOPER',
    ITADMIN: 'DEVELOPER',
    MANAGEMENTITADMIN: 'DEVELOPER',
    DEMOADMIN: 'DEMOADMIN',
    TENDERDEMO: 'TENDERDEMO',
    READONLYADMIN: 'DEMOADMIN',
    DEMOVIEWER: 'DEMOVIEWER',
    GENERALMANAGER: 'GM',
    GMTOPMANAGEMENT: 'GM',
    OPERATIONSMANAGER: 'OPERATIONSMANAGER',
    OPERATIONMANAGER: 'OPERATIONSMANAGER',
    OPSMANAGER: 'OPERATIONSMANAGER',
    OM: 'OPERATIONSMANAGER',
    BRANCHHEAD: 'BRANCHHEAD',
    BH: 'BRANCHHEAD',
    BUSINESSHEAD: 'BUSINESSHEAD',
    SOUTHHEAD: 'SOUTHHEAD',
    IFMSSOUTHHEAD: 'SOUTHHEAD',
    KEYACCOUNTMANAGER: 'KAM',
    FIELDOFFICER: 'FO',
    EXECUTIVEASSISTANT: 'EXECUTIVEASSISTANT',
  };
  return aliases[key] || key;
}

function employeeKey(row = {}) {
  return text(row.employee_code || row.fo_user_id || row.username).toUpperCase();
}

export function foEmployeeKey(row = {}) {
  return employeeKey(row);
}

function profileValue(profile = {}, field) {
  return text(profile[field] || profile.metadata?.[field]);
}

function activeProfile(profile = {}) {
  return profile?.is_active === true && !['inactive', 'disabled', 'deactivated'].includes(comparable(profile.status));
}

function uppercaseState(value) {
  return text(value).toUpperCase();
}

function normalizedBusinessGroup(value) {
  const key = comparable(value);
  if (key === 'retail' || key === 'reliance retail') return 'reliance_retail';
  if (key === 'standalone') return 'standalone';
  if (key.includes('hospital') || key.includes('nims') || key.includes('osmania')) return 'hospital';
  return key;
}

function profileBusinessGroup(profile = {}) {
  return normalizedBusinessGroup(
    profileValue(profile, 'business') ||
    profileValue(profile, 'client') ||
    profileValue(profile, 'client_name'),
  );
}

function configuredFoAccess(profile = {}) {
  const config = profile.fo_access_config || profile._fo_access_config || null;
  if (!config || config.active === false) return null;
  const role = normalizeFoOperationalRole(config.role || config.role_code);
  if (!CONFIGURED_MANAGEMENT_ROLES.has(role)) return null;
  if (config.invalid === true) {
    return {
      role,
      states: [],
      businessGroups: [],
      businesses: [],
      source: config.source || 'access_user_assignments',
      invalid: true,
      reason: config.reason || 'configured_scope_invalid',
    };
  }
  const states = Array.isArray(config.states)
    ? config.states.map(uppercaseState).filter(Boolean)
    : [];
  const businessGroups = Array.isArray(config.business_groups)
    ? config.business_groups.map(normalizedBusinessGroup).filter((value) => COMMAND_CENTER_STANDARD_BUSINESS_GROUPS.has(value))
    : [];
  const businesses = Array.isArray(config.businesses)
    ? config.businesses.map(text).filter(Boolean)
    : [];
  if (!states.length || !businessGroups.length) return null;
  return {
    role,
    states: [...new Set(states)],
    businessGroups: [...new Set(businessGroups)],
    businesses: [...new Set(businesses.length ? businesses : businessGroups.flatMap((group) =>
      group === 'standalone' ? ['Standalone'] : ['Reliance Retail', 'Retail']))],
    source: config.source || 'access_user_assignments',
  };
}

function isHospitalOrNimsProfile(profile = {}) {
  return [
    profileValue(profile, 'business'),
    profileValue(profile, 'client'),
    profileValue(profile, 'client_name'),
    profile.metadata?.business,
    profile.metadata?.client,
    profile.metadata?.client_name,
  ].some((value) => normalizedBusinessGroup(value) === 'hospital');
}

function isOperationsManagerLike(profile = {}) {
  return comparable([
    profile.role,
    profile.designation,
    profile.department,
    profile.metadata?.designation,
    profile.metadata?.department,
  ].join(' ')).includes('operation');
}

export function isOperationalEmployeeProfile(profile = {}) {
  const key = normalizeFoOperationalRole(profile.role);
  if (key !== 'MANAGER') return OPERATIONAL_EMPLOYEE_ROLES.has(key);
  return isOperationsManagerLike(profile);
}

export function canAccessFoOperations(profile) {
  if (hasCooWebVisibility(profile?.role) && profile?.web_access_enabled === false) return false;
  if (activeProfile(profile) && configuredFoAccess(profile)) return true;
  const key = normalizeFoOperationalRole(profile?.role);
  if (!activeProfile(profile) || (!OPERATIONS_ROLES.has(key) && !hasCooWebVisibility(profile?.role))) return false;
  if (key !== 'MANAGER') return true;
  return isOperationsManagerLike(profile);
}

function hierarchyCodesForActor(actorCode, hierarchyRows = []) {
  const codes = new Set(actorCode ? [actorCode] : []);
  for (const row of hierarchyRows) {
    if (row?.is_active === false) continue;
    const references = [
      row.manager_employee_code,
      row.managers_manager_employee_code,
      row.business_head_employee_code,
      row.gm_employee_code,
      row.coo_employee_code,
      ...(Array.isArray(row.hierarchy_path) ? row.hierarchy_path : []),
    ].map((value) => text(value).toUpperCase());
    if (actorCode && references.includes(actorCode)) {
      const code = employeeKey(row);
      if (code) codes.add(code);
    }
  }
  return codes;
}

function hierarchyDescendantCodesForActor(actorCode, hierarchyRows = [], maxDepth = 50) {
  const normalizedActorCode = text(actorCode).toUpperCase();
  if (!normalizedActorCode) return new Set();

  const childrenByManager = new Map();
  for (const row of hierarchyRows) {
    if (row?.is_active === false) continue;
    const employeeCode = employeeKey(row);
    const managerCode = text(row?.manager_employee_code).toUpperCase();
    if (!employeeCode || !managerCode || employeeCode === managerCode) continue;
    if (!childrenByManager.has(managerCode)) childrenByManager.set(managerCode, new Set());
    childrenByManager.get(managerCode).add(employeeCode);
  }

  const descendants = new Set();
  let frontier = [normalizedActorCode];
  for (let depth = 0; frontier.length && depth < maxDepth; depth += 1) {
    const next = [];
    for (const managerCode of frontier) {
      for (const employeeCode of childrenByManager.get(managerCode) || []) {
        if (employeeCode === normalizedActorCode || descendants.has(employeeCode)) continue;
        descendants.add(employeeCode);
        next.push(employeeCode);
      }
    }
    frontier = next;
  }
  return descendants;
}

export function foOperationalAllowedEmployeeCodes(actor, profiles = [], hierarchyRows = []) {
  if (!canAccessFoOperations(actor)) return new Set();
  const actorRole = normalizeFoOperationalRole(actor.role);
  const actorCode = employeeKey(actor);
  const configured = configuredFoAccess(actor);
  const descendants = hierarchyCodesForActor(actorCode, hierarchyRows);
  const actorState = comparable(profileValue(actor, 'state'));
  const actorBusiness = comparable(profileValue(actor, 'business'));
  const actorBranch = comparable(profileValue(actor, 'branch'));
  const allowed = new Set();

  for (const profile of profiles) {
    if (!activeProfile(profile) || !isOperationalEmployeeProfile(profile)) continue;
    const code = employeeKey(profile);
    if (!code) continue;
    if (FULL_VISIBILITY_ROLES.has(actorRole) || hasCooWebVisibility(actor.role)) {
      allowed.add(code);
      continue;
    }
    if (configured) {
      const profileState = uppercaseState(profileValue(profile, 'state'));
      const profileGroup = profileBusinessGroup(profile);
      if (
        configured.states.includes(profileState) &&
        configured.businessGroups.includes(profileGroup) &&
        !isHospitalOrNimsProfile(profile)
      ) allowed.add(code);
      continue;
    }
    const profileState = comparable(profileValue(profile, 'state'));
    const profileBusiness = comparable(profileValue(profile, 'business'));
    const profileBranch = comparable(profileValue(profile, 'branch'));
    if (actorRole === 'BUSINESSHEAD') {
      if (actorBusiness && profileBusiness === actorBusiness) allowed.add(code);
      continue;
    }
    if (actorRole === 'BRANCHHEAD') {
      if (
        actorState && profileState === actorState &&
        (!actorBusiness || profileBusiness === actorBusiness) &&
        (!actorBranch || profileBranch === actorBranch)
      ) allowed.add(code);
      continue;
    }
    if (['GM', 'SOUTHHEAD'].includes(actorRole)) {
      if (
        descendants.has(code) ||
        (actorState && profileState === actorState && (!actorBusiness || profileBusiness === actorBusiness))
      ) allowed.add(code);
      continue;
    }
    if (descendants.has(code)) allowed.add(code);
  }
  if (actorCode && isOperationalEmployeeProfile(actor)) allowed.add(actorCode);
  return allowed;
}

export function resolveOperationsCommandCenterScope(actor = {}) {
  if (!canAccessFoOperations(actor)) {
    return {
      scopeType: 'NONE',
      allowedStates: [],
      allowedBusinessGroups: [],
      allowedBusinesses: [],
      excludeHospital: true,
      legacyFallback: false,
      label: 'No Operations Command Center access',
    };
  }

  const actorRole = normalizeFoOperationalRole(actor.role);
  const actorCode = employeeKey(actor);
  const actorState = uppercaseState(profileValue(actor, 'state'));
  const actorBusinessGroup = profileBusinessGroup(actor);
  const configured = configuredFoAccess(actor);

  if (configured) {
    if (configured.invalid) {
      return {
        scopeType: 'CONFIGURED_INVALID',
        allowedStates: [],
        allowedBusinessGroups: [],
        allowedBusinesses: [],
        excludeHospital: true,
        legacyFallback: false,
        configured: true,
        invalid: true,
        label: 'Configured access requires valid state and business scope',
        source: configured.source,
      };
    }
    return {
      scopeType: configured.role === 'GM' ? 'CONFIGURED_GM' : 'CONFIGURED_BRANCH_HEAD',
      allowedStates: configured.states,
      allowedBusinessGroups: configured.businessGroups,
      allowedBusinesses: configured.businesses,
      excludeHospital: true,
      legacyFallback: false,
      configured: true,
      label: `Viewing: ${configured.states.join(', ')} - ${configured.businesses.filter((value) => value !== 'Retail').join(' + ')}`,
      source: configured.source,
    };
  }

  if (FULL_VISIBILITY_ROLES.has(actorRole) || hasCooWebVisibility(actor.role)) {
    return {
      scopeType: 'GLOBAL',
      allowedStates: [],
      allowedBusinessGroups: [],
      allowedBusinesses: [],
      excludeHospital: false,
      legacyFallback: false,
      label: 'Viewing: Global',
    };
  }

  if (COMMAND_CENTER_RELIANCE_ALL_STATES_ACTORS.has(actorCode)) {
    return {
      scopeType: 'RELIANCE_RETAIL_ALL_STATES',
      allowedStates: [...COMMAND_CENTER_RELIANCE_STATES],
      allowedBusinessGroups: ['reliance_retail'],
      allowedBusinesses: ['Reliance Retail', 'Retail'],
      excludeHospital: true,
      legacyFallback: false,
      label: 'Viewing: All 5 States - Reliance Retail',
    };
  }

  if (COMMAND_CENTER_TN_STANDALONE_ACTORS.has(actorCode)) {
    return {
      scopeType: 'TN_STANDALONE_OVERRIDE',
      allowedStates: ['TN'],
      allowedBusinessGroups: ['standalone'],
      allowedBusinesses: ['Standalone'],
      excludeHospital: true,
      legacyFallback: false,
      label: 'Viewing: TN - Standalone',
    };
  }

  if (
    actorRole === 'BRANCHHEAD' &&
    COMMAND_CENTER_BRANCH_HEAD_MULTI_BUSINESS_STATES.has(actorState.toLowerCase())
  ) {
    return {
      scopeType: 'BRANCH_HEAD_STATE_STANDARD_FO_BUSINESSES',
      allowedStates: [actorState],
      allowedBusinessGroups: [...COMMAND_CENTER_STANDARD_BUSINESS_GROUPS],
      allowedBusinesses: ['Standalone', 'Reliance Retail', 'Retail'],
      excludeHospital: true,
      legacyFallback: false,
      label: `Viewing: ${actorState} - Standalone + Reliance Retail`,
    };
  }

  if (
    COMMAND_CENTER_STATE_BUSINESS_ROLES.has(actorRole) &&
    actorState === 'TN' &&
    ['standalone', 'reliance_retail'].includes(actorBusinessGroup)
  ) {
    return {
      scopeType: actorBusinessGroup === 'standalone' ? 'TN_STANDALONE' : 'TN_RELIANCE_RETAIL',
      allowedStates: ['TN'],
      allowedBusinessGroups: [actorBusinessGroup],
      allowedBusinesses: actorBusinessGroup === 'standalone'
        ? ['Standalone']
        : ['Reliance Retail', 'Retail'],
      excludeHospital: true,
      legacyFallback: false,
      label: actorBusinessGroup === 'standalone'
        ? 'Viewing: TN - Standalone'
        : 'Viewing: TN - Reliance Retail',
    };
  }

  return {
    scopeType: 'LEGACY',
    allowedStates: [],
    allowedBusinessGroups: [],
    allowedBusinesses: [],
    excludeHospital: false,
    legacyFallback: true,
    label: 'Viewing: Legacy scope',
  };
}

function profileMatchesOperationsCommandCenterScope(profile = {}, scope = {}) {
  if (scope.configured && (!scope.allowedStates?.length || !scope.allowedBusinessGroups?.length)) return false;
  if (!activeProfile(profile) || !isOperationalEmployeeProfile(profile)) return false;
  if (scope.scopeType === 'GLOBAL') return true;
  if (scope.excludeHospital && isHospitalOrNimsProfile(profile)) return false;
  const state = uppercaseState(profileValue(profile, 'state'));
  if (scope.allowedStates?.length && !scope.allowedStates.includes(state)) return false;
  const businessGroup = profileBusinessGroup(profile);
  return !scope.allowedBusinessGroups?.length || scope.allowedBusinessGroups.includes(businessGroup);
}

export function operationsCommandCenterAllowedEmployeeCodes(actor, profiles = [], hierarchyRows = []) {
  const scope = resolveOperationsCommandCenterScope(actor);
  if (scope.legacyFallback) return foOperationalAllowedEmployeeCodes(actor, profiles, hierarchyRows);
  const allowed = new Set();
  const actorCode = employeeKey(actor);
  const configuredBranchHeadDescendants = scope.scopeType === 'CONFIGURED_BRANCH_HEAD'
    ? hierarchyDescendantCodesForActor(actorCode, hierarchyRows)
    : null;
  for (const profile of profiles) {
    if (!profileMatchesOperationsCommandCenterScope(profile, scope)) continue;
    const code = employeeKey(profile);
    if (
      configuredBranchHeadDescendants &&
      code !== actorCode &&
      !configuredBranchHeadDescendants.has(code)
    ) continue;
    if (code) allowed.add(code);
  }
  return allowed;
}

export function isProfileInOperationsCommandCenterScope(actor, target, profiles = [], hierarchyRows = []) {
  const allowedCodes = operationsCommandCenterAllowedEmployeeCodes(actor, profiles, hierarchyRows);
  const targetProfile = profiles.find((profile) =>
    [profile.id, profile.employee_code, profile.username]
      .map((value) => text(value).toUpperCase())
      .filter(Boolean)
      .some((value) => [
        target?.id,
        target?.profile_id,
        target?.employee_code,
        target?.fo_user_id,
        target?.username,
      ].map((candidate) => text(candidate).toUpperCase()).includes(value)));
  const targetCodes = [
    employeeKey(target),
    text(target?.employee_code).toUpperCase(),
    text(target?.fo_user_id).toUpperCase(),
    text(target?.username).toUpperCase(),
    employeeKey(targetProfile),
  ].filter(Boolean);
  return targetCodes.some((code) => allowedCodes.has(code));
}

export function resolveFoAccessMode(env = process.env) {
  const requested = comparable(env.FO_ACCESS_MODE || 'legacy');
  if (requested === FO_ACCESS_MODES.SHADOW) {
    return { mode: FO_ACCESS_MODES.SHADOW, requested_mode: requested, production_mode: FO_ACCESS_MODES.LEGACY };
  }
  if (requested === FO_ACCESS_MODES.NORMALIZED) {
    return {
      mode: FO_ACCESS_MODES.LEGACY,
      requested_mode: requested,
      production_mode: FO_ACCESS_MODES.LEGACY,
      normalized_available: false,
      warning: 'FO_ACCESS_MODE=normalized is reserved until org/access migration is complete.',
    };
  }
  return { mode: FO_ACCESS_MODES.LEGACY, requested_mode: requested || 'legacy', production_mode: FO_ACCESS_MODES.LEGACY };
}

export function resolveFoDataScope(actor, profiles = [], hierarchyRows = [], options = {}) {
  const mode = resolveFoAccessMode(options.env);
  const role = normalizeFoOperationalRole(actor?.role);
  const employeeCodes = foOperationalAllowedEmployeeCodes(actor, profiles, hierarchyRows);
  const full = FULL_VISIBILITY_ROLES.has(role) || hasCooWebVisibility(actor?.role);
  let visibilityType = 'NONE';
  if (full) visibilityType = 'GLOBAL';
  else if (role === 'BUSINESSHEAD') visibilityType = 'BUSINESS';
  else if (role === 'BRANCHHEAD') visibilityType = 'STATE_BUSINESS';
  else if (['GM', 'SOUTHHEAD'].includes(role)) visibilityType = 'STATE_HIERARCHY';
  else if (employeeCodes.size) visibilityType = 'REPORTING_TREE';

  return {
    actorProfileId: actor?.id || null,
    actorEmployeeCode: employeeKey(actor) || null,
    role,
    scopeMode: mode.production_mode.toUpperCase(),
    requestedMode: mode.requested_mode,
    visibilityType,
    employeeCodes: [...employeeCodes].sort(),
    state: profileValue(actor, 'state') || null,
    business: profileValue(actor, 'business') || null,
    branch: profileValue(actor, 'branch') || null,
    canViewSubordinates: !['FO'].includes(role) && employeeCodes.size > 1,
    source: 'legacy_profiles_employee_hierarchy',
    normalized: mode.mode === FO_ACCESS_MODES.SHADOW
      ? {
          status: 'unavailable',
          reason: 'org_* assignments are not migrated yet.',
          missing_from_normalized: [],
          unexpected_in_normalized: [],
        }
      : null,
  };
}

export function resolveFoOperationalAccess(actor, profiles = [], hierarchyRows = [], options = {}) {
  const scope = resolveFoDataScope(actor, profiles, hierarchyRows, options);
  return {
    ...scope,
    canAccessFoOperations: canAccessFoOperations(actor),
    permissions: Object.fromEntries(FO_FEATURES.map((feature) => [feature.key, canFoUser(actor, feature.key)])),
  };
}

export function buildFieldOperationsAccessPreview(actor, profiles = [], hierarchyRows = []) {
  const allowedCodes = operationsCommandCenterAllowedEmployeeCodes(actor, profiles, hierarchyRows);
  const commandCenterScope = resolveOperationsCommandCenterScope(actor);
  const visibleEmployees = profiles
    .filter((profile) => allowedCodes.has(employeeKey(profile)))
    .map((profile) => ({
      id: profile.id || null,
      employee_code: profile.employee_code || profile.username || null,
      full_name: profile.full_name || profile.display_name || null,
      role: profile.role || null,
      state: profileValue(profile, 'state') || null,
      business: profileValue(profile, 'business') || null,
    }))
    .sort((left, right) =>
      text(left.state).localeCompare(text(right.state)) ||
      text(left.business).localeCompare(text(right.business)) ||
      text(left.full_name).localeCompare(text(right.full_name)));
  return {
    employee: {
      id: actor?.id || null,
      employee_code: actor?.employee_code || actor?.username || null,
      full_name: actor?.full_name || actor?.display_name || null,
      role: actor?.role || null,
      state: profileValue(actor, 'state') || null,
      business: profileValue(actor, 'business') || null,
      is_active: actor?.is_active === true,
      web_access_enabled: actor?.web_access_enabled !== false,
    },
    capabilities: {
      command_center_view: canFoUser(actor, 'MAP_VIEW'),
      employee_details_view: canFoUser(actor, 'VISITS_VIEW'),
      visit_history_view: canFoUser(actor, 'VISITS_VIEW'),
      km_view: canFoUser(actor, 'KM_VIEW'),
      missing_km_approve: canFoUser(actor, 'KM_APPROVE'),
    },
    effective_scope: {
      scope_type: commandCenterScope.scopeType,
      label: commandCenterScope.label,
      states: commandCenterScope.allowedStates || [],
      businesses: commandCenterScope.allowedBusinesses || [],
      role: configuredFoAccess(actor)?.role || normalizeFoOperationalRole(actor?.role),
      source: commandCenterScope.source || (commandCenterScope.legacyFallback
        ? 'legacy_profiles_employee_hierarchy'
        : 'operations_command_center_resolver'),
      configured: commandCenterScope.configured === true,
    },
    visible_employee_count: visibleEmployees.length,
    visible_employees: visibleEmployees,
  };
}

export function canFoUser(actor, featureKey) {
  const role = configuredFoAccess(actor)?.role || normalizeFoOperationalRole(actor?.role);
  if (!activeProfile(actor)) return false;
  if (!canAccessFoOperations(actor) && String(featureKey || '').startsWith('KM_') === false) {
    return false;
  }
  if (FULL_FO_FEATURES.has(featureKey)) return canAccessFoOperations(actor);
  if (featureKey === 'KM_RECALCULATE') return BATCH_KM_ROLES.has(role) || TECHNICAL_KM_ROLES.has(role);
  if (featureKey === 'KM_APPROVE') return KM_APPROVAL_ROLES.has(role) || CHECKOUT_REVIEW_ROLES.has(role);
  if (featureKey === 'KM_AUDIT_VIEW') return false;
  if (featureKey?.startsWith('USER_')) return USER_MANAGEMENT_ROLES.has(role) && role !== 'EXECUTIVEASSISTANT';
  if (featureKey === 'FAULT_TRACKER') return FAULT_TRACKER_READ_ALL.has(role);
  if (featureKey === 'DEEP_CLEANING') return ['ADMIN', 'QPMSADMIN', 'DEVELOPER', 'MD', 'COO', 'EXECUTIVEASSISTANT', 'GM', 'BUSINESSHEAD', 'BRANCHHEAD', 'OPERATIONSMANAGER', 'KAM'].includes(role);
  if (featureKey === 'HOSPITAL_OPERATIONS') return ['ADMIN', 'QPMSADMIN', 'DEVELOPER', 'MD', 'COO', 'GM', 'BRANCHHEAD', 'OPERATIONSMANAGER'].includes(role);
  if (featureKey === 'HOSPITAL_FEEDBACK') return ['ADMIN', 'QPMSADMIN', 'DEVELOPER', 'MD', 'COO', 'GM', 'BUSINESSHEAD', 'BRANCHHEAD', 'OPERATIONSMANAGER'].includes(role);
  if (featureKey === 'NEW_BUSINESS') return LEAD_ROLES.has(role);
  if (featureKey === 'TRAINING') return ['ADMIN', 'QPMSADMIN', 'DEVELOPER', 'MD', 'COO', 'EXECUTIVEASSISTANT', 'GM', 'BUSINESSHEAD', 'BRANCHHEAD', 'OPERATIONSMANAGER', 'KAM', 'FO'].includes(role);
  return false;
}

function cellFor(roleRow, feature) {
  const synthetic = { role: roleRow.role, status: 'Active', is_active: true, web_access_enabled: true };
  const allowed = canFoUser(synthetic, feature.key);
  const role = roleRow.key;
  const scope = ['ADMIN', 'QPMSADMIN', 'DEVELOPER', 'MD', 'COO', 'EXECUTIVEASSISTANT'].includes(role)
    ? 'GLOBAL'
    : ['BRANCHHEAD', 'OPERATIONSMANAGER', 'KAM', 'FO', 'GM', 'SOUTHHEAD', 'BUSINESSHEAD'].includes(role)
      ? 'SCOPED'
      : 'NONE';
  if (!allowed) return { feature: feature.key, status: 'NONE', scope: 'NONE', frontend: 'blocked', backend: 'blocked' };
  const status = scope === 'GLOBAL' ? 'FULL' : 'SCOPED';
  return {
    feature: feature.key,
    status,
    scope,
    frontend: 'allowed',
    backend: feature.key === 'KM_AUDIT_VIEW' ? 'not_configured' : 'allowed',
  };
}

export function buildFoAccessMatrix(options = {}) {
  const mode = resolveFoAccessMode(options.env);
  const roles = MATRIX_ROLES.map((row) => ({
    ...row,
    currentSource: 'Legacy profiles + employee_hierarchy',
    migrationReadiness: ['ADMIN', 'QPMSADMIN', 'DEVELOPER', 'MD', 'COO'].includes(row.key)
      ? 'Ready'
      : 'Migration Required',
  }));
  const currentMatrix = roles.map((role) => ({
    role: role.role,
    normalizedKey: role.key,
    currentSource: role.currentSource,
    currentScope: currentScopeForRole(role.key),
    targetScope: role.targetScope,
    frontendStatus: 'Derived from current route helpers/audit',
    backendStatus: 'Derived from legacy resolver/catalog',
    migrationReadiness: role.migrationReadiness,
    cells: FO_FEATURES.map((feature) => cellFor(role, feature)),
  }));
  return {
    mode: mode.production_mode,
    requested_mode: mode.requested_mode,
    shadow_supported: true,
    normalized_active: false,
    migrationReady: false,
    features: FO_FEATURES,
    roles,
    currentMatrix,
    knownMismatches: [
      {
        code: 'FO_DASHBOARD_DIRECT_SUPABASE_READS',
        severity: 'medium',
        message: 'FOActivities still uses direct Supabase reads for selected-officer drill-down datasets; the Command Center list/dashboard load is backend scoped.',
      },
      {
        code: 'FO_OPERATIONS_DASHBOARD_API_SCOPED_LEGACY',
        severity: 'low',
        message: 'The /api/fo/operations/dashboard endpoint uses legacy Command Center scope until normalized org assignments are cut over.',
      },
      {
        code: 'ACCESS_FRAMEWORK_NOT_FO_AUTHORITY',
        severity: 'medium',
        message: 'access_* assignments exist but do not yet authorize FO Operations visibility.',
      },
    ],
    targetModel: [
      'PROFILE / IDENTITY',
      'ORGANIZATION ASSIGNMENT',
      'REPORTING HIERARCHY',
      'MODULE ACCESS',
      'ROLE',
      'PERMISSION',
      'DATA SCOPE',
    ],
    migrationNeeds: {
      tables: ['org_states', 'org_branches', 'org_employee_assignments', 'org_reporting_lines'],
      accessSeeds: ['fo_operations module permissions', 'role permission mappings', 'user assignments', 'data scopes'],
      cutoverSequence: ['migration', 'backfill', 'shadow comparison', 'validation', 'Branch Head pilot', 'Operations Manager pilot', 'full cutover'],
    },
  };
}

function currentScopeForRole(role) {
  if (['ADMIN', 'QPMSADMIN', 'DEVELOPER', 'MD', 'COO', 'EXECUTIVEASSISTANT'].includes(role)) return 'Global';
  if (['GM', 'SOUTHHEAD'].includes(role)) return 'Current state/business plus hierarchy';
  if (role === 'BUSINESSHEAD') return 'Current business';
  if (role === 'BRANCHHEAD') return 'Current state + optional business/branch';
  if (role === 'OPERATIONSMANAGER') return 'Current reporting descendants';
  if (role === 'KAM') return 'Current hierarchy/self';
  if (role === 'FO') return 'Self';
  return 'Not configured';
}
