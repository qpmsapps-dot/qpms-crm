import { createHash } from 'node:crypto';
import { reconcileSupportedKm, sharedKmReconciliationEnabled, sharedKmPreviewEnabled } from './foKmIncrementalReconciliationService.js';
import { kmError } from './foKmEvidenceService.js';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_PAGE_SIZE = 10;
const PROFILE_PAGE_SIZE = 500;

function validDay(value) {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function normalizedFilter(value, allLabel) {
  const text = String(value || '').trim();
  return !text || text.toLowerCase() === allLabel.toLowerCase() ? null : text;
}

export function validateSupportedBatchSelection(payload = {}) {
  const fromDate = payload.fromDate || payload.from_date || payload.date;
  const toDate = payload.toDate || payload.to_date || payload.date || fromDate;
  if (!validDay(fromDate) || !validDay(toDate) || toDate < fromDate ||
      (Date.parse(toDate) - Date.parse(fromDate)) > 30 * 86400000) {
    throw kmError('KM_BATCH_PERIOD_INVALID', 'Select a valid period of at most 31 days.', 400);
  }
  if (payload.dryRun !== undefined && typeof payload.dryRun !== 'boolean') {
    throw kmError('KM_BATCH_DRY_RUN_INVALID', 'dryRun must be a boolean.', 400);
  }
  const requestedPageSize = payload.batchSize === undefined ? MAX_PAGE_SIZE : Number(payload.batchSize);
  if (!Number.isInteger(requestedPageSize) || requestedPageSize < 1 || requestedPageSize > MAX_PAGE_SIZE) {
    throw kmError('KM_BATCH_SIZE_INVALID', 'Batch size must be between 1 and 10.', 400);
  }
  const state = normalizedFilter(payload.state, 'All States');
  const business = normalizedFilter(payload.business, 'All Business');
  const status = normalizedFilter(payload.status, 'All Status');
  return { fromDate, toDate, state, business, status, pageSize: requestedPageSize, dryRun: payload.dryRun === true };
}

function fingerprint(selection, actorId) {
  return createHash('sha256').update(JSON.stringify([
    actorId, selection.fromDate, selection.toDate, selection.state,
    selection.business, selection.status, selection.dryRun,
  ])).digest('hex');
}

function readCursor(value, fingerprintValue) {
  if (!value) return null;
  try {
    if (typeof value !== 'string' || value.length > 2048) throw Error('invalid');
    const cursor = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!validDay(cursor.date) || !/^[0-9a-f-]{36}$/i.test(cursor.id) ||
        cursor.fingerprint !== fingerprintValue) throw Error('invalid');
    return cursor;
  } catch {
    throw kmError('KM_BATCH_CURSOR_INVALID', 'The batch cursor is invalid or does not match the selected filters.', 400);
  }
}

function writeCursor(row, fingerprintValue) {
  return Buffer.from(JSON.stringify({
    date: row.attendance_date, id: row.id, fingerprint: fingerprintValue,
  }), 'utf8').toString('base64url');
}

function postgrestValues(values) {
  return values.map(value => '"' + String(value).replaceAll('"', '') + '"').join(',');
}

async function loadProfileScope(client, selection) {
  if (!selection.state && !selection.business) return null;
  const profiles = [];
  for (let offset = 0; ; offset += PROFILE_PAGE_SIZE) {
    let query = client.from('profiles').select('id,employee_code,state,business');
    if (selection.state) query = query.eq('state', selection.state);
    if (selection.business) query = query.eq('business', selection.business);
    const { data, error } = await query.order('id').range(offset, offset + PROFILE_PAGE_SIZE - 1);
    if (error) throw error;
    profiles.push(...(data || []));
    if ((data || []).length < PROFILE_PAGE_SIZE) break;
    if (profiles.length >= 10000) throw kmError('KM_BATCH_SCOPE_TOO_LARGE', 'Profile selection exceeds the supported safe batch scope.', 422);
  }
  return {
    profileIds: [...new Set(profiles.map(p => String(p.id || '').trim()).filter(Boolean))],
    employeeCodes: [...new Set(profiles.map(p => String(p.employee_code || '').trim()).filter(Boolean))],
  };
}

export async function runSupportedKmBatch(client, payload, {
  environment = process.env, adminAuthorization, reconcile = reconcileSupportedKm,
} = {}) {
  const selection = validateSupportedBatchSelection(payload);
  if (!adminAuthorization?.userId) throw kmError('KM_ADMIN_REQUIRED', 'Authenticated Admin authorization is required.', 403);
  if (!(selection.dryRun ? sharedKmPreviewEnabled(environment) : sharedKmReconciliationEnabled(environment))) {
    throw kmError('KM_SHARED_RECONCILIATION_INACTIVE', 'Shared KM reconciliation is inactive; no financial work was started.', 503);
  }
  const scopeFingerprint = fingerprint(selection, adminAuthorization.userId);
  const cursor = readCursor(payload.cursor, scopeFingerprint);
  const profileScope = await loadProfileScope(client, selection);
  const empty = {
    fromDate: selection.fromDate, toDate: selection.toDate, mode: selection.dryRun ? 'preview' : 'posting',
    processed: 0, updated: 0, skipped: 0, failed: 0, deferred: 0, previewed: 0,
    creditedKm: 0, creditedAmount: 0, nextCursor: null, done: true, results: [], counters: {},
  };
  if (profileScope && !profileScope.profileIds.length && !profileScope.employeeCodes.length) return empty;

  let query = client.from('fo_attendance')
    .select('id,employee_code,fo_user_id,attendance_date,status,logout_time')
    .gte('attendance_date', selection.fromDate)
    .lte('attendance_date', selection.toDate)
    .not('logout_time', 'is', null)
    .order('attendance_date', { ascending: true })
    .order('id', { ascending: true })
    .limit(selection.pageSize + 1);
  if (cursor) {
    query = query.or('attendance_date.gt.' + cursor.date +
      ',and(attendance_date.eq.' + cursor.date + ',id.gt.' + cursor.id + ')');
  }
  if (payload.employee_code) query = query.eq('employee_code', payload.employee_code);
  if (profileScope) {
    const clauses = [];
    if (profileScope.employeeCodes.length) clauses.push('employee_code.in.(' + postgrestValues(profileScope.employeeCodes) + ')');
    if (profileScope.profileIds.length) clauses.push('fo_user_id.in.(' + postgrestValues(profileScope.profileIds) + ')');
    query = query.or(clauses.join(','));
  }
  // 'Ended' in the FO dashboard represents all completed statuses, not one database literal.
  if (selection.status && selection.status.toUpperCase() !== 'ENDED') query = query.ilike('status', selection.status);
  const { data, error } = await query;
  if (error) throw error;
  const rows = (data || []).slice(0, selection.pageSize);
  const results = [];
  for (const attendance of rows) {
    try {
      const result = await reconcile(client, { attendance_id: attendance.id }, {
        environment, persist: !selection.dryRun, adminAuthorization,
        trigger: 'admin_recalculation', maxGoogleDirectionsCalls: 6, deadlineAt: Date.now() + 20000,
      });
      results.push({
        ...result, attendance_id: attendance.id, employee_code: attendance.employee_code,
        date: attendance.attendance_date,
      });
    } catch (error) {
      results.push({
        attendance_id: attendance.id, employee_code: attendance.employee_code,
        date: attendance.attendance_date, status: 'failed', financial_posted: false,
        code: error.code || 'KM_RECALCULATION_FAILED',
        message: 'Calculation or posting failed; no financial success is assumed.',
      });
    }
  }
  const updated = results.filter(r => r.status === 'posted' && r.financial_posted === true && r.receipt_id).length;
  const failed = results.filter(r => r.status === 'failed').length;
  const deferred = results.filter(r => r.status === 'deferred' || r.status === 'active_closed_windows_only').length;
  const previewed = results.filter(r => r.status === 'calculated_not_posted').length;
  const skipped = results.length - updated - failed - deferred - previewed;
  const creditedKm = Math.round(results.filter(r => r.status === 'posted' && r.receipt_id)
    .reduce((sum, r) => sum + Number(r.additionalKm || 0), 0) * 100) / 100;
  const creditedAmount = Math.round(results.filter(r => r.status === 'posted' && r.receipt_id)
    .reduce((sum, r) => sum + Number(r.additionalAmount || 0), 0) * 100) / 100;
  const nextCursor = (data || []).length > selection.pageSize && rows.length
    ? writeCursor(rows[rows.length - 1], scopeFingerprint) : null;
  return {
    ...empty, processed: results.length, updated, skipped, failed, deferred, previewed,
    creditedKm, creditedAmount, nextCursor, done: !nextCursor,
    results, counters: { posted: updated, unchanged: skipped, deferred, failed, previewed },
  };
}
