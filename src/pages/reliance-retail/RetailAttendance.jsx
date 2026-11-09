import { useLocation } from 'react-router-dom';
import { readRetailNavigation } from '../../utils/retailNavigation.js';
import RetailResponsibilityPanel from '../../components/reliance-retail/RetailResponsibilityPanel.jsx';
import '../../components/reliance-retail/retailReport.css';
import { useCallback, useEffect, useRef, useState } from 'react';

import { CalendarDays, Upload, AlertTriangle, X } from 'lucide-react';
import { useModalFocus } from '../../hooks/useModalFocus.js';
import { usePageTitle } from '../../hooks/usePageTitle.js';
import { retailAttendanceApi } from '../../services/retailAttendanceApi.js';
import { attendanceColumns, attendanceAopCoverage, attendanceAopValue, exportRetailAttendance, exportRetailAttendanceSource } from '../../utils/retailAttendanceExport.js';
import { ATTENDANCE_MAX_FILE_BYTES, indiaToday, STATE_OPTIONS } from '../../../backend/shared/retailAttendance.js';
import {useAuth} from '../../context/auth-context.js';
import {isPlatformAdmin} from '../../utils/authRoles.js';
import {RetailAttendanceTrend,RetailAttendanceKpis,RetailAttendanceSummary} from '../../components/reliance-retail/RetailAttendanceVisual.jsx';

const number = value => value == null ? 'N/A' : Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const pct = value => value == null ? 'N/A' : `${number(value)}%${value > 100 ? ' ↑' : ''}`;
const color = value => value == null ? 'bg-slate-100 text-slate-500' : value >= 90 ? 'bg-green-100 text-green-900' : value >= 85 ? 'bg-amber-100 text-amber-900' : 'bg-red-100 text-red-900';
const button = 'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-blue-950 disabled:opacity-40';
const errorText = error => error.response?.data?.message || error.message;

function SummaryTable({ rows, total, onState, report }) {
  return <div role="region" aria-label="Store attendance summary, scroll horizontally for all columns" tabIndex={0} className="overflow-x-auto"><table className="retail-attendance-summary w-full text-right text-sm" style={{minWidth:1580,fontSize:14}}><caption className="sr-only">Store attendance: all manpower, actual, target and percentage columns</caption><thead className="bg-blue-50 text-blue-950"><tr>{attendanceColumns.map(([key, label]) => <th key={key} scope="col" className={`px-3 py-3 ${key === 'state' ? 'text-left' : ''}`}>{label}</th>)}</tr></thead>
    <tbody>{[...rows, total].map((row, index) => <tr key={row.state} className={`border-t border-slate-100 ${index === rows.length ? 'bg-blue-50 font-bold' : ''}`}>
      {attendanceColumns.map(([key]) => <td key={key} style={key === 'state' ? {backgroundColor:index === rows.length ? '#eaf2ff' : '#fff'} : undefined} className={`whitespace-nowrap px-3 py-3 ${key.endsWith('_pct') ? color(row[key]) : ''} ${key === 'state' ? 'text-left font-semibold' : ''}`}>
        {key === 'state' ? onState && index !== rows.length ? <button className="text-blue-700 underline" onClick={() => onState(row.state)}>{row.state}</button> : row.state : key.endsWith('_pct') ? pct(row[key]) : key.includes('aop') ? number(attendanceAopValue(report, row, key)) : row.missing_aop.length && key.includes('target') ? 'N/A' : number(row[key])}
      </td>)}
    </tr>)}</tbody></table></div>;
}

function UploadDialog({ onClose, onImported, fallbackFocusRef }) {
  const [file, setFile] = useState(null); const [preview, setPreview] = useState(null); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(''); const [replace, setReplace] = useState(false); const [reason, setReason] = useState('');
  function select(value) {
    setPreview(null); setReplace(false); setReason('');
    if (value && value.size > ATTENDANCE_MAX_FILE_BYTES) {
      setFile(null); setError('Select an .xlsx file, maximum 15 MB.'); return;
    }
    setFile(value); setError('');
  }
  async function validate() {
    if (!file || busy) return; setBusy(true); setError(''); setPreview(null);
    try { setPreview((await retailAttendanceApi.preview(file)).preview); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  async function commit() {
    if (busy) return; setBusy(true); setError('');
    try { await retailAttendanceApi.commit({ id: preview.id, preview_key: preview.preview_key, replace, reason }); await onImported(); onClose(); }
    catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  const dialogRef = useModalFocus({ onClose, canDismiss: !busy, fallbackFocusRef });
  const corrections = preview?.affected_records?.length || 0;
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"><section ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="attendance-upload-title" aria-describedby="attendance-upload-description" aria-busy={busy} className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
    <div className="flex items-center justify-between"><h2 id="attendance-upload-title" className="text-lg font-bold text-blue-950">Upload Day Attendance</h2><button aria-label="Close upload" disabled={busy} onClick={onClose}><X size={20}/></button></div>
    <p id="attendance-upload-description" className="my-3 text-sm text-slate-600">Preview the M-here workbook before import. Store and state are resolved from the Reliance Retail Store Master.</p>
    <label onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (!busy) select(event.dataTransfer.files[0]); }} className="block rounded-xl border-2 border-dashed border-blue-200 bg-blue-50/40 p-6 text-center text-sm">
      Select or drop an .xlsx file (maximum 15 MB)<input aria-label="Attendance Excel file" disabled={busy} type="file" accept=".xlsx" onChange={e => select(e.target.files[0])} className="mx-auto mt-3 block max-w-full"/>
    </label>
    <button disabled={!file || busy} onClick={validate} className={`${button} mt-3`}>{busy ? 'Processing…' : 'Validate and Preview'}</button>
    {error && <p role="alert" className="my-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {preview && <div className="mt-4 space-y-3">
      <p className="font-semibold">{preview.total_rows} rows · {preview.valid_rows} valid · {preview.rejected_rows} rejected ? {preview.excluded_rows || 0} excluded</p>
      <p className="text-sm">Dates: {(preview.dates || []).join(', ')}</p>
      <details className="text-sm"><summary>Date / class / status counts</summary>{[['Dates',preview.date_counts],['Classes',preview.class_counts],['Statuses',preview.status_counts]].map(([label,counts])=><p key={label}>{label}: {Object.entries(counts || {}).map(([k,v])=>k+': '+v).join(' ? ')}</p>)}</details>
      {!!preview.excluded_rows && <details className="text-sm"><summary>{preview.excluded_rows} excluded source rows (no HK/MEPC credit)</summary>{preview.excluded_sampled && <p>Showing the first {preview.exception_sample_limit}. All source rows and exceptions are retained in import history and source export.</p>}{preview.excluded.map(row=><p key={row.source_row}>Row {row.source_row}: {row.original_class}</p>)}</details>}
      {preview.committed ? <p className="rounded-lg bg-green-50 p-3 text-green-800">This exact file was already imported. No duplicate records were written.</p> : <>
        {preview.rejected_rows > 0 && <div className="rounded-lg bg-amber-50 p-3 text-sm"><p>Rejected rows receive no credit. Valid rows can be imported; resolve exceptions and submit a corrected file.</p>{preview.rejected_sampled && <p>Showing the first {preview.exception_sample_limit} of {preview.rejected_rows} rejected rows. All source rows and exceptions are retained in import history and source export.</p>}<div className="max-h-48 overflow-auto">{preview.rejected.map(row => <p key={row.source_row}>Row {row.source_row} · {row.store_code || 'Missing store'}: {row.reasons.join('; ')}</p>)}</div></div>}
        {corrections > 0 && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm"><p>{corrections} existing employee/date records will be replaced. All previous site rows for each corrected employee/day are superseded together. Prior versions remain in source history; other employee/days remain unchanged.</p>
          <details><summary>Review affected records</summary><div className="max-h-40 overflow-auto">{preview.affected_records.map(row => <p key={row.id}>{row.employee_code} · {row.attendance_date} · {row.class} · {row.credit}</p>)}</div></details>
          <label className="mt-2 block"><input type="checkbox" checked={replace} onChange={e => setReplace(e.target.checked)}/> I confirm this correction</label>
          <input aria-label="Correction reason" maxLength={500} value={reason} onChange={e => setReason(e.target.value)} placeholder="Required correction reason" className="mt-2 w-full rounded border p-2"/>
        </div>}
        <div className="max-h-52 overflow-auto rounded-lg border"><table className="w-full text-left text-xs"><thead><tr>{['Employee','Name','Store','Date','Class','Original status','Credit'].map(h => <th key={h} className="p-2">{h}</th>)}</tr></thead><tbody>{preview.preview.map((row, index) => <tr key={index} className="border-t">{[row.employee_code,row.employee_name,row.store_code,row.attendance_date,row.class,row.original_status,row.credit].map((value, i) => <td key={i} className="p-2">{value}</td>)}</tr>)}</tbody></table></div>
        <p className="text-xs text-slate-500">Preview shows up to 100 valid rows. No attendance is written until confirmation.</p>
        <button disabled={busy || !preview.can_commit || (corrections > 0 && (!replace || !reason.trim()))} onClick={commit} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">Confirm {corrections ? 'Correction' : 'Import'}</button>
      </>}
    </div>}
  </section></div>;
}

export default function RetailAttendance() {
  usePageTitle('Reliance Retail Attendance');
  const headingRef = useRef(null);
  const uploadButtonRef = useRef(null);
  const setUploadButtonRef = useCallback(node => {
    const previous = uploadButtonRef.current;
    uploadButtonRef.current = node;
    // Refresh can remove the launcher just after the dialog restores focus to it.
    if (!node && previous === document.activeElement) headingRef.current?.focus();
  }, []);
  const {user}=useAuth();
  const today = indiaToday();
  const location = useLocation();
  const [entryScope] = useState(() => readRetailNavigation(location.state, 'attendance', today));
  const [cutoff, setCutoff] = useState(entryScope?.to || ''); const [view, setView] = useState('mtd'); const [state, setState] = useState(entryScope?.state || '');
  const [report, setReport] = useState(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [refresh, setRefresh] = useState(0);
  const [upload, setUpload] = useState(false); const [drill, setDrill] = useState(null); const [employeeStore, setEmployeeStore] = useState(null); const [employees, setEmployees] = useState([]); const [employeeDate, setEmployeeDate] = useState(today); const [employeePage, setEmployeePage] = useState(0); const [employeeBusy, setEmployeeBusy] = useState(false); const [employeeError, setEmployeeError] = useState('');
  useEffect(() => {
    // Reset server-request state on filter changes; cleanup prevents stale responses.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    let live = true; setBusy(true); setError(''); setReport(null); setDrill(null); setEmployeeStore(null);
    retailAttendanceApi.summary({ cutoff: cutoff || undefined, view, state }).then(r => { if (live) { setReport(r.report); if (!cutoff) setCutoff(r.report.cutoff); } }).catch(e => { if (live) setError(errorText(e)); }).finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [cutoff, view, state, refresh]);
  useEffect(() => {
    if (!employeeStore) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    let live = true; setEmployeeBusy(true); setEmployeeError(''); setEmployees([]);
    retailAttendanceApi.employees({ store_id: employeeStore.id, date: employeeDate, page: employeePage }).then(r => { if (live) setEmployees(r.rows); }).catch(e => { if (live) setEmployeeError(errorText(e)); }).finally(() => { if (live) setEmployeeBusy(false); });
    return () => { live = false; };
  }, [employeeStore, employeeDate, employeePage]);
  function selectMonth(month) {
    if (!/^\d{4}-\d{2}$/.test(month)) return;
    const last = new Date(Date.UTC(Number(month.slice(0,4)), Number(month.slice(5)), 0)).getUTCDate();
    setCutoff(month === today.slice(0,7) ? today : `${month}-${last}`);
  }
  async function exportReport(scope) { try { await exportRetailAttendance(report, scope); } catch (e) { setError(errorText(e)); } }
  const total = report?.total;
  const aop = attendanceAopCoverage(report);
  const states = report?.available_states?.length ? report.available_states : isPlatformAdmin(user)?STATE_OPTIONS:[];
  const period = view === 'daily' ? cutoff : `${cutoff.slice(0,7)}-01 to ${cutoff}`;
  return <div className="retail-report retail-attendance-workspace rr-attendance-page text-slate-800">{entryScope?.store&&<p role="status">Dashboard period and state applied. This Attendance endpoint does not support a store filter; use the store summary for drill-down.</p>}
    <header className="rr-attendance-page-header">
      <div className="rr-attendance-page-title"><h1 ref={headingRef} tabIndex={-1}>Reliance Retail Attendance</h1>
        <p>HK &amp; MEPC · Digital attendance and AOP performance</p></div>
      <div className="rr-attendance-page-controls">
        <label className="rr-attendance-control"><CalendarDays size={15}/><input aria-label="Month and year"
         type="month" max={today.slice(0,7)} value={cutoff.slice(0,7)} onChange={e=>selectMonth(e.target.value)}/></label>
        {report?.can_upload&&<button ref={setUploadButtonRef} type="button" className="rr-attendance-control rr-attendance-upload"
         onClick={()=>setUpload(true)}><Upload size={15}/>Upload Day Attendance</button>}
      </div>
    </header>
    <div className="rr-attendance-page-controls" aria-label="Attendance filters">
      <div role="tablist" aria-label="Attendance view" className="rr-attendance-segments">
       {[['mtd','Month-to-Date'],['daily','Daily View']].map(([value,label])=>
        <button key={value} id={`attendance-tab-${value}`} role="tab" aria-controls="attendance-report-panel" tabIndex={view===value ? 0 : -1} aria-selected={view===value} onKeyDown={event => { if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return; event.preventDefault(); const next = event.key === 'Home' ? 'mtd' : event.key === 'End' ? 'daily' : value === 'mtd' ? 'daily' : 'mtd'; setView(next); document.getElementById(`attendance-tab-${next}`)?.focus(); }}
          onClick={()=>setView(value)}>{label}</button>)}
      </div>
      <label className="rr-attendance-control"><span className="rr-attendance-filter-title">Cutoff</span>
        <input aria-label="Attendance cutoff date" type="date" value={cutoff} max={today}
         onChange={e=>{if(e.target.value)setCutoff(e.target.value);}}/></label>
      {states.length>1?
       <label className="rr-attendance-control"><span className="rr-attendance-filter-title">State</span>
        <select aria-label="State filter" value={state} onChange={e=>setState(e.target.value)}>
         <option value="">All authorized states</option>
         {states.map(code=><option key={code} value={code}>{code}</option>)}
        </select></label>:
       <span className="rr-attendance-control" aria-label="Authorized state">
        {states[0]||'Authorized state scope'}</span>}
      <button type="button" className="rr-attendance-control" onClick={()=>setRefresh(n=>n+1)}>Refresh</button>
    </div>
    <div id="attendance-report-panel" className="grid min-w-0 grid-cols-1 gap-3" role="tabpanel" aria-labelledby={`attendance-tab-${view}`} tabIndex={0}>
    {busy&&<p role="status" className="rounded-lg bg-blue-50 p-5 text-sm">Loading attendance…</p>}
    {error&&<div role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-800">
      {error}<button className={`${button} ml-3`} onClick={()=>setRefresh(n=>n+1)}>Retry</button></div>}
    {report&&<>
      <RetailAttendanceTrend report={report}/>
      <RetailAttendanceKpis report={report}/>
      <RetailAttendanceSummary report={report} onState={setDrill} onExport={exportReport}/>
      {!total.complete&&<details className="rr-attendance-caution" role="status">
        <summary><AlertTriangle size={14} className="inline mr-1"/>Incomplete attendance or AOP coverage — verified percentages are N/A</summary>
        <p>Missing attendance dates: {total.missing_dates.join(', ')||'None'}. Missing approved AOP dates: {total.missing_aop.join(', ')||'None'}.
         Missing uploads must not be counted as employee absence. AOP configured for {aop.configured} of {aop.stores} authorized stores.</p>
      </details>}
      <details className="rr-attendance-technical">
        <summary>Source coverage and calculation details</summary>
        <p>Period: {period} · Latest imported: {report.latest_imported_date||'None'} · Approved AOP: {number(aop.total_aop)} across {aop.configured}/{aop.stores} stores.
         HK: {number(aop.hk_aop)} · MEPC: {number(aop.mepc_aop)}.</p>
        <p>{report.mepc_target_policy} Decimal AOPs are preserved. Percentages require complete approved coverage.</p>
        <p>Unique attended employees: {number(report.employee_counts?.unique_employees)} · Attended employee-days: {number(report.employee_counts?.employee_days)}.
         HK replacement mapping: {report.replacement_mapping_status||'Unavailable'}.</p>
      </details>
      {isPlatformAdmin(user)&&<details className="rr-attendance-technical">
       <summary>Admin · AOP and source reconciliation</summary><RetailResponsibilityPanel/>
      </details>}
      {drill && <section className="rounded-xl border p-4"><div className="flex justify-between"><h3 className="font-semibold">{drill} — Stores</h3><button className={button} onClick={()=>{setDrill(null);setEmployeeStore(null);}}>Close</button></div><div className="my-3 flex flex-wrap gap-2">{report.stores.filter(s=>s.state===drill).map(store=><button className={button} key={store.id} onClick={()=>{setEmployeeStore(store);setEmployeeDate(cutoff);setEmployeePage(0);}}>{store.store_code} · {store.store_name}</button>)}</div><SummaryTable report={report} rows={report.stores.filter(s=>s.state===drill).map(s=>({...s,state:s.store_code}))} total={{...report.states.find(s=>s.state===drill),state:`${drill} Total`}}/>
        {employeeStore && <div className="mt-4 space-y-3 border-t pt-4"><h4 className="font-semibold">{employeeStore.store_code} — {employeeStore.store_name}: employee attendance</h4><input aria-label="Employee attendance date" type="date" value={employeeDate} max={today} onChange={e=>{setEmployeeDate(e.target.value);setEmployeePage(0);}} className="rounded border p-2 text-xs"/>
          {employeeBusy ? <p role="status">Loading employee attendance…</p> : employeeError ? <p role="alert">{employeeError}</p> : <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr>{['Employee Code','Employee Name','Store Code','Class','Attendance Date','Original Status','Credit'].map(h=><th key={h} className="p-2">{h}</th>)}</tr></thead><tbody>{employees.slice(0,100).map(row=><tr key={row.employee_code} className="border-t">{[row.employee_code,row.employee_name,row.store_code_snapshot,row.class,row.attendance_date,row.original_status,row.credit].map((v,i)=><td key={i} className="p-2">{v}</td>)}</tr>)}</tbody></table>{!employees.length && <p>No uploaded records for this store/date. This does not establish absence.</p>}</div>}
          <button className={button} disabled={!employeePage || employeeBusy} onClick={()=>setEmployeePage(n=>n-1)}>Previous</button><button className={`${button} ml-2`} disabled={employees.length<=100 || employeeBusy} onClick={()=>setEmployeePage(n=>n+1)}>Next</button>
        </div>}
      </section>}
    </>}

    </div>
    {report?.can_upload && <ImportHistory refresh={refresh}/>}
    {upload && <UploadDialog fallbackFocusRef={headingRef} onClose={()=>setUpload(false)} onImported={async()=>{setCutoff('');setRefresh(n=>n+1);}}/>}
  </div>;
}

function ImportHistory({ refresh }) {
  const [open,setOpen]=useState(false), [rows,setRows]=useState([]), [selected,setSelected]=useState(null), [page,setPage]=useState(0), [error,setError]=useState(''), [busy,setBusy]=useState(false);
  useEffect(()=>{
    if(!open) return;
    let live=true;
    retailAttendanceApi.history({page}).then(r=>{if(live){setRows(r.history);setError('');}}).catch(e=>{if(live)setError(errorText(e));});
    return()=>{live=false;};
  },[open,page,refresh]);
  async function inspect(id) { setBusy(true);setError('');try {setSelected((await retailAttendanceApi.history({id})).history);} catch(e){setError(errorText(e));}finally{setBusy(false);} }
  async function download() {try{await exportRetailAttendanceSource(selected);}catch(e){setError(errorText(e));}}
  return <section className="rounded-xl border p-4"><button className={button} onClick={()=>setOpen(v=>!v)}>Import history and exceptions</button>
    {open && <div className="mt-3 space-y-3">{error && <p role="alert">{error}</p>}<div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr>{['File / imported at','Status','Dates','Valid / rejected','Correction / source'].map(h=><th key={h} className="p-2">{h}</th>)}</tr></thead><tbody>{rows.slice(0,20).map(row=><tr key={row.id} className="border-t"><td className="p-2">{row.filename}<br/>{row.uploaded_at}</td><td>{row.status}</td><td>{row.date_from} to {row.date_to}</td><td>{row.valid_rows} / {row.rejected_rows}</td><td>{row.correction_reason}<button disabled={busy} className={button} onClick={()=>inspect(row.id)}>Source and exceptions</button></td></tr>)}</tbody></table></div>
    <button className={button} disabled={!page} onClick={()=>setPage(n=>n-1)}>Previous imports</button><button className={button} disabled={rows.length<=20} onClick={()=>setPage(n=>n+1)}>Next imports</button>
    {selected && <div className="rounded border p-3 text-xs"><p>{selected.filename} ? SHA-256: {selected.checksum}</p><p>{selected.raw_source?.rows?.length || 0} retained source rows ? {selected.raw_source?.headers?.length || 0} source columns</p><button className={button} onClick={download}>Export source and exceptions</button><div className="max-h-64 overflow-auto">{[...(selected.raw_source?.rejected || []),...(selected.raw_source?.excluded || [])].map(row=><p key={row.source_row}>Row {row.source_row} ? {row.store_code} ? {row.attendance_date}: {row.reasons.join('; ')}</p>)}</div></div>}
    </div>}
  </section>;
}
