import { createHash, randomUUID } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import XLSX from 'xlsx';
import { retailAccess, assertRetailAccess } from './relianceRetailManagementService.js';
import { attendanceClass, attendanceCredit, validDate, stateLabel, reportingState, STATE_OPTIONS, storeKey, summarizeAttendance, indiaToday } from '../shared/retailAttendance.js';

export const ATTENDANCE_COLUMNS = Object.freeze({ employee_code: 'EP No', employee_name: 'EP Name', store_code: 'Site Code', attendance_date: 'Att. Date', original_status: 'Att. Status', class: 'Class' });
export function attendanceError(statusCode, message, code = 'retail_attendance_invalid') { return Object.assign(new Error(message), { statusCode, code }); }
export function attendanceAccess(profile, write = false) {
  assertRetailAccess(profile, 'dashboard');
  if (profile.is_active === false || (profile.status && storeKey(profile.status) !== 'ACTIVE')) throw attendanceError(403, 'Active profile required.');
  // Reuse the existing global Retail administrator role mapping, not browser claims.
  const admin = retailAccess({ ...profile, business: '' }).allowed;
  if (write && !admin) throw attendanceError(403, 'Only authorized administrators may upload or correct attendance.');
  const state = admin ? null : stateLabel(profile.state);
  if (!admin && (!state || ['ALL', 'ALL STATES', 'ALLSTATES', 'AP', 'ANDHRA PRADESH'].includes(state))) throw attendanceError(403, 'An unambiguous authorized Retail state is required.');
  return { admin, state };
}

// Check declared ZIP expansion before invoking the existing Excel parser.
export function validateExcelContainer(bytes, filename) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > 10 * 1024 * 1024 || !/\.xlsx$/i.test(filename) || filename.length > 200) throw attendanceError(400, 'Select a non-empty .xlsx file, maximum 10 MB.');
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (bytes.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0) throw attendanceError(400, 'Invalid Excel ZIP container.');
  const entries = bytes.readUInt16LE(end + 10); let offset = bytes.readUInt32LE(end + 16); let expanded = 0;
  if (entries > 2000 || !entries) throw attendanceError(400, 'Workbook has too many ZIP entries.');
  for (let n = 0; n < entries; n++) {
    if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== 0x02014b50) throw attendanceError(400, 'Invalid ZIP directory.');
    const size = bytes.readUInt32LE(offset + 24); expanded += size;
    const length = bytes.readUInt16LE(offset + 28);
    const name = bytes.toString('utf8', offset + 46, offset + 46 + length);
    if (expanded > 60 * 1024 * 1024 || /vbaProject|externalLinks|\.\.\//i.test(name) || bytes.readUInt16LE(offset + 8) & 1) throw attendanceError(400, 'Encrypted, macro, external-link or oversized workbook is not supported.');
    const local = bytes.readUInt32LE(offset + 42); const compressed = bytes.readUInt32LE(offset + 20); const method = bytes.readUInt16LE(offset + 10);
    if (local + 30 > bytes.length || bytes.readUInt32LE(local) !== 0x04034b50 || ![0,8].includes(method) || bytes.readUInt16LE(local + 8) !== method) throw attendanceError(400, 'Unsupported ZIP entry.');
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    if (start + compressed > bytes.length) throw attendanceError(400, 'Truncated ZIP content.');
    try {
      const actual = method === 0 ? bytes.subarray(start,start+compressed) : inflateRawSync(bytes.subarray(start,start+compressed), { maxOutputLength: Math.max(1,size) });
      if (actual.length !== size) throw new Error('ZIP size mismatch');
    } catch { throw attendanceError(400, 'Unsafe or invalid compressed workbook content.'); }
    offset += 46 + length + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
  }
}

export function parseAttendanceWorkbook(bytes, filename) {
  validateExcelContainer(bytes, filename);
  let book;
  try { book = XLSX.read(bytes, { type: 'buffer', cellDates: false, cellFormula: true }); }
  catch { throw attendanceError(400, 'Excel workbook cannot be read.'); }
  const sheets = book.SheetNames.filter(name => {
    const sheet = book.Sheets[name];
    if (!sheet['!ref']) return false;
    const range = XLSX.utils.decode_range(sheet['!ref']);
    if (range.e.r > 50000 || range.e.c > 100) throw attendanceError(400, 'Workbook exceeds 50,000 rows or 101 columns.');
    const headers = XLSX.utils.sheet_to_json(sheet, { header: 1, range: 0, blankrows: false })[0] || [];
    return Object.values(ATTENDANCE_COLUMNS).every(h => headers.filter(v => String(v).trim() === h).length === 1);
  });
  if (sheets.length !== 1) throw attendanceError(400, `Exactly one attendance sheet must have these headers: ${Object.values(ATTENDANCE_COLUMNS).join(', ')}.`);
  const sheet = book.Sheets[sheets[0]];
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: true });
  const indexes = Object.fromEntries(Object.entries(ATTENDANCE_COLUMNS).map(([key, header]) => [key, grid[0].findIndex(v => String(v).trim() === header)]));
  const rows = [];
  for (let index = 1; index < grid.length; index++) {
    const values = grid[index];
    if (values.every(v => v === '')) continue;
    const row = { source_row: index + 1 };
    for (const [key, column] of Object.entries(indexes)) {
      const cell = sheet[XLSX.utils.encode_cell({ r: index, c: column })];
      if (cell?.f) throw attendanceError(400, `Formula in mandatory attendance field at row ${index + 1}.`);
      row[key] = values[column];
      if (key === 'attendance_date' && typeof row[key] === 'number') {
        const date = XLSX.SSF.parse_date_code(row[key], { date1904: !!book.Workbook?.WBProps?.date1904 });
        row[key] = date ? `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}` : '';
      }
    }
    rows.push(row);
  }
  return { sheet: sheets[0], rows };
}

export function validateAttendanceRows(rows, stores) {
  const masters = new Map();
  for (const store of stores) { const code = storeKey(store.store_code); if (masters.has(code)) throw attendanceError(409, 'Duplicate normalized Retail Store Master code.'); masters.set(code, store); }
  const keys = new Map(); const duplicates = new Set();
  for (const r of rows) { const key = `${storeKey(r.employee_code)}:${r.attendance_date}`; if (keys.has(key)) duplicates.add(key); keys.set(key, true); }
  const valid = []; const rejected = [];
  for (const row of rows) {
    const errors = [];
    const store = masters.get(storeKey(row.store_code));
    if (!store) errors.push('Unknown Reliance Retail Store Code');
    if (!storeKey(row.employee_code)) errors.push('Missing Employee Code');
    if (!String(row.employee_name ?? '').trim()) errors.push('Missing Employee Name');
    let kind; let credit;
    try { kind = attendanceClass(row.class); } catch (e) { errors.push(e.message); }
    try { credit = attendanceCredit(row.original_status); } catch (e) { errors.push(e.message); }
    try { validDate(row.attendance_date); } catch (e) { errors.push(e.message); }
    if (typeof row.attendance_date === 'string' && row.attendance_date > indiaToday()) errors.push('Future Attendance Date');
    if (duplicates.has(`${storeKey(row.employee_code)}:${row.attendance_date}`)) errors.push('Duplicate Employee Code / Attendance Date');
    if (errors.length) rejected.push({ source_row: row.source_row, employee_code: storeKey(row.employee_code), store_code: storeKey(row.store_code), attendance_date: String(row.attendance_date ?? ''), original_class: String(row.class ?? ''), original_status: String(row.original_status ?? ''), reasons: errors });
    else valid.push({ employee_code: storeKey(row.employee_code), employee_name: String(row.employee_name).trim(), retail_store_id: store.id, store_code: store.store_code,
      class: kind, original_status: String(row.original_status), credit, attendance_date: row.attendance_date });
  }
  return { valid, rejected };
}

async function data(query) { const result = await query; if (result.error) throw result.error; return result.data; }
async function pages(makeQuery) {
  const rows = [];
  for (let from = 0; from < 100000; from += 1000) {
    const page = await data(makeQuery().range(from, from + 999)); rows.push(...(page || []));
    if (page.length < 1000) return rows;
  }
  throw attendanceError(413, 'Result exceeds the reporting limit. Narrow the selected scope.');
}
async function scopedStores(client, profile, state = '') {
  const scope = attendanceAccess(profile);
  if (state && scope.state && reportingState(state) !== reportingState(scope.state)) throw attendanceError(403, 'State is outside your authorized Retail scope.');
  const stores = await pages(() => client.from('reliance_retail_store_master').select('id,store_code,store_name,state,status').order('id'));
  return stores.filter(s => (!scope.state || stateLabel(s.state) === scope.state) && (!state || reportingState(s.state) === reportingState(state)));
}

export async function previewRetailAttendance(client, profile, bytes, filename) {
  attendanceAccess(profile, true);
  const parsed = parseAttendanceWorkbook(bytes, filename);
  const stores = await scopedStores(client, profile);
  const result = validateAttendanceRows(parsed.rows, stores);
  const checksum = createHash('sha256').update(bytes).digest('hex');
  const existing = await data(client.from('retail_attendance_uploads').select('id,status,uploaded_by,validation_summary').eq('kind', 'attendance').eq('checksum', checksum).maybeSingle());
  if (existing?.status === 'committed') return { ...existing.validation_summary, id: existing.id, idempotent: true, committed: true };
  const conflicts = await data(client.rpc('rpc_retail_attendance_conflicts', { p_rows: result.valid }));
  const dates = [...new Set(result.valid.map(r => r.attendance_date))].sort();
  const summary = { total_rows: parsed.rows.length, valid_rows: result.valid.length, rejected_rows: result.rejected.length, rejected: result.rejected,
    affected_records: conflicts, dates, sheet: parsed.sheet, preview: result.valid.slice(0, 100), can_commit: result.valid.length > 0 && result.rejected.length === 0,
    note: 'Rejected rows block this file. Correct or remove them and preview again. No records have been imported.' };
  const previewKey = randomUUID();
  const batch = { kind: 'attendance', filename, checksum, uploaded_by: profile.id, uploaded_at: new Date().toISOString(), date_from: dates[0] || null, date_to: dates.at(-1) || null,
    total_rows: summary.total_rows, valid_rows: summary.valid_rows, rejected_rows: summary.rejected_rows, validation_summary: { ...summary, preview_key: previewKey },
    payload: result.valid, expected_ids: conflicts.map(row => row.id).sort() };
  const saved = existing ? await data(client.from('retail_attendance_uploads').update(batch).eq('id', existing.id).eq('status', 'preview').select('id').single())
    : await data(client.from('retail_attendance_uploads').insert(batch).select('id').single());
  return { ...summary, id: saved.id, preview_key: previewKey };
}

export async function commitRetailAttendance(client, profile, input) {
  attendanceAccess(profile, true);
  if (typeof input.replace !== 'boolean' || typeof input.preview_key !== 'string') throw attendanceError(400, 'Preview and explicit import/correction confirmation required.');
  return data(client.rpc('rpc_commit_retail_attendance_upload', { p_batch: input.id, p_actor: profile.id, p_replace: input.replace,
    p_reason: String(input.reason || '').trim().slice(0, 500), p_preview_key: input.preview_key }));
}

export async function retailAttendanceReport(client, profile, input = {}) {
  const cutoff = validDate(input.cutoff || indiaToday());
  if (cutoff > indiaToday()) throw attendanceError(400, 'Future attendance cutoff is not supported.');
  if (input.view && !['daily', 'mtd'].includes(input.view)) throw attendanceError(400, 'Invalid attendance view.');
  const scope = attendanceAccess(profile);
  const allStores = await scopedStores(client, profile);
  const states = [...new Set(allStores.map(s => reportingState(s.state)))].filter(s => STATE_OPTIONS.includes(s)).sort();
  const requestedState = input.state ? reportingState(input.state) : '';
  if (requestedState && !STATE_OPTIONS.includes(requestedState)) throw attendanceError(400, 'Invalid reporting state.');
  if (requestedState && scope.state && requestedState !== reportingState(scope.state)) throw attendanceError(403, 'State is outside your authorized scope.');
  const selected = allStores.filter(s => !requestedState || reportingState(s.state) === requestedState);
  const from = input.view === 'daily' ? cutoff : `${cutoff.slice(0, 7)}-01`;
  const source = await data(client.rpc('rpc_retail_attendance_report_source', { p_store_ids: selected.map(s => s.id), p_from: from, p_to: cutoff }));
  const summary = summarizeAttendance({ stores: selected.filter(s => s.status === 'Active' || source.attendance.some(r => r.retail_store_id === s.id) || source.aop.some(r => r.retail_store_id === s.id)),
    attendance: source.attendance, aop: source.aop, cutoff, view: input.view || 'mtd' });
  return { ...summary, available_states: states, latest_imported_date: source.latest_date, can_upload: scope.admin,
    aop_mapping_blocked: 'Budget workbook has conflicting proposed/current/WO and regional sources. Approved sheet, component totals and effective dates must be confirmed before AOP import.' };
}

export async function retailAttendanceEmployees(client, profile, input) {
  const stores = await scopedStores(client, profile);
  const store = stores.find(s => s.id === input.store_id);
  if (!store) throw attendanceError(403, 'Store is outside your authorized scope.');
  const date = validDate(input.date);
  const page = Math.max(0, Number.parseInt(input.page, 10) || 0);
  const rows = await data(client.from('retail_employee_daily_attendance').select('employee_code,employee_name,store_code_snapshot,class,attendance_date,original_status,credit')
    .eq('retail_store_id', input.store_id).eq('attendance_date', date).is('superseded_at', null).order('employee_code').range(page * 100, page * 100 + 100));
  return rows.map(row => ({ ...row, reporting_state: reportingState(store.state), original_geographic_state: store.state }));
}
