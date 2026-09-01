const USER_MANAGEMENT_PROFILE_FIELDS = [
  'id',
  'auth_user_id',
  'employee_code',
  'username',
  'full_name',
  'display_name',
  'mobile',
  'email',
  'state',
  'role',
  'designation',
  'department',
  'business',
  'status',
  'is_active',
  'metadata',
  'requires_password_change',
  'mobile_access_enabled',
  'web_access_enabled',
  'auth_provisioning_status',
  'auth_provisioning_error',
  'auth_provisioned_at',
  'last_profile_sync_at',
  'deactivated_at',
  'deactivated_by',
  'deactivation_reason',
  'created_at',
  'updated_at',
];

export const USER_MANAGEMENT_PROFILE_SELECT = USER_MANAGEMENT_PROFILE_FIELDS.join(',');

export const HIERARCHY_FIELD_NAMES = [
  'manager_employee_code',
  'managers_manager_employee_code',
  'business_head_employee_code',
  'gm_employee_code',
  'coo_employee_code',
  'hierarchy_level',
  'hierarchy_path',
  'is_active',
  'metadata',
];

const SENSITIVE_KEY_PATTERN =
  /password|temporary_password|access_token|refresh_token|authorization|service.?role|secret/i;

export function normalizeEmployeeCode(value) {
  return String(value || '').trim().toUpperCase();
}

export function textOrNull(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function booleanValue(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1' || value === 1) return true;
  if (value === 'false' || value === '0' || value === 0) return false;
  return fallback;
}

export function canonicalProfileRole(value, fallback = null) {
  const text = textOrNull(value);
  if (!text) return fallback;
  const normalized = text
    .replace(/[\s_-]+/g, '')
    .toUpperCase();
  const canonicalByNormalized = {
    FO: 'FO',
    FIELDOFFICER: 'FO',
    SUPERVISOR: 'Supervisor',
    KAM: 'KAM',
    KEYACCOUNTMANAGER: 'KAM',
    OM: 'Operations Manager',
    OPERATIONSMANAGER: 'Operations Manager',
    BRANCHHEAD: 'Branch Head',
    BUSINESSHEAD: 'Business Head',
    SOUTHHEAD: 'South Head',
    BH: 'Branch Head',
    GM: 'GM',
    COO: 'COO',
    EXECUTIVEASSISTANT: 'Executive Assistant',
    MD: 'MD',
    BDEXECUTIVE: 'BD Executive',
    BUSINESSDEVELOPMENTEXECUTIVE: 'BD Executive',
    BDHEAD: 'BD Head',
    BUSINESSDEVELOPMENTHEAD: 'BD Head',
  };
  return canonicalByNormalized[normalized] || text;
}

export function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

export function sanitizeAuditData(value) {
  if (Array.isArray(value)) return value.map(sanitizeAuditData);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !SENSITIVE_KEY_PATTERN.test(key))
      .map(([key, entry]) => [key, sanitizeAuditData(entry)]),
  );
}

export function isUserManagementSchemaError(error) {
  return (
    ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(error?.code) ||
    /employee_hierarchy|user_management_audit_logs|requires_password_change|auth_provisioning_status|schema cache|column .* does not exist/i.test(
      String(error?.message || ''),
    )
  );
}

export function userManagementErrorMessage(error) {
  if (isUserManagementSchemaError(error)) {
    return 'User Management database foundation is unavailable. Apply supabase/migrations_2_0/009_user_management_foundation.sql and retry.';
  }
  return error?.message || 'User Management operation failed.';
}

export async function assertUserManagementFoundation(client) {
  const checks = await Promise.all([
    client
      .from('profiles')
      .select(
        'id,requires_password_change,mobile_access_enabled,web_access_enabled,auth_provisioning_status,deactivated_at',
      )
      .limit(1),
    client.from('employee_hierarchy').select('id,employee_code').limit(1),
    client.from('user_management_audit_logs').select('id,action').limit(1),
  ]);
  const error = checks.find((result) => result.error)?.error;
  if (error) {
    const foundationError = new Error(userManagementErrorMessage(error));
    foundationError.statusCode = 503;
    foundationError.code = error.code;
    throw foundationError;
  }
}

export async function loadProfileById(client, profileId) {
  const { data, error } = await client
    .from('profiles')
    .select(USER_MANAGEMENT_PROFILE_SELECT)
    .eq('id', profileId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

function addCountRows(counts, rows, requestedCodes) {
  for (const row of rows || []) {
    const rowId = String(row.id || '');
    const codes = new Set(
      [row.employee_code, row.fo_user_id]
        .map(normalizeEmployeeCode)
        .filter((code) => code && requestedCodes.has(code)),
    );
    for (const code of codes) {
      if (!counts.has(code)) counts.set(code, new Set());
      counts.get(code).add(rowId || `${code}-${counts.get(code).size}`);
    }
  }
}

async function loadTableCounts(client, table, employeeCodes) {
  const requestedCodes = new Set(employeeCodes.map(normalizeEmployeeCode).filter(Boolean));
  const counts = new Map();
  if (!requestedCodes.size) return counts;
  const codes = Array.from(requestedCodes);
  const loadRows = async (column) => {
    const rows = [];
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await client
        .from(table)
        .select(`id,${column}`)
        .in(column, codes)
        .order('id', { ascending: true })
        .range(from, from + pageSize - 1);
      if (error && isMissingColumnError(error)) {
        return [];
      }
      if (error) throw error;
      rows.push(...(data || []));
      if ((data || []).length < pageSize) break;
    }
    return rows.map((row) => ({
      id: row.id,
      matched_code: row[column],
    }));
  };
  const [foIdRows, employeeCodeRows, usernameRows] = await Promise.all([
    loadRows('fo_user_id'),
    loadRows('employee_code'),
    loadRows('username'),
  ]);
  addCountRows(
    counts,
    [...foIdRows, ...employeeCodeRows, ...usernameRows].map((row) => ({
      id: row.id,
      employee_code: row.matched_code,
    })),
    requestedCodes,
  );
  return new Map(Array.from(counts, ([code, ids]) => [code, ids.size]));
}

export async function loadOperationalCounts(client, employeeCodes) {
  const [attendance, siteVisits, gpsLogs] = await Promise.all([
    loadTableCounts(client, 'fo_attendance', employeeCodes),
    loadTableCounts(client, 'fo_site_visits', employeeCodes),
    loadTableCounts(client, 'fo_location_logs', employeeCodes),
  ]);
  return { attendance, siteVisits, gpsLogs };
}

export function attachOperationalCounts(profile, counts) {
  const code = normalizeEmployeeCode(profile?.employee_code);
  return {
    ...profile,
    attendance_count: counts.attendance.get(code) || 0,
    site_visit_count: counts.siteVisits.get(code) || 0,
    gps_log_count: counts.gpsLogs.get(code) || 0,
  };
}

export function hierarchyPayloadFromBody(body, employeeCode) {
  const supplied = HIERARCHY_FIELD_NAMES.some((field) => hasOwn(body, field));
  if (!supplied) return null;
  const payload = { employee_code: normalizeEmployeeCode(employeeCode) };
  for (const field of HIERARCHY_FIELD_NAMES) {
    if (!hasOwn(body, field)) continue;
    if (field === 'hierarchy_path') {
      payload[field] = Array.isArray(body[field])
        ? body[field].map(normalizeEmployeeCode).filter(Boolean)
        : null;
    } else if (field === 'is_active') {
      payload[field] = booleanValue(body[field], true);
    } else if (field === 'metadata') {
      payload[field] =
        body[field] && typeof body[field] === 'object' && !Array.isArray(body[field])
          ? body[field]
          : {};
    } else if (field.endsWith('_employee_code')) {
      payload[field] = normalizeEmployeeCode(body[field]) || null;
    } else {
      payload[field] = textOrNull(body[field]);
    }
  }
  return payload;
}

export async function loadHierarchy(client, employeeCode) {
  const normalizedCode = normalizeEmployeeCode(employeeCode);
  if (!normalizedCode) return null;
  const { data, error } = await client
    .from('employee_hierarchy')
    .select('*')
    .ilike('employee_code', normalizedCode)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

function emptyHierarchyForProfile(profile) {
  return {
    employee_code: profile?.employee_code || null,
    manager_employee_code: null,
    managers_manager_employee_code: null,
    business_head_employee_code: null,
    gm_employee_code: null,
    coo_employee_code: null,
    hierarchy_level: null,
    hierarchy_path: null,
    is_active: false,
    metadata: {},
  };
}

function hierarchyGraphRecord(profile, hierarchyByEmployeeCode) {
  const code = normalizeEmployeeCode(profile?.employee_code);
  return {
    id: profile.id,
    employee_code: profile.employee_code || null,
    full_name: profile.full_name || null,
    display_name: profile.display_name || null,
    username: profile.username || null,
    email: profile.email || null,
    mobile: profile.mobile || null,
    state: profile.state || null,
    role: profile.role || null,
    designation: profile.designation || null,
    department: profile.department || null,
    business: profile.business || null,
    status: profile.status || null,
    is_active: profile.is_active === true,
    metadata: profile.metadata || {},
    hierarchy: hierarchyByEmployeeCode.get(code) || emptyHierarchyForProfile(profile),
  };
}

export async function loadHierarchyGraph(client) {
  const profiles = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client
      .from('profiles')
      .select(USER_MANAGEMENT_PROFILE_SELECT)
      .eq('is_active', true)
      .eq('status', 'Active')
      .order('full_name', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    profiles.push(...(data || []));
    if ((data || []).length < pageSize) break;
  }

  const profileEmployeeCodes = new Set(
    profiles.map((profile) => normalizeEmployeeCode(profile.employee_code)).filter(Boolean),
  );
  const hierarchyByEmployeeCode = new Map();
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client
      .from('employee_hierarchy')
      .select(
        [
          'employee_code',
          'manager_employee_code',
          'managers_manager_employee_code',
          'business_head_employee_code',
          'gm_employee_code',
          'coo_employee_code',
          'hierarchy_level',
          'hierarchy_path',
          'is_active',
          'metadata',
        ].join(','),
      )
      .eq('is_active', true)
      .order('updated_at', { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw error;

    for (const row of data || []) {
      const code = normalizeEmployeeCode(row.employee_code);
      if (profileEmployeeCodes.has(code) && !hierarchyByEmployeeCode.has(code)) {
        hierarchyByEmployeeCode.set(code, {
          employee_code: row.employee_code || null,
          manager_employee_code: row.manager_employee_code || null,
          managers_manager_employee_code: row.managers_manager_employee_code || null,
          business_head_employee_code: row.business_head_employee_code || null,
          gm_employee_code: row.gm_employee_code || null,
          coo_employee_code: row.coo_employee_code || null,
          hierarchy_level: row.hierarchy_level || null,
          hierarchy_path: Array.isArray(row.hierarchy_path) ? row.hierarchy_path : null,
          is_active: row.is_active === true,
          metadata: row.metadata || {},
        });
      }
    }
    if ((data || []).length < pageSize) break;
  }

  return profiles.map((profile) => hierarchyGraphRecord(profile, hierarchyByEmployeeCode));
}

function userManagementValidationError(message, details = null) {
  const error = new Error(message);
  error.statusCode = 400;
  if (details) error.details = details;
  return error;
}

function isActiveUserManagementProfile(profile) {
  return (
    profile?.is_active === true &&
    String(profile.status || '').trim().toLowerCase() === 'active' &&
    Boolean(normalizeEmployeeCode(profile.employee_code))
  );
}

async function loadActiveUserManagementProfilesByCode(client) {
  const profilesByCode = new Map();
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client
      .from('profiles')
      .select(USER_MANAGEMENT_PROFILE_SELECT)
      .eq('is_active', true)
      .eq('status', 'Active')
      .order('full_name', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    for (const profile of data || []) {
      if (isActiveUserManagementProfile(profile)) {
        profilesByCode.set(normalizeEmployeeCode(profile.employee_code), profile);
      }
    }
    if ((data || []).length < pageSize) break;
  }
  return profilesByCode;
}

async function loadActiveHierarchyRows(client) {
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client
      .from('employee_hierarchy')
      .select('*')
      .eq('is_active', true)
      .order('updated_at', { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if ((data || []).length < pageSize) break;
  }
  return rows;
}

function normalizeHierarchyAssignments(assignments) {
  if (!Array.isArray(assignments)) {
    throw userManagementValidationError('assignments must be an array.');
  }
  const seen = new Set();
  return assignments.map((assignment, index) => {
    const employeeCode = normalizeEmployeeCode(assignment?.employee_code);
    const managerEmployeeCode = normalizeEmployeeCode(assignment?.manager_employee_code) || null;
    if (!employeeCode) {
      throw userManagementValidationError(`assignments[${index}].employee_code is required.`);
    }
    if (seen.has(employeeCode)) {
      throw userManagementValidationError(
        `Duplicate employee_code in assignments: ${employeeCode}.`,
      );
    }
    seen.add(employeeCode);
    if (managerEmployeeCode && managerEmployeeCode === employeeCode) {
      throw userManagementValidationError('Employee cannot report to self.', {
        employee_code: employeeCode,
      });
    }
    return { employee_code: employeeCode, manager_employee_code: managerEmployeeCode };
  });
}

function latestActiveHierarchyRowsByCode(rows) {
  const rowsByCode = new Map();
  for (const row of rows || []) {
    const code = normalizeEmployeeCode(row.employee_code);
    if (!code) continue;
    if (!rowsByCode.has(code)) rowsByCode.set(code, []);
    rowsByCode.get(code).push(row);
  }
  return rowsByCode;
}

function currentManagerMapFromRows(rowsByCode) {
  const managerByCode = new Map();
  for (const [code, rows] of rowsByCode.entries()) {
    const latest = rows[0];
    managerByCode.set(code, normalizeEmployeeCode(latest?.manager_employee_code) || null);
  }
  return managerByCode;
}

function assertHierarchyAssignmentsAreValid(assignments, profilesByCode) {
  for (const assignment of assignments) {
    if (!profilesByCode.has(assignment.employee_code)) {
      throw userManagementValidationError('Employee profile is not active or does not exist.', {
        employee_code: assignment.employee_code,
      });
    }
    if (
      assignment.manager_employee_code &&
      !profilesByCode.has(assignment.manager_employee_code)
    ) {
      throw userManagementValidationError('Manager profile is not active or does not exist.', {
        employee_code: assignment.employee_code,
        manager_employee_code: assignment.manager_employee_code,
      });
    }
  }
}

function assertNoHierarchyCycles(assignments, managerByCode, traversalLimit) {
  for (const assignment of assignments) {
    const employeeCode = assignment.employee_code;
    let nextCode = assignment.manager_employee_code;
    const visited = new Set([employeeCode]);
    let steps = 0;
    while (nextCode) {
      if (visited.has(nextCode)) {
        throw userManagementValidationError('Circular hierarchy assignment is not allowed.', {
          employee_code: employeeCode,
          manager_employee_code: assignment.manager_employee_code,
          circular_employee_code: nextCode,
        });
      }
      visited.add(nextCode);
      steps += 1;
      if (steps > traversalLimit) {
        throw userManagementValidationError('Hierarchy traversal limit exceeded.', {
          employee_code: employeeCode,
        });
      }
      nextCode = managerByCode.get(nextCode) || null;
    }
  }
}

function hierarchyProfileText(profile) {
  return [profile?.role, profile?.designation]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function isCooProfile(profile) {
  return /\bCOO\b|CHIEF OPERATING OFFICER/.test(hierarchyProfileText(profile));
}

function isGmProfile(profile) {
  return /\bGM\b|GENERAL MANAGER/.test(hierarchyProfileText(profile));
}

function isBusinessHeadProfile(profile) {
  return /BUSINESS HEAD|BRANCH HEAD|\bBH\b|\bHEAD\b|HEAD\s*-/.test(hierarchyProfileText(profile));
}

function hierarchyPathForEmployee(employeeCode, managerByCode, traversalLimit) {
  const path = [employeeCode];
  let nextCode = managerByCode.get(employeeCode) || null;
  const visited = new Set(path);
  let steps = 0;
  while (nextCode) {
    if (visited.has(nextCode)) break;
    path.push(nextCode);
    visited.add(nextCode);
    steps += 1;
    if (steps > traversalLimit) break;
    nextCode = managerByCode.get(nextCode) || null;
  }
  return path;
}

function hierarchyPayloadForAssignment(assignment, managerByCode, profilesByCode, actorAuthUserId) {
  const path = hierarchyPathForEmployee(
    assignment.employee_code,
    managerByCode,
    profilesByCode.size + 1,
  );
  const ancestors = path.slice(1);
  const ancestorProfile = (predicate) =>
    ancestors.find((code) => predicate(profilesByCode.get(code))) || null;
  return {
    employee_code: assignment.employee_code,
    manager_employee_code: assignment.manager_employee_code,
    managers_manager_employee_code: ancestors[1] || null,
    business_head_employee_code: ancestorProfile(isBusinessHeadProfile),
    gm_employee_code: ancestorProfile(isGmProfile),
    coo_employee_code: ancestorProfile(isCooProfile),
    hierarchy_level: String(Math.max(0, path.length - 1)),
    hierarchy_path: path,
    is_active: true,
    metadata: {
      updated_by: actorAuthUserId,
      updated_from: 'user_management_hierarchy_builder',
    },
    updated_by: actorAuthUserId,
  };
}

export async function saveHierarchyAssignments(client, assignments, actorAuthUserId) {
  const normalizedAssignments = normalizeHierarchyAssignments(assignments);
  const profilesByCode = await loadActiveUserManagementProfilesByCode(client);
  assertHierarchyAssignmentsAreValid(normalizedAssignments, profilesByCode);

  const activeHierarchyRows = await loadActiveHierarchyRows(client);
  const rowsByCode = latestActiveHierarchyRowsByCode(activeHierarchyRows);
  const managerByCode = currentManagerMapFromRows(rowsByCode);
  for (const assignment of normalizedAssignments) {
    managerByCode.set(assignment.employee_code, assignment.manager_employee_code);
  }
  assertNoHierarchyCycles(normalizedAssignments, managerByCode, profilesByCode.size + 1);

  let updated = 0;
  let inserted = 0;
  let duplicateRowsDeactivated = 0;

  for (const assignment of normalizedAssignments) {
    const payload = hierarchyPayloadForAssignment(
      assignment,
      managerByCode,
      profilesByCode,
      actorAuthUserId,
    );
    const existingRows = rowsByCode.get(assignment.employee_code) || [];
    const latest = existingRows[0] || null;
    if (latest) {
      const { error } = await client
        .from('employee_hierarchy')
        .update({
          ...payload,
          metadata: {
            ...(latest.metadata || {}),
            ...payload.metadata,
          },
        })
        .eq('id', latest.id);
      if (error) throw error;
      updated += 1;
    } else {
      const { error } = await client
        .from('employee_hierarchy')
        .insert({
          ...payload,
          created_by: actorAuthUserId,
        });
      if (error) throw error;
      inserted += 1;
    }

    const duplicates = existingRows.slice(1);
    for (const duplicate of duplicates) {
      const { error } = await client
        .from('employee_hierarchy')
        .update({
          is_active: false,
          updated_by: actorAuthUserId,
          metadata: {
            ...(duplicate.metadata || {}),
            duplicate_deactivated_by: actorAuthUserId,
            duplicate_deactivated_from: 'user_management_hierarchy_builder',
          },
        })
        .eq('id', duplicate.id);
      if (error) throw error;
      duplicateRowsDeactivated += 1;
    }
  }

  return {
    updated,
    inserted,
    duplicateRowsDeactivated,
    affectedEmployeeCodes: normalizedAssignments.map((assignment) => assignment.employee_code),
  };
}

export async function saveHierarchy(client, employeeCode, body, actorAuthUserId) {
  const payload = hierarchyPayloadFromBody(body, employeeCode);
  if (!payload) return null;
  const existing = await loadHierarchy(client, employeeCode);
  if (existing) {
    const { data, error } = await client
      .from('employee_hierarchy')
      .update({
        ...payload,
        updated_by: actorAuthUserId,
      })
      .eq('id', existing.id)
      .select('*')
      .single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await client
    .from('employee_hierarchy')
    .insert({
      ...payload,
      created_by: actorAuthUserId,
      updated_by: actorAuthUserId,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

function requestIpAddress(request) {
  const forwarded = String(request.headers['x-forwarded-for'] || '')
    .split(',')[0]
    .trim();
  return forwarded || request.ip || request.socket?.remoteAddress || null;
}

export async function writeUserManagementAudit(
  client,
  {
    action,
    targetProfile,
    oldData = null,
    newData = null,
    reason = null,
    metadata = {},
    request,
  },
) {
  const { error } = await client.from('user_management_audit_logs').insert({
    action,
    target_profile_id: targetProfile?.id || null,
    target_auth_user_id: targetProfile?.auth_user_id || null,
    target_employee_code: targetProfile?.employee_code || null,
    actor_auth_user_id: request.authUser?.id || null,
    actor_profile_id: request.profile?.id || null,
    actor_employee_code: request.employeeCode || null,
    actor_role: request.userRole || null,
    old_data: oldData ? sanitizeAuditData(oldData) : null,
    new_data: newData ? sanitizeAuditData(newData) : null,
    reason: textOrNull(reason),
    ip_address: requestIpAddress(request),
    user_agent: textOrNull(request.headers['user-agent']),
    metadata: sanitizeAuditData(metadata || {}),
  });
  if (error) throw error;
}

export function profileMetadataForAuth(profile) {
  return {
    employee_code: profile.employee_code || null,
    full_name: profile.full_name || null,
    display_name: profile.display_name || null,
    mobile: profile.mobile || null,
    role: canonicalProfileRole(profile.role),
    designation: profile.designation || null,
    department: profile.department || null,
    business: profile.business || null,
    state: profile.state || null,
  };
}

export function safeAuthError(error) {
  return {
    message: error?.message || 'Supabase Auth operation failed.',
    code: error?.code || error?.status || null,
  };
}

export function sanitizeSupabaseDiagnosticError(error) {
  const message = String(error?.message || 'Supabase service-role test failed.')
    .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, '[redacted-jwt]')
    .replace(/[A-Za-z0-9_-]{40,}/g, '[redacted-secret]')
    .slice(0, 300);
  return {
    message,
    code: error?.code || error?.status || error?.statusCode || null,
  };
}

export function serviceRoleClientNotConfiguredError() {
  const error = new Error('Backend service-role client is not configured.');
  error.statusCode = 503;
  error.code = 'service_role_client_not_configured';
  error.diagnosticReason = 'service_role_client_not_configured';
  return error;
}

function isMissingRelationError(error) {
  return ['42P01', 'PGRST205'].includes(error?.code);
}

function isMissingColumnError(error) {
  return ['42703', 'PGRST204'].includes(error?.code);
}

export async function countRowsByColumn(
  client,
  table,
  column,
  value,
  { optionalTable = false, optionalColumn = false } = {},
) {
  const normalizedValue = normalizeEmployeeCode(value);
  if (!normalizedValue) {
    return { count: 0, available: true };
  }
  const { count, error } = await client
    .from(table)
    .select('id', { count: 'exact', head: true })
    .ilike(column, normalizedValue);
  if (!error) return { count: count || 0, available: true };
  if (
    (optionalTable && isMissingRelationError(error)) ||
    (optionalColumn && isMissingColumnError(error))
  ) {
    return {
      count: 0,
      available: false,
      reason: isMissingRelationError(error) ? 'table_missing' : 'column_missing',
    };
  }
  throw error;
}

export async function countRowsAcrossColumns(
  client,
  table,
  columns,
  value,
  options = {},
) {
  const normalizedValue = normalizeEmployeeCode(value);
  if (!normalizedValue) {
    return {
      count: 0,
      available: true,
      columns: Object.fromEntries(
        columns.map((column) => [column, { count: 0, available: true }]),
      ),
    };
  }
  const ids = new Set();
  const results = await Promise.all(
    columns.map(async (column) => {
      const columnIds = [];
      const pageSize = 1000;
      for (let from = 0; ; from += pageSize) {
        const { data, error } = await client
          .from(table)
          .select('id')
          .ilike(column, normalizedValue)
          .order('id', { ascending: true })
          .range(from, from + pageSize - 1);
        if (error) {
          if (
            (options.optionalTable && isMissingRelationError(error)) ||
            (options.optionalColumn && isMissingColumnError(error))
          ) {
            return {
              count: 0,
              available: false,
              reason: isMissingRelationError(error)
                ? 'table_missing'
                : 'column_missing',
            };
          }
          throw error;
        }
        for (const row of data || []) {
          columnIds.push(String(row.id));
          ids.add(String(row.id));
        }
        if ((data || []).length < pageSize) break;
      }
      return { count: columnIds.length, available: true };
    }),
  );
  return {
    count: ids.size,
    available: results.some((result) => result.available),
    columns: Object.fromEntries(
      columns.map((column, index) => [column, results[index]]),
    ),
  };
}

export async function buildHardDeletePreview(client, profile) {
  const employeeCode = normalizeEmployeeCode(profile?.employee_code);
  const [
    attendance,
    siteVisits,
    gpsLogs,
    liveStatus,
    stores,
    hierarchyOwner,
    hierarchyManager,
    hierarchyManagersManager,
    hierarchyBusinessHead,
    hierarchyGm,
    hierarchyCoo,
  ] = await Promise.all([
    countRowsAcrossColumns(
      client,
      'fo_attendance',
      ['employee_code', 'fo_user_id', 'username'],
      employeeCode,
      { optionalColumn: true },
    ),
    countRowsAcrossColumns(
      client,
      'fo_site_visits',
      ['employee_code', 'fo_user_id'],
      employeeCode,
      { optionalColumn: true },
    ),
    countRowsAcrossColumns(
      client,
      'fo_location_logs',
      ['employee_code', 'fo_user_id', 'username'],
      employeeCode,
      { optionalColumn: true },
    ),
    countRowsAcrossColumns(
      client,
      'fo_live_status',
      ['fo_user_id', 'username', 'employee_code'],
      employeeCode,
      { optionalTable: true, optionalColumn: true },
    ),
    countRowsByColumn(
      client,
      'store_master',
      'created_by_employee_code',
      employeeCode,
      { optionalTable: true, optionalColumn: true },
    ),
    countRowsByColumn(
      client,
      'employee_hierarchy',
      'employee_code',
      employeeCode,
    ),
    countRowsByColumn(
      client,
      'employee_hierarchy',
      'manager_employee_code',
      employeeCode,
    ),
    countRowsByColumn(
      client,
      'employee_hierarchy',
      'managers_manager_employee_code',
      employeeCode,
    ),
    countRowsByColumn(
      client,
      'employee_hierarchy',
      'business_head_employee_code',
      employeeCode,
    ),
    countRowsByColumn(
      client,
      'employee_hierarchy',
      'gm_employee_code',
      employeeCode,
    ),
    countRowsByColumn(
      client,
      'employee_hierarchy',
      'coo_employee_code',
      employeeCode,
    ),
  ]);
  const attendanceCount = attendance.count;
  const siteVisitCount = siteVisits.count;
  const gpsLogCount = gpsLogs.count;
  const storeCreatedCount = stores.count;
  const hasMeaningfulHistory =
    attendanceCount > 0 ||
    siteVisitCount > 0 ||
    gpsLogCount > 0 ||
    storeCreatedCount > 0;
  const hierarchyReferenceCount =
    hierarchyManager.count +
    hierarchyManagersManager.count +
    hierarchyBusinessHead.count +
    hierarchyGm.count +
    hierarchyCoo.count;
  const hasImportantHierarchyReference = hierarchyReferenceCount > 0;
  const hardDeleteAllowed =
    !hasMeaningfulHistory && !hasImportantHierarchyReference;
  return {
    profile: {
      id: profile.id,
      auth_user_id: profile.auth_user_id || null,
      employee_code: profile.employee_code || null,
      full_name: profile.full_name || null,
      email: profile.email || null,
      role: profile.role || null,
      status: profile.status || null,
      is_active: profile.is_active === true,
    },
    attendance_count: attendanceCount,
    site_visit_count: siteVisitCount,
    gps_log_count: gpsLogCount,
    live_status_count: liveStatus.count,
    store_created_count: storeCreatedCount,
    hierarchy_count: hierarchyOwner.count,
    hierarchy_reference_count: hierarchyReferenceCount,
    hierarchy_reference_counts: {
      manager_employee_code: hierarchyManager.count,
      managers_manager_employee_code: hierarchyManagersManager.count,
      business_head_employee_code: hierarchyBusinessHead.count,
      gm_employee_code: hierarchyGm.count,
      coo_employee_code: hierarchyCoo.count,
    },
    has_meaningful_history: hasMeaningfulHistory,
    has_important_hierarchy_reference: hasImportantHierarchyReference,
    hard_delete_allowed: hardDeleteAllowed,
    recommendation: hasMeaningfulHistory
      ? 'Deactivate instead'
      : hasImportantHierarchyReference
        ? 'Reassign hierarchy references before hard delete'
        : 'Hard delete appears safe',
    availability: {
      live_status: liveStatus,
      store_master: stores,
    },
  };
}

export async function buildEmployeeCodeRepairPreview(
  client,
  profile,
  oldEmployeeCode,
  newEmployeeCode,
) {
  const oldCode = normalizeEmployeeCode(oldEmployeeCode);
  const newCode = normalizeEmployeeCode(newEmployeeCode);
  const countSpecs = [
    ['profiles.employee_code', 'profiles', 'employee_code', {}],
    ['profiles.username', 'profiles', 'username', {}],
    ['employee_hierarchy.employee_code', 'employee_hierarchy', 'employee_code', {}],
    [
      'employee_hierarchy.manager_employee_code',
      'employee_hierarchy',
      'manager_employee_code',
      {},
    ],
    [
      'employee_hierarchy.managers_manager_employee_code',
      'employee_hierarchy',
      'managers_manager_employee_code',
      {},
    ],
    [
      'employee_hierarchy.business_head_employee_code',
      'employee_hierarchy',
      'business_head_employee_code',
      {},
    ],
    ['employee_hierarchy.gm_employee_code', 'employee_hierarchy', 'gm_employee_code', {}],
    [
      'employee_hierarchy.coo_employee_code',
      'employee_hierarchy',
      'coo_employee_code',
      {},
    ],
    [
      'fo_attendance.employee_code',
      'fo_attendance',
      'employee_code',
      { optionalColumn: true },
    ],
    [
      'fo_attendance.fo_user_id',
      'fo_attendance',
      'fo_user_id',
      { optionalColumn: true },
    ],
    [
      'fo_attendance.username',
      'fo_attendance',
      'username',
      { optionalColumn: true },
    ],
    [
      'fo_site_visits.employee_code',
      'fo_site_visits',
      'employee_code',
      { optionalColumn: true },
    ],
    [
      'fo_site_visits.fo_user_id',
      'fo_site_visits',
      'fo_user_id',
      { optionalColumn: true },
    ],
    [
      'fo_location_logs.employee_code',
      'fo_location_logs',
      'employee_code',
      { optionalColumn: true },
    ],
    [
      'fo_location_logs.fo_user_id',
      'fo_location_logs',
      'fo_user_id',
      { optionalColumn: true },
    ],
    [
      'fo_location_logs.username',
      'fo_location_logs',
      'username',
      { optionalColumn: true },
    ],
    [
      'fo_live_status.employee_code',
      'fo_live_status',
      'employee_code',
      { optionalTable: true, optionalColumn: true },
    ],
    [
      'fo_live_status.fo_user_id',
      'fo_live_status',
      'fo_user_id',
      { optionalTable: true, optionalColumn: true },
    ],
    [
      'fo_live_status.username',
      'fo_live_status',
      'username',
      { optionalTable: true, optionalColumn: true },
    ],
    [
      'store_master.created_by_employee_code',
      'store_master',
      'created_by_employee_code',
      { optionalTable: true, optionalColumn: true },
    ],
  ];
  const entries = await Promise.all(
    countSpecs.map(async ([key, table, column, options]) => [
      key,
      await countRowsByColumn(client, table, column, oldCode, options),
    ]),
  );
  return {
    profile_id: profile.id,
    old_employee_code: oldCode,
    new_employee_code: newCode,
    affected_counts: Object.fromEntries(entries),
    warning:
      'Employee-code repair updates profile, hierarchy, and supported operational text-code references. Review every affected count before execution.',
    repair_allowed: true,
  };
}

export function isAuthUserNotFoundError(error) {
  const status = Number(error?.status || error?.statusCode || 0);
  return (
    status === 404 ||
    /user not found|not found/i.test(String(error?.message || ''))
  );
}
