import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import express from 'express';
import XLSX from 'xlsx';
import { ATTENDANCE_MAX_FILE_BYTES } from '../shared/retailAttendance.js';
import { createRetailAttendanceRouter } from '../routes/retailAttendanceRoutes.js';
import { parseAttendanceWorkbook, validateExcelContainer } from '../services/retailAttendanceService.js';
import {decodeAttendanceSource} from '../services/retailAttendancePreviewAudit.js';

// Real, uncompressed XLSX source cells, all below Excel's 32,767-character cell limit.
// No appended junk, fake ZIP lengths, external links or relaxed expansion limits.
function sizedWorkbook(size) {
  const rows = Array.from({ length: 512 }, (_, i) => [`SIZE${i}`, 'Upload size fixture', 'S1', '2026-10-01', 'P', 'House Keeping', '']);
  const book = XLSX.utils.book_new();
  const makeSheet = () => XLSX.utils.aoa_to_sheet([['EP No', 'EP Name', 'Site Code', 'Att. Date', 'Att. Status', 'Class', 'Source evidence'], ...rows]);
  XLSX.utils.book_append_sheet(book, makeSheet(), 'Attendance');
  const write = () => XLSX.write(book, { type: 'buffer', bookType: 'xlsx', compression: false });
  const remaining = size - write().length;
  const perCell = Math.floor(remaining / rows.length);
  assert.ok(perCell > 0 && perCell + 1 <= 32767);
  for (let i = 0; i < rows.length; i++) rows[i][6] = 'x'.repeat(perCell + (i < remaining % rows.length ? 1 : 0));
  book.Sheets.Attendance = makeSheet();
  const bytes = write();
  assert.equal(bytes.length, size, 'Fixture must have the exact documented byte size');
  return bytes;
}

async function serverForPreview(run) {
  const state = { batch: null, reads: 0, commits: 0 };
  const stores = [{ id: 'store-size-fixture', store_code: 'S1', store_name: 'Size fixture', state: 'TN', status: 'Active' }];
  const db = {
    from(table) {
      state.reads++;
      const q = {
        select() { return q; }, order() { return q; }, eq() { return q; },
        range: async () => ({ data: stores }), maybeSingle: async () => ({ data: null }),
        insert(batch) { state.batch = batch; return q; },
        single: async () => ({ data: { id: 'size-preview' } }),
      };
      assert.ok(['reliance_retail_store_master', 'retail_attendance_uploads'].includes(table));
      return q;
    },
    async rpc(name, input) {
      if (name === 'rpc_retail_attendance_conflicts') return { data: [] };
      assert.equal(name, 'rpc_commit_retail_attendance_upload');
      assert.equal(input.p_batch, 'size-preview');
      assert.equal(input.p_preview_key, state.batch.validation_summary.preview_key);
      assert.equal(input.p_replace, false);
      assert.equal((await decodeAttendanceSource(state.batch.raw_source)).rows.length, 512);
      assert.equal(state.batch.payload.reduce((sum, row) => sum + row.credit, 0), 512);
      state.commits++;
      return { data: 'size-preview' };
    },
  };
  const app = express();
  // The unchanged global JSON middleware must not constrain the binary workbook body.
  app.use(express.json({ limit: '10mb' }));
  app.use((req, _res, next) => { req.profile = { id: 'admin-size-fixture', role: 'Admin', is_active: true }; next(); });
  app.use('/attendance', createRetailAttendanceRouter({ getClient: () => db, environment: { RETAIL_ATTENDANCE_ENABLED: 'true' } }));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}/attendance`, state); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

for (const mib of [12, 15]) {
  test(`${mib} MiB real Excel previews, retains source audit and reaches commit without resending workbook`, async () => {
    const bytes = sizedWorkbook(mib * 1024 * 1024);
    await serverForPreview(async (base, state) => {
      const response = await fetch(base + '/preview', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': 'size.xlsx' }, body: bytes });
      assert.equal(response.status, 200);
      const { preview } = await response.json();
      assert.equal(preview.valid_rows, 512);
      assert.equal(preview.rejected_rows, 0);
      assert.equal(preview.can_commit, true);
      assert.equal(state.batch.checksum, createHash('sha256').update(bytes).digest('hex'));
      const retained=await decodeAttendanceSource(state.batch.raw_source);
      assert.equal(retained.rows[0].raw_cells[6].length, retained.rows[1].raw_cells[6].length);
      const commit = await fetch(base + '/commit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: preview.id, preview_key: preview.preview_key, replace: false }) });
      assert.equal(commit.status, 200);
      assert.equal((await commit.json()).batch_id, 'size-preview');
      assert.equal(state.commits, 1);
    });
  });
}

test('15 MiB + one byte is rejected before parsing/audit writes, including chunked bodies', async () => {
  assert.equal(ATTENDANCE_MAX_FILE_BYTES, 15728640);
  const bytes = Buffer.alloc(ATTENDANCE_MAX_FILE_BYTES + 1);
  assert.throws(() => validateExcelContainer(bytes, 'oversize.xlsx'), /maximum 15 MB/);
  await serverForPreview(async (base, state) => {
    for (const chunked of [false, true]) {
      const body = chunked ? (async function* () { for (let i = 0; i < bytes.length; i += 65536) yield bytes.subarray(i, i + 65536); })() : bytes;
      const response = await fetch(base + '/preview', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': 'oversize.xlsx' }, body, ...(chunked ? { duplex: 'half' } : {}) });
      assert.equal(response.status, 413);
      assert.match((await response.json()).message, /maximum 15 MB/);
    }
    assert.equal(state.reads, 0);
    assert.equal(state.batch, null);
  });
});

test('invalid Excel remains rejected with no audit write', async () => {
  assert.throws(() => parseAttendanceWorkbook(Buffer.from('not Excel'), 'bad.xlsx'), /Invalid Excel ZIP/);
  await serverForPreview(async (base, state) => {
    const response = await fetch(base + '/preview', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': 'bad.xlsx' }, body: Buffer.from('not Excel') });
    assert.equal(response.status, 400);
    assert.equal(state.reads, 0);
    assert.equal(state.batch, null);
  });
});
