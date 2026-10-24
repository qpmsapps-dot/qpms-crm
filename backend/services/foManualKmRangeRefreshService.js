import { randomUUID } from 'node:crypto';
import { createManualKmRefreshService } from './foManualKmRefreshService.js';
import { adminKmApprovalAuthorization } from './foKmRecalculationAuthorizationService.js';
import { assertKmFinancialWritesAvailable } from './kmFinancialWriteMaintenanceService.js';

export const MANUAL_KM_RANGE_MAX_DAYS = 7;
export const MANUAL_KM_RANGE_TTL_MS = 10 * 60 * 1000;
export const MANUAL_KM_RANGE_DIRECTIONS_PER_DAY = 3;

function fail(statusCode, code, message) {
  throw Object.assign(new Error(message), { statusCode, code });
}
function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function manualKmRangeSelection(payload) {
  const employee = String(payload.employee_code || '').trim();
  const start = payload.start_date;
  const end = payload.end_date;
  if (typeof payload.employee_code !== 'string' || !employee || !validDate(start) || !validDate(end) || start > end ||
      ['date', 'date_from', 'date_to', 'from_date', 'to_date', 'attendance_id', 'preview_token'].some(key => payload[key] != null)) {
    fail(400, 'KM_RANGE_SELECTION_REQUIRED', 'Select one employee and valid start and end dates.');
  }
  const count = (Date.parse(end) - Date.parse(start)) / 86400000 + 1;
  if (count > MANUAL_KM_RANGE_MAX_DAYS) {
    fail(400, 'KM_RANGE_LIMIT_EXCEEDED', `Select at most ${MANUAL_KM_RANGE_MAX_DAYS} calendar days.`);
  }
  return { employee, start, end, dates: Array.from({ length: count }, (_, i) =>
    new Date(Date.parse(start) + i * 86400000).toISOString().slice(0, 10)) };
}
const money = value => Math.round((Number(value) || 0) * 100) / 100;
function totals(rows, apply) {
  const eligible = rows.filter(row => row.status === (apply ? 'applied' : 'ready'));
  const sum = callback => money(eligible.reduce((total, row) => total + callback(row), 0));
  return {
    total_days: rows.length, ready: rows.filter(row => row.status === 'ready').length,
    applied: rows.filter(row => row.status === 'applied').length,
    protected: rows.filter(row => row.status === 'protected').length,
    missing: rows.filter(row => row.status === 'missing').length,
    failed: rows.filter(row => row.status === 'failed').length,
    existing_payable_km: sum(row => row.before.payable_km),
    recalculated_payable_km: sum(row => row.after.payable_km),
    existing_route_km: sum(row => row.before.route_km),
    recalculated_route_km: sum(row => row.after.route_km),
    recovered_km: sum(row => row.after.route_km - row.before.route_km),
    payable_km_difference: sum(row => row.after.payable_km - row.before.payable_km),
    payable_amount: sum(row => row.after.amount),
    recovered_amount: sum(row => row.after.amount - row.before.amount),
  };
}
function errorRow(date, error, original = {}) {
  const code = error.code || 'KM_DAY_FAILED';
  return { ...original, date, ok: false,
    status: ['KM_FINANCIAL_STATE_PROTECTED', 'manual_km_financial_state_protected'].includes(code) ? 'protected'
      : code === 'KM_ATTENDANCE_NOT_FOUND' ? 'missing' : 'failed',
    code, error_status: error.statusCode || 503,
    message: error.statusCode ? error.message : 'This attendance could not be recalculated. Retry the same preview if the save outcome is unknown.',
  };
}

// A range is orchestration only. Every write still requires its own reviewed
// single-attendance token and the unchanged Migration 236 transaction.
export function createManualKmRangeRefreshService({ singleAttendance = createManualKmRefreshService({
  ttlMs: MANUAL_KM_RANGE_TTL_MS, maxGoogleDirectionsCalls: MANUAL_KM_RANGE_DIRECTIONS_PER_DAY,
}), now = Date.now, token = randomUUID, maxRanges = 20 } = {}) {
  const ranges = new Map();
  function response(range, rows, apply) {
    const summary = totals(rows, apply);
    const successful = apply ? summary.applied : summary.ready;
    return { ok: true, mode: 'range', dry_run: !apply,
      outcome: successful === rows.length ? 'success' : successful ? 'partial_success' : 'complete_failure',
      employee_code: range.employee, start_date: range.start, end_date: range.end,
      results: rows, summary, expires_in_seconds: Math.max(0, Math.floor((range.expires - now()) / 1000)) };
  }
  return async function manualRange({ client, payload, profile, authUser, environment = process.env }) {
    const reason = String(payload.approval_reason || '').trim();
    if (typeof payload.approval_reason !== 'string' || !reason || reason.length > 1000) fail(400, 'KM_APPROVAL_REASON_REQUIRED', 'Enter an Admin reason of at most 1000 characters.');
    if (!adminKmApprovalAuthorization(profile, authUser, reason)) fail(403, 'KM_ADMIN_REQUIRED', 'An active Admin is required.');
    const selected = manualKmRangeSelection(payload);
    for (const [key, value] of ranges) if (!value.running && value.expires <= now()) ranges.delete(key);
    const apply = payload.dry_run !== true;
    let range;
    if (apply) {
      range = ranges.get(payload.range_token);
      if (!range || range.userId !== authUser.id || range.employee !== selected.employee ||
          range.start !== selected.start || range.end !== selected.end || range.reason !== reason || range.expires <= now()) {
        fail(409, 'KM_RANGE_PREVIEW_REQUIRED', 'Preview this exact employee, date range and reason again.');
      }
      assertKmFinancialWritesAvailable({ environment, authorizedAdminAction: true });
      if (range.running) fail(409, 'KM_RANGE_ALREADY_RUNNING', 'This reviewed range is already being applied.');
      range.running = true;
    } else {
      if (ranges.size >= maxRanges) fail(429, 'KM_RANGE_CAPACITY', 'Too many reviewed ranges. Retry shortly.');
      range = { ...selected, reason, userId: authUser.id, expires: now() + MANUAL_KM_RANGE_TTL_MS, days: [], running: true };
      // Reserve capacity before awaiting calculations, including concurrent previews.
      ranges.set(token(), range);
    }
    try {
      if (!apply) {
        for (const date of range.dates) {
          try {
            const preview = await singleAttendance({ client, profile, authUser, environment,
              payload: { manual_refresh: true, employee_code: range.employee, date, approval_reason: reason, dry_run: true } });
            if (preview.read_only === true || preview.financial_eligible === false || !preview.preview_token) {
              range.days.push({ date, row: { ...preview, preview_token: undefined,
                status: preview.code === 'KM_FINANCIAL_STATE_PROTECTED' ? 'protected' : 'failed',
                recovered_km: 0, payable_km_difference: 0, recovered_amount: 0 } });
              continue;
            }
            const day = { date, preview, row: { ...preview, preview_token: undefined, status: 'ready',
              recovered_km: money(preview.after.route_km - preview.before.route_km),
              payable_km_difference: money(preview.after.payable_km - preview.before.payable_km),
              recovered_amount: money(preview.after.amount - preview.before.amount) } };
            range.days.push(day);
          } catch (error) {
            const row = errorRow(date, error);
            if (error.statusCode !== 403) {
              // Admin authorization already succeeded, and only the exact scoped
              // employee/date can contribute existing totals to a failed row.
              try {
                const result = await client.from('fo_attendance').select('id,total_route_km,total_approved_km,petrol_amount')
                  .eq('employee_code', range.employee).eq('attendance_date', date).maybeSingle();
                if (!result.error && result.data) row.before = { route_km: Number(result.data.total_route_km || 0),
                  payable_km: Number(result.data.total_approved_km || 0), amount: Number(result.data.petrol_amount || 0) };
              } catch { /* Preserve the original per-day error, without inventing values. */ }
            }
            range.days.push({ date, row });
          }
        }
        if (range.expires <= now()) fail(409, 'KM_RANGE_PREVIEW_EXPIRED', 'Preview took too long. Select fewer dates and preview again.');
        const key = [...ranges].find(([, value]) => value === range)[0];
        return { ...response(range, range.days.map(day => day.row), false), range_token: key };
      }
      const rows = [];
      for (const day of range.days) {
        if (day.receipt) {
          rows.push({ ...day.receipt, idempotent_replay: true });
        } else if (!day.preview) {
          rows.push(day.row); // Failed/protected previews are never financial candidates.
        } else {
          try {
            const receipt = await singleAttendance({ client, profile, authUser, environment,
              payload: { manual_refresh: true, employee_code: range.employee, date: day.date,
                approval_reason: reason, dry_run: false, attendance_id: day.preview.attendance_id,
                preview_token: day.preview.preview_token } });
            day.receipt = { ...day.row, ...receipt, ok: true, status: 'applied' };
            rows.push(day.receipt);
          } catch (error) { rows.push(errorRow(day.date, error, day.row)); }
        }
      }
      return response(range, rows, true);
    } finally { range.running = false; }
  };
}
