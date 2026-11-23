import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import XLSX from 'xlsx';
import express from 'express';
import { attendanceTimeSource, attendanceSeconds, classifyAttendanceException, summarizeAttendanceExceptions } from '../shared/retailAttendanceExceptions.js';
import { parseAttendanceWorkbook, validateAttendanceRows, ATTENDANCE_COLUMNS, retailAttendanceExceptions } from '../services/retailAttendanceService.js';
import { parseAttendanceWorkbookStreaming } from '../services/retailAttendanceXlsx.js';
import { createRetailAttendanceRouter } from '../routes/retailAttendanceRoutes.js';
import { hydrateAttendanceExceptionTimes } from '../services/retailAttendanceExceptionSource.js';
import { encodeAttendanceSource } from '../services/retailAttendancePreviewAudit.js';
import { exceptionExportRows, attendanceExceptionWorkbook } from '../../src/utils/retailAttendanceExceptionsExport.js';
const times = (a = '09:00:00', b = '18:00:00', c = '9:00:00') => attendanceTimeSource(['In Time', 'Out Time', 'Man Hours'], [a, b, c]);
const row = { employee_code: '0001', employee_name: 'Synthetic employee', retail_store_id: 's1', store_code_snapshot: '001', class: 'HK', attendance_date: '2026-11-21', original_status: 'P', time_source: times() };
const scope = { from: row.attendance_date, to: row.attendance_date, classes: ['HK'] };
test('strict Excel day fractions, durations, AM/PM, midnight and overnight shifts', () => {
  assert.equal(attendanceSeconds(0).seconds, 0);
  assert.equal(attendanceSeconds(8 / 24, true).seconds, 28800);
  assert.equal(attendanceSeconds(1.25, true).seconds, 108000);
  assert.equal(attendanceSeconds('12:00:00 AM').seconds, 0);
  assert.equal(attendanceSeconds('12:00 PM').seconds, 43200);
  for (const raw of [-1, 45251.5, NaN, Infinity, true, '8.5', '09:60:00', '24:00:00', 'invalid']) assert.equal(attendanceSeconds(raw).invalid, true);
  const overnight = classifyAttendanceException(times('22:00:00', '06:00:00', '8:00:00'));
  assert.equal(overnight.below_9_hours, true); assert.deepEqual(overnight.issues, []);
  assert.equal(classifyAttendanceException(times(0, 8 / 24, 8 / 24)).below_9_hours, true);
});
test('exceptions are mutually exclusive, exclude no punches and keep discrepancies separate', () => {
  assert.equal(classifyAttendanceException(times('09:00:00', '', '0:00:00')).missing_checkout, true);
  assert.equal(classifyAttendanceException(times('09:00:00', '', '0:00:00')).below_9_hours, false);
  assert.equal(classifyAttendanceException(times('', '', '0:00:00')).below_9_hours, false);
  assert.equal(classifyAttendanceException(times('09:00:00', '18:00:00', '9:00:00')).below_9_hours, false);
  const bad = classifyAttendanceException(times('09:00:00', '18:00:00', 'bad'));
  assert.equal(bad.below_available, false); assert.equal(bad.below_9_hours, false);
  const disputed = classifyAttendanceException(times('04:57:28', '15:51:30', '6:44:36'));
  assert.equal(disputed.below_9_hours, true); assert.deepEqual(disputed.issues, ['Punch duration differs from Man Hours']);
  assert.equal(classifyAttendanceException(times('', '18:00:00', '0:00:00')).below_available, false);
  assert.equal(classifyAttendanceException(times('09:00:00', '18:00:00', '')).below_available, false);
});
test('legacy fields, formulas and duplicate headers fail closed without changing credit eligibility', () => {
  assert.equal(classifyAttendanceException(null).missing_available, false);
  assert.equal(classifyAttendanceException(attendanceTimeSource(['In Time', 'In Time', 'Out Time', 'Man Hours'], ['', '', '', ''])).missing_available, false);
  const source = attendanceTimeSource(['In Time', 'Out Time', 'Man Hours'], ['09:00:00', '17:00:00', '8:00:00'], { 2: '1/3' });
  assert.equal(classifyAttendanceException(source).below_available, false);
  const record = { source_row: 2, employee_code: '0001', employee_name: 'Fixture', store_code: '001', attendance_date: row.attendance_date, original_status: 'P', class: 'House Keeping', time_source: source };
  const stores = [{ id: 's1', store_code: '001' }];
  assert.equal(validateAttendanceRows([record], stores).valid[0].credit, 1);
  assert.equal(validateAttendanceRows([record, record], stores).valid.length, 0);
});
test('daily/MTD, duplicates, supersession and unavailable coverage never imply absence or false zero', () => {
  const missing = { ...row, time_source: times('09:00:00', '', '0:00:00') };
  let report = summarizeAttendanceExceptions([missing, missing, { ...missing, superseded_at: '2026-11-22' }], scope);
  assert.equal(report.missing_checkout, 1); assert.equal(report.details.length, 1);
  report = summarizeAttendanceExceptions([{ ...missing, superseded_at: 'now' }, row], scope);
  assert.equal(report.missing_checkout, 0); assert.equal(report.below_9_hours, 0);
  report = summarizeAttendanceExceptions([{ ...row, time_source: undefined }], scope);
  assert.equal(report.missing_checkout, null);
  report = summarizeAttendanceExceptions([missing], { ...scope, from: '2026-11-01' });
  assert.equal(report.missing_checkout, null); assert.equal(report.categories.HK.known_missing_checkout, 1);
  report = summarizeAttendanceExceptions([missing, { ...missing, attendance_date: '2026-11-20' }], { ...scope, from: '2026-11-20' });
  assert.equal(report.missing_checkout, 2);
  assert.equal(summarizeAttendanceExceptions([], scope).missing_checkout, null);
});
test('redacted original 21 November rows pass both parsers: HK25/57, MEPC13/3, total38/60; no credit changes', async () => {
  const fixture = JSON.parse(readFileSync(new URL('fixtures/retailAttendanceTimesNov21.json', import.meta.url)));
  const headers = ['EP No', 'EP Name', 'Site Code', 'Att. Date', 'Att. Status', 'Class', 'In Time', 'Out Time', 'Man Hours'];
  const data = fixture.rows.map(([kind, a, b, c, status], i) => [`SYN${i}`, 'Redacted employee', '0001', fixture.date, status, kind, a, b, c]);
  const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([headers, ...data]), 'Reference');
  const bytes = XLSX.write(book, { type: 'buffer', bookType: 'xlsx', compression: true });
  const sync = parseAttendanceWorkbook(bytes, 'arbitrary.xlsx'), stream = await parseAttendanceWorkbookStreaming(bytes, 'arbitrary.xlsx', ATTENDANCE_COLUMNS);
  assert.deepEqual(stream.rows, sync.rows);
  const valid = validateAttendanceRows(stream.rows, [{ id: 's1', store_code: '0001' }]);
  assert.equal(valid.excluded.length, 1); assert.equal(valid.rejected.length, 0);
  const report = summarizeAttendanceExceptions(valid.valid, { ...scope, classes: ['HK', 'MEPC'] });
  assert.deepEqual([report.categories.HK.missing_checkout, report.categories.HK.below_9_hours, report.categories.MEPC.missing_checkout, report.categories.MEPC.below_9_hours], [25, 57, 13, 3]);
  assert.equal(report.missing_checkout, 38); assert.equal(report.below_9_hours, 60); assert.equal(report.flagged_records, 1);
  const withoutTimes = rows => rows.map(r => { const copy = { ...r }; delete copy.time_source; return copy; });
  const old = validateAttendanceRows(withoutTimes(stream.rows), [{ id: 's1', store_code: '0001' }]);
  assert.deepEqual(withoutTimes(valid.valid), old.valid);
});

const admin = { id: 'admin', role: 'Admin', status: 'Active', is_active: true };
const stores = [{ id: 's1', store_code: '001', store_name: 'Synthetic TN', state: 'TN' }, { id: 's2', store_code: '002', store_name: 'Synthetic AP1', state: 'AP-1' }];
function clientFixture() {
  const calls = [];
  return { calls, from() { return { select() { return this; }, order() { return this; }, async range() { return { data: stores }; } }; },
    async rpc(name, args) { calls.push([name, args]); return { data: args.p_store_ids.includes('s1') ? [row] : [] }; } };
}
test('scoped backend endpoint denies unauthorized users, foreign states, classes and malformed periods', async () => {
  const client = clientFixture();
  const result = await retailAttendanceExceptions(client, admin, { cutoff: row.attendance_date, view: 'daily', state: 'TN' });
  assert.equal(result.categories.HK.missing_checkout, 0); assert.equal(result.missing_checkout, null); assert.deepEqual(client.calls[0][1].p_store_ids, ['s1']);
  await assert.rejects(() => retailAttendanceExceptions(client, { ...admin, role: 'FO', business: 'Other' }, { cutoff: row.attendance_date }), { statusCode: 403 });
  await assert.rejects(() => retailAttendanceExceptions(client, admin, { cutoff: 'not-date' }), { statusCode: 400 });
  await assert.rejects(() => retailAttendanceExceptions(client, admin, { cutoff: '2099-01-01' }), { statusCode: 400 });
  await assert.rejects(() => retailAttendanceExceptions(client, admin, { cutoff: row.attendance_date, state: 'AP-2' }), { statusCode: 403 });
  await assert.rejects(() => retailAttendanceExceptions(client, admin, { cutoff: row.attendance_date, view: 'year' }), { statusCode: 400 });
  const forged = clientFixture(); forged.rpc = async () => ({ data: [{ ...row, retail_store_id: 's2' }] });
  await assert.rejects(() => retailAttendanceExceptions(forged, admin, { cutoff: row.attendance_date, state: 'TN' }), { statusCode: 502 });
});
test('router uses existing access guard; no unauthenticated or inactive exception reads', async () => {
  const app = express(); let profile = admin;
  app.use((req, res, next) => { req.profile = profile; next(); });
  app.use(createRetailAttendanceRouter({ getClient: clientFixture, environment: { RETAIL_ATTENDANCE_ENABLED: 'true' } }));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const url = `http://127.0.0.1:${server.address().port}/exceptions?cutoff=2026-11-21&view=daily&state=TN`;
    assert.equal((await fetch(url)).status, 200);
    profile = null; assert.equal((await fetch(url)).status, 401);
    profile = { ...admin, is_active: false }; assert.equal((await fetch(url)).status, 403);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
test('effective state grants and MIS class assignments constrain exceptions without changing access', async () => {
  const leader = { ...admin, role: 'Branch Head', employee_code: 'SYN-BH', auth_user_id: 'synthetic-auth', business: 'Reliance Retail', state: 'TN', web_access_enabled: true, _retailRoleStates: ['TN'] };
  const client = clientFixture();
  await retailAttendanceExceptions(client, leader, { cutoff: row.attendance_date, view: 'daily' });
  assert.deepEqual(client.calls[0][1].p_store_ids, ['s1']);
  await assert.rejects(() => retailAttendanceExceptions(client, leader, { cutoff: row.attendance_date, state: 'AP-1' }), { statusCode: 403 });
  await assert.rejects(() => retailAttendanceExceptions(client, { ...leader, business: 'Other Business' }, { cutoff: row.attendance_date }), { statusCode: 403 });
  await assert.rejects(() => retailAttendanceExceptions(client, { ...leader, _retailRoleStates: undefined }, { cutoff: row.attendance_date }), { statusCode: 403 });
  const mis = { ...admin, role: 'MIS_HK', _retailMis: { role: 'MIS_HK', states: ['TN'], active: true }, _retailMisModule: 'attendance-hk' };
  const m = clientFixture(); await retailAttendanceExceptions(m, mis, { cutoff: row.attendance_date, view: 'daily', class: 'MEPC' });
  assert.deepEqual(m.calls[0][1].p_classes, ['HK']); assert.deepEqual(m.calls[0][1].p_store_ids, ['s1']);
  await assert.rejects(() => retailAttendanceExceptions(m, { ...mis, _retailMisModule: 'thermography' }, { cutoff: row.attendance_date }), { statusCode: 403 });
});
test('Excel export round-trip preserves employee identity, raw status, numeric times and N/A', async () => {
  const r = { ...row, employee_name: '=NOT_A_FORMULA()', state: 'TN', source_state: 'TN', store_name: 'Synthetic', time_source: times(0, 8 / 24, 8 / 24), ...classifyAttendanceException(times(0, 8 / 24, 8 / 24)) };
  assert.deepEqual(exceptionExportRows([r])[1].slice(7, 10), ['00:00:00', '08:00:00', '08:00:00']);
  const report = { ...scope, view: 'daily', note: 'Synthetic unavailable coverage', missing_checkout: null, below_9_hours: 1 };
  const bytes = await attendanceExceptionWorkbook(report, [r]);
  const book = XLSX.read(bytes, { type: 'buffer' }), sheet = book.Sheets['Attendance exceptions'];
  assert.equal(sheet.A5.v, '0001'); assert.equal(sheet.B5.v, '=NOT_A_FORMULA()'); assert.equal(sheet.B5.f, undefined);
  assert.equal(sheet.B2.v, 'N/A'); assert.equal(sheet.K5.v, 'P');
});
test('legacy committed archives recover only exact authorized current identities, with hash and resource checks', async () => {
  const original = { source_row: 2, employee_code: '0001', store_code: '001', class: 'House Keeping', attendance_date: row.attendance_date, original_status: 'P', raw_cells: ['09:00:00', '', '0:00:00'], raw_formulas: {} };
  const archive = await encodeAttendanceSource({ headers: ['In Time', 'Out Time', 'Man Hours'], rows: [original] });
  let source = archive, reads = 0;
  const client = { from(table) {
    assert.equal(table, 'retail_attendance_uploads');
    const filters = {};
    return { select(columns) { assert.equal(columns, 'id,kind,status,raw_source'); return this; }, eq(k, v) { filters[k] = v; return this; }, async maybeSingle() {
      reads++; assert.deepEqual(filters, { id: 'b1', kind: 'attendance', status: 'committed' });
      return { data: { id: 'b1', kind: 'attendance', status: 'committed', raw_source: source } };
    } };
  } };
  const legacy = { ...row, batch_id: 'b1', source_row: 2, time_source: null };
  const recovered = await hydrateAttendanceExceptionTimes(client, [legacy]);
  assert.equal(classifyAttendanceException(recovered[0].time_source).missing_checkout, true);
  assert.equal(legacy.time_source, null); assert.equal(reads, 1);
  for (const changed of [{ employee_code: 'OTHER' }, { store_code_snapshot: 'OTHER' }, { attendance_date: '2026-11-20' }, { class: 'MEPC' }, { source_row: 3 }, { original_status: 'A' }]) {
    const out = await hydrateAttendanceExceptionTimes(client, [{ ...legacy, ...changed }]);
    assert.equal(out[0].time_source, null); assert.match(out[0].time_source_issue, /identity mismatch/);
  }
  const before = reads; await hydrateAttendanceExceptionTimes(client, [row]); assert.equal(reads, before);
  source = { headers: [], rows: [original] }; assert.equal((await hydrateAttendanceExceptionTimes(client, [legacy]))[0].time_source, undefined);
  source = { ...archive, sha256: '0'.repeat(64) }; await assert.rejects(() => hydrateAttendanceExceptionTimes(client, [legacy]), /cannot be read safely/);
  source = { ...archive, uncompressed_bytes: 300 * 1024 * 1024 }; await assert.rejects(() => hydrateAttendanceExceptionTimes(client, [legacy]), { statusCode: 413 });
});
