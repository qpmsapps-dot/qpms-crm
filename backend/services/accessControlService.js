const TABLE_MISSING_CODES = new Set(['42P01', 'PGRST205', 'PGRST204']);
const SUPPORTED_SCOPE_TYPES = new Set([
  'global',
  'business_vertical',
  'client',
  'all_client',
  'state',
  'branch',
  'site',
  'store',
  'hospital_block',
  'floor',
  'location',
  'department',
  'assigned_ticket',
  'employee_self',
]);

function clean(value) {
  return String(value || '').trim();
}

function code(value) {
  return clean(value).toLowerCase();
}

function id(value) {
  const text = clean(value);
  return text || null;
}

function isTableMissing(error) {
  const text = `${error?.code || ''} ${error?.message || ''}`.toLowerCase();
  return TABLE_MISSING_CODES.has(error?.code) ||
    text.includes('could not find the table') ||
    text.includes('does not exist') ||
    text.includes('schema cache');
}

function isActiveProfile(profile = {}) {
  if (!profile) return false;
  if (profile.is_active === false) return false;
  const status = code(profile.status || 'active');
  return !status || status === 'active';
}

function isEffective(row = {}, now = new Date()) {
  if (row.active === false) return false;
  if (code(row.verification_status) !== 'verified') return false;
  const at = now instanceof Date ? now : new Date(now);
  const from = row.effective_from ? new Date(row.effective_from) : null;
  const to = row.effective_to ? new Date(row.effective_to) : null;
  if (from && at < from) return false;
  if (to && at >= to) return false;
  return true;
}

function isEnabled(row = {}, now = new Date()) {
  if (row.enabled === false) return false;
  const at = now instanceof Date ? now : new Date(now);
  const from = row.effective_from ? new Date(row.effective_from) : null;
  const to = row.effective_to ? new Date(row.effective_to) : null;
  if (from && at < from) return false;
  if (to && at >= to) return false;
  return true;
}

function isEffectiveScope(row = {}, now = new Date()) {
  if (row.allowed === false) return false;
  const at = now instanceof Date ? now : new Date(now);
  const from = row.effective_from ? new Date(row.effective_from) : null;
  const to = row.effective_to ? new Date(row.effective_to) : null;
  if (from && at < from) return false;
  if (to && at >= to) return false;
  return true;
}

function byId(rows = []) {
  return new Map(rows.filter((row) => row?.id).map((row) => [String(row.id), row]));
}

function permissionCodesForRole(roleId, rolePermissions = [], permissionsById = new Map()) {
  return rolePermissions
    .filter((row) => String(row.role_id || '') === String(roleId || '') && row.allowed !== false)
    .map((row) => permissionsById.get(String(row.permission_id || '')))
    .filter((permission) => permission?.active !== false)
    .map((permission) => permission.code)
    .filter(Boolean)
    .sort();
}

function safeScopeValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  if (!text) return null;
  if (/[\u0000-\u001f]/.test(text)) return null;
  return text;
}

function compactRequestedScopes(requestedScopes = {}) {
  return Object.fromEntries(
    Object.entries(requestedScopes || {})
      .map(([key, value]) => [code(key), safeScopeValue(value)])
      .filter(([, value]) => Boolean(value)),
  );
}

function scopeValue(scope = {}) {
  return safeScopeValue(scope.scope_id) ||
    safeScopeValue(scope.scope_code) ||
    safeScopeValue(scope.scope_text);
}

function valuesEqual(a, b) {
  const left = safeScopeValue(a);
  const right = safeScopeValue(b);
  return Boolean(left && right && code(left) === code(right));
}

function requestedHasResource(requestedScopes = {}) {
  return Object.keys(compactRequestedScopes(requestedScopes)).length > 0;
}

function scopeMatches(scope = {}, requestedScopes = {}, context = {}) {
  if (scope.allowed === false) return false;
  const type = code(scope.scope_type);
  if (!type) return false;
  if (!SUPPORTED_SCOPE_TYPES.has(type)) return false;
  const requested = compactRequestedScopes(requestedScopes);
  const assignedValue = scopeValue(scope);
  if (type === 'global') return true;
  if (type === 'business_vertical') {
    const requestedVertical = requested.business_vertical || requested.business_vertical_id;
    return Boolean(requestedVertical) && valuesEqual(assignedValue, requestedVertical);
  }
  if (type === 'client') {
    return Boolean(requested.client_id) && valuesEqual(assignedValue, requested.client_id);
  }
  if (type === 'all_client') {
    const contextClientId = safeScopeValue(context.clientId);
    return Boolean(contextClientId && requested.client_id && valuesEqual(contextClientId, requested.client_id));
  }
  if (type === 'employee_self') {
    const requestedEmployee =
      requested.employee_self ||
      requested.employee_id ||
      requested.auth_user_id ||
      requested.profile_id ||
      requested.employee_code;
    if (!requestedEmployee) return false;
    return valuesEqual(requestedEmployee, context.authUserId) ||
      valuesEqual(requestedEmployee, context.profileId) ||
      valuesEqual(requestedEmployee, context.employeeCode) ||
      valuesEqual(assignedValue, requestedEmployee);
  }
  const requestedValue = requested[type] || requested[`${type}_id`] || requested[`${type}_code`];
  return Boolean(requestedValue) && valuesEqual(assignedValue, requestedValue);
}

function assignmentSpecificity(scopes = []) {
  const order = {
    location: 8,
    department: 7,
    floor: 6,
    hospital_block: 5,
    store: 5,
    site: 4,
    branch: 3,
    state: 2,
    client: 1,
    all_client: 0,
  };
  return scopes.reduce((max, scope) => Math.max(max, order[code(scope.scope_type)] ?? 0), 0);
}

export function evaluateUnifiedAssignments({
  authUserId,
  profile,
  assignments = [],
  scopes = [],
  roles = [],
  permissions = [],
  rolePermissions = [],
  modules = [],
  clients = [],
  businessVerticals = [],
  verticalModules = [],
  clientModules = [],
  requestedModule,
  requestedPermission,
  requestedClientId,
  requestedScopes = {},
  now = new Date(),
} = {}) {
  if (!authUserId) {
    return { granted: false, source: 'unified', reason: 'auth_user_missing', assignments: [] };
  }
  if (profile && !isActiveProfile(profile)) {
    return { granted: false, source: 'unified', reason: 'profile_inactive', assignments: [] };
  }

  const roleMap = byId(roles);
  const permissionMap = byId(permissions);
  const moduleMap = byId(modules);
  const clientMap = byId(clients);
  const verticalMap = byId(businessVerticals);
  const scopesByAssignment = new Map();
  for (const scope of scopes) {
    const assignmentId = String(scope.user_assignment_id || '');
    if (!scopesByAssignment.has(assignmentId)) scopesByAssignment.set(assignmentId, []);
    scopesByAssignment.get(assignmentId).push(scope);
  }

  const requestedModuleCode = code(requestedModule);
  const requestedPermissionCode = code(requestedPermission);
  const compactScopes = compactRequestedScopes(requestedScopes);
  const hasScopedResourceRequest = Object.keys(compactScopes).length > 0;
  const activeAssignments = assignments
    .filter((assignment) => {
      const sameAuth = id(assignment.auth_user_id) && id(assignment.auth_user_id) === id(authUserId);
      const sameProfile = profile?.id && id(assignment.profile_id) === id(profile.id);
      return (sameAuth || sameProfile) && isEffective(assignment, now);
    })
    .map((assignment) => {
      const role = roleMap.get(String(assignment.role_id || ''));
      const module = moduleMap.get(String(assignment.module_id || ''));
      const client = assignment.client_id ? clientMap.get(String(assignment.client_id)) : null;
      const businessVertical = verticalMap.get(String(assignment.business_vertical_id || ''));
      const assignmentScopes = scopesByAssignment.get(String(assignment.id || '')) || [];
      const permissionCodes = permissionCodesForRole(role?.id, rolePermissions, permissionMap);
      const verticalModule = verticalModules.find((row) =>
        String(row.business_vertical_id || '') === String(assignment.business_vertical_id || '') &&
        String(row.module_id || '') === String(assignment.module_id || ''));
      const clientModule = client
        ? clientModules.find((row) =>
          String(row.client_id || '') === String(client.id || '') &&
          String(row.module_id || '') === String(assignment.module_id || ''))
        : null;
      return {
        assignment,
        role,
        module,
        client,
        businessVertical,
        scopes: assignmentScopes.filter((scope) => isEffectiveScope(scope, now)),
        permissionCodes,
        verticalModule,
        clientModule,
      };
    })
    .filter((entry) => Boolean(entry.role) && entry.role.active !== false)
    .filter((entry) => Boolean(entry.module) && entry.module.active !== false)
    .filter((entry) => Boolean(entry.businessVertical) && entry.businessVertical.active !== false)
    .filter((entry) => !entry.assignment.client_id || Boolean(entry.client))
    .filter((entry) => !entry.client || entry.client.active !== false)
    .filter((entry) => Boolean(entry.verticalModule) && isEnabled(entry.verticalModule, now))
    .filter((entry) => !entry.client || (Boolean(entry.clientModule) && isEnabled(entry.clientModule, now)))
    .filter((entry) => !requestedModuleCode || code(entry.module?.code) === requestedModuleCode)
    .filter((entry) => !requestedClientId || String(entry.client?.id || '') === String(requestedClientId))
    .filter((entry) => !requestedPermissionCode ||
      entry.permissionCodes.some((permission) => code(permission) === requestedPermissionCode))
    .filter((entry) => !hasScopedResourceRequest ||
      entry.scopes.some((scope) => scopeMatches(scope, compactScopes, {
        businessVerticalId: entry.businessVertical?.id,
        clientId: entry.client?.id || entry.assignment.client_id,
        authUserId,
        profileId: profile?.id,
        employeeCode: profile?.employee_code,
      })));

  activeAssignments.sort((a, b) => {
    const aSpec = assignmentSpecificity(a.scopes);
    const bSpec = assignmentSpecificity(b.scopes);
    if (aSpec !== bSpec) return bSpec - aSpec;
    return String(a.assignment.id || '').localeCompare(String(b.assignment.id || ''));
  });

  return {
    granted: activeAssignments.length > 0,
    source: 'unified',
    reason: activeAssignments.length ? 'granted' : 'no_verified_assignment',
    totalAssignmentRowsFound: assignments.filter((assignment) => {
      const sameAuth = id(assignment.auth_user_id) && id(assignment.auth_user_id) === id(authUserId);
      const sameProfile = profile?.id && id(assignment.profile_id) === id(profile.id);
      return sameAuth || sameProfile;
    }).length,
    assignments: activeAssignments.map(toSafeAssignment),
  };
}

function toSafeAssignment(entry) {
  return {
    source: entry.assignment.source || 'manual',
    business_vertical: entry.businessVertical ? {
      id: entry.businessVertical.id,
      code: entry.businessVertical.code,
      name: entry.businessVertical.name,
    } : null,
    client: entry.client ? {
      id: entry.client.id,
      code: entry.client.code,
      name: entry.client.name,
      client_type: entry.client.client_type || null,
    } : null,
    module: entry.module ? {
      id: entry.module.id,
      code: entry.module.code,
      name: entry.module.name,
      application_target: entry.module.application_target,
    } : null,
    role: entry.role ? {
      id: entry.role.id,
      code: entry.role.code,
      name: entry.role.name,
      user_type: entry.role.user_type,
    } : null,
    permissions: entry.permissionCodes,
    scopes: entry.scopes
      .filter((scope) => scope.allowed !== false)
      .map((scope) => ({
        scope_type: scope.scope_type,
        scope_id: scope.scope_id || null,
        scope_code: scope.scope_code || null,
        scope_text: scope.scope_text || null,
      })),
    assignment_source: 'unified',
  };
}

function legacyPermissions(roleCode) {
  const role = code(roleCode);
  if (['doctor', 'hospital_management'].includes(role)) {
    return ['hospital_ticket.create', 'hospital_ticket.view', 'hospital_ticket.feedback'];
  }
  if (role === 'housekeeping_supervisor') {
    return ['hospital_ticket.view', 'hospital_ticket.accept', 'hospital_ticket.start', 'hospital_ticket.resolve'];
  }
  if (['operations_executive', 'facility_manager'].includes(role)) {
    return ['hospital_ticket.view', 'routing.view'];
  }
  return ['hospital_ticket.view'];
}

function legacyModuleForRole(roleCode, profileType) {
  return profileType === 'client' ||
    ['doctor', 'hospital_management'].includes(code(roleCode))
    ? { code: 'client_ticketing', name: 'Client Ticketing', application_target: 'client_mobile' }
    : { code: 'hospital_operations', name: 'Hospital Operations', application_target: 'mobile_fo' };
}

export function legacyHospitalAccessFromRows({ user, scopes = [], client } = {}) {
  if (!user || user.is_active === false) return null;
  const module = legacyModuleForRole(user.role_code, user.profile_type);
  return {
    id: user.id,
    source: 'legacy_hospital',
    business_vertical: { code: 'hospital', name: 'Hospital' },
    client: client ? {
      id: client.id,
      code: client.client_code,
      name: client.client_name,
      client_type: client.business_type || 'hospital',
    } : user.client_id ? { id: user.client_id } : null,
    module,
    role: {
      code: user.role_code,
      name: user.role_code,
      user_type: user.profile_type === 'client' ? 'client' : 'internal',
    },
    permissions: legacyPermissions(user.role_code),
    scopes: scopes.map((scope) => ({
      scope_type: scope.scope_type === 'block' ? 'hospital_block' : scope.scope_type,
      scope_id: scope.block_id || scope.location_id || scope.client_id || null,
      legacy_scope_type: scope.scope_type,
      can_view: scope.can_view !== false,
      can_create: scope.can_create === true,
      can_update: scope.can_update === true,
    })),
    assignment_source: 'legacy_hospital',
  };
}

async function selectRows(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function loadUnifiedRows(client, authUserId, profileId) {
  const filter = profileId
    ? `auth_user_id.eq.${authUserId},profile_id.eq.${profileId}`
    : `auth_user_id.eq.${authUserId}`;
  const assignments = await selectRows(
    client.from('access_user_assignments').select('*').or(filter),
  );
  const assignmentIds = assignments.map((row) => row.id).filter(Boolean);
  const idsOf = (field) => Array.from(new Set(assignments.map((row) => row[field]).filter(Boolean)));
  const roleIds = idsOf('role_id');
  const moduleIds = idsOf('module_id');
  const clientIds = idsOf('client_id');
  const verticalIds = idsOf('business_vertical_id');

  const [
    scopes,
    roles,
    modules,
    clients,
    businessVerticals,
    verticalModules,
    clientModules,
  ] = await Promise.all([
    assignmentIds.length
      ? selectRows(client.from('access_user_scopes').select('*').in('user_assignment_id', assignmentIds))
      : [],
    roleIds.length
      ? selectRows(client.from('access_roles').select('*').in('id', roleIds))
      : [],
    moduleIds.length
      ? selectRows(client.from('access_modules').select('*').in('id', moduleIds))
      : [],
    clientIds.length
      ? selectRows(client.from('access_clients').select('*').in('id', clientIds))
      : [],
    verticalIds.length
      ? selectRows(client.from('access_business_verticals').select('*').in('id', verticalIds))
      : [],
    verticalIds.length && moduleIds.length
      ? selectRows(client.from('access_business_vertical_modules').select('*').in('business_vertical_id', verticalIds).in('module_id', moduleIds))
      : [],
    clientIds.length && moduleIds.length
      ? selectRows(client.from('access_client_modules').select('*').in('client_id', clientIds).in('module_id', moduleIds))
      : [],
  ]);
  const permissionIds = roleIds.length
    ? await selectRows(
      client
        .from('access_role_permissions')
        .select('*')
        .in('role_id', roleIds),
    )
    : [];
  const permissions = permissionIds.length
    ? await selectRows(
      client
        .from('access_permissions')
        .select('*')
        .in('id', Array.from(new Set(permissionIds.map((row) => row.permission_id).filter(Boolean)))),
    )
    : [];

  return {
    assignments,
    totalAssignmentRowsFound: assignments.length,
    scopes,
    roles,
    modules,
    clients,
    businessVerticals,
    verticalModules,
    clientModules,
    rolePermissions: permissionIds,
    permissions,
  };
}

function requestedContextMatchesLegacy(assignment, {
  requestedModule,
  requestedPermission,
  requestedClientId,
  requestedScopes = {},
} = {}) {
  const requestedModuleCode = code(requestedModule);
  const requestedPermissionCode = code(requestedPermission);
  if (requestedModuleCode && code(assignment.module?.code) !== requestedModuleCode) return false;
  if (requestedPermissionCode && !assignment.permissions.some((permission) => code(permission) === requestedPermissionCode)) {
    return false;
  }
  if (requestedClientId && String(assignment.client?.id || '') !== String(requestedClientId)) return false;
  if (!Object.keys(requestedScopes || {}).length) return true;
  if (!assignment.scopes.length) return true;
  return assignment.scopes.some((scope) => scopeMatches(scope, requestedScopes));
}

async function loadLegacyHospitalAccess(client, authUserId) {
  const { data: user, error } = await client
    .from('hospital_ticket_users')
    .select('*')
    .eq('auth_user_id', authUserId)
    .eq('is_active', true)
    .maybeSingle();
  if (error) {
    if (isTableMissing(error)) return null;
    throw error;
  }
  if (!user) return null;
  const [scopes, clients] = await Promise.all([
    selectRows(
      client
        .from('hospital_ticket_user_scopes')
        .select('*')
        .eq('hospital_ticket_user_id', user.id),
    ),
    selectRows(
      client
        .from('hospital_clients')
        .select('*')
        .eq('id', user.client_id)
        .limit(1),
    ),
  ]);
  return legacyHospitalAccessFromRows({ user, scopes, client: clients[0] || null });
}

export async function resolveCurrentUserAccess({
  client,
  authUser,
  profile = null,
  requestedModule,
  requestedPermission,
  requestedClientId,
  requestedScopes = {},
  now = new Date(),
} = {}) {
  const authUserId = authUser?.id || profile?.auth_user_id;
  if (!authUserId) {
    return {
      ok: false,
      code: 'auth_user_missing',
      message: 'Authenticated user is required.',
      assignments: [],
    };
  }
  if (profile && !isActiveProfile(profile)) {
    return {
      ok: false,
      code: 'profile_inactive',
      message: 'User profile is inactive.',
      assignments: [],
    };
  }

  let unifiedAvailable = true;
  let unified = { granted: false, assignments: [], reason: 'not_checked', totalAssignmentRowsFound: 0 };
  try {
    const rows = await loadUnifiedRows(client, authUserId, profile?.id);
    unified = evaluateUnifiedAssignments({
      authUserId,
      profile,
      requestedModule,
      requestedPermission,
      requestedClientId,
      requestedScopes,
      now,
      ...rows,
    });
    unified.totalAssignmentRowsFound = rows.totalAssignmentRowsFound;
  } catch (error) {
    if (!isTableMissing(error)) throw error;
    unifiedAvailable = false;
  }

  if (unified.assignments.length) {
    return {
      ok: true,
      source: 'unified',
      access_granted: true,
      unifiedAvailable,
      missingProfile: !profile,
      identity: safeIdentity(authUser, profile),
      assignments: unified.assignments,
    };
  }

  if (unifiedAvailable && unified.totalAssignmentRowsFound > 0) {
    return {
      ok: false,
      source: 'unified_denied',
      access_granted: false,
      code: 'unified_assignment_not_effective',
      message: 'Unified access assignment is not active for this request.',
      unifiedAvailable,
      missingProfile: !profile,
      identity: safeIdentity(authUser, profile),
      assignments: [],
    };
  }

  const legacy = await loadLegacyHospitalAccess(client, authUserId);
  if (legacy && requestedContextMatchesLegacy(legacy, {
    requestedModule,
    requestedPermission,
    requestedClientId,
    requestedScopes,
  })) {
    return {
      ok: true,
      source: 'legacy_hospital',
      access_granted: true,
      unifiedAvailable,
      missingProfile: !profile,
      identity: safeIdentity(authUser, profile),
      assignments: [legacy],
    };
  }

  return {
    ok: true,
    source: unifiedAvailable ? 'none' : 'legacy_only_schema_missing',
    access_granted: false,
    unifiedAvailable,
    missingProfile: !profile,
    identity: safeIdentity(authUser, profile),
    assignments: [],
  };
}

function safeIdentity(authUser = {}, profile = {}) {
  return {
    auth_user_id: authUser?.id || profile?.auth_user_id || null,
    profile_id: profile?.id || null,
    email: profile?.email || authUser?.email || null,
    full_name: profile?.full_name || profile?.display_name || authUser?.user_metadata?.full_name || null,
    employee_code: profile?.employee_code || null,
    role: profile?.role || null,
    active: profile ? isActiveProfile(profile) : true,
  };
}

export function accessResponseForClient(result = {}) {
  const assignments = (result.assignments || []).map((assignment) => ({
    source: assignment.source || assignment.assignment_source || null,
    business_vertical: assignment.business_vertical || null,
    client: assignment.client || null,
    module: assignment.module || null,
    role: assignment.role || null,
    permissions: assignment.permissions || [],
    scopes: (assignment.scopes || []).map((scope) => ({
      scope_type: scope.scope_type,
      scope_id: scope.scope_id || null,
      scope_code: scope.scope_code || null,
      scope_text: scope.scope_text || null,
    })),
    assignment_source: assignment.assignment_source || assignment.source || null,
  }));
  const identity = result.identity ? {
    auth_user_id: result.identity.auth_user_id || null,
    profile_id: result.identity.profile_id || null,
    email: result.identity.email || null,
    full_name: result.identity.full_name || null,
    employee_code: result.identity.employee_code || null,
    role: result.identity.role || null,
    active: result.identity.active !== false,
  } : null;
  return {
    ok: result.ok !== false,
    access_granted: result.access_granted === true || (result.ok !== false && assignments.length > 0),
    source: result.source || 'none',
    unified_available: result.unifiedAvailable !== false,
    missing_profile: result.missingProfile === true,
    identity,
    assignments,
    enabled_modules: Array.from(new Set(
      assignments
        .map((assignment) => assignment.module?.code)
        .filter(Boolean),
    )).sort(),
  };
}
