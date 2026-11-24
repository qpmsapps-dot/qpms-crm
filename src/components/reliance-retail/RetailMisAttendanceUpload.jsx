import { useRef, useState } from 'react';
import { ATTENDANCE_MAX_FILE_BYTES } from '../../../backend/shared/retailAttendance.js';
import { attendancePendingKey, readPendingAttendance, savePendingAttendance, checkAttendanceCommit, submitAttendanceOnce } from '../../utils/retailAttendanceCommit.js';

export default function RetailMisAttendanceUpload({ request, module, actor, disabled, onCommitted }) {
  const key = attendancePendingKey(actor, module);
  const [pending, setPending] = useState(() => readPendingAttendance(sessionStorage, key));
  const [file, setFile] = useState(null), [preview, setPreview] = useState(null), [confirm, setConfirm] = useState(false);
  const [replace, setReplace] = useState(false), [reason, setReason] = useState(''), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [uncertain, setUncertain] = useState(Boolean(pending));
  const inFlight = useRef(false);
  const inputRef = useRef(null);
  const affected = preview?.affected_record_count;
  function remember(batch) { setPending(batch); savePendingAttendance(sessionStorage, key, batch); }
  function finish() {
    remember(null); setUncertain(false); setPreview(null); setFile(null); setConfirm(false);
    if (inputRef.current) inputRef.current.value = '';
    setNotice('Attendance commit confirmed. The authorized report is being refreshed.'); onCommitted();
  }
  function statusMessage(result) {
    if (result.status === 'committed') { finish(); return; }
    setUncertain(result.writer_busy); setConfirm(false);
    setNotice(result.writer_busy ? 'An attendance writer is still active. Completion is not confirmed. Check status again; do not submit again yet.' : 'Batch is still in preview and no attendance writer was observed. Review the result and explicitly retry, or validate the original workbook again.');
    if (result.failure) setError(result.failure);
  }
  async function validate() {
    if (!file || inFlight.current || uncertain) return;
    inFlight.current = true; setBusy(true); setError(''); setPreview(null); setNotice('Validating the workbook and complete correction scope…');
    try {
      const result = await request(`/attendance/${module}/preview`, { method: 'POST', data: file, headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) } });
      if (result.committed) { finish(); return; }
      if (result.conflict_snapshot_complete !== true || !Number.isSafeInteger(result.affected_record_count)) throw Error('A complete correction preview is required. Contact your administrator.');
      setPreview(result); setConfirm(false); setNotice('Validation complete. Review the full affected-record count before confirming.'); remember(null);
    } catch (e) { setError(e.response?.data?.message || e.message); setNotice('No new correction was confirmed.'); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function commit() {
    if (!preview || !confirm || uncertain || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(''); setUncertain(true); remember(preview); setNotice('Submitting one atomic attendance transaction. Waiting for a confirmed result…');
    try { statusMessage(await submitAttendanceOnce(request, preview, { replace, reason })); }
    catch (e) {
      setError(e.message); setConfirm(false);
      if (e.requires_preview) { setPreview(null); setUncertain(false); remember(null); setNotice('This commit was rejected. Validate the original workbook again for a fresh complete preview.'); }
      else setNotice('Commit outcome is unconfirmed. Check batch status; no automatic resubmission was made.');
    }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function check() {
    if (!pending || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(''); setNotice('Checking the persisted batch status…');
    try { statusMessage(await checkAttendanceCommit(request, pending)); }
    catch (e) { setUncertain(true); setError(e.response?.data?.message || e.message); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <section aria-label="M-Here Attendance import" className="mt-4 rounded-xl border border-blue-100 bg-blue-50/30 p-4">
    <h2 className="font-semibold text-blue-900">M-Here Attendance upload and corrections</h2>
    <label className="mt-3 block">Attendance workbook (.xlsx, up to 15 MB)<input ref={inputRef} aria-label="Attendance workbook" disabled={busy || uncertain || disabled} type="file" accept=".xlsx" onChange={e => {
      const next = e.target.files?.[0]; setPreview(null); setConfirm(false); setError('');
      if (next && (!/\.xlsx$/i.test(next.name) || next.size > ATTENDANCE_MAX_FILE_BYTES || !next.size)) { setFile(null); setError('Select a non-empty .xlsx file, maximum 15 MB.'); } else setFile(next || null);
    }}/></label>
    <button disabled={!file || busy || uncertain || disabled} onClick={validate}>Preview attendance upload</button>
    {notice && <p role="status" className="my-2">{notice}</p>}{error && <p role="alert" className="my-2 text-red-800">{error}</p>}
    {pending && <p className="my-2">Batch: {pending.id} <button disabled={busy || disabled} onClick={check}>Check attendance batch status</button></p>}
    {preview && <><p>{preview.valid_rows} valid; {preview.rejected_rows} rejected. {affected.toLocaleString('en-IN')} affected records in the complete correction snapshot. Original workbook/source audit is retained.</p>
      <div className="overflow-auto"><table><thead><tr>{['Store Code','Employee','Date','Class','Status','Credit'].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{(preview.preview || []).map((r, i) => <tr key={i}>{[r.store_code,r.employee_code,r.attendance_date,r.class,r.original_status,r.credit].map((v, n) => <td key={n}>{v}</td>)}</tr>)}</tbody></table></div>
      <label className="block"><input type="checkbox" disabled={busy || uncertain} checked={replace} onChange={e => setReplace(e.target.checked)}/>This is an explicit correction of existing rows</label>
      <label className="block">Correction reason<input disabled={busy || uncertain} value={reason} maxLength={500} onChange={e => setReason(e.target.value)}/></label>
      <label className="block"><input type="checkbox" disabled={busy || uncertain} checked={confirm} onChange={e => setConfirm(e.target.checked)}/>I reviewed the upload and any corrections.</label>
      <button disabled={busy || uncertain || disabled || !confirm || !preview.can_commit || (affected > 0 && (!replace || !reason.trim()))} onClick={commit}>Commit reviewed attendance</button>
    </>}
  </section>;
}
