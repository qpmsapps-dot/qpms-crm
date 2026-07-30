import {
  canAccessOperationsSummary,
  operationsSummaryAllowedEmployeeCodes,
  storedAttendancePayableKm,
  storedAttendancePetrolAmount,
} from './operationsSummaryService.js';

const PAGE_SIZE = 1000;
const ATTENDANCE_ID_CHUNK_SIZE = 100;
const INCLUDED_EXPENSE_CLAIM_STATUSES = new Set([
  'submitted',
  'pending_review',
  'approved',
]);
const EXPENSE_CLAIM_QUERY_STATUSES = [...INCLUDED_EXPENSE_CLAIM_STATUSES];
const DISTANCE_REIMBURSEMENT_MODES = new Set(['bike', 'own_vehicle', 'car']);
const TICKET_REIMBURSEMENT_MODES = new Set(['auto', 'bus', 'train', 'other']);
const COMPLETED_STATUS_PATTERN =
  /completed|ended|closed|logout|stale[\s_]*auto[\s_]*ended|auto[\s_]*ended/i;

function text(value) {
  return String(value ?? '').trim();
}

function key(value) {
  return text(value).toUpperCase();
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rounded(value) {
  return Number(number(value).toFixed(2));
}

function normalizedMode(value) {
  return text(value).toLowerCase().replace(/[\s-]+/g, '_');
}

function modeLabel(value) {
  switch (normalizedMode(value)) {
    case 'bike':
    case 'own_vehicle':
      return 'Bike';
    case 'car':
      return 'Car';
    case 'auto':
      return 'Auto';
    case 'bus':
      return 'Bus';
    case 'train':
      return 'Train';
    case 'other':
      return 'Other';
    default:
      return null;
  }
}

function reportError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function validDate(value) {
  const candidate = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return false;
  const [year, month, day] = candidate.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

export function kolkataPeriodBounds(fromDate, toDate) {
  if (!validDate(fromDate) || !validDate(toDate)) {
    throw reportError(400, 'date_from and date_to must use YYYY-MM-DD.');
  }
  if (fromDate > toDate) {
    throw reportError(400, 'date_from cannot be after date_to.');
  }
  return {
    from_date: fromDate,
    to_date: toDate,
    from_iso: new Date(`${fromDate}T00:00:00+05:30`).toISOString(),
    to_iso: new Date(`${toDate}T23:59:59.999+05:30`).toISOString(),
    timezone: 'Asia/Kolkata',
  };
}

export async function fetchEmployeeRangePages(queryFactory, pageSize = PAGE_SIZE) {
  const rows = [];
  const seen = new Set();
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await queryFactory().range(from, from + pageSize - 1);
    if (error) throw error;
    const page = data || [];
    for (const row of page) {
      const rowKey = text(row?.id) || JSON.stringify(row);
      if (seen.has(rowKey)) continue;
      seen.add(rowKey);
      rows.push(row);
    }
    if (page.length < pageSize) break;
  }
  return rows;
}

function chunks(values, size = ATTENDANCE_ID_CHUNK_SIZE) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function fetchByAttendanceIds(client, table, attendanceIds, orderColumn) {
  const rows = [];
  for (const attendanceIdsChunk of chunks(attendanceIds)) {
    rows.push(
      ...(await fetchEmployeeRangePages(() => {
        let query = client
          .from(table)
          .select('*')
          .in('attendance_id', attendanceIdsChunk);
        if (orderColumn) query = query.order(orderColumn, { ascending: true });
        return query.order('id', { ascending: true });
      })),
    );
  }
  const unique = new Map(rows.map((row) => [text(row.id), row]));
  return Array.from(unique.values());
}

function isOptionalExpenseClaimAccessError(error) {
  return ['42501', '42P01', 'PGRST205'].includes(error?.code);
}

export async function loadOptionalExpenseClaims(client, attendanceIds = [], options = {}) {
  if (!attendanceIds.length) return { rows: [], warning: null };
  try {
    const rows = [];
    for (const attendanceIdsChunk of chunks(attendanceIds)) {
      rows.push(
        ...(await fetchEmployeeRangePages(() =>
          client
            .from('fo_travel_expense_claims')
            .select('*')
            .in('attendance_id', attendanceIdsChunk)
            .in('status', EXPENSE_CLAIM_QUERY_STATUSES)
            .order('created_at', { ascending: true })
            .order('id', { ascending: true }))),
      );
    }
    const employeeCodes = [...new Set((options.employeeCodes || []).map(key).filter(Boolean))];
    if (employeeCodes.length && options.fromIso && options.toIso) {
      const fallbackRows = await fetchEmployeeRangePages(() =>
        client
          .from('fo_travel_expense_claims')
          .select('*')
          .in('employee_code', employeeCodes)
          .in('status', EXPENSE_CLAIM_QUERY_STATUSES)
          .gte('created_at', options.fromIso)
          .lte('created_at', options.toIso)
          .order('created_at', { ascending: true })
          .order('id', { ascending: true }));
      const byId = new Map(rows.map((row) => [text(row.id), row]));
      for (const row of fallbackRows) {
        const rowKey = text(row.id) || JSON.stringify(row);
        if (!byId.has(rowKey)) byId.set(rowKey, row);
      }
      return { rows: [...byId.values()], warning: null };
    }
    return { rows, warning: null };
  } catch (error) {
    if (!isOptionalExpenseClaimAccessError(error)) throw error;
    return {
      rows: [],
      warning: {
        code: 'EXPENSE_CLAIMS_UNAVAILABLE',
        attendance_id: null,
        attendance_date: null,
        message:
          'Ticket and parking claims are temporarily unavailable; attendance reimbursement remains available.',
      },
    };
  }
}

function profileEmployeeCode(profile = {}) {
  return key(profile.employee_code || profile.username);
}

function employeeMatchesIdentifier(profile, identifier) {
  const target = key(identifier);
  return [
    profile.id,
    profile.employee_code,
    profile.username,
    profile.email,
  ].some((value) => key(value) === target);
}

async function resolveAuthorizedEmployee(client, actor, identifier) {
  if (!canAccessOperationsSummary(actor)) {
    throw reportError(403, 'Your role cannot access employee operations reports.');
  }
  const [profiles, hierarchyRows] = await Promise.all([
    fetchEmployeeRangePages(() => client.from('profiles').select('*').eq('is_active', true)),
    fetchEmployeeRangePages(() => client.from('employee_hierarchy').select('*').eq('is_active', true)),
  ]);
  const employee = profiles.find((profile) => employeeMatchesIdentifier(profile, identifier));
  if (!employee) throw reportError(404, 'Employee not found.');
  const employeeCode = profileEmployeeCode(employee);
  const allowedCodes = operationsSummaryAllowedEmployeeCodes(actor, profiles, hierarchyRows);
  if (!employeeCode || !allowedCodes.has(employeeCode)) {
    throw reportError(403, 'You cannot access this employee report.');
  }
  return employee;
}

function safeEmployee(profile = {}) {
  return {
    id: profile.id || null,
    employee_code: profile.employee_code || profile.username || null,
    username: profile.username || null,
    full_name: profile.full_name || profile.display_name || null,
    designation: profile.designation || null,
    department: profile.department || null,
    role: profile.role || null,
    state: profile.state || profile.metadata?.state || null,
    business: profile.business || profile.metadata?.business || null,
  };
}

const SAFE_ATTENDANCE_METADATA_KEYS = [
  'approved_adjustment_included_in_payable',
  'approved_adjustment_km',
  'final_return_leg_km',
  'final_return_leg_provider',
  'final_return_leg_reason',
  'payable_km_source',
  'payable_km_source_reason',
  'payable_km_formula',
  'review_flags',
  'travel_legs',
  'km_recalculation_status',
  'canonical_recalculation_pending',
];

function safeMetadata(metadata, keysToKeep) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
  return Object.fromEntries(
    keysToKeep
      .filter((metadataKey) => Object.hasOwn(metadata, metadataKey))
      .map((metadataKey) => [metadataKey, metadata[metadataKey]]),
  );
}

function safeAttendance(row = {}) {
  return {
    id: row.id,
    fo_user_id: row.fo_user_id || null,
    employee_code: row.employee_code || null,
    attendance_date: row.attendance_date || null,
    login_time: row.login_time || null,
    logout_time: row.logout_time || null,
    status: row.status || null,
    travel_mode: row.travel_mode || null,
    rate_per_km: row.rate_per_km ?? null,
    start_latitude: row.start_latitude ?? row.login_latitude ?? null,
    start_longitude: row.start_longitude ?? row.login_longitude ?? null,
    end_latitude: row.end_latitude ?? row.logout_latitude ?? null,
    end_longitude: row.end_longitude ?? row.logout_longitude ?? null,
    raw_gps_km: row.raw_gps_km ?? null,
    filtered_gps_km: row.filtered_gps_km ?? null,
    actual_travel_km: row.actual_travel_km ?? null,
    actual_km: row.actual_km ?? null,
    total_route_km: row.total_route_km ?? null,
    eligible_km: row.eligible_km ?? null,
    total_approved_km: row.total_approved_km ?? null,
    petrol_amount: row.petrol_amount ?? null,
    route_sync_status: row.route_sync_status || null,
    updated_at: row.updated_at || null,
    metadata: safeMetadata(row.metadata, SAFE_ATTENDANCE_METADATA_KEYS),
  };
}

const SAFE_VISIT_METADATA_KEYS = [
  'checkout_review_status',
  'checkout_review_approved_km',
  'approved_missing_km',
  'approved_missing_checkout_km',
  'checkout_review_approval_remarks',
  'checkout_review_approved_by_employee_code',
  'checkout_review_reason',
];

function safeVisit(row = {}, attendanceDateById = new Map()) {
  const checkIn = row.check_in_time || null;
  const checkOut = row.check_out_time || row.checkout_time || null;
  return {
    id: row.id,
    attendance_id: row.attendance_id || null,
    attendance_date: attendanceDateById.get(text(row.attendance_id)) || null,
    store_id: row.store_id || null,
    store_code: row.store_code || row.site_code || null,
    store_name: row.store_name || row.site_name || null,
    site_name: row.site_name || row.store_name || null,
    client_name: row.client_name || null,
    state: row.state || null,
    check_in_time: checkIn,
    check_out_time: checkOut,
    check_in_latitude: row.check_in_latitude ?? null,
    check_in_longitude: row.check_in_longitude ?? null,
    check_out_latitude: row.check_out_latitude ?? null,
    check_out_longitude: row.check_out_longitude ?? null,
    route_km: row.route_km ?? null,
    visit_duration_minutes: deriveVisitDurationMinutes({
      storedMinutes: row.visit_duration_minutes,
      checkIn,
      checkOut,
    }),
    status: row.status || row.visit_status || null,
    checkout_note: row.checkout_note || row.check_out_note || null,
    metadata: safeMetadata(row.metadata, SAFE_VISIT_METADATA_KEYS),
  };
}

function kolkataDateFromTimestamp(value) {
  if (!value) return '';
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(parsed);
}

export function attachFallbackClaimsToAttendance(claims = [], attendances = [], employeeCode = '') {
  const targetCode = key(employeeCode);
  const byDate = new Map();
  for (const attendance of attendances) {
    const list = byDate.get(text(attendance.attendance_date)) || [];
    list.push(attendance);
    byDate.set(text(attendance.attendance_date), list);
  }
  return claims.map((claim) => {
    if (text(claim.attendance_id)) return claim;
    const claimCode = key(claim.employee_code || claim.fo_user_id);
    const candidates = byDate.get(kolkataDateFromTimestamp(claim.submitted_at || claim.created_at)) || [];
    if (claimCode === targetCode && candidates.length === 1) {
      return { ...claim, attendance_id: candidates[0].id };
    }
    return claim;
  });
}

export function deriveVisitDurationMinutes({ storedMinutes, checkIn, checkOut } = {}) {
  const stored = Number(storedMinutes);
  if (Number.isFinite(stored) && stored > 0) return Math.round(stored);
  if (!checkIn || !checkOut) return null;
  const start = new Date(checkIn).getTime();
  const end = new Date(checkOut).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return Math.max(0, Math.floor((end - start) / 60000));
}

function safeTravelLeg(row = {}, attendanceDateById = new Map()) {
  return {
    id: row.id,
    attendance_id: row.attendance_id,
    attendance_date: attendanceDateById.get(text(row.attendance_id)) || null,
    started_at: row.started_at || null,
    ended_at: row.ended_at || null,
    start_lat: row.start_lat ?? null,
    start_lng: row.start_lng ?? null,
    end_lat: row.end_lat ?? null,
    end_lng: row.end_lng ?? null,
    travel_mode: row.travel_mode || null,
    rate_per_km: row.rate_per_km ?? null,
    calculated_km: row.calculated_km ?? null,
    payable_km: row.payable_km ?? null,
    payable_amount: row.payable_amount ?? row.fare_amount ?? null,
    calculation_source: row.calculation_source || row.source || null,
    status: row.status || null,
  };
}

function isParkingClaim(row = {}) {
  return normalizedMode(row.claim_type) === 'parking' ||
    (
      normalizedMode(row.travel_mode) === 'other' &&
      /^parking claim\b/i.test(text(row.remarks))
    );
}

function isEligibleExpenseClaim(row = {}) {
  const status = normalizedMode(row.status);
  if (!INCLUDED_EXPENSE_CLAIM_STATUSES.has(status)) return false;
  return isParkingClaim(row) ||
    TICKET_REIMBURSEMENT_MODES.has(normalizedMode(row.travel_mode));
}

function safeExpenseClaim(row = {}, attendanceDateById = new Map()) {
  const parking = isParkingClaim(row);
  const amount = rounded(row.fare_amount);
  return {
    id: row.id || null,
    attendance_id: row.attendance_id || null,
    attendance_date: attendanceDateById.get(text(row.attendance_id)) || null,
    travel_mode: normalizedMode(row.travel_mode) || null,
    claim_type: parking ? 'parking' : normalizedMode(row.claim_type) || 'travel',
    claimed_amount: amount,
    eligible_amount: amount,
    fare_amount: amount,
    ticket_amount: parking ? 0 : amount,
    parking_amount: parking ? amount : 0,
    status: normalizedMode(row.status) || null,
    approval_status: normalizedMode(row.status) || null,
    proof_reference: row.proof_file_url || null,
    remarks: row.remarks || null,
    submitted_at: row.submitted_at || row.created_at || null,
  };
}

function adjustmentFromVisit(visit) {
  const metadata = visit.metadata || {};
  const candidates = [
    metadata.checkout_review_approved_km,
    metadata.approved_missing_km,
    metadata.approved_missing_checkout_km,
  ];
  const amount = candidates
    .map(Number)
    .find((value) => Number.isFinite(value) && value > 0) || 0;
  if (amount <= 0) return null;
  return {
    site_visit_id: visit.id,
    attendance_id: visit.attendance_id,
    attendance_date: visit.attendance_date,
    approved_km: rounded(amount),
    status: metadata.checkout_review_status || 'approved',
    remarks: metadata.checkout_review_approval_remarks || null,
  };
}

function isCompletedAttendance(row) {
  return Boolean(row.logout_time) || COMPLETED_STATUS_PATTERN.test(text(row.status));
}

function isStaleAttendance(row) {
  return /stale[\s_]*auto[\s_]*ended/i.test(text(row.status));
}

function reimbursementModes({ attendance, legs, claims }) {
  const modes = [];
  const addMode = (value) => {
    const label = modeLabel(value);
    if (label && !modes.includes(label)) modes.push(label);
  };
  legs.forEach((leg) => addMode(leg.travel_mode));
  claims
    .filter((claim) => claim.claim_type !== 'parking')
    .forEach((claim) => addMode(claim.travel_mode));
  if (!modes.length) addMode(attendance.travel_mode);
  return modes;
}

function completedDistanceLegs(legs = []) {
  return legs.filter((leg) =>
    Boolean(leg.ended_at) &&
    !['active', 'cancelled', 'rejected'].includes(normalizedMode(leg.status)) &&
    DISTANCE_REIMBURSEMENT_MODES.has(normalizedMode(leg.travel_mode)));
}

function distanceReimbursement(attendance, legs = []) {
  const hasStoredCanonicalKm = [
    attendance.total_approved_km,
    attendance.eligible_km,
    attendance.total_route_km,
  ].some((value) => value !== null && value !== undefined);
  if (
    isCompletedAttendance(attendance) &&
    hasStoredCanonicalKm &&
    attendance.petrol_amount !== null &&
    attendance.petrol_amount !== undefined &&
    DISTANCE_REIMBURSEMENT_MODES.has(normalizedMode(attendance.travel_mode))
  ) {
    return {
      kilometer: rounded(storedAttendancePayableKm(attendance)),
      amount: rounded(storedAttendancePetrolAmount(attendance)),
    };
  }
  const completedLegs = completedDistanceLegs(legs);
  if (completedLegs.length) {
    return {
      kilometer: rounded(completedLegs.reduce((sum, leg) => sum + number(leg.payable_km), 0)),
      amount: rounded(completedLegs.reduce((sum, leg) => {
        if (leg.payable_amount !== null && leg.payable_amount !== undefined) {
          return sum + number(leg.payable_amount);
        }
        return sum + number(leg.payable_km) * number(leg.rate_per_km);
      }, 0)),
    };
  }
  if (!DISTANCE_REIMBURSEMENT_MODES.has(normalizedMode(attendance.travel_mode))) {
    return { kilometer: 0, amount: 0 };
  }
  return {
    kilometer: rounded(storedAttendancePayableKm(attendance)),
    amount: rounded(storedAttendancePetrolAmount(attendance)),
  };
}

function buildSiteVisitSummary(attendances, visitsByAttendance) {
  return attendances.flatMap((attendance) => {
    const visits = [...(visitsByAttendance.get(attendance.id) || [])]
      .sort((left, right) =>
        text(left.check_in_time).localeCompare(text(right.check_in_time)) ||
        text(left.id).localeCompare(text(right.id)));
    const rows = [{
      attendance_id: attendance.id,
      attendance_date: attendance.attendance_date,
      row_type: 'start_day',
      site_name: 'Start Day',
      client_name: null,
      check_in_time: attendance.login_time,
      check_out_time: null,
      visit_duration_minutes: null,
      approved_km: 0,
      review_status: null,
      remarks: 'Start of day',
    }];
    for (const visit of visits) {
      const adjustment = adjustmentFromVisit(visit);
      rows.push({
        attendance_id: attendance.id,
        attendance_date: attendance.attendance_date,
        row_type: 'site_visit',
        site_name: visit.store_name || visit.site_name || 'Site visit',
        client_name: visit.client_name || null,
        check_in_time: visit.check_in_time,
        check_out_time: visit.check_out_time,
        visit_duration_minutes: visit.visit_duration_minutes,
        approved_km: adjustment?.approved_km || 0,
        review_status: visit.metadata?.checkout_review_status || visit.status || null,
        remarks:
          visit.metadata?.checkout_review_approval_remarks ||
          visit.checkout_note ||
          null,
      });
    }
    const ended = Boolean(attendance.logout_time);
    rows.push({
      attendance_id: attendance.id,
      attendance_date: attendance.attendance_date,
      row_type: ended ? 'end_day' : 'end_day_pending',
      site_name: ended
        ? isStaleAttendance(attendance) ? 'Auto Ended' : 'End Day'
        : 'End Day Pending',
      client_name: null,
      check_in_time: null,
      check_out_time: attendance.logout_time,
      visit_duration_minutes: null,
      approved_km: 0,
      review_status: null,
      remarks: ended ? 'End of day' : 'Attendance is still active',
    });
    return rows;
  });
}

export function buildEmployeeRangeDataset({
  employee,
  period,
  attendances = [],
  visits = [],
  travelLegs = [],
  expenseClaims = [],
}) {
  const sortedAttendances = attendances
    .map(safeAttendance)
    .sort((left, right) =>
      text(left.attendance_date).localeCompare(text(right.attendance_date)) ||
      text(left.login_time).localeCompare(text(right.login_time)) ||
      text(left.id).localeCompare(text(right.id)));
  const attendanceDateById = new Map(
    sortedAttendances.map((row) => [text(row.id), row.attendance_date]),
  );
  const safeVisits = visits
    .map((row) => safeVisit(row, attendanceDateById))
    .sort((left, right) => text(left.check_in_time).localeCompare(text(right.check_in_time)));
  const safeTravelLegs = travelLegs
    .map((row) => safeTravelLeg(row, attendanceDateById))
    .sort((left, right) => text(left.started_at).localeCompare(text(right.started_at)));
  const uniqueExpenseClaims = new Map();
  for (const claim of expenseClaims) {
    const claimKey = text(claim.id) ||
      [
        text(claim.attendance_id),
        normalizedMode(claim.travel_mode),
        normalizedMode(claim.claim_type),
        text(claim.fare_amount),
        text(claim.submitted_at || claim.created_at),
      ].join(':');
    if (!uniqueExpenseClaims.has(claimKey) && isEligibleExpenseClaim(claim)) {
      uniqueExpenseClaims.set(claimKey, safeExpenseClaim(claim, attendanceDateById));
    }
  }
  const safeExpenseClaims = [...uniqueExpenseClaims.values()]
    .sort((left, right) => text(left.submitted_at).localeCompare(text(right.submitted_at)));
  const adjustments = safeVisits.map(adjustmentFromVisit).filter(Boolean);
  const visitsByAttendance = new Map();
  const legsByAttendance = new Map();
  const claimsByAttendance = new Map();
  for (const visit of safeVisits) {
    const list = visitsByAttendance.get(visit.attendance_id) || [];
    list.push(visit);
    visitsByAttendance.set(visit.attendance_id, list);
  }
  for (const leg of safeTravelLegs) {
    const list = legsByAttendance.get(leg.attendance_id) || [];
    list.push(leg);
    legsByAttendance.set(leg.attendance_id, list);
  }
  for (const claim of safeExpenseClaims) {
    const list = claimsByAttendance.get(claim.attendance_id) || [];
    list.push(claim);
    claimsByAttendance.set(claim.attendance_id, list);
  }

  const dateCounts = new Map();
  for (const row of sortedAttendances) {
    dateCounts.set(row.attendance_date, (dateCounts.get(row.attendance_date) || 0) + 1);
  }

  const warnings = [];
  for (const row of sortedAttendances) {
    const rowLegs = legsByAttendance.get(row.id) || [];
    if (!rowLegs.length) {
      warnings.push({
        code: 'LEGACY_TRAVEL_LEGS_UNAVAILABLE',
        attendance_id: row.id,
        attendance_date: row.attendance_date,
        message: 'Legacy attendance - persisted travel-leg snapshots are unavailable.',
      });
    }
    if (dateCounts.get(row.attendance_date) > 1) {
      warnings.push({
        code: 'DUPLICATE_OR_REOPENED_ATTENDANCE_DATE',
        attendance_id: row.id,
        attendance_date: row.attendance_date,
        message: 'More than one attendance record exists for this business date.',
      });
    }
    if (isStaleAttendance(row)) {
      warnings.push({
        code: 'STALE_AUTO_ENDED',
        attendance_id: row.id,
        attendance_date: row.attendance_date,
        message: 'Attendance was stale auto-ended and should be reviewed.',
      });
    }
    if (/reopen/i.test(text(row.status))) {
      warnings.push({
        code: 'REOPENED_ATTENDANCE',
        attendance_id: row.id,
        attendance_date: row.attendance_date,
        message: 'Attendance was reopened.',
      });
    }
  }

  const dailySummary = sortedAttendances.map((row) => {
    const rowVisits = visitsByAttendance.get(row.id) || [];
    const rowLegs = legsByAttendance.get(row.id) || [];
    const rowClaims = claimsByAttendance.get(row.id) || [];
    const distance = distanceReimbursement(row, rowLegs);
    const otherTransportAmount = rounded(
      rowClaims.reduce((sum, claim) => sum + number(claim.ticket_amount), 0),
    );
    const parkingAmount = rounded(
      rowClaims.reduce((sum, claim) => sum + number(claim.parking_amount), 0),
    );
    const eligibleTicketParkingAmount = rounded(otherTransportAmount + parkingAmount);
    return {
      attendance_id: row.id,
      attendance_ids: [row.id],
      attendance_date: row.attendance_date,
      login_time: row.login_time,
      logout_time: row.logout_time,
      status: row.status,
      modes: reimbursementModes({
        attendance: row,
        legs: rowLegs,
        claims: rowClaims,
      }),
      visit_count: rowVisits.length,
      raw_gps_km: rounded(row.raw_gps_km),
      filtered_gps_km: rounded(row.filtered_gps_km),
      actual_travel_km: rounded(row.actual_travel_km),
      payable_km: rounded(storedAttendancePayableKm(row)),
      petrol_amount: rounded(storedAttendancePetrolAmount(row)),
      kilometer: distance.kilometer,
      distance_amount: distance.amount,
      claim_amount: eligibleTicketParkingAmount,
      ticket_amount: otherTransportAmount,
      other_transport_amount: otherTransportAmount,
      parking_amount: parkingAmount,
      eligible_ticket_amount: otherTransportAmount,
      eligible_ticket_parking_amount: eligibleTicketParkingAmount,
      total_amount: rounded(distance.amount + eligibleTicketParkingAmount),
      amount: rounded(distance.amount + eligibleTicketParkingAmount),
      approved_missing_km: rounded(
        adjustments
          .filter((adjustment) => adjustment.attendance_id === row.id)
          .reduce((sum, adjustment) => sum + adjustment.approved_km, 0),
      ),
      travel_leg_count: rowLegs.length,
      duplicate_or_reopened: dateCounts.get(row.attendance_date) > 1,
    };
  });

  const sumDaily = (field) => rounded(dailySummary.reduce((sum, row) => sum + number(row[field]), 0));
  const completedCount = sortedAttendances.filter(isCompletedAttendance).length;
  const staleCount = sortedAttendances.filter(isStaleAttendance).length;
  const activeCount = sortedAttendances.filter((row) => !row.logout_time && !isCompletedAttendance(row)).length;
  const periodSummary = {
    attendance_count: sortedAttendances.length,
    attendance_day_count: new Set(sortedAttendances.map((row) => row.attendance_date)).size,
    completed_count: completedCount,
    active_count: activeCount,
    stale_count: staleCount,
    incomplete_count: activeCount + staleCount,
    visit_count: safeVisits.length,
    canonical_payable_km: sumDaily('payable_km'),
    approved_missing_km: rounded(adjustments.reduce((sum, row) => sum + row.approved_km, 0)),
    canonical_petrol_amount: sumDaily('petrol_amount'),
    kilometer: sumDaily('kilometer'),
    distance_amount: sumDaily('distance_amount'),
    eligible_claim_amount: sumDaily('claim_amount'),
    other_transport_amount: sumDaily('other_transport_amount'),
    parking_amount: sumDaily('parking_amount'),
    eligible_ticket_parking_amount: sumDaily('eligible_ticket_parking_amount'),
    total_amount: sumDaily('amount'),
    total_man_days: new Set(sortedAttendances.map((row) => row.attendance_date).filter(Boolean)).size,
    attendance_records: sortedAttendances.length,
    total_visits: safeVisits.length,
    raw_gps_km: sumDaily('raw_gps_km'),
    filtered_gps_km: sumDaily('filtered_gps_km'),
    actual_travel_km: sumDaily('actual_travel_km'),
    first_start: sortedAttendances.find((row) => row.login_time)?.login_time || null,
    last_end: sortedAttendances.slice().reverse().find((row) => row.logout_time)?.logout_time || null,
    period_attendance_status:
      activeCount > 0
        ? 'Active / Incomplete'
        : staleCount > 0
          ? 'Completed with exceptions'
          : sortedAttendances.length
            ? 'Completed'
            : 'No attendance',
  };

  return {
    employee: safeEmployee(employee),
    period,
    attendance_days: sortedAttendances,
    site_visits: safeVisits,
    site_visit_summary: buildSiteVisitSummary(sortedAttendances, visitsByAttendance),
    travel_legs: safeTravelLegs,
    expense_claims: safeExpenseClaims,
    missing_checkout_adjustments: adjustments,
    period_summary: periodSummary,
    daily_summary: dailySummary,
    data_quality_warnings: warnings,
  };
}

export async function loadAuthorizedEmployeeRange(client, actor, query = {}) {
  const employeeIdentifier = text(
    query.employee || query.employee_identifier || query.employee_code || query.fo_user_id,
  );
  if (!employeeIdentifier) throw reportError(400, 'employee is required.');
  const period = kolkataPeriodBounds(
    text(query.date_from || query.from_date),
    text(query.date_to || query.to_date),
  );
  const employee = await resolveAuthorizedEmployee(client, actor, employeeIdentifier);
  const identifiers = [
    employee.employee_code,
    employee.username,
    employee.id,
  ].map(text).filter(Boolean);
  const orFilter = [
    ...identifiers.map((value) => `employee_code.eq.${value}`),
    ...identifiers.map((value) => `fo_user_id.eq.${value}`),
  ].join(',');
  const attendances = await fetchEmployeeRangePages(() =>
    client
      .from('fo_attendance')
      .select('*')
      .or(orFilter)
      .gte('attendance_date', period.from_date)
      .lte('attendance_date', period.to_date)
      .order('attendance_date', { ascending: true })
      .order('login_time', { ascending: true })
      .order('id', { ascending: true }));
  const attendanceIds = attendances.map((row) => row.id).filter(Boolean);
  const visits = attendanceIds.length
    ? await fetchByAttendanceIds(client, 'fo_site_visits', attendanceIds, 'check_in_time')
    : [];
  let travelLegs = [];
  let travelLegTableUnavailable = false;
  if (attendanceIds.length) {
    try {
      travelLegs = await fetchByAttendanceIds(client, 'fo_travel_legs', attendanceIds, 'started_at');
    } catch (error) {
      if (!['42P01', 'PGRST205'].includes(error?.code)) throw error;
      travelLegTableUnavailable = true;
    }
  }
  const optionalClaims = await loadOptionalExpenseClaims(client, attendanceIds, {
    employeeCodes: [employee.employee_code],
    fromIso: period.from_iso,
    toIso: period.to_iso,
  });
  const linkedExpenseClaims = attachFallbackClaimsToAttendance(
    optionalClaims.rows,
    attendances,
    employee.employee_code,
  );
  const dataset = buildEmployeeRangeDataset({
    employee,
    period,
    attendances,
    visits,
    travelLegs,
    expenseClaims: linkedExpenseClaims,
  });
  if (optionalClaims.warning) {
    dataset.data_quality_warnings.unshift(optionalClaims.warning);
  }
  if (travelLegTableUnavailable) {
    dataset.data_quality_warnings.unshift({
      code: 'TRAVEL_LEG_TABLE_UNAVAILABLE',
      attendance_id: null,
      attendance_date: null,
      message: 'Travel-leg records are temporarily unavailable.',
    });
  }
  return dataset;
}

export async function recalculateEmployeeRange({ attendances = [], recalculate }) {
  const results = [];
  let eligible = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  for (const attendance of attendances) {
    const baseResult = {
      attendance_id: attendance.id,
      attendance_date: attendance.attendance_date || null,
      status: attendance.status || null,
    };
    if (!attendance.logout_time) {
      skipped += 1;
      results.push({
        ...baseResult,
        outcome: 'skipped',
        reason: 'Attendance is active or has no End Day timestamp.',
      });
      continue;
    }
    eligible += 1;
    try {
      await recalculate(attendance);
      updated += 1;
      results.push({ ...baseResult, outcome: 'updated', reason: null });
    } catch {
      failed += 1;
      results.push({
        ...baseResult,
        outcome: 'failed',
        reason: 'KM recalculation failed for this attendance.',
      });
    }
  }
  return {
    found: attendances.length,
    eligible,
    updated,
    skipped,
    failed,
    results,
  };
}
