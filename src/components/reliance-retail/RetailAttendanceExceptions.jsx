import { useEffect, useState } from 'react';
import { retailAttendanceApi } from '../../services/retailAttendanceApi.js';
import { exceptionColumns, exceptionExportRows, exportAttendanceExceptions } from '../../utils/retailAttendanceExceptionsExport.js';

const button = 'rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-semibold text-blue-800 disabled:opacity-50';
const count = value => value == null ? 'N/A' : value.toLocaleString('en-IN');
export default function RetailAttendanceExceptions({ cutoff, view, state, refresh }) {
  const [result, setResult] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [metric, setMetric] = useState(''), [category, setCategory] = useState(''), [page, setPage] = useState(0), [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBusy(true); setResult(null); setError(''); setMetric(''); setPage(0);
    retailAttendanceApi.exceptions({ cutoff, view, state }).then(r => {
      if (live && r.report) setResult(r.report);
      else if (live) setError('Attendance exception data is unavailable.');
    }).catch(e => { if (live) setError(e.response?.data?.message || e.message || 'Attendance exception data is unavailable.'); })
      .finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [cutoff, view, state, refresh, retry]);
  const rows = result?.details?.filter(r => (!category || r.class === category) && (metric === 'issues' ? r.issues.length : r[metric])) || [];
  async function download() { try { await exportAttendanceExceptions(result, rows); } catch (e) { setError(e.message); } }
  return <section aria-label="Attendance exceptions" className="rounded-xl border border-blue-100 bg-blue-50/30 p-4">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="font-bold text-blue-950">Attendance exceptions</h2>
      <p className="text-xs text-slate-600">{view === 'daily' ? 'Daily' : 'Month-to-Date'} · {cutoff} · {state || 'All authorized states'}</p></div>
    {busy && <p role="status">Loading attendance exceptions…</p>}
    {error && <p role="alert">{error} <button className={button} onClick={() => setRetry(n => n + 1)}>Retry exceptions</button></p>}
    <div className="grid gap-3 sm:grid-cols-2">{[['missing_checkout', 'Missing Checkout'], ['below_9_hours', 'Below 9 Work Hours']].map(([key, label]) =>
      <button key={key} disabled={!result} onClick={() => { setMetric(key); setPage(0); }} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }} className="rounded-xl border border-blue-100 bg-white p-4 text-left shadow-sm disabled:opacity-60" aria-expanded={metric === key}>
        <span className="block text-sm font-semibold text-blue-900">{label}</span><strong className="my-1 block text-3xl text-blue-700">{count(result?.[key])}</strong>
        <span className="text-xs text-slate-600">{Object.entries(result?.categories || {}).map(([kind, group]) => `${kind}: ${count(group[key])}`).join(' · ') || 'Time data unavailable'} · View employees</span>
      </button>)}</div>
    {result && <><p className="mt-3 text-xs text-slate-600">{result.note}</p>
      {Object.entries(result.categories).map(([kind, group]) => (group.missing_dates.length || group.missing_unavailable || group.below_unavailable) ?
        <p key={kind} className="mt-1 text-xs text-amber-900">{kind}: missing uploaded dates: {group.missing_dates.join(', ') || 'None'}; unavailable punch rows: {group.missing_unavailable}; unavailable duration rows: {group.below_unavailable}. Known Missing Checkout: {group.known_missing_checkout}; known Below 9 Hours: {group.known_below_9_hours}.</p> : null)}
      <button className={`${button} mt-3`} onClick={() => { setMetric('issues'); setPage(0); }}>Invalid / inconsistent time records ({result.flagged_records})</button></>}
    {metric && result && <div className="mt-4 border-t border-blue-100 pt-3">
      <div className="mb-3 flex flex-wrap items-center gap-2"><h3 className="mr-auto font-semibold">{metric === 'missing_checkout' ? 'Missing Checkout' : metric === 'below_9_hours' ? 'Below 9 Work Hours' : 'Time validation issues'} — employee records</h3>
        <label className="text-sm">Category <select aria-label="Exception category" value={category} onChange={e => { setCategory(e.target.value); setPage(0); }} className="rounded border p-2"><option value="">All permitted categories</option>{Object.keys(result.categories).map(k => <option key={k}>{k}</option>)}</select></label>
        <button className={button} onClick={download}>Export exception employees</button><button className={button} onClick={() => setMetric('')}>Close exceptions</button></div>
      {!rows.length ? <p>No known affected records in the selected scope. Unavailable coverage is shown above.</p> : <div className="overflow-x-auto"><table className="w-full text-left text-xs"><caption className="sr-only">Attendance exception employee details</caption>
        <thead className="bg-blue-50"><tr>{exceptionColumns.map(label => <th className="whitespace-nowrap p-2" key={label}>{label}</th>)}</tr></thead>
        <tbody>{exceptionExportRows(rows.slice(page * 50, page * 50 + 50)).slice(1).map((values, i) => <tr className="border-t" key={i}>{values.map((v, j) => <td className="p-2" key={j}>{v}</td>)}</tr>)}</tbody></table></div>}
      <div className="mt-3 flex items-center gap-2 text-sm"><span>{rows.length} affected records · Page {page + 1}</span><button className={button} disabled={!page} onClick={() => setPage(n => n - 1)}>Previous exceptions</button><button className={button} disabled={(page + 1) * 50 >= rows.length} onClick={() => setPage(n => n + 1)}>Next exceptions</button></div>
    </div>}
  </section>;
}
