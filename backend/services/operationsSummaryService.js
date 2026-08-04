const FULL_VISIBILITY_ROLES = new Set([
  'ADMIN', 'QPMSADMIN', 'DEVELOPER', 'DEV', 'ITADMIN', 'MD', 'COO',
  'DEMOADMIN', 'TENDERDEMO',
  'DEMOVIEWER',
]);

const OPERATIONS_ROLES = new Set([
  ...FULL_VISIBILITY_ROLES,
  'GM', 'GENERALMANAGER', 'SOUTHHEAD', 'BRANCHHEAD', 'BH',
  'OPERATIONSMANAGER', 'OPERATIONMANAGER', 'OM', 'MANAGER',
  'BUSINESSHEAD', 'KAM', 'KEYACCOUNTMANAGER', 'FO', 'FIELDOFFICER',
]);

export const TRAVEL_CLAIM_REPORT_INCLUDED_STATUSES = Object.freeze([
  'submitted',
  'pending_review',
  'approved',
]);

const STATE_ALIASES = new Map([
  ['KL', { state_name: 'Kerala', state_code: 'KL' }],
  ['KERALA', { state_name: 'Kerala', state_code: 'KL' }],
  ['KA', { state_name: 'Karnataka', state_code: 'KA' }],
  ['KARNATAKA', { state_name: 'Karnataka', state_code: 'KA' }],
  ['TN', { state_name: 'Tamil Nadu', state_code: 'TN' }],
  ['TAMILNADU', { state_name: 'Tamil Nadu', state_code: 'TN' }],
  ['TAMIL NADU', { state_name: 'Tamil Nadu', state_code: 'TN' }],
  ['TG', { state_name: 'Telangana', state_code: 'TG' }],
  ['TS', { state_name: 'Telangana', state_code: 'TG' }],
  ['TELANGANA', { state_name: 'Telangana', state_code: 'TG' }],
  ['AP', { state_name: 'Andhra Pradesh', state_code: 'AP' }],
  ['ANDHRAPRADESH', { state_name: 'Andhra Pradesh', state_code: 'AP' }],
  ['ANDHRA PRADESH', { state_name: 'Andhra Pradesh', state_code: 'AP' }],
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

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rounded(value) {
  return Number(number(value).toFixed(2));
}

export function normalizeTravelClaimReportState(value) {
  const raw = text(value);
  if (!raw) return { state_name: 'Unknown', state_code: 'Unknown', state_key: 'UNKNOWN' };
  const upper = raw.toUpperCase().replace(/\s+/g, ' ');
  const compact = upper.replace(/[^A-Z0-9]+/g, '');
  const apSplit = upper.match(/^AP[\s-]*(\d+)$/);
  if (apSplit) {
    const code = `AP-${apSplit[1]}`;
    return { state_name: code, state_code: code, state_key: code };
  }
  const alias = STATE_ALIASES.get(upper) || STATE_ALIASES.get(compact);
  if (alias) {
    return { ...alias, state_key: alias.state_code };
  }
  return { state_name: raw, state_code: raw, state_key: raw.toUpperCase() };
}

function stateMatchesFilter(profile, filterState) {
  if (!filterState) return true;
  return normalizeTravelClaimReportState(profileValue(profile, 'state')).state_key ===
    normalizeTravelClaimReportState(filterState).state_key;
}

function emptyTravelClaimTotals() {
  return {
    employee_count: 0,
    total_km_travelled: 0,
    distance_reimbursement: 0,
    other_transport_mode_amount: 0,
    parking_amount: 0,
    total_claim: 0,
  };
}

function addTravelClaimTotals(summary, row) {
  return {
    employee_count: summary.employee_count + 1,
    total_km_travelled: rounded(summary.total_km_travelled + row.total_km_travelled),
    distance_reimbursement: rounded(summary.distance_reimbursement + row.distance_reimbursement),
    other_transport_mode_amount: rounded(summary.other_transport_mode_amount + row.other_transport_mode_amount),
    parking_amount: rounded(summary.parking_amount + row.parking_amount),
    total_claim: rounded(summary.total_claim + row.total_claim),
  };
}

function finalizeTravelClaimTotals(totals) {
  return {
    ...totals,
    total_claim: rounded(
      totals.distance_reimbursement +
      totals.other_transport_mode_amount +
      totals.parking_amount,
    ),
  };
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

function chunks(values, size = 100) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

export function classifyTravelClaim(row = {}) {
  const claimType = comparable(row.claim_type);
  if (claimType === 'parking') return 'parking';
  if (claimType === 'transport') return 'transport';
  if (comparable(row.remarks).includes('parking')) return 'parking';
  return 'transport';
}

function displayNameForEmployee(attendance = {}, profile = {}) {
  return text(
    profile.full_name ||
    profile.display_name ||
    attendance.display_name ||
    attendance.full_name ||
    attendance.employee_name ||
    attendance.username ||
    attendance.employee_code,
  );
}

export function buildConsolidatedTravelClaimReportDataset({
  attendances = [],
  profiles = [],
  hierarchyRows = [],
  liveRows = [],
  claims = [],
  actor,
  filters,
  generatedBy = {},
  generatedAt = new Date(),
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
  const attendanceIdToEmployeeCode = new Map();
  const rowsByEmployee = new Map();

  for (const attendance of attendances) {
    const code = employeeKey(attendance);
    if (!code || !allowedCodes.has(code)) continue;
    const date = text(attendance.attendance_date).slice(0, 10);
    if (date < filters.date_from || date > filters.date_to) continue;
    const profile = profilesByCode.get(code) || {};
    if (filters.state && !stateMatchesFilter(profile, filters.state)) continue;
    if (filters.business && comparable(profileValue(profile, 'business')) !== comparable(filters.business)) continue;
    if (!statusMatches(attendance, filters.status, liveByEmployee)) continue;

    const payableKm = storedAttendancePayableKm(attendance);
    const distanceReimbursement = storedAttendancePetrolAmount(attendance, payableKm);
    const normalizedState = normalizeTravelClaimReportState(profileValue(profile, 'state'));
    const row = rowsByEmployee.get(code) || {
      employee_code: code,
      employee_name: displayNameForEmployee(attendance, profile),
      state_name: normalizedState.state_name,
      state_code: normalizedState.state_code,
      state_key: normalizedState.state_key,
      total_km_travelled: 0,
      distance_reimbursement: 0,
      other_transport_mode_amount: 0,
      parking_amount: 0,
      total_claim: 0,
      attendance_count: 0,
    };
    if (!row.employee_name) row.employee_name = displayNameForEmployee(attendance, profile);
    row.total_km_travelled += payableKm;
    row.distance_reimbursement += distanceReimbursement;
    row.attendance_count += 1;
    rowsByEmployee.set(code, row);
    if (attendance.id) attendanceIdToEmployeeCode.set(text(attendance.id), code);
  }

  const seenClaimIds = new Set();
  for (const claim of claims) {
    const claimId = text(claim.id);
    if (claimId && seenClaimIds.has(claimId)) continue;
    if (claimId) seenClaimIds.add(claimId);
    const code = attendanceIdToEmployeeCode.get(text(claim.attendance_id));
    if (!code) continue;
    const row = rowsByEmployee.get(code);
    if (!row) continue;
    const amount = Math.max(0, number(claim.fare_amount));
    if (classifyTravelClaim(claim) === 'parking') {
      row.parking_amount += amount;
    } else {
      row.other_transport_mode_amount += amount;
    }
  }

  const rows = [...rowsByEmployee.values()]
    .map((row) => {
      const distance = rounded(row.distance_reimbursement);
      const transport = rounded(row.other_transport_mode_amount);
      const parking = rounded(row.parking_amount);
      return {
        ...row,
        employee_name: row.employee_name || row.employee_code,
        total_km_travelled: rounded(row.total_km_travelled),
        distance_reimbursement: distance,
        other_transport_mode_amount: transport,
        parking_amount: parking,
        total_claim: rounded(distance + transport + parking),
      };
    })
    .sort((left, right) =>
      comparable(left.state_name).localeCompare(comparable(right.state_name)) ||
      comparable(left.state_code).localeCompare(comparable(right.state_code)) ||
      comparable(left.employee_name).localeCompare(comparable(right.employee_name)) ||
      comparable(left.employee_code).localeCompare(comparable(right.employee_code)));

  const sectionsByState = new Map();
  for (const row of rows) {
    const section = sectionsByState.get(row.state_key) || {
      state_name: row.state_name,
      state_code: row.state_code,
      state_key: row.state_key,
      rows: [],
      totals: emptyTravelClaimTotals(),
    };
    section.rows.push(row);
    section.totals = addTravelClaimTotals(section.totals, row);
    sectionsByState.set(row.state_key, section);
  }

  const state_sections = [...sectionsByState.values()]
    .map((section) => ({
      ...section,
      totals: finalizeTravelClaimTotals(section.totals),
    }))
    .sort((left, right) =>
      comparable(left.state_name).localeCompare(comparable(right.state_name)) ||
      comparable(left.state_code).localeCompare(comparable(right.state_code)));

  const totals = finalizeTravelClaimTotals(
    rows.reduce((summary, row) => addTravelClaimTotals(summary, row), emptyTravelClaimTotals()),
  );

  return {
    rows,
    state_sections,
    totals,
    applied_filters: {
      ...filters,
      state: filters.state || 'All States',
      business: filters.business || 'All Business',
      status: filters.status || 'All Status',
      timezone: 'Asia/Kolkata',
    },
    claim_statuses_included: TRAVEL_CLAIM_REPORT_INCLUDED_STATUSES,
    generated_by: {
      name: text(generatedBy.full_name || generatedBy.display_name || generatedBy.email || generatedBy.employee_code) || 'Authenticated user',
      employee_code: text(generatedBy.employee_code) || null,
    },
    generated_at: generatedAt.toISOString(),
  };
}

async function fetchClaimsForAttendanceIds(client, attendanceIds) {
  const rows = [];
  for (const attendanceIdChunk of chunks(attendanceIds)) {
    rows.push(...await fetchPaged(() => client
      .from('fo_travel_expense_claims')
      .select('id,attendance_id,employee_code,travel_mode,fare_amount,remarks,status,claim_type,created_at,reviewed_at,metadata')
      .in('attendance_id', attendanceIdChunk)
      .in('status', TRAVEL_CLAIM_REPORT_INCLUDED_STATUSES)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })));
  }
  return rows;
}

export async function buildConsolidatedTravelClaimReport(client, actor, query, today, generatedAt = new Date()) {
  if (!canAccessOperationsSummary(actor)) {
    const error = new Error('Your role cannot access Operations travel claim reports.');
    error.statusCode = 403;
    throw error;
  }
  const filters = normalizeOperationsSummaryFilters(query, today);
  const [profiles, hierarchyRows, attendances] = await Promise.all([
    fetchPaged(() => client.from('profiles').select('*').eq('is_active', true)),
    fetchPaged(() => client.from('employee_hierarchy').select('*').eq('is_active', true)),
    fetchPaged(() => client
      .from('fo_attendance')
      .select('id,fo_user_id,employee_code,display_name,username,attendance_date,status,logout_time,total_approved_km,eligible_km,total_route_km,actual_km,petrol_amount,rate_per_km,travel_mode')
      .gte('attendance_date', filters.date_from)
      .lte('attendance_date', filters.date_to)
      .order('attendance_date', { ascending: true })
      .order('id', { ascending: true })),
  ]);
  const allowedCodes = operationsSummaryAllowedEmployeeCodes(actor, profiles, hierarchyRows);
  const authorizedLiveIdentifiers = profiles.flatMap((profile) => {
    const code = employeeKey(profile);
    if (!code || !allowedCodes.has(code)) return [];
    return [profile.id, code];
  });
  const liveRows = await fetchAuthorizedLiveStatusRows(client, authorizedLiveIdentifiers);
  const prelim = buildConsolidatedTravelClaimReportDataset({
    attendances,
    profiles,
    hierarchyRows,
    liveRows,
    claims: [],
    actor,
    filters,
    generatedBy: actor,
    generatedAt,
  });
  const includedEmployeeCodes = new Set(prelim.rows.map((row) => row.employee_code));
  const attendanceIds = attendances
    .filter((attendance) => includedEmployeeCodes.has(employeeKey(attendance)))
    .map((attendance) => text(attendance.id))
    .filter(Boolean);
  const claims = attendanceIds.length ? await fetchClaimsForAttendanceIds(client, attendanceIds) : [];
  return buildConsolidatedTravelClaimReportDataset({
    attendances,
    profiles,
    hierarchyRows,
    liveRows,
    claims,
    actor,
    filters,
    generatedBy: actor,
    generatedAt,
  });
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
      .lte('attendance_date', filters.date_to)
      .order('attendance_date', { ascending: true })
      .order('id', { ascending: true })),
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
