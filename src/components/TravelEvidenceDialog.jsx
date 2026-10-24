import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { authenticatedFetch } from '../services/api.js';
import { runTravelEvidencePeriod } from '../utils/travelEvidenceRecalculation.js';

const km = value => value === null || value === undefined ? 'Unknown / not assessed' : `${Number(value).toFixed(2)} km`;

export default function TravelEvidenceDialog({ selection, endpoint, onClose, onFinancialReview, request = authenticatedFetch }) {
  const dialog = useRef(null), controller = useRef(null);
  const [progress, setProgress] = useState({ running: true, rows: [], completed: 0, total: 0 });
  const [error, setError] = useState('');
  useEffect(() => {
    const previous = document.activeElement, element = dialog.current;
    element.showModal();
    // Delay start until after StrictMode's setup/cleanup probe; one user click
    // must not issue a second calculation while the first request is aborting.
    let live = true;
    const abort = new AbortController(); controller.current = abort;
    const start = setTimeout(() => {
      runTravelEvidencePeriod({ employee: selection.employee, from: selection.from, to: selection.to,
        endpoint, request, signal: abort.signal, onProgress: state => { if (live) setProgress(state); } })
        .catch(failure => { if (live) { setError(failure.message); setProgress(p => ({ ...p, running: false })); } });
    }, 0);
    return () => { live = false; clearTimeout(start); abort.abort(); element.close(); previous?.focus?.(); };
  }, [selection, endpoint, request]);
  const failures = progress.rows.filter(row => row.status === 'failed').length;
  const outcome = progress.running ? 'Loading' : failures === progress.rows.length && failures ? 'Failed' :
    failures || progress.rows.some(row => ['partial', 'protected'].includes(row.status)) || progress.stopped ? 'Partial' : 'Completed';
  return createPortal(<dialog ref={dialog} aria-labelledby="travel-evidence-title" onCancel={event => { event.preventDefault(); onClose(); }}
    className="fixed inset-0 m-auto max-h-[90vh] w-[min(78rem,96vw)] overflow-auto rounded-xl border border-slate-300 bg-white p-6 text-slate-900 shadow-xl backdrop:bg-black/50">
    <h2 id="travel-evidence-title" className="text-lg font-bold">Recalculate Selected Period — travel evidence</h2>
    <p className="my-2">{selection.employee} · {selection.from} → {selection.to}</p>
    <p className="my-2 text-sm">GPS-first calculations with bounded Directions fallback. Active attendance includes only closed windows. Travel modes and saved financial values are unchanged. No evidence records are persisted.</p>
    <p role="status" aria-live="polite" className="my-3 font-semibold">{outcome}: {progress.completed} of {progress.total} dates processed{progress.stopped ? ' — stopped' : ''}.</p>
    <progress aria-label="Travel evidence progress" value={progress.completed} max={Math.max(1, progress.total)} className="w-full" />
    {error ? <p role="alert" className="my-2 text-red-700">{error}</p> : null}
    <div className="my-4 overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr>
      {['Date / state', 'Calculated travel', 'Saved route', 'Saved payable', 'Petrol-eligible evidence', 'Checkout review evidence', 'Already included payable', 'Proposed additional payable', 'Result'].map(label => <th className="p-2" key={label}>{label}</th>)}
    </tr></thead><tbody>{progress.rows.map(row => <tr key={row.date}>
      <th className="whitespace-nowrap p-2">{row.date}<p>{row.status}</p></th>
      {['calculated_travel_km', 'saved_route_km', 'saved_payable_km', 'petrol_eligible_evidence_km', 'pending_checkout_review_km', 'already_included_km', 'proposed_additional_payable_km'].map(key => <td key={key} className="p-2">{row.status === 'loading' ? '…' : km(row[key])}</td>)}
      <td className="min-w-64 p-2"><p>{row.message}</p>{row.travel_mode ? <p>Recorded mode: {row.travel_mode}. Estimates are not financial approval.</p> : null}
        {row.legs?.length ? <details><summary>Travel windows ({row.legs.length})</summary>{row.legs.map((leg, index) => <p key={index} className="my-2">{leg.type}: {km(leg.km)} · {leg.source} · {leg.from_time} → {leg.to_time}{leg.fallback_reason ? ` · ${leg.fallback_reason}` : ''}{leg.review_flags?.length ? ` · Review: ${leg.review_flags.join(', ')}` : ''}</p>)}</details> : null}
      </td>
    </tr>)}</tbody></table></div>
    <p className="my-2 text-sm">Checkout-review distances are evidence, not automatically unpaid distance. Unknown inclusion is never treated as zero. Approved, settled and manually adjusted values remain protected.</p>
    <div className="mt-4 flex flex-wrap justify-end gap-3">
      {progress.running ? <button type="button" className="rounded border px-4 py-2" onClick={() => controller.current?.abort()}>Stop after current request</button> : null}
      {!progress.running && progress.rows.some(row => row.ok && !row.active && !row.protected) ? <button type="button" className="rounded border px-4 py-2" onClick={onFinancialReview}>Review financial correction separately</button> : null}
      <button type="button" className="rounded border px-4 py-2" onClick={onClose}>Close</button>
    </div>
  </dialog>, document.body);
}
