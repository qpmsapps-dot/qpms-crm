import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { authenticatedFetch } from '../services/api.js';

function RangeResults({ result }) {
  const format = value => value == null ? '—' : Number(value).toFixed(2);
  return <section aria-label="Per-date KM results" className="my-4">
    <p className="my-2 text-sm">{result.dry_run ? 'Eligible preview totals' : 'Committed date totals'}: recovered KM <strong>{format(result.summary.recovered_km)}</strong> · payable amount <strong>₹{format(result.summary.payable_amount)}</strong> · amount difference ₹{format(result.summary.recovered_amount)}</p>
    <p className="my-2 text-sm">Ready: {result.summary.ready} · Saved: {result.summary.applied} · Protected: {result.summary.protected} · No attendance: {result.summary.missing} · Failed: {result.summary.failed}</p>
    <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr>
      {['Date', 'Existing route KM', 'Recalculated route KM', 'Recovered KM', 'Payable KM', 'Existing ₹', 'Payable ₹', 'Difference ₹', 'Result'].map(label => <th key={label} className="p-2">{label}</th>)}
    </tr></thead><tbody>{result.results.map(row => <tr key={row.date}>
      <th className="whitespace-nowrap p-2">{row.date}</th><td className="p-2">{format(row.before?.route_km)}</td>
      <td className="p-2">{format(row.after?.route_km)}</td><td className="p-2">{format(row.recovered_km)}</td><td className="p-2">{format(row.after?.payable_km)}</td>
      <td className="p-2">{format(row.before?.amount)}</td><td className="p-2">{format(row.after?.amount)}</td><td className="p-2">{format(row.recovered_amount)}</td>
      <td className="min-w-48 p-2"><strong>{row.status}</strong>{row.message ? <p>{row.message} ({row.code})</p> : null}
        {row.final_leg ? <p>Last Checkout → End Day: {format(row.final_leg.km)} km · {row.final_leg.source || row.final_leg.status}</p> : null}
        {row.final_leg?.checkout_eligibility ? <FinalLegEvidence leg={row.final_leg} /> : null}
        {row.calculation_run_id ? <p>Receipt: {row.calculation_run_id}</p> : null}</td>
    </tr>)}</tbody></table></div>
    {!result.dry_run ? <p className="my-2 text-sm">Only dates with saved receipts contribute to totals. Other figures are proposed values; failed saves may require receipt verification.</p> : null}
  </section>;
}

function FinalLegEvidence({ leg }) {
  const format = value => value == null ? 'Unavailable' : Number(value).toFixed(2);
  const comparison = leg.origin_comparison;
  const checkout = leg.checkout_eligibility;
  return <section aria-label="Final leg evidence" className="my-2 text-sm">
    {comparison ? <>
      <p>Policy-selected recorded checkout distance: {format(comparison.recorded_checkout_km)} km.</p>
      {comparison.materially_different_origins ? <p>Site/check-in origin comparison: {format(comparison.site_origin_km)} km ({comparison.site_origin_source || comparison.site_origin_status}). Origins differ by {comparison.origin_offset_meters} m. Comparison only; not added to totals. Driving fallback can differ from the Google Maps motorcycle route.</p> : null}
      <p>{comparison.policy_reason}</p>
    </> : null}
    <p>GPS quality: {leg.valid_points ?? 'Unknown'} valid / {leg.gps_log_count ?? 'Unknown'} recorded points; filtered GPS {format(leg.filtered_gps_km)} km. Rejections: {Object.entries(leg.rejected_point_reasons || {}).map(([reason, count]) => `${reason}: ${count}`).join(', ') || 'None reported'}.</p>
    <p>Distance source: {leg.source || leg.status || 'Unavailable'}. Fallback/review reason: {leg.reason || 'None reported'}.</p>
    <p>Checkout petrol eligibility: {checkout?.petrol_eligible_after_checkout === true ? 'Eligible' : checkout?.petrol_eligible_after_checkout === false ? 'Not eligible' : 'Unverified'}; location: {checkout?.location_status || 'Unknown'}; recorded site offset: {checkout?.distance_meters ?? 'Unknown'} m. Refresh KM cannot override checkout restrictions.</p>
  </section>;
}

export default function ManualKmRefreshDialog({ employee, endpoint, rangeEndpoint = endpoint.replace(/\/recalculate$/, '/manual-range'), onClose, onCommitted, request = authenticatedFetch }) {
  const dialog = useRef(null);
  const [date, setDate] = useState('');
  const [rangeMode, setRangeMode] = useState(false);
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState(null);
  const inFlight = useRef(false);
  useEffect(() => {
    const previous = document.activeElement;
    const element = dialog.current;
    element.showModal();
    return () => { element.close(); previous?.focus?.(); };
  }, []);
  function invalidate() { setPreview(null); setConfirmed(false); setError(''); }
  async function submit(apply) {
    if (inFlight.current || !date || (rangeMode && !endDate) || !reason.trim() || (apply && (!preview || preview.read_only || !confirmed))) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), rangeMode ? 600000 : 120000);
    try {
      const response = await request(rangeMode ? rangeEndpoint : endpoint, {
        method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_code: employee,
          ...(rangeMode ? { start_date: date, end_date: endDate } : { manual_refresh: true, date }),
          approval_reason: reason.trim(), dry_run: !apply,
          ...(apply ? rangeMode ? { range_token: preview.range_token }
            : { attendance_id: preview.attendance_id, preview_token: preview.preview_token } : {}),
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) {
        if (response.status === 409) { setPreview(null); setConfirmed(false); }
        throw new Error(`${result.message || 'Recalculation could not be completed.'}${result.code ? ` (${result.code})` : ''}`);
      }
      if (apply) {
        setReceipt(result);
        if (!rangeMode) setPreview(null);
        setConfirmed(false);
        try { if (!rangeMode || result.summary.applied > 0) await onCommitted(result); } catch {
          setError('KM was saved. Reload the employee report to view the latest totals.');
        }
      } else { setPreview(result); setConfirmed(false); }
    } catch (failure) {
      setError(failure.name === 'AbortError'
        ? 'The request timed out. If saving, retry this same preview to check its persisted receipt.'
        : failure.message);
    }
    finally { clearTimeout(timeout); inFlight.current = false; setBusy(false); }
  }
  return createPortal(
    <dialog ref={dialog} aria-labelledby="manual-km-title"
      onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}
      className={`fixed inset-0 m-auto max-h-[90vh] ${rangeMode ? 'w-[min(64rem,95vw)]' : 'w-[min(36rem,95vw)]'} overflow-auto rounded-xl border border-slate-300 bg-white p-6 text-slate-900 shadow-xl backdrop:bg-black/50`}>
      <h2 id="manual-km-title" className="text-lg font-bold">Review Refresh KM — financial correction</h2>
      <p className="my-2 text-sm">Approved, settled and manually adjusted records are protected. Each completed attendance is reviewed and saved independently.</p>
      <label className="my-3 block">Employee<input aria-label="Employee" readOnly value={employee} className="mt-1 block w-full rounded border p-2" /></label>
      <label className="my-3 flex gap-2"><input type="checkbox" aria-label="Recalculate date range" checked={rangeMode} disabled={busy || Boolean(receipt)}
        onChange={(event) => { setRangeMode(event.target.checked); invalidate(); }} />Recalculate a date range (maximum seven calendar days)</label>
      <label className="my-3 block">{rangeMode ? 'Start date' : 'Attendance date'}<input aria-label={rangeMode ? 'Start date' : 'Attendance date'} type="date" value={date} disabled={busy || Boolean(receipt)}
        onChange={(event) => { setDate(event.target.value); invalidate(); }} className="mt-1 block w-full rounded border p-2" /></label>
      {rangeMode ? <label className="my-3 block">End date<input aria-label="End date" type="date" value={endDate} min={date || undefined} disabled={busy || Boolean(receipt)}
        onChange={(event) => { setEndDate(event.target.value); invalidate(); }} className="mt-1 block w-full rounded border p-2" /></label> : null}
      <label className="my-3 block">Admin approval reason<textarea aria-label="Admin approval reason" value={reason} maxLength={1000} disabled={busy || Boolean(receipt)}
        onChange={(event) => { setReason(event.target.value); invalidate(); }} className="mt-1 block w-full rounded border p-2" /></label>
      {preview && !receipt && rangeMode ? <RangeResults result={preview} /> : null}
      {preview && !receipt && !rangeMode ? <section aria-label="KM calculation preview" className="my-4">
        <p className="text-sm">Employee {preview.employee_code} · {preview.date}</p>
        <table className="my-2 w-full text-left text-sm"><thead><tr><th>Calculation</th><th>Before</th><th>After</th></tr></thead>
          <tbody>{[['Route KM', 'route_km'], ['Payable KM', 'payable_km'], ['Amount (₹)', 'amount']].map(([label, key]) =>
            <tr key={key}><th className="py-2">{label}</th><td>{Number(preview.before[key]).toFixed(2)}</td><td>{Number(preview.after[key]).toFixed(2)}</td></tr>)}</tbody></table>
        <p className="text-sm">Last Checkout → End Day: {preview.final_leg.km ?? 'Unavailable'} km · {preview.final_leg.source || preview.final_leg.status || 'No accepted evidence'}</p>
        <FinalLegEvidence leg={preview.final_leg} />
        {preview.read_only ? <p role="status" className="my-2 text-sm">{preview.message} This distance is not included in saved route or payable totals.</p>
          : <p className="my-2 text-sm">Preview expires in five minutes. Changed evidence requires a new preview.</p>}
      </section> : null}
      {preview && !preview.read_only && !receipt && (!rangeMode || preview.summary.ready > 0) ? <label className="flex gap-2"><input type="checkbox" aria-label="Confirm reviewed calculations" checked={confirmed} disabled={busy}
        onChange={(event) => setConfirmed(event.target.checked)} />I reviewed these values and approve {rangeMode ? 'only the eligible dates shown above' : 'this single attendance recalculation'}.</label> : null}
      {preview && !receipt && rangeMode ? <p className="my-2 text-sm">Range previews expire within ten minutes. Failed or protected dates are never applied. Each date commits separately; a later failure does not undo successful dates.</p> : null}
      {receipt && rangeMode ? <><p role="status" className="my-3">Saved {receipt.summary.applied} of {receipt.summary.total_days} dates. Review each result below.</p><RangeResults result={receipt} />
        {receipt.summary.failed > 0 ? <><label className="my-3 flex gap-2"><input type="checkbox" aria-label="Confirm retry of unresolved dates" checked={confirmed} disabled={busy}
          onChange={event => setConfirmed(event.target.checked)} />I reviewed the failures and approve retrying unresolved dates using this same preview.</label>
          <button type="button" disabled={busy || !confirmed || !preview} className="rounded border px-4 py-2" onClick={() => submit(true)}>Retry unresolved dates</button>
          <button type="button" disabled={busy} className="ml-2 rounded border px-4 py-2" onClick={() => { setReceipt(null); invalidate(); }}>Create a new preview</button></> : null}</> : null}
      {receipt && !rangeMode ? <p role="status" className="my-3 text-green-800">KM saved. Calculation receipt: {receipt.calculation_run_id}</p> : null}
      {error ? <p role="alert" className="my-3 text-red-700">{error}</p> : null}
      <div className="mt-4 flex flex-wrap justify-end gap-3">
        <button type="button" disabled={busy} onClick={onClose} className="rounded border px-4 py-2">Close</button>
        {!receipt ? <button type="button" disabled={busy || !date || (rangeMode && !endDate) || !reason.trim()} onClick={() => submit(false)} className="rounded border px-4 py-2">{busy ? 'Please wait…' : 'Preview KM'}</button> : null}
        {preview && !preview.read_only && !receipt && (!rangeMode || preview.summary.ready > 0) ? <button type="button" disabled={busy || !confirmed} onClick={() => submit(true)} className="rounded bg-blue-700 px-4 py-2 text-white">Approve and save</button> : null}
      </div>
    </dialog>, document.body,
  );
}
