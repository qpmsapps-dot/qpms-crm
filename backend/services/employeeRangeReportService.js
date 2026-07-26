import {
  canAccessOperationsSummary,
  operationsSummaryAllowedEmployeeCodes,
  storedAttendancePayableKm,
  storedAttendancePetrolAmount,
} from './operationsSummaryService.js';

const PAGE_SIZE = 1000;
const ATTENDANCE_ID_CHUNK_SIZE = 100;
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
    check_in_time: row.check_in_time || null,
    check_out_time: row.check_out_time || row.checkout_time || null,
    check_in_latitude: row.check_in_latitude ?? null,
    check_in_longitude: row.check_in_longitude ?? null,
    check_out_latitude: row.check_out_latitude ?? null,
    check_out_longitude: row.check_out_longitude ?? null,
    route_km: row.route_km ?? null,
    visit_duration_minutes: row.visit_duration_minutes ?? null,
    status: row.status || row.visit_status || null,
    checkout_note: row.checkout_note || row.check_out_note || null,
    metadata: safeMetadata(row.metadata, SAFE_VISIT_METADATA_KEYS),
  };
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

function modesForAttendances(rows) {
  return [...new Set(rows.map((row) => text(row.travel_mode)).filter(Boolean))];
}

export function buildEmployeeRangeDataset({
  employee,
  period,
  attendances = [],
  visits = [],
  travelLegs = [],
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
  const adjustments = safeVisits.map(adjustmentFromVisit).filter(Boolean);
  const visitsByAttendance = new Map();
  const legsByAttendance = new Map();
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
    return {
      attendance_id: row.id,
      attendance_ids: [row.id],
      attendance_date: row.attendance_date,
      login_time: row.login_time,
      logout_time: row.logout_time,
      status: row.status,
      modes: modesForAttendances([row]),
      visit_count: rowVisits.length,
      raw_gps_km: rounded(row.raw_gps_km),
      filtered_gps_km: rounded(row.filtered_gps_km),
      actual_travel_km: rounded(row.actual_travel_km),
      payable_km: rounded(storedAttendancePayableKm(row)),
      petrol_amount: rounded(storedAttendancePetrolAmount(row)),
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
    travel_legs: safeTravelLegs,
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
  const dataset = buildEmployeeRangeDataset({
    employee,
    period,
    attendances,
    visits,
    travelLegs,
  });
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
