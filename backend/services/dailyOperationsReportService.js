import XLSX from 'xlsx';
import { normalizeRecipients, sendEmail } from './emailService.js';

export const REPORT_STATES = ['TN', 'KL', 'KA', 'AP', 'TG'];

const FIELD_ROLE_KEYS = new Set([
  'FO',
  'KAM',
  'OPERATIONSMANAGER',
  'BRANCHHEAD',
  'BUSINESSHEAD',
  'GM',
  'GENERALMANAGER',
]);

const STATE_ALIASES = new Map([
  ['TN', 'TN'],
  ['TAMILNADU', 'TN'],
  ['TAMIL NADU', 'TN'],
  ['KL', 'KL'],
  ['KERALA', 'KL'],
  ['KA', 'KA'],
  ['KARNATAKA', 'KA'],
  ['AP', 'AP'],
  ['ANDHRAPRADESH', 'AP'],
  ['ANDHRA PRADESH', 'AP'],
  ['TG', 'TG'],
  ['TS', 'TG'],
  ['TELANGANA', 'TG'],
]);

function roleKey(role) {
  return String(role || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '');
}

function isFieldProfile(profile) {
  return profile?.is_active === true &&
    String(profile.status || 'Active').trim().toLowerCase() === 'active' &&
    FIELD_ROLE_KEYS.has(roleKey(profile.role));
}

export function normalizeReportState(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'Unknown';
  const compact = raw.toUpperCase().replace(/[^A-Z]+/g, '');
  const spaced = raw.toUpperCase().replace(/\s+/g, ' ');
  return STATE_ALIASES.get(raw.toUpperCase()) ||
    STATE_ALIASES.get(spaced) ||
    STATE_ALIASES.get(compact) ||
    'Unknown';
}

function indiaDateInput(date = new Date()) {
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.REPORT_EMAIL_TIMEZONE || 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date ? new Date(date) : new Date());
}

function formatReportDate(dateInput) {
  const date = new Date(`${dateInput}T00:00:00+05:30`);
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: process.env.REPORT_EMAIL_TIMEZONE || 'Asia/Kolkata',
  }).format(date);
}

function startEndForDate(dateInput) {
  const start = new Date(`${dateInput}T00:00:00+05:30`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

function numberValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value) {
  return String(value || '').trim();
}

function employeeCodeFrom(row) {
  return text(row?.employee_code || row?.fo_user_id || row?.username);
}

function profileCode(profile) {
  return text(profile?.employee_code || profile?.username).toUpperCase();
}

function displayName(profile, fallback = '') {
  return text(profile?.display_name || profile?.full_name || profile?.name || fallback);
}

function metadataOf(row) {
  return row?.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
    ? row.metadata
    : {};
}

function reportManager(profile) {
  const metadata = metadataOf(profile);
  return text(
    metadata.reporting_manager_name ||
    metadata.reporting_manager_employee_code ||
    metadata.operations_manager_employee_code ||
    profile?.reporting_manager ||
    '',
  );
}

function branchHead(profile) {
  const metadata = metadataOf(profile);
  return text(metadata.branch_head_name || metadata.branch_head_employee_code || '');
}

function isMissingEndGps(attendance) {
  if (!attendance?.logout_time) return false;
  return !Number.isFinite(Number(attendance.end_latitude)) ||
    !Number.isFinite(Number(attendance.end_longitude));
}

function attendanceStatus(attendance) {
  if (!attendance) return 'Not Started';
  if (attendance.logout_time) return 'Ended Day';
  return text(attendance.status) || 'Active';
}

function firstVisitName(visits = []) {
  return text(visits[0]?.store_name || visits[0]?.store_code || '');
}

function lastVisitName(visits = []) {
  const visit = visits[visits.length - 1];
  return text(visit?.store_name || visit?.store_code || '');
}

function visitClosed(visit) {
  return Boolean(visit?.checkout_time || visit?.check_out_time);
}

function visitTime(visit) {
  return visit?.check_in_time || visit?.created_at || '';
}

function byTime(a, b) {
  return new Date(visitTime(a) || 0) - new Date(visitTime(b) || 0);
}

async function fetchAllRows(client, table, select, buildQuery) {
  const pageSize = 1000;
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    let query = client.from(table).select(select).range(from, from + pageSize - 1);
    query = buildQuery ? buildQuery(query) : query;
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

async function loadReportData(client, dateInput) {
  const { startIso, endIso } = startEndForDate(dateInput);
  const profiles = await fetchAllRows(client, 'profiles', '*', (query) =>
    query.eq('is_active', true).eq('status', 'Active'));
  const fieldProfiles = profiles.filter(isFieldProfile);
  const attendances = await fetchAllRows(client, 'fo_attendance', '*', (query) =>
    query.eq('attendance_date', dateInput).order('login_time', { ascending: false }));
  const visits = await fetchAllRows(client, 'fo_site_visits', '*', (query) =>
    query.gte('check_in_time', startIso).lt('check_in_time', endIso).order('check_in_time', { ascending: true }));
  return { profiles, fieldProfiles, attendances, visits };
}

function buildEmployeeRows({ fieldProfiles, attendances, visits, state = null }) {
  const attendanceByCode = new Map();
  for (const attendance of attendances) {
    const code = employeeCodeFrom(attendance).toUpperCase();
    if (!code) continue;
    if (!attendanceByCode.has(code)) attendanceByCode.set(code, attendance);
  }

  const visitsByCode = new Map();
  const visitsByAttendance = new Map();
  for (const visit of visits) {
    const code = employeeCodeFrom(visit).toUpperCase();
    if (code) {
      const list = visitsByCode.get(code) || [];
      list.push(visit);
      visitsByCode.set(code, list);
    }
    const attendanceId = text(visit.attendance_id);
    if (attendanceId) {
      const list = visitsByAttendance.get(attendanceId) || [];
      list.push(visit);
      visitsByAttendance.set(attendanceId, list);
    }
  }

  return fieldProfiles
    .filter((profile) => !state || normalizeReportState(profile.state) === state)
    .map((profile) => {
      const code = profileCode(profile);
      const attendance = attendanceByCode.get(code) || null;
      const attendanceVisits = attendance?.id && visitsByAttendance.has(String(attendance.id))
        ? visitsByAttendance.get(String(attendance.id))
        : visitsByCode.get(code) || [];
      const orderedVisits = [...attendanceVisits].sort(byTime);
      const missingEndGps = isMissingEndGps(attendance);
      const openVisits = orderedVisits.filter((visit) => !visitClosed(visit));
      const visitCount = orderedVisits.length;
      const payableKm = numberValue(attendance?.eligible_km ?? attendance?.total_route_km);
      const petrolAmount = numberValue(attendance?.petrol_amount);
      const exceptions = [];
      if (!attendance) exceptions.push('Not Started');
      if (attendance && !attendance.logout_time) exceptions.push('Missing End Day');
      if (missingEndGps) exceptions.push('Missing End GPS');
      if (openVisits.length) exceptions.push('Open Site Visit');
      if (visitCount > 0 && payableKm <= 0) exceptions.push('Zero KM but visits exist');
      return {
        profile,
        attendance,
        visits: orderedVisits,
        state: normalizeReportState(profile.state),
        employeeCode: code,
        fullName: displayName(profile, code),
        role: text(profile.role),
        business: text(profile.business),
        reportingManager: reportManager(profile),
        branchHead: branchHead(profile),
        startTime: attendance?.login_time || '',
        endTime: attendance?.logout_time || '',
        attendanceStatus: attendanceStatus(attendance),
        siteVisitCount: visitCount,
        firstSite: firstVisitName(orderedVisits),
        lastSite: lastVisitName(orderedVisits),
        payableKm,
        petrolAmount,
        endGpsSource: text(metadataOf(attendance).end_location_source),
        missingEndGps: missingEndGps ? 'Yes' : 'No',
        exceptionRemarks: exceptions.join(', '),
        exceptions,
      };
    });
}

function summarizeRows(rows, reportDate, state = null) {
  return {
    reportDate,
    state,
    totalUsers: rows.length,
    activeToday: rows.filter((row) => row.attendance).length,
    notStarted: rows.filter((row) => !row.attendance).length,
    endedDay: rows.filter((row) => row.attendance?.logout_time).length,
    missingEndDay: rows.filter((row) => row.attendance && !row.attendance.logout_time).length,
    missingEndGps: rows.filter((row) => row.missingEndGps === 'Yes').length,
    siteVisits: rows.reduce((sum, row) => sum + row.siteVisitCount, 0),
    payableKm: Number(rows.reduce((sum, row) => sum + row.payableKm, 0).toFixed(2)),
    petrolAmount: Number(rows.reduce((sum, row) => sum + row.petrolAmount, 0).toFixed(2)),
    exceptions: rows.reduce((sum, row) => sum + row.exceptions.length, 0),
  };
}

function employeeSheetRows(rows) {
  return rows.map((row) => ({
    'Employee Code': row.employeeCode,
    'Full Name': row.fullName,
    Role: row.role,
    Business: row.business,
    'Reporting Manager / Operations Manager': row.reportingManager,
    'Branch Head': row.branchHead,
    'Start Time': row.startTime,
    'End Time': row.endTime,
    'Attendance Status': row.attendanceStatus,
    'Site Visit Count': row.siteVisitCount,
    'First Site': row.firstSite,
    'Last Site': row.lastSite,
    'Payable KM': row.payableKm,
    'Petrol Amount': row.petrolAmount,
    'End GPS Source': row.endGpsSource,
    'Missing End GPS': row.missingEndGps,
    'Exception Remarks': row.exceptionRemarks,
  }));
}

function siteVisitSheetRows(rows, stateFilter = null) {
  const output = [];
  for (const row of rows) {
    if (stateFilter && row.state !== stateFilter) continue;
    for (const visit of row.visits) {
      output.push({
        State: row.state,
        Business: row.business,
        'Employee Code': row.employeeCode,
        'Full Name': row.fullName,
        'Store Name': text(visit.store_name),
        'Client Name': text(visit.client_name),
        'Store Code': text(visit.store_code),
        'Check-In Time': visit.check_in_time || '',
        'Check-Out Time': visit.checkout_time || visit.check_out_time || '',
        'Visit Duration': visit.visit_duration_minutes ?? '',
        'Route KM': numberValue(visit.route_km),
        'Visit Status': text(visit.visit_status || visit.status),
      });
    }
  }
  return output;
}

function exceptionSheetRows(rows, stateFilter = null) {
  const output = [];
  for (const row of rows) {
    if (stateFilter && row.state !== stateFilter) continue;
    for (const issue of row.exceptions) {
      output.push({
        State: row.state,
        Business: row.business,
        'Employee Code': row.employeeCode,
        'Full Name': row.fullName,
        'Issue Type': issue,
        Details: row.exceptionRemarks,
      });
    }
  }
  return output;
}

function appendJsonSheet(workbook, name, rows) {
  const safeRows = rows.length ? rows : [{}];
  const sheet = XLSX.utils.json_to_sheet(safeRows);
  XLSX.utils.book_append_sheet(workbook, sheet, name.slice(0, 31));
}

function buildWorkbook({ dateInput, mode, state, rows }) {
  const workbook = XLSX.utils.book_new();
  const reportDate = dateInput;
  if (mode === 'master') {
    const overall = summarizeRows(rows, reportDate);
    appendJsonSheet(workbook, 'Overall Summary', [{
      'Report Date': overall.reportDate,
      'Total Field Users': overall.totalUsers,
      'Active Today': overall.activeToday,
      'Not Started': overall.notStarted,
      'Ended Day': overall.endedDay,
      'Missing End Day': overall.missingEndDay,
      'Missing End GPS': overall.missingEndGps,
      'Total Site Visits': overall.siteVisits,
      'Payable KM': overall.payableKm,
      'Petrol Amount': overall.petrolAmount,
    }]);
    const summaryStates = rows.some((row) => row.state === 'Unknown')
      ? [...REPORT_STATES, 'Unknown']
      : REPORT_STATES;
    appendJsonSheet(workbook, 'State Summary', summaryStates.map((item) => {
      const summary = summarizeRows(rows.filter((row) => row.state === item), reportDate, item);
      return {
        State: item,
        'Total Users': summary.totalUsers,
        'Active Today': summary.activeToday,
        'Not Started': summary.notStarted,
        'Ended Day': summary.endedDay,
        'Missing End Day': summary.missingEndDay,
        'Missing End GPS': summary.missingEndGps,
        'Site Visits': summary.siteVisits,
        'Payable KM': summary.payableKm,
        'Petrol Amount': summary.petrolAmount,
      };
    }));
    for (const item of REPORT_STATES) {
      appendJsonSheet(workbook, item, employeeSheetRows(rows.filter((row) => row.state === item)));
    }
    appendJsonSheet(workbook, 'Site Visit Details', siteVisitSheetRows(rows));
    appendJsonSheet(workbook, 'Exceptions', exceptionSheetRows(rows));
    return workbook;
  }

  const stateRows = rows.filter((row) => row.state === state);
  const summary = summarizeRows(stateRows, reportDate, state);
  appendJsonSheet(workbook, 'State Summary', [{
    State: state,
    'Total Users': summary.totalUsers,
    'Active Today': summary.activeToday,
    'Not Started': summary.notStarted,
    'Ended Day': summary.endedDay,
    'Missing End Day': summary.missingEndDay,
    'Missing End GPS': summary.missingEndGps,
    'Site Visits': summary.siteVisits,
    'Payable KM': summary.payableKm,
    'Petrol Amount': summary.petrolAmount,
  }]);
  appendJsonSheet(workbook, 'Employee Details', employeeSheetRows(stateRows));
  appendJsonSheet(workbook, 'Site Visit Details', siteVisitSheetRows(stateRows, state));
  appendJsonSheet(workbook, 'Exceptions', exceptionSheetRows(stateRows, state));
  return workbook;
}

function workbookBuffer(workbook) {
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

function masterFilename(dateInput) {
  return `myQPMS_Daily_Operations_Report_All_States_${dateInput}.xlsx`;
}

function stateFilename(state, dateInput) {
  return `myQPMS_Daily_Operations_Report_${state}_${dateInput}.xlsx`;
}

function emailBody({ summary, dateLabel, state = null }) {
  const salutation = state ? 'Dear Sir/Madam,' : 'Dear Sir,';
  const subjectLine = state
    ? `Please find attached the myQPMS Daily Operations Report for ${state} for ${dateLabel}.`
    : `Please find attached the myQPMS Daily Operations Report for all states for ${dateLabel}.`;
  const stateLine = state ? '' : '\nState-wise summary is included in the Excel attachment.\n';
  return `${salutation}

${subjectLine}

Summary:
- Total Field Users: ${summary.totalUsers}
- Active Today: ${summary.activeToday}
- Not Started: ${summary.notStarted}
- Site Visits: ${summary.siteVisits}
- Payable KM: ${summary.payableKm}
- Petrol Amount: ${summary.petrolAmount}
- Exceptions: ${summary.exceptions}
${stateLine}
Regards,
myQPMS System`;
}

export async function generateDailyOperationsReport({ client, date, mode = 'master', state } = {}) {
  if (!client) throw new Error('Supabase client is required.');
  const dateInput = indiaDateInput(date);
  const normalizedState = state ? normalizeReportState(state) : null;
  const data = await loadReportData(client, dateInput);
  const rows = buildEmployeeRows(data);
  const workbook = buildWorkbook({
    dateInput,
    mode: mode === 'state' ? 'state' : 'master',
    state: normalizedState,
    rows,
  });
  const summaryRows = mode === 'state' && normalizedState
    ? rows.filter((row) => row.state === normalizedState)
    : rows;
  const summary = summarizeRows(summaryRows, dateInput, normalizedState);
  const filename = mode === 'state' && normalizedState
    ? stateFilename(normalizedState, dateInput)
    : masterFilename(dateInput);
  return {
    date: dateInput,
    dateLabel: formatReportDate(dateInput),
    mode: mode === 'state' ? 'state' : 'master',
    state: normalizedState,
    filename,
    workbook,
    buffer: workbookBuffer(workbook),
    rows: summaryRows,
    summary,
    sheetNames: workbook.SheetNames,
  };
}

async function branchHeadRecipients(client, state) {
  const override = normalizeRecipients(process.env[`REPORT_BRANCH_HEAD_${state}_EMAIL`]);
  if (override.length) return { recipients: override, source: 'env_override' };
  const { data, error } = await client
    .from('profiles')
    .select('email, full_name, display_name, employee_code, role, state, status, is_active, business')
    .eq('is_active', true)
    .eq('status', 'Active');
  if (error) throw error;
  const recipients = (data || [])
    .filter((profile) => roleKey(profile.role) === 'BRANCHHEAD')
    .filter((profile) => normalizeReportState(profile.state) === state)
    .map((profile) => text(profile.email))
    .filter((email) => email.includes('@'));
  return { recipients: [...new Set(recipients)], source: 'profile' };
}

export async function sendDailyOperationsReports({ client, date, mode = 'all', state, to, cc } = {}) {
  if (String(process.env.REPORT_EMAIL_ENABLED || '').trim().toLowerCase() === 'false') {
    return { ok: false, message: 'Report email is disabled.', results: [] };
  }

  const results = [];
  const dateInput = indiaDateInput(date);

  async function sendMaster() {
    const report = await generateDailyOperationsReport({ client, date: dateInput, mode: 'master' });
    const recipients = normalizeRecipients(to || process.env.REPORT_MASTER_EMAIL_TO);
    const ccRecipients = normalizeRecipients(cc || process.env.REPORT_MASTER_EMAIL_CC);
    const subject = `myQPMS Daily Operations Report - All States - ${report.dateLabel}`;
    const result = await sendEmail({
      to: recipients,
      cc: ccRecipients,
      subject,
      text: emailBody({ summary: report.summary, dateLabel: report.dateLabel }),
      attachments: [{
        filename: report.filename,
        content: report.buffer,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }],
    });
    return { type: 'master', state: null, recipients, cc: ccRecipients, report, email: result };
  }

  async function sendState(targetState) {
    const normalizedState = normalizeReportState(targetState);
    const report = await generateDailyOperationsReport({
      client,
      date: dateInput,
      mode: 'state',
      state: normalizedState,
    });
    const recipients = normalizeRecipients(to);
    const resolvedRecipients = recipients.length
      ? { recipients, source: 'manual' }
      : await branchHeadRecipients(client, normalizedState);
    if (!resolvedRecipients.recipients.length) {
      console.warn(`[myQPMS Daily Report] No active Branch Head email found for ${normalizedState}.`);
      return {
        type: 'state',
        state: normalizedState,
        skipped: true,
        message: `No active Branch Head email found for ${normalizedState}.`,
        report,
      };
    }
    const subject = `myQPMS Daily Operations Report - ${normalizedState} - ${report.dateLabel}`;
    const result = await sendEmail({
      to: resolvedRecipients.recipients,
      subject,
      text: emailBody({ summary: report.summary, dateLabel: report.dateLabel, state: normalizedState }),
      attachments: [{
        filename: report.filename,
        content: report.buffer,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }],
    });
    return {
      type: 'state',
      state: normalizedState,
      recipients: resolvedRecipients.recipients,
      recipientSource: resolvedRecipients.source,
      report,
      email: result,
    };
  }

  if (mode === 'master' || mode === 'all') {
    try {
      results.push(await sendMaster());
    } catch (error) {
      results.push({ type: 'master', ok: false, message: error.message, code: error.code || null });
      if (mode === 'master') throw error;
    }
  }

  if (mode === 'state') {
    results.push(await sendState(state));
  } else if (mode === 'all' && String(process.env.REPORT_BRANCH_HEAD_EMAIL_ENABLED || 'true').toLowerCase() !== 'false') {
    for (const item of REPORT_STATES) {
      try {
        results.push(await sendState(item));
      } catch (error) {
        console.error(`[myQPMS Daily Report] ${item} report failed`, { message: error.message, code: error.code });
        results.push({ type: 'state', state: item, ok: false, message: error.message, code: error.code || null });
      }
    }
  }

  return {
    ok: results.some((result) => result.email?.ok || result.skipped),
    date: dateInput,
    mode,
    results: results.map((result) => ({
      type: result.type,
      state: result.state,
      skipped: result.skipped || false,
      message: result.message || null,
      recipients: result.recipients || [],
      cc: result.cc || [],
      recipientSource: result.recipientSource || null,
      filename: result.report?.filename || null,
      sheetNames: result.report?.sheetNames || [],
      summary: result.report?.summary || null,
      email: result.email || null,
      ok: Boolean(result.email?.ok || result.skipped),
    })),
  };
}
