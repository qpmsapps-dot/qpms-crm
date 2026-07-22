const FULL_VISIBILITY_ROLES = new Set([
  'ADMIN', 'QPMSADMIN', 'DEVELOPER', 'DEV', 'ITADMIN', 'MD', 'COO',
  'DEMOADMIN', 'TENDERDEMO',
]);

const OPERATIONS_ROLES = new Set([
  ...FULL_VISIBILITY_ROLES,
  'GM', 'GENERALMANAGER', 'SOUTHHEAD', 'BRANCHHEAD', 'BH',
  'OPERATIONSMANAGER', 'OPERATIONMANAGER', 'OM', 'MANAGER',
  'BUSINESSHEAD', 'KAM', 'KEYACCOUNTMANAGER', 'FO', 'FIELDOFFICER',
]);

function roleKey(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '');
}

function text(value) {
  return String(value || '').trim();
}

function comparable(value) {
  return text(value).toLowerCase();
}

function employeeKey(row = {}) {
  return text(row.employee_code || row.fo_user_id || row.username).toUpperCase();
}

function profileValue(profile = {}, field) {
  return text(profile[field] || profile.metadata?.[field]);
}

function activeProfile(profile) {
  return profile?.is_active === true && !['inactive', 'disabled', 'deactivated'].includes(comparable(profile.status));
}

function validDateInput(value, fallback) {
  const candidate = text(value || fallback);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return null;
  const [year, month, day] = candidate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) return null;
  return candidate;
}

function allValue(value) {
  const normalized = comparable(value);
  return !normalized || normalized.startsWith('all ') || normalized === 'all';
}

export function normalizeOperationsSummaryFilters(query = {}, today) {
  const dateFrom = validDateInput(query.date_from || query.from_date, today);
  const dateTo = validDateInput(query.date_to || query.to_date, today);
  if (!dateFrom || !dateTo) {
    const error = new Error('date_from and date_to must use YYYY-MM-DD.');
    error.statusCode = 400;
    throw error;
  }
  if (dateFrom > dateTo) {
    const error = new Error('date_from cannot be after date_to.');
    error.statusCode = 400;
    throw error;
  }
  return {
    date_from: dateFrom,
    date_to: dateTo,
    state: allValue(query.state) ? null : text(query.state),
    business: allValue(query.business) ? null : text(query.business),
    status: allValue(query.status) ? null : text(query.status),
  };
}

export function canAccessOperationsSummary(profile) {
  if (!activeProfile(profile) || !OPERATIONS_ROLES.has(roleKey(profile.role))) return false;
  if (roleKey(profile.role) !== 'MANAGER') return true;
  return comparable([
    profile.role,
    profile.designation,
    profile.department,
    profile.metadata?.designation,
    profile.metadata?.department,
  ].join(' ')).includes('operation');
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

function isOperationalEmployeeProfile(profile = {}) {
  const operationalRole = new Set([
    'GM', 'GENERALMANAGER', 'SOUTHHEAD', 'BRANCHHEAD', 'BH',
    'OPERATIONSMANAGER', 'OPERATIONMANAGER', 'OM', 'MANAGER',
    'KAM', 'KEYACCOUNTMANAGER', 'FO', 'FIELDOFFICER',
  ]).has(roleKey(profile.role));
  if (!operationalRole || roleKey(profile.role) !== 'MANAGER') return operationalRole;
  return comparable([
    profile.role,
    profile.designation,
    profile.department,
    profile.metadata?.designation,
    profile.metadata?.department,
  ].join(' ')).includes('operation');
}

export function operationsSummaryAllowedEmployeeCodes(actor, profiles = [], hierarchyRows = []) {
  if (!canAccessOperationsSummary(actor)) return new Set();
  const actorRole = roleKey(actor.role);
  const actorCode = employeeKey(actor);
  const descendants = hierarchyCodesForActor(actorCode, hierarchyRows);
  const actorState = comparable(profileValue(actor, 'state'));
  const actorBusiness = comparable(profileValue(actor, 'business'));
  const actorBranch = comparable(profileValue(actor, 'branch'));
  const allowed = new Set();

  for (const profile of profiles) {
    if (!activeProfile(profile) || !isOperationalEmployeeProfile(profile)) continue;
    const code = employeeKey(profile);
    if (!code) continue;
    if (FULL_VISIBILITY_ROLES.has(actorRole)) {
      allowed.add(code);
      continue;
    }
    const profileState = comparable(profileValue(profile, 'state'));
    const profileBusiness = comparable(profileValue(profile, 'business'));
    const profileBranch = comparable(profileValue(profile, 'branch'));
    if (actorRole === 'BUSINESSHEAD') {
      if (actorBusiness && profileBusiness === actorBusiness) allowed.add(code);
      continue;
    }
    if (['BRANCHHEAD', 'BH'].includes(actorRole)) {
      if (
        actorState && profileState === actorState &&
        (!actorBusiness || profileBusiness === actorBusiness) &&
        (!actorBranch || profileBranch === actorBranch)
      ) allowed.add(code);
      continue;
    }
    if (['GM', 'GENERALMANAGER', 'SOUTHHEAD'].includes(actorRole)) {
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

export function storedAttendancePayableKm(row = {}) {
  for (const value of [row.total_approved_km, row.eligible_km, row.total_route_km]) {
    if (value === null || value === undefined || text(value) === '') continue;
    const number = Number(value);
    if (Number.isFinite(number)) return Math.max(0, number);
  }
  return 0;
}

export function storedAttendancePetrolAmount(row = {}, payableKm = storedAttendancePayableKm(row)) {
  const hasStoredAmount = row.petrol_amount !== null && row.petrol_amount !== undefined && text(row.petrol_amount) !== '';
  const stored = Number(row.petrol_amount);
  if (hasStoredAmount && Number.isFinite(stored)) return Math.max(0, stored);
  const rate = Number(row.rate_per_km);
  return Math.max(0, payableKm * (Number.isFinite(rate) ? rate : 4));
}

function liveStatusKey(row = {}, employeeCodeByProfileId = new Map()) {
  const foUserId = text(row.fo_user_id);
  return employeeCodeByProfileId.get(foUserId) || foUserId.toUpperCase();
}

function statusMatches(row, requestedStatus, liveByEmployee) {
  if (!requestedStatus) return true;
  const requested = roleKey(requestedStatus);
  if (requested === 'NOTSTARTED') return false;
  const attendanceActive = comparable(row.status || 'active') === 'active' && !row.logout_time;
  if (requested === 'ACTIVE') return attendanceActive;
  if (requested === 'ENDED' || requested === 'OFFLINE') return !attendanceActive;
  const live = liveByEmployee.get(employeeKey(row)) || {};
  const hasSite = Boolean(live.active_site_visit_id) || comparable(live.current_status).includes('site');
  const tracking = live.is_tracking === true || comparable(live.current_status).includes('travel');
  if (requested === 'ONSITE') return attendanceActive && hasSite;
  if (requested === 'ONTRAVEL') return attendanceActive && !hasSite && tracking;
  if (requested === 'ACTIVESTATIONARY') return attendanceActive && !hasSite && !tracking;
  return comparable(row.status) === comparable(requestedStatus);
}

export function summarizeOperationsRows({
  attendances = [],
  profiles = [],
  hierarchyRows = [],
  liveRows = [],
  actor,
  filters,
}) {
  const allowedCodes = operationsSummaryAllowedEmployeeCodes(actor, profiles, hierarchyRows);
  const profilesByCode = new Map(profiles.map((profile) => [employeeKey(profile), profile]));
  const employeeCodeByProfileId = new Map(
    profiles
      .map((profile) => [text(profile.id), employeeKey(profile)])
      .filter(([profileId, employeeCode]) => profileId && employeeCode),
  );
  const liveByEmployee = new Map(
    liveRows.map((row) => [liveStatusKey(row, employeeCodeByProfileId), row]),
  );
  const matchingEmployeeCodes = new Set();
  let payableKm = 0;
  let petrolAmount = 0;
  let matchingAttendanceCount = 0;

  for (const attendance of attendances) {
    const code = employeeKey(attendance);
    if (!code || !allowedCodes.has(code)) continue;
    const date = text(attendance.attendance_date).slice(0, 10);
    if (date < filters.date_from || date > filters.date_to) continue;
    const profile = profilesByCode.get(code) || {};
    if (filters.state && comparable(profileValue(profile, 'state')) !== comparable(filters.state)) continue;
    if (filters.business && comparable(profileValue(profile, 'business')) !== comparable(filters.business)) continue;
    if (!statusMatches(attendance, filters.status, liveByEmployee)) continue;
    const rowPayableKm = storedAttendancePayableKm(attendance);
    payableKm += rowPayableKm;
    petrolAmount += storedAttendancePetrolAmount(attendance, rowPayableKm);
    matchingAttendanceCount += 1;
    matchingEmployeeCodes.add(code);
  }

  return {
    payable_km: Number(payableKm.toFixed(2)),
    petrol_amount: Number(petrolAmount.toFixed(2)),
    matching_attendance_count: matchingAttendanceCount,
    matching_employee_count: matchingEmployeeCodes.size,
    applied_filters: {
      ...filters,
      state: filters.state || 'All States',
      business: filters.business || 'All Business',
      status: filters.status || 'All Status',
      timezone: 'Asia/Kolkata',
    },
  };
}

async function fetchPaged(queryFactory, pageSize = 1000) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await queryFactory().range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

async function fetchAuthorizedLiveStatusRows(client, identifiers, chunkSize = 200) {
  const uniqueIdentifiers = [...new Set(identifiers.map(text).filter(Boolean))];
  if (!uniqueIdentifiers.length) return [];
  const rows = [];
  for (let index = 0; index < uniqueIdentifiers.length; index += chunkSize) {
    const chunk = uniqueIdentifiers.slice(index, index + chunkSize);
    rows.push(...await fetchPaged(() => client
      .from('fo_live_status')
      .select('fo_user_id,current_status,is_tracking,active_site_visit_id')
      .in('fo_user_id', chunk)));
  }
  return rows;
}

export async function buildOperationsSummary(client, actor, query, today) {
  if (!canAccessOperationsSummary(actor)) {
    const error = new Error('Your role cannot access Operations summary totals.');
    error.statusCode = 403;
    throw error;
  }
  const filters = normalizeOperationsSummaryFilters(query, today);
  const [profiles, hierarchyRows, attendances] = await Promise.all([
    fetchPaged(() => client.from('profiles').select('*').eq('is_active', true)),
    fetchPaged(() => client.from('employee_hierarchy').select('*').eq('is_active', true)),
    fetchPaged(() => client
      .from('fo_attendance')
      .select('id,fo_user_id,employee_code,attendance_date,status,logout_time,total_approved_km,eligible_km,total_route_km,petrol_amount,rate_per_km')
      .gte('attendance_date', filters.date_from)
      .lte('attendance_date', filters.date_to)),
  ]);
  const allowedCodes = operationsSummaryAllowedEmployeeCodes(actor, profiles, hierarchyRows);
  const authorizedLiveIdentifiers = profiles.flatMap((profile) => {
    const code = employeeKey(profile);
    if (!code || !allowedCodes.has(code)) return [];
    // Current rows reference profiles.id. Include employee_code as a read-only
    // compatibility key for older live rows that predate the profile-id link.
    return [profile.id, code];
  });
  const liveRows = await fetchAuthorizedLiveStatusRows(client, authorizedLiveIdentifiers);
  return summarizeOperationsRows({ attendances, profiles, hierarchyRows, liveRows, actor, filters });
}
