import RetailResponsibilityPanel from '../../components/reliance-retail/RetailResponsibilityPanel.jsx';
import { createElement, useEffect, useState } from 'react';
import { BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { CalendarDays, Upload, Download, Users, ClipboardCheck, Target, Wrench, TrendingUp, AlertTriangle, X } from 'lucide-react';
import { usePageTitle } from '../../hooks/usePageTitle.js';
import { retailAttendanceApi } from '../../services/retailAttendanceApi.js';
import { attendanceColumns, exportRetailAttendance, exportRetailAttendanceSource } from '../../utils/retailAttendanceExport.js';
import { ATTENDANCE_MAX_FILE_BYTES, indiaToday, STATE_OPTIONS } from '../../../backend/shared/retailAttendance.js';
import { StoreImportButton } from '../../components/reliance-retail/StoreImportDialog.jsx';

const number = value => value == null ? 'N/A' : Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const pct = value => value == null ? 'N/A' : `${number(value)}%${value > 100 ? ' ↑' : ''}`;
const color = value => value == null ? 'bg-slate-100 text-slate-500' : value > 100 ? 'bg-blue-100 text-blue-900' : value >= 90 ? 'bg-green-100 text-green-900' : value >= 75 ? 'bg-amber-100 text-amber-900' : 'bg-red-100 text-red-900';
const button = 'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-blue-950 disabled:opacity-40';
const errorText = error => error.response?.data?.message || error.message;

function SummaryTable({ rows, total, onState }) {
  return <div className="overflow-x-auto"><table className="w-full min-w-[650px] table-fixed text-right text-[10px]"><thead className="bg-blue-50 text-blue-950"><tr>{attendanceColumns.map(([key, label]) => <th key={key} className={`px-1 py-3 ${key === 'state' ? 'text-left' : ''}`}>{label}</th>)}</tr></thead>
    <tbody>{[...rows, total].map((row, index) => <tr key={row.state} className={`border-t border-slate-100 ${index === rows.length ? 'bg-blue-50 font-bold' : ''}`}>
      {attendanceColumns.map(([key]) => <td key={key} className={`whitespace-nowrap px-1 py-3 ${key.endsWith('_pct') ? color(row[key]) : ''} ${key === 'state' ? 'text-left font-semibold' : ''}`}>
        {key === 'state' ? onState && index !== rows.length ? <button className="text-blue-700 underline" onClick={() => onState(row.state)}>{row.state}</button> : row.state : key.endsWith('_pct') ? pct(row[key]) : row.missing_aop.length && (key.includes('aop') || key.includes('target')) ? 'N/A' : number(row[key])}
      </td>)}
    </tr>)}</tbody></table></div>;
}

function UploadDialog({ onClose, onImported }) {
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
  const corrections = preview?.affected_records?.length || 0;
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"><section role="dialog" aria-modal="true" aria-label="Upload Day Attendance" className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
    <div className="flex items-center justify-between"><h2 className="text-lg font-bold text-blue-950">Upload Day Attendance</h2><button aria-label="Close upload" disabled={busy} onClick={onClose}><X size={20}/></button></div>
    <p className="my-3 text-sm text-slate-600">Preview the M-here workbook before import. Store and state are resolved from the Reliance Retail Store Master.</p>
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
  const today = indiaToday();
  const [cutoff, setCutoff] = useState(''); const [view, setView] = useState('mtd'); const [state, setState] = useState('');
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
  const targetKnown = total && !total.missing_aop.length;
  const cards = total ? [
    [view === 'daily' ? 'Approved Manpower / AOP' : 'Total AOP Count', targetKnown ? number(total.total_aop) : 'N/A', Users],
    [view === 'daily' ? 'Present Attendance Credits' : 'Actual Man-days', number(total.total_actual), ClipboardCheck],
    [view === 'daily' ? 'Attendance Shortfall (Target − Actual)' : 'Target Man-days', targetKnown ? number(view === 'daily' ? total.shortfall : total.total_target) : 'N/A', Target],
    ['HK Attendance', pct(total.hk_pct), Users], ['MEPC Attendance', pct(total.mepc_pct), Wrench], ['Overall Attendance', pct(total.overall_pct), TrendingUp],
  ] : [];
  const states = STATE_OPTIONS;
  const period = view === 'daily' ? cutoff : `${cutoff.slice(0,7)}-01 to ${cutoff}`;
  return <div className="space-y-4 rounded-xl bg-white p-4 text-slate-800 md:p-5">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-bold text-blue-950">Reliance Retail Attendance</h1><p className="text-sm text-slate-500">Manpower attendance summary using daily uploaded data.</p><p className="mt-2 font-semibold text-blue-950">Latest imported attendance date: {report?.latest_imported_date || 'No attendance imported'}</p></div>
      <div className="flex flex-wrap gap-2"><label className={button}><CalendarDays size={16}/><input aria-label="Month and year" type="month" max={today.slice(0,7)} value={cutoff.slice(0,7)} onChange={e => selectMonth(e.target.value)}/></label>
        <StoreImportButton onImported={() => setRefresh(value => value + 1)}/>
        {report?.can_upload && <button onClick={() => setUpload(true)} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white"><Upload size={16}/>Upload Day Attendance</button>}
      </div></header>
    <div className="flex flex-wrap items-center justify-between gap-3"><div role="tablist" aria-label="Attendance view" className="inline-flex rounded-lg border border-blue-100 bg-blue-50 p-1">{[['mtd','Month-to-Date'],['daily','Daily View']].map(([value,label]) => <button key={value} role="tab" aria-selected={view===value} onClick={() => setView(value)} className={`rounded-md px-5 py-2 text-xs font-semibold ${view===value ? 'bg-blue-600 text-white' : 'text-blue-950'}`}>{label}</button>)}</div>
      <div className="flex gap-2"><input aria-label="Attendance cutoff date" type="date" value={cutoff} max={today} onChange={e => { if (e.target.value) setCutoff(e.target.value); }} className="rounded-lg border p-2 text-xs"/>
        <select aria-label="State filter" value={state} onChange={e => setState(e.target.value)} className="rounded-lg border p-2 text-xs"><option value="">All States</option>{states.map(s => <option key={s}>{s}</option>)}</select></div>
    </div>
    <details open className="rounded-xl border p-4"><summary className="cursor-pointer font-bold">All-state coverage, FO ownership and source AOP review</summary><RetailResponsibilityPanel/></details>
    {busy && <p role="status" className="rounded-lg bg-blue-50 p-6">Loading attendance…</p>}
    {error && <div role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-800">{error}<button className={`${button} ml-3`} onClick={() => setRefresh(n => n+1)}>Retry</button></div>}
    {report && <>
      <div><h2 className="font-semibold text-blue-950">{view === 'daily' ? 'Daily' : 'Month-to-Date'} Attendance ({period})</h2><p className="text-xs text-slate-500">Latest successfully imported attendance date: {report.latest_imported_date || 'No uploads'}. AOP count is applicable at the selected cutoff.</p></div>
      {!total.complete && <div role="status" className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><AlertTriangle size={18}/><div>Incomplete data. Missing store attendance dates: {total.missing_dates.join(', ') || 'None'}. Missing AOP dates: {total.missing_aop.join(', ') || 'None'}. Attendance percentages are N/A until coverage and approved AOP are complete. Missing uploads are not employee absence.</div></div>}
      {report.aop_mapping_blocked && <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">Approved effective-dated AOP configuration is pending budget-source confirmation. Existing Store Master budgets have not been substituted or changed.</p>}
      {!report.stores.length && <p className="rounded-lg border p-6 text-sm">No Retail stores in this authorized state/filter.</p>}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">{cards.map(([label,value,Icon],index) => <article key={label} className={`flex min-h-28 items-start gap-3 rounded-xl border border-slate-100 p-4 ${['bg-blue-50/70','bg-green-50/70','bg-amber-50/70','bg-orange-50/70','bg-violet-50/70','bg-red-50/70'][index]}`}>{createElement(Icon,{className:'mt-1 h-6 w-6 shrink-0 text-blue-600'})}<div><p className="text-xs text-blue-950">{label}</p><p className="mt-2 text-xl font-bold text-blue-950">{value}</p>{index < 3 && <p className="mt-1 text-[10px] text-slate-500">HK: {index!==1 && !targetKnown ? 'N/A' : number(index===0 ? total.hk_aop : index===1 ? total.hk_actual : view==='daily' ? total.complete ? total.hk_target-total.hk_actual : null : total.hk_target)} | MEPC: {index!==1 && !targetKnown ? 'N/A' : number(index===0 ? total.mepc_aop : index===1 ? total.mepc_actual : view==='daily' ? total.complete ? total.mepc_target-total.mepc_actual : null : total.mepc_target)}</p>}</div></article>)}</div>
      <p className="text-xs text-slate-600">{report.mepc_target_policy || 'HK uses daily approved AOP. MEPC uses the existing seven-day aggregate planning cycle; this is not an employee weekly-off roster.'} Decimal AOP values are preserved. Missing or conflicting approved AOP remains N/A.</p>
      {total.over_target && <p className="text-xs font-semibold text-blue-700">Over target: actual credits exceed target. Values above 100% are retained.</p>}
      <div className="grid gap-4 xl:grid-cols-[minmax(300px,0.8fr)_minmax(0,1.5fr)]">
        <section className="min-w-0 rounded-xl border border-slate-200 p-3"><h3 className="mb-3 text-sm font-bold text-blue-950">State-wise HK vs MEPC Attendance %</h3><ResponsiveContainer width="100%" height={260}><BarChart data={report.states} margin={{left:0,right:10,top:10,bottom:5}}><CartesianGrid vertical={false} stroke="#edf1f7"/><XAxis dataKey="state" tick={{fontSize:11}}/><YAxis domain={[0, dataMax => Math.max(100, dataMax)]} tick={{fontSize:10}} tickFormatter={v=>`${v}%`}/><Tooltip formatter={pct}/><Legend iconType="circle" wrapperStyle={{fontSize:11}}/><Bar isAnimationActive={false} name="HK %" dataKey="hk_pct" fill="#1685ff" radius={[3,3,0,0]}/><Bar isAnimationActive={false} name="MEPC %" dataKey="mepc_pct" fill="#a46af4" radius={[3,3,0,0]}/></BarChart></ResponsiveContainer></section>
        <section className="min-w-0 rounded-xl border border-slate-200"><div className="flex flex-wrap items-center justify-between gap-2 p-3"><h3 className="text-sm font-bold text-blue-950">State-wise Summary</h3><div className="flex gap-2"><button className={button} onClick={()=>exportReport('consolidated')}><Download size={13}/>Total</button><button className={button} onClick={()=>exportReport('states')}><Download size={13}/>Export</button><button className={button} onClick={()=>exportReport('stores')}>Store export</button></div></div><SummaryTable rows={report.states} total={total} onState={setDrill}/></section>
      </div>
      {drill && <section className="rounded-xl border p-4"><div className="flex justify-between"><h3 className="font-semibold">{drill} — Stores</h3><button className={button} onClick={()=>{setDrill(null);setEmployeeStore(null);}}>Close</button></div><div className="my-3 flex flex-wrap gap-2">{report.stores.filter(s=>s.state===drill).map(store=><button className={button} key={store.id} onClick={()=>{setEmployeeStore(store);setEmployeeDate(cutoff);setEmployeePage(0);}}>{store.store_code} · {store.store_name}</button>)}</div><SummaryTable rows={report.stores.filter(s=>s.state===drill).map(s=>({...s,state:s.store_code}))} total={{...report.states.find(s=>s.state===drill),state:`${drill} Total`}}/>
        {employeeStore && <div className="mt-4 space-y-3 border-t pt-4"><h4 className="font-semibold">{employeeStore.store_code} — {employeeStore.store_name}: employee attendance</h4><input aria-label="Employee attendance date" type="date" value={employeeDate} max={today} onChange={e=>{setEmployeeDate(e.target.value);setEmployeePage(0);}} className="rounded border p-2 text-xs"/>
          {employeeBusy ? <p role="status">Loading employee attendance…</p> : employeeError ? <p role="alert">{employeeError}</p> : <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr>{['Employee Code','Employee Name','Store Code','Class','Attendance Date','Original Status','Credit'].map(h=><th key={h} className="p-2">{h}</th>)}</tr></thead><tbody>{employees.slice(0,100).map(row=><tr key={row.employee_code} className="border-t">{[row.employee_code,row.employee_name,row.store_code_snapshot,row.class,row.attendance_date,row.original_status,row.credit].map((v,i)=><td key={i} className="p-2">{v}</td>)}</tr>)}</tbody></table>{!employees.length && <p>No uploaded records for this store/date. This does not establish absence.</p>}</div>}
          <button className={button} disabled={!employeePage || employeeBusy} onClick={()=>setEmployeePage(n=>n-1)}>Previous</button><button className={`${button} ml-2`} disabled={employees.length<=100 || employeeBusy} onClick={()=>setEmployeePage(n=>n+1)}>Next</button>
        </div>}
      </section>}
    </>}
    <p className="text-xs text-slate-500">Unique employees with positive attendance: {number(report?.employee_counts?.unique_employees)}; attended employee-days: {number(report?.employee_counts?.employee_days)}. Attendance credits remain separate from headcount. HK replacement attendance: {report?.replacement_mapping_status || 'Unavailable / pending source mapping'}. MEPC targets use an aggregate 7-day planning cycle; they do not assign employee weekly-off dates.</p>
    {report?.can_upload && <ImportHistory refresh={refresh}/>}
    {upload && <UploadDialog onClose={()=>setUpload(false)} onImported={async()=>{setCutoff('');setRefresh(n=>n+1);}}/>}
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
