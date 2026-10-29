import { useCallback, useEffect, useMemo, useState } from 'react';
import { retailProvisionalApi as api } from '../../services/retailProvisionalApi.js';
import { provisionalCounts, downloadProvisional } from '../../utils/retailProvisionalExport.js';

const inputClass = 'rounded-lg border p-2';
export default function RetailProvisionalStores() {
  const [report, setReport] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [state, setState] = useState(''), [version, setVersion] = useState(''), [status, setStatus] = useState(''), [query, setQuery] = useState('');
  const [file, setFile] = useState(null), [editor, setEditor] = useState(null), [notice, setNotice] = useState('');
  const [withdrawn, setWithdrawn] = useState(false);
  const load = useCallback(async () => { setBusy(true); setError(''); try { setReport(await api.review()); } catch(e) { setError(e.response?.data?.message || e.message); } finally { setBusy(false); } }, []);
  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load]);
  async function act(fn) { setBusy(true); setError(''); setNotice(''); try { await fn(); await load(); } catch(e) { setError(e.response?.data?.message || e.message); } finally { setBusy(false); } }
  const rows = useMemo(() => (report?.rows || []).filter(r => (withdrawn || !r.withdrawn_at) && (!state || r.source_state === state) && (!version || String(r.version) === version) && (!status || r.verification_status === status) && `${r.store_code} ${r.review.store_name}`.toLowerCase().includes(query.toLowerCase())), [report, state, version, status, query, withdrawn]);
  const counts = report ? provisionalCounts(report.rows, report.canonical) : [];
  async function propose(e) {
    e.preventDefault(); await act(async () => { await api.propose({ row_id: editor.row.id, revision: editor.row.revision, changes: editor.changes, reason: editor.reason }); setEditor(null); setNotice('Correction submitted for independent Admin review.'); });
  }
  return <section className="space-y-4" aria-label="Provisional Store Master">
    <h2 className="text-xl font-bold">Provisional stores — MIS review</h2>
    <p className="rounded-xl bg-amber-50 p-3">Unverified source information. Verified staging records also remain separate from operational Store Master, attendance and AOP. Canonical activation requires the existing identity approval process.</p>
    {error && <div role="alert" className="rounded-xl bg-red-50 p-3 text-red-700">{error}</div>}
    {notice && <p role="status">{notice}</p>}
    <button className={inputClass} disabled={busy} onClick={load}>Refresh review</button>
    {busy && <p role="status">Loading review…</p>}
    {report && <>
      {report.admin && <form className="flex flex-wrap gap-3 rounded-xl border p-4" onSubmit={e => { e.preventDefault(); void act(async () => { const receipt = await api.upload(file); setNotice(`${receipt.rows} source rows ${receipt.replayed ? 'already recorded; no duplicate upload created' : 'staged as PENDING_VERIFICATION'}.`); }); }}>
        <label>Source review workbook <input aria-label="Provisional source workbook" type="file" accept=".xlsx" onChange={e => setFile(e.target.files[0] || null)}/></label><button className={inputClass} disabled={busy || !file}>Upload to provisional staging</button>
      </form>}
      <div className="overflow-x-auto rounded-xl border"><table className="min-w-full text-sm"><thead><tr>{['Source state','Source rows (all versions)','Unique pending codes','Pending rows','Verified staging rows','Canonical stores'].map(h => <th className="p-3 text-left" key={h}>{h}</th>)}</tr></thead><tbody>{counts.map(c => <tr key={c.state}>{Object.values(c).map((v,i) => <td className="p-3" key={i}>{v}</td>)}</tr>)}</tbody></table></div>
      <div className="flex flex-wrap gap-3">
        <label>State <select aria-label="Provisional state" className={inputClass} value={state} onChange={e => setState(e.target.value)}><option value="">All authorized states</option>{counts.map(c => <option key={c.state}>{c.state}</option>)}</select></label>
        <label>Version <select aria-label="Source version" className={inputClass} value={version} onChange={e => setVersion(e.target.value)}><option value="">All source versions</option>{report.files.map(f => <option key={f.id} value={f.version}>{f.version}: {f.filename}{f.withdrawn_at ? ' (withdrawn)' : ''}</option>)}</select></label>
        <label>Status <select aria-label="Verification status" className={inputClass} value={status} onChange={e => setStatus(e.target.value)}><option value="">All statuses</option><option>PENDING_VERIFICATION</option><option>VERIFIED</option></select></label>
        <input aria-label="Search provisional stores" className={inputClass} placeholder="Code or store name" value={query} onChange={e => setQuery(e.target.value)}/>
        <label><input type="checkbox" checked={withdrawn} onChange={e => setWithdrawn(e.target.checked)}/> Include withdrawn versions</label>
        <button className={inputClass} disabled={busy} onClick={() => void act(() => downloadProvisional(report, rows))}>Export MIS Excel</button>
      </div>
      <p>{rows.length} source rows in selected scope. Duplicate rows and source versions are counted separately.</p>
      {!rows.length && <p>No provisional records in this scope.</p>}
      {[...new Set(rows.map(r => r.source_state))].map(s => <div key={s} className="space-y-2"><h3 className="font-bold">{s || 'UNKNOWN'} provisional records</h3><div className="overflow-x-auto rounded-xl border"><table className="min-w-full text-sm"><thead><tr>{['Code / source','Store / geography','Verification','Duplicate / conflict flags','Review'].map(h => <th className="p-3 text-left" key={h}>{h}</th>)}</tr></thead><tbody>{rows.filter(r => r.source_state === s).map(r => <tr key={r.id} className="border-t align-top">
        <td className="p-3"><b>{r.store_code || 'MISSING CODE'}</b><p>v{r.version} · row {r.source_row}</p><details><summary>Original evidence</summary><p className="break-all">SHA256: {r.sha256}<br/>Row digest: {r.row_digest}</p><pre className="max-w-sm whitespace-pre-wrap">{JSON.stringify(r.source.raw,null,2)}</pre></details></td>
        <td className="p-3">{r.review.store_name}<p>{r.review.state} / {r.review.city} · {r.review.operating_status}</p>{r.review.duplicate_of && <p>Mapped canonical ID: {r.review.duplicate_of}</p>}</td>
        <td className="p-3">{r.verification_status}{r.withdrawn_at && <p>WITHDRAWN</p>}</td>
        <td className="p-3">{r.duplicate_count > 1 && <p>DUPLICATE_CODE ({r.duplicate_count} rows)</p>}{r.other_version_match && <p>OTHER_SOURCE_VERSION</p>}{r.canonical_matches.length > 0 && <p>CANONICAL_MATCH_REQUIRES_REVIEW</p>}{r.source.conflict_evidence && <p>{r.source.conflict_evidence}</p>}</td>
        <td className="p-3"><button className={inputClass} disabled={busy || !!r.withdrawn_at || report.proposals.some(p => p.row_id === r.id && p.status === 'PENDING')} onClick={() => setEditor({ row:r, changes:{...r.review}, reason:'' })}>Propose correction</button>
          <details><summary>Change history</summary>{report.proposals.filter(p => p.row_id === r.id).map(p => <div key={p.id} className="my-2 max-w-sm rounded border p-2"><p>{p.status} · {p.reason}</p><pre className="whitespace-pre-wrap">{JSON.stringify(p.changes,null,2)}</pre><p>{p.decision_reason}</p>{report.admin && p.status === 'PENDING' && !r.withdrawn_at && <div className="flex gap-2">{[true,false].map(approve => <button className={inputClass} key={String(approve)} disabled={busy} onClick={() => { const reason = window.prompt('Decision reason and evidence reference'); if(reason) void act(() => api.decide({proposal_id:p.id,approve,reason})); }}>{approve ? 'Approve staging verification' : 'Reject proposal'}</button>)}</div>}</div>)}</details>
        </td></tr>)}</tbody></table></div></div>)}
      <details><summary>Source versions and rollback safeguards</summary>{report.files.map(f => <div className="my-2 rounded border p-3" key={f.id}><p>v{f.version} · {f.filename} · {f.created_at}</p><p className="break-all">{f.sha256}</p><p>{f.withdrawn_at ? `Withdrawn: ${f.withdrawal_reason}` : 'Available for review'}</p>{report.admin && !f.withdrawn_at && <button className={inputClass} disabled={busy} onClick={() => { const reason = window.prompt('Withdraw this source version: reason'); if(reason) void act(() => api.withdraw({batch_id:f.id,reason})); }}>Withdraw source version</button>}</div>)}</details>
    </>}
    {editor && <div className="fixed inset-0 z-50 overflow-auto bg-slate-950/40 p-4"><form className="mx-auto max-w-xl space-y-3 rounded-xl bg-white p-5" onSubmit={propose}><h3 className="font-bold">Propose correction: {editor.row.store_code}</h3>{[['store_name','Store name'],['city','City / geography']].map(([k,label]) => <label className="block" key={k}>{label}<input className={`${inputClass} w-full`} required={k === 'store_name'} value={editor.changes[k]} onChange={e => setEditor({...editor,changes:{...editor.changes,[k]:e.target.value}})}/></label>)}
      <label className="block">Geographic state<select className={`${inputClass} w-full`} value={editor.changes.state} onChange={e => setEditor({...editor,changes:{...editor.changes,state:e.target.value}})}>{['TN','PY','KA','KL','TG','AP-1','AP-2'].map(s => <option key={s}>{s}</option>)}</select></label>
      <label className="block">Operating status<select className={`${inputClass} w-full`} value={editor.changes.operating_status} onChange={e => setEditor({...editor,changes:{...editor.changes,operating_status:e.target.value}})}>{['UNKNOWN','Active','Inactive','Closed'].map(s => <option key={s}>{s}</option>)}</select></label>
      <label className="block">Duplicate mapping<select className={`${inputClass} w-full`} value={editor.changes.duplicate_of || ''} onChange={e => setEditor({...editor,changes:{...editor.changes,duplicate_of:e.target.value || null}})}><option value="">No canonical mapping proposed</option>{report.canonical.map(c => <option key={c.id} value={c.id}>{c.store_code} · {c.store_name} · {c.state}</option>)}</select></label>
      <label className="block">Correction reason / evidence<textarea className={`${inputClass} w-full`} required minLength={3} maxLength={2000} value={editor.reason} onChange={e => setEditor({...editor,reason:e.target.value})}/></label><button type="button" className={inputClass} onClick={() => setEditor(null)}>Cancel</button> <button className={inputClass} disabled={busy}>Submit proposal</button>
    </form></div>}
  </section>;
}
