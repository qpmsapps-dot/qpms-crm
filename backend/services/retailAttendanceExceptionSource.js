import { decodeAttendanceSource } from './retailAttendancePreviewAudit.js';
import { attendanceTimeSource } from '../shared/retailAttendanceExceptions.js';
import { attendanceClass, storeKey } from '../shared/retailAttendance.js';

// Read only: no enrichment/backfill writes. Old committed payloads deliberately
// remain immutable. Decode only batches referenced by already-authorized rows;
// return only the three time fields of identity-verified current source rows.
export async function hydrateAttendanceExceptionTimes(client, rows) {
  const missing = rows.filter(r => r.time_source?.version !== 1), batches = [...new Set(missing.map(r => r.batch_id))];
  if (batches.length > 128) throw Object.assign(new Error('Too many source archives. Narrow the exception reporting period.'), { statusCode: 413 });
  const recovered = new Map(); let decodedBytes = 0;
  for (const id of batches) {
    const result = await client.from('retail_attendance_uploads').select('id,kind,status,raw_source').eq('id', id).eq('kind', 'attendance').eq('status', 'committed').maybeSingle();
    if (result.error) throw result.error;
    const batch = result.data;
    if (!batch || batch.id !== id || batch.kind !== 'attendance' || batch.status !== 'committed') throw Object.assign(new Error('Committed attendance source is unavailable.'), { statusCode: 502 });
    decodedBytes += batch.raw_source?.encoding ? batch.raw_source.uncompressed_bytes : Buffer.byteLength(JSON.stringify(batch.raw_source || {}));
    if (!Number.isSafeInteger(decodedBytes) || decodedBytes > 256 * 1024 * 1024) throw Object.assign(new Error('Source archives exceed the safe exception report budget. Narrow the reporting period.'), { statusCode: 413 });
    const archive = await decodeAttendanceSource(batch.raw_source);
    if (!archive?.headers || !archive?.rows) continue;
    if (!Array.isArray(archive.headers) || archive.headers.length > 101 || !Array.isArray(archive.rows) || archive.rows.length > 100000) throw Object.assign(new Error('Invalid attendance source archive.'), { statusCode: 502 });
    const bySource = new Map();
    for (const source of archive.rows) {
      if (bySource.has(source.source_row)) throw Object.assign(new Error('Ambiguous attendance source row.'), { statusCode: 502 });
      bySource.set(source.source_row, source);
    }
    for (const row of missing.filter(r => r.batch_id === id)) {
      const original = bySource.get(row.source_row); let kind;
      try { kind = attendanceClass(original?.class); } catch { /* Missing/unsupported source never becomes attendance. */ }
      if (!original || storeKey(original.employee_code) !== row.employee_code || storeKey(original.store_code) !== storeKey(row.store_code_snapshot)
        || original.attendance_date !== row.attendance_date || kind !== row.class || String(original.original_status) !== row.original_status || !Array.isArray(original.raw_cells)) {
        recovered.set(row, { time_source: null, time_source_issue: 'Stored source identity mismatch; time data unavailable' }); continue;
      }
      recovered.set(row, { time_source: attendanceTimeSource(archive.headers, original.raw_cells, original.raw_formulas || {}) });
    }
  }
  return rows.map(row => recovered.has(row) ? { ...row, ...recovered.get(row) } : row);
}
