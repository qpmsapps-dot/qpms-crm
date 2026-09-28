import { useCallback, useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { useAuth } from '../context/auth-context.js';
import { claimTenderTask, decideTenderReview, getTenderWorkbookUrl, getTenderWorkspace, submitTenderVersion, uploadTenderVersion } from '../services/tenderApi.js';
import { isPlatformAdmin, normalizeCanonicalRole } from '../utils/authRoles.js';

const tabs = ['New Queue', 'My Work', 'Rework', 'Submitted for Approval', 'Approval Tracking', 'Completed'];
function reviewerFamily(value) {
  const key = String(value || '').toUpperCase().replace(/[^A-Z0-9]+/g, '');
  if (['HR', 'HRREVIEWER', 'HRGM'].includes(key)) return 'HR';
  if (['COMMERCIAL', 'COMMERCIALTEAM', 'COMMERCIALREVIEWER'].includes(key)) return 'Commercial';
  if (['FINANCE', 'FINANCETEAM', 'FINANCEREVIEWER', 'FINANCEGM'].includes(key)) return 'Finance';
  return key === 'CFO' || key === 'COO' ? key : null;
}

export default function TenderWorkspace() {
  const { user } = useAuth();
  const [state, setState] = useState({ loading: true, error: '', items: [] });
  const [tab, setTab] = useState(tabs[0]);
  const [preview, setPreview] = useState(null);
  const load = useCallback(async () => {
    try { const data = await getTenderWorkspace(); setState({ loading: false, error: '', items: data.items || [] }); }
    catch (error) { setState({ loading: false, error: error.message, items: [] }); }
  }, []);
  useEffect(() => {
    let active = true;
    getTenderWorkspace()
      .then((data) => { if (active) setState({ loading: false, error: '', items: data.items || [] }); })
      .catch((error) => { if (active) setState({ loading: false, error: error.message, items: [] }); });
    return () => { active = false; };
  }, []);
  const role = normalizeCanonicalRole(user?.rawRole || user?.role);
  const admin = isPlatformAdmin(user);
  const items = useMemo(() => state.items.filter((item) => {
    if (tab === 'New Queue') return item.status === 'Waiting for Tender Assignment';
    if (tab === 'My Work') return item.status === 'In Preparation';
    if (tab === 'Rework') return item.status === 'Rework';
    if (tab === 'Submitted for Approval') return ['Approval Pending', 'CFO Approval', 'COO Approval'].includes(item.status);
    if (tab === 'Completed') return ['Proposal Ready', 'Completed'].includes(item.status);
    return true;
  }), [state.items, tab]);
  async function view(version) {
    const result = await getTenderWorkbookUrl(version.id);
    const response = await fetch(result.url);
    if (!response.ok) throw new Error('Unable to load the Tender workbook.');
    const book = XLSX.read(await response.arrayBuffer(), { type: 'array', cellStyles: true });
    setPreview({ filename: result.filename, sheets: book.SheetNames.map((name) => ({ name, rows: XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1, defval: '' }) })) });
  }
  if (state.loading) return <p className="enterprise-card p-6">Loading Tender workspace...</p>;
  if (state.error) return <p className="enterprise-card p-6 text-rose-700">{state.error}</p>;
  return <div className="space-y-5">
    <header><h1 className="text-3xl font-bold">Tender</h1><p className="text-slate-500">Versioned Tender preparation and approval tracking.</p></header>
    <div className="flex flex-wrap gap-2">{tabs.map((name) => <button key={name} onClick={() => setTab(name)} className={`rounded-xl px-4 py-2 text-sm font-bold ${tab === name ? 'bg-blue-700 text-white' : 'bg-white text-slate-600'}`}>{name}</button>)}</div>
    <div className="grid gap-4">{items.map((item) => <TenderCard key={item.id} item={item} role={role} admin={admin} reload={load} view={view} />)}{!items.length ? <p className="enterprise-card p-6 text-slate-500">No Tender items in this queue.</p> : null}</div>
    {preview ? <WorkbookPreview preview={preview} close={() => setPreview(null)} /> : null}
  </div>;
}

function TenderCard({ item, role, admin, reload, view }) {
  const [file, setFile] = useState(null); const [notes, setNotes] = useState(''); const latest = item.versions?.[0];
  const canTender = role === 'Tender' || admin;
  const pendingReview = item.reviews?.find((review) => review.status === 'Pending' && (admin || reviewerFamily(role) === review.reviewer_role));
  return <article className="enterprise-card p-5">
    <div className="grid gap-3 sm:grid-cols-3">
      <Summary label="Client" value={item.lead?.client_name} /><Summary label="State" value={item.lead?.state} /><Summary label="Site" value={item.lead?.site_location} />
      <Summary label="Tender Owner" value={item.tender_owner_name || 'Unassigned'} /><Summary label="BD Owner" value={item.bd_owner_name} /><Summary label="Status" value={item.status} />
      <Summary label="Current Version" value={item.current_version ? `V${item.current_version}` : 'None'} /><Summary label="Rework Count" value={item.rework_count} /><Summary label="Pending With" value={item.pending_with} />
    </div>
    <p className="mt-4 rounded-xl bg-slate-50 p-3 text-sm">{JSON.stringify(item.assessment?.survey_snapshot || {}).slice(0, 500) || 'No survey summary recorded.'}</p>
    {item.status === 'Waiting for Tender Assignment' && canTender ? <button className="mt-4 rounded-xl bg-blue-700 px-4 py-2 font-bold text-white" onClick={async () => { await claimTenderTask(item.id); await reload(); }}>Take Task</button> : null}
    {canTender && ['In Preparation', 'Rework'].includes(item.status) && item.assigned_tender_profile_id ? <div className="mt-4 grid gap-3 sm:grid-cols-2">
      <input type="file" accept=".xlsx" onChange={(event) => setFile(event.target.files?.[0] || null)} />
      <textarea placeholder="Tender notes" value={notes} onChange={(event) => setNotes(event.target.value)} className="rounded-xl border p-3" />
      <button disabled={!file || !file.name.toLowerCase().endsWith('.xlsx')} className="rounded-xl bg-blue-700 px-4 py-2 font-bold text-white disabled:opacity-40" onClick={async () => { await uploadTenderVersion(item.id, file, notes); setFile(null); await reload(); }}>Upload New Version</button>
      {latest?.status === 'Draft' ? <button className="rounded-xl bg-emerald-700 px-4 py-2 font-bold text-white" onClick={async () => { await submitTenderVersion(item.id, latest.id); await reload(); }}>Submit for Approval</button> : null}
    </div> : null}
    {latest ? <div className="mt-4 flex gap-3"><button className="font-bold text-blue-700" onClick={() => view(latest)}>View Excel</button><button className="font-bold text-blue-700" onClick={async () => { const result = await getTenderWorkbookUrl(latest.id); window.open(result.url, '_blank', 'noopener,noreferrer'); }}>Download Excel</button></div> : null}
    {pendingReview ? <div className="mt-4 flex gap-3"><button className="rounded-xl bg-emerald-700 px-4 py-2 font-bold text-white" onClick={async () => { await decideTenderReview(pendingReview.id, 'APPROVE', ''); await reload(); }}>Approve</button><button className="rounded-xl bg-amber-600 px-4 py-2 font-bold text-white" onClick={async () => { const remarks = window.prompt('Rework remarks'); if (!remarks?.trim()) return; await decideTenderReview(pendingReview.id, 'REWORK', remarks); await reload(); }}>Rework</button></div> : null}
    <div className="mt-4 text-xs text-slate-500">{(item.reviews || []).map((review) => `${review.reviewer_role}: ${review.status}`).join(' · ')}</div>
  </article>;
}

function WorkbookPreview({ preview, close }) {
  const [sheet, setSheet] = useState(preview.sheets[0]?.name); const current = preview.sheets.find((item) => item.name === sheet);
  return <div className="fixed inset-0 z-50 overflow-auto bg-slate-950/60 p-8"><div className="mx-auto max-w-6xl rounded-2xl bg-white p-5"><div className="flex justify-between"><h2 className="font-bold">{preview.filename}</h2><button onClick={close}>Close</button></div><div className="my-3 flex gap-2">{preview.sheets.map((item) => <button key={item.name} onClick={() => setSheet(item.name)} className="rounded bg-slate-100 px-3 py-1">{item.name}</button>)}</div><div className="overflow-auto"><table className="min-w-full border-collapse text-sm"><tbody>{(current?.rows || []).map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, columnIndex) => <td key={columnIndex} className="border px-2 py-1">{String(cell)}</td>)}</tr>)}</tbody></table></div></div></div>;
}
function Summary({ label, value }) { return <div><p className="text-xs font-bold uppercase text-slate-400">{label}</p><p className="font-semibold">{value ?? '—'}</p></div>; }
