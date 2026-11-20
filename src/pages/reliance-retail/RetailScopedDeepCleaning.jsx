import { useLocation } from 'react-router-dom';
import { readRetailNavigation } from '../../utils/retailNavigation.js';
import DeepCleaningOverview from '../../components/reliance-retail/DeepCleaningOverview.jsx';
import DeepCleaningExportControls from '../../components/reliance-retail/DeepCleaningExportControls.jsx';
import DeepCleaningEvidenceDrawer from '../../components/reliance-retail/DeepCleaningEvidenceDrawer.jsx';
import RetailCleaningMonthlyPlan from '../../components/reliance-retail/RetailCleaningMonthlyPlan.jsx';
import { cleaningView, recordedFoName, recordedFoCode, cleaningPhotoCount, recordedStatus } from '../../utils/deepCleaningView.js';
import {trainingMonthRange as cleaningMonthRange} from '../../utils/deepCleaningExport.js';
import { useRetailExcelRows } from '../../utils/useRetailExcelRows.js';
import { excelCleaningRows, isExcelSource } from '../../utils/retailExcelInline.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, RefreshCw, CalendarDays, ChevronDown, History, Info, Filter, Search, Images, Eye, Table2 } from 'lucide-react';
import { authenticatedApiRequest } from '../../services/api.js';
import { indiaToday } from '../../../backend/shared/retailAttendance.js';
import { REPORTING_STATES } from './ifmsDashboardModel.js';
import { usePageTitle } from '../../hooks/usePageTitle.js';
import { ReportNotice, ReportPager } from '../../components/reliance-retail/RetailReportUi.jsx';
import { reportPage } from '../../utils/retailReportView.js';
import RetailCleaningSchedule from '../../components/reliance-retail/RetailCleaningSchedule.jsx';
import { useAuth } from '../../context/auth-context.js';
import { isReadOnlyUser } from '../../utils/demoAccess.js';
import { isPlatformAdmin } from '../../utils/authRoles.js';
import '../../components/reliance-retail/deepCleaningV2.css';
import '../../components/reliance-retail/thermographyReports.css';
import '../../components/reliance-retail/deepCleaningThermographyLayout.css';
function VerifiedFoLink({scheduleId,onSaved}) {
  const [source,setSource]=useState(''),[kind,setKind]=useState('legacy'),[reason,setReason]=useState('');
  const [confirmed,setConfirmed]=useState(false),[exception,setException]=useState(false),[preview,setPreview]=useState(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const reset=()=>{setPreview(null);setConfirmed(false);setException(false);};
  async function command(action){
    setBusy(true);setError('');
    try{
      const response=await authenticatedApiRequest({method:'POST',url:`/api/reliance-retail/module-reports/deep-cleaning/${encodeURIComponent(scheduleId)}/link-fo`,data:{source_id:source,...(kind==='client'?{source_kind:'client',action,reason,revision:preview?.revision,allow_date_exception:exception}:{})}});
      if(action==='preview')setPreview(response.data.result);else onSaved();
    }catch(e){setError(e.response?.data?.message||e.message);}finally{setBusy(false);}
  }
  return <details><summary>Link verified FO completion</summary><form onSubmit={e=>{e.preventDefault();if(confirmed&&!busy)void command('link');}}>
    <label>Submission source<select value={kind} onChange={e=>{setKind(e.target.value);reset();}}><option value="legacy">Existing verified FO activity</option><option value="client">Independent Deep Cleaning submission</option></select></label>
    <label>Existing FO submission ID<input required aria-label="Existing FO cleaning submission ID" value={source} onChange={e=>{setSource(e.target.value);reset();}}/></label>
    {kind==='client'&&<><button type="button" disabled={busy||!source} onClick={()=>void command('preview')}>Preview authorized historical link</button>
      {preview&&<p role="status">Store {preview.store_code}; scheduled {preview.scheduled_date}; actual visit {preview.actual_date}; FO {preview.employee_code||'Not recorded'}. Original dates and evidence remain unchanged.</p>}
      <label>Historical review reason<textarea required minLength={20} maxLength={2000} value={reason} onChange={e=>{setReason(e.target.value);setConfirmed(false);}}/></label>
      {preview&&!preview.exact_date&&<label><input type="checkbox" checked={exception} onChange={e=>{setException(e.target.checked);setConfirmed(false);}}/>I explicitly approve this recorded date exception after reviewing both original dates.</label>}</>}
    <label><input required type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>I verified this submitted work against the recorded schedule.</label>
    <p>Automatic matching uses exact store/date only. Historical exceptions require an authorized Admin, a verified canonical submission, stored paired evidence and an audited reason. Missing identity or evidence cannot be overridden.</p>
    {error&&<p role="alert">{error}</p>}
    <button disabled={busy||!confirmed||kind==='client'&&(!preview||reason.trim().length<20||!preview.exact_date&&!exception)}>Confirm verified link</button>
  </form></details>;
}
export default function RetailScopedDeepCleaning() {
  usePageTitle('Reliance Retail Deep Cleaning');
  const {
    user
  } = useAuth();
  const [selected, setSelected] = useState(null),
    [evidenceError, setEvidenceError] = useState('');
  const [monthly, setMonthly] = useState(true),
    [monthlyAllowed, setMonthlyAllowed] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [tab,setTab]=useState('scheduled'),[instructions,setInstructions]=useState(false),[scheduleHistory,setScheduleHistory]=useState(false);
  const monthlySection=useRef(null),historySection=useRef(null);
  function moveTab(event){
    const keys=['ArrowLeft','ArrowRight','Home','End'];if(!keys.includes(event.key))return;event.preventDefault();
    const current=event.target.id==='dc-tab-submitted'?'submitted':'scheduled';
    const next=event.key==='Home'?'scheduled':event.key==='End'?'submitted':current==='scheduled'?'submitted':'scheduled';
    setTab(next);document.getElementById('dc-tab-'+next)?.focus();
  }
  const today = indiaToday();
  const location = useLocation();
  const [entryScope] = useState(() => readRetailNavigation(location.state, 'cleaning', today));
  const [from, setFrom] = useState(entryScope?.from || today.slice(0, 7) + '-01'),
    [to, setTo] = useState(entryScope?.to || today),
    [state, setState] = useState(entryScope?.state || ''),
    [store, setStore] = useState(entryScope?.store || ''),
    [status, setStatus] = useState('');
  const [query, setQuery] = useState(''),
    [page, setPage] = useState(0),
    [workPage, setWorkPage] = useState(0),
    [size, setSize] = useState(25),
    [refresh, setRefresh] = useState(0);
  const [report, setReport] = useState(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [exporting, setExporting] = useState(false),
    [evidence, setEvidence] = useState(null),
    [evidenceBusy, setEvidenceBusy] = useState(false);
  const evidenceRequest = useRef(0);
  const evidenceFlight = useRef(null);
  const invalidateEvidence = useCallback(() => {
    evidenceRequest.current++;
    evidenceFlight.current?.controller.abort();
    evidenceFlight.current=null;
  }, []);
  const clearEvidence = useCallback(() => {
    evidenceRequest.current++;
    evidenceFlight.current?.controller.abort();
    evidenceFlight.current=null;
    setEvidence(null);
    setSelected(null);
    setEvidenceError('');
    setEvidenceBusy(false);
  }, []);
  function resetView() {
    setPage(0);
    setWorkPage(0);
    clearEvidence();
  }
  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    invalidateEvidence();
    queueMicrotask(() => {
      if (live) {
        setBusy(true);
        setError('');
        setReport(null);
        setEvidence(null);
        setSelected(null);
        setEvidenceError('');
        setEvidenceBusy(false);
      }
    });
    Promise.resolve().then(() => live ? authenticatedApiRequest({
      url: '/api/reliance-retail/module-reports/deep-cleaning',
      signal: controller.signal,
      params: {
        from,
        to,
        state,
        store
      }
    }) : null).then(r => {
      if (live) setReport(r.data.report);
    }).catch(e => {
      if (live) setError(e.response?.data?.message || e.message);
    }).finally(() => {
      if (live) setBusy(false);
    });
    return () => {
      live = false;
      controller.abort();
      invalidateEvidence();
    };
  }, [from, to, state, store, refresh, invalidateEvidence]);
  async function inspect(id, record) {
    const key=JSON.stringify([id,from,to,state,store]);
    if(evidenceFlight.current?.key===key)return;
    evidenceFlight.current?.controller.abort();
    const controller=new AbortController();
    evidenceFlight.current={key,controller};
    const request = ++evidenceRequest.current;
    setSelected(record || view.work.find(row => row.id === id) || view.linkedWork.find(row=>row.id===id) || {
      id
    });
    setEvidenceError('');
    setEvidence(null);
    setEvidenceBusy(true);
    try {
      const result = await authenticatedApiRequest({
        url: `/api/reliance-retail/module-reports/deep-cleaning/${encodeURIComponent(id)}/evidence`,
        signal: controller.signal,
        params: {
          from,
          to,
          state,
          store
        }
      });
      if (request === evidenceRequest.current) setEvidence(result.data.uploads);
    } catch (e) {
      if (request === evidenceRequest.current) setEvidenceError(e.response?.data?.message || e.message);
    } finally {
      if(evidenceFlight.current?.controller===controller)evidenceFlight.current=null;
      if (request === evidenceRequest.current) setEvidenceBusy(false);
    }
  }
  const excel = useRetailExcelRows('deep_cleaning', from <= '2026-10-31' && to >= '2026-10-01');
  const historical = excelCleaningRows(excel.rows, {
    from,
    to,
    state,
    store,
    query
  });
  const view = cleaningView(report, historical, {
      status,
      query
    }),
    rows = view.schedules,
    work = view.work,
    totals = report?.totals;
  const reportedCompleted = historical.submissions.length;
  const activeFilters = Number(from !== today.slice(0, 7) + '-01' || to !== today) + [state, store, status, query.trim()].filter(Boolean).length;
  function resetFilters() {
    resetView();
    setFrom(today.slice(0, 7) + '-01');
    setTo(today);
    setState('');
    setStore('');
    setStatus('');
    setQuery('');
  }
  const schedulingAccess = useCallback(async () => {
    try {
      const result = await authenticatedApiRequest({
        url: '/api/reliance-retail/mis/access'
      });
      const access = result.data.result;
      setMonthlyAllowed(!isReadOnlyUser(user) && access?.active === true && (access.cleaning_schedule_admin === true || !access.read_only && (access.role === 'CENTRAL_MIS' || access.role === 'CLEANING_SCHEDULE_WRITER' && access.schedule_writer === true) && access.modules?.includes('cleaning')));
    } catch {
      setMonthlyAllowed(false);
    }
  }, [user]);
  useEffect(()=>{let live=true;Promise.resolve().then(()=>{if(live)void schedulingAccess();});return()=>{live=false;};},[schedulingAccess]);
  async function exportReport() {
    setExporting(true);
    setError('');
    try {
      const {
          default: ExcelJS
        } = await import('exceljs'),
        {
          downloadUnified
        } = await import('../../utils/retailUnifiedExport.js'),
        book = new ExcelJS.Workbook(),
        sheet = book.addWorksheet('Filtered schedules');
      sheet.addRow(['Store Code', 'Store Name', 'Geographic State', 'Reporting State', 'Scheduled Date', 'Status', 'Not Completed Reason', 'Overdue', 'Completion Submission IDs', 'Source', 'FO evidence verified']);
      rows.forEach(row => sheet.addRow([row.store.store_code, row.store.store_name, row.store.state, row.reporting_state, row.scheduled_date, row.display_status, row.not_done_reason, Boolean(row.overdue), (row.submission_ids || []).join(', '), isExcelSource(row) ? 'October Excel (reported)' : 'Operational', isExcelSource(row) ? 'No' : 'See recorded submissions']));
      const submitted = book.addWorksheet('Recorded work');
      submitted.addRow(['Store Code', 'Date', 'Recorded Status', 'Before Images', 'After Images', 'Source', 'Verified FO submission']);
      work.forEach(row => submitted.addRow([row.store.store_code, row.deep_cleaning_date || 'Not recorded in source', row.status, row.before_count ?? '', row.after_count ?? '', isExcelSource(row) ? 'October Excel (reported)' : 'Operational', isExcelSource(row) ? 'No' : 'Yes']));
      await downloadUnified(book, 'Retail_Deep_Cleaning.xlsx');
    } catch (e) {
      setError(e.message);
    } finally {
      setExporting(false);
    }
  }
  return <section className="retail-report dc-v2 dc-layout thermo-v2 dc-thermo-layout" aria-busy={busy}>
    <div className="dc-main">
      <header className="thv2-header"><div><p className="thv2-eyebrow">RELIANCE RETAIL / OPERATIONS</p><h1>Deep Cleaning</h1><p>Manage monthly cleaning schedules, completed visits and photo evidence.</p></div>
        <div className="thv2-actions">
          <DeepCleaningExportControls from={from} to={to} state={state} store={store} status={status} query={query} disabled={!report || busy || exporting}><button disabled={!report || busy || exporting} onClick={()=>void exportReport()}><Download size={16}/>{exporting?'Exporting...':'Export Report'}</button></DeepCleaningExportControls>
          <button aria-expanded={scheduleHistory} aria-controls="dc-schedule-history" onClick={()=>{setTab('scheduled');setScheduleHistory(value=>!value);requestAnimationFrame(()=>historySection.current?.scrollIntoView({block:'nearest'}));}}><History size={16}/>Schedule History</button>
          <button aria-expanded={instructions} aria-controls="dc-instructions" onClick={()=>setInstructions(value=>!value)}><Info size={16}/>Instructions</button>
        </div>
      </header>
      {instructions&&<section id="dc-instructions" className="dc-inline-note" aria-label="Deep Cleaning instructions"><h2>Reporting instructions</h2><p>Choose a month, state, store and date range. Cards, chart, report tables and filtered exports retain the existing authorized reporting range. Future-inclusive ranges are labelled as selected-range counts, not till-date counts.</p><p>Monthly Excel imports use the separately selected schedule month and include the full monthly plan. Store Master validation, the 500-row limit and whole-workbook confirmation remain mandatory. Submitted reports and completed schedules are separate measures.</p><p>View evidence and downloads in Submitted Work &amp; Evidence. Corrections, history and verified linking remain subject to existing backend authorization.</p></section>}
      <section className="thv2-filters dc-filter-grid" aria-label="Cleaning filters">
        <label>Month<input aria-label="Cleaning reporting month" type="month" value={from.slice(0,7)===to.slice(0,7)?from.slice(0,7):''} onChange={e=>{if(e.target.value){const range=cleaningMonthRange(e.target.value);resetView();setFrom(range.from);setTo(range.to);}}}/></label>
        <label>State<select aria-label="Cleaning state" value={state} onChange={e=>{resetView();setState(e.target.value);setStore('');}}><option value="">All authorized states</option>{REPORTING_STATES.map(item=><option key={item.code} value={item.code}>{item.label}</option>)}</select></label>
        <label>Store<select aria-label="Cleaning store" value={store} onChange={e=>{resetView();setStore(e.target.value);}}><option value="">All stores</option>{report?.stores?.map(item=><option key={item.id} value={item.id}>{item.store_code} / {item.store_name}</option>)}</select></label>
        <fieldset><legend>KPI Date Range</legend><div className="thv2-dates"><input aria-label="Cleaning from" type="date" value={from} max={to} onChange={e=>{if(e.target.value){resetView();setFrom(e.target.value);}}}/><span>-</span><input aria-label="Cleaning to" type="date" value={to} min={from} onChange={e=>{if(e.target.value){resetView();setTo(e.target.value);}}}/></div></fieldset>
      </section>
      <div className="dc-range-tools"><span>{from} / {to} / Asia/Kolkata / {activeFilters} active filters</span><div><button onClick={resetFilters}>Reset filters</button><button disabled={busy} onClick={()=>{resetView();setRefresh(value=>value+1);}}><RefreshCw size={14}/>Refresh</button></div></div>
      {busy&&<ReportNotice>Loading cleaning tracker...</ReportNotice>}{error&&<ReportNotice error>{error}</ReportNotice>}
      <DeepCleaningOverview view={view} available={Boolean(report&&totals&&!busy)} from={from} to={to} today={today}/>
      <section className="dc-monthly-area" ref={monthlySection} aria-label="Monthly schedule import">
        <div className="thv2-upload-strip"><CalendarDays aria-hidden="true"/><div><h2>Upload Monthly Schedule</h2><p>Excel (.xlsx) / STATE, STORE_CODE, SCHEDULE_DATE / up to 500 rows / FO assignment optional</p></div>
          <details className="dc-schedule-menu" onToggle={e=>{if(e.currentTarget.open)void schedulingAccess();}}><summary><CalendarDays size={15}/>Schedule Deep Cleaning<ChevronDown size={14}/></summary><div><button disabled={isReadOnlyUser(user)} onClick={e=>{e.currentTarget.closest('details').open=false;setScheduling(true);}}>Schedule a visit</button>{monthlyAllowed&&<button onClick={e=>{e.currentTarget.closest('details').open=false;setMonthly(true);requestAnimationFrame(()=>monthlySection.current?.scrollIntoView({block:'nearest'}));}}>Monthly Excel schedule import</button>}</div></details>
        </div>
        {monthlyAllowed?(monthly?<div className="dc-monthly"><div className="dc-import-heading"><h2>Monthly Excel Schedule Import</h2><button onClick={()=>setMonthly(false)}>Close import</button></div><RetailCleaningMonthlyPlan showManagement={false} onImported={()=>setRefresh(value=>value+1)}/></div>:<button className="thv2-primary" onClick={()=>setMonthly(true)}>Monthly Excel schedule import</button>):<p className="dc-permission-note">Monthly import is available only with your existing verified schedule-write permission. Read-only access is unchanged.</p>}
      </section>
      {scheduling&&<RetailCleaningSchedule readOnly={isReadOnlyUser(user)} onClose={()=>setScheduling(false)} onSaved={result=>{resetView();const day=result.schedule?.scheduled_date;if(day&&day>to)setTo(day);setRefresh(value=>value+1);}}/>}
      <div className="dc-view-tabs" role="tablist" aria-label="Deep Cleaning records" onKeyDown={moveTab}>
        <button role="tab" id="dc-tab-scheduled" aria-controls="dc-panel-scheduled" aria-selected={tab==='scheduled'} tabIndex={tab==='scheduled'?0:-1} onClick={()=>setTab('scheduled')}>Scheduled Deep Cleaning <span>{rows.length}</span></button>
        <button role="tab" id="dc-tab-submitted" aria-controls="dc-panel-submitted" aria-selected={tab==='submitted'} tabIndex={tab==='submitted'?0:-1} onClick={()=>setTab('submitted')}>Submitted Work &amp; Evidence <span>{work.length}</span></button>
      </div>
      <div className="thv2-table-tools dc-record-tools"><label className="thv2-search"><Search size={15}/><input aria-label="Search cleaning records" type="search" placeholder="Search store code, name or FO" value={query} onChange={e=>{resetView();setQuery(e.target.value);}}/></label><label>Status<select aria-label="Cleaning status" value={status} onChange={e=>{resetView();setStatus(e.target.value);}}><option value="">All statuses</option>{view.statuses.map(value=><option key={value}>{value}</option>)}</select></label></div>
      {report&&!busy&&<>
        {!totals&&<ReportNotice>Schedule storage is unavailable. Completion submissions remain visible; scheduled totals are unavailable.</ReportNotice>}{!!report.exceptions?.length&&<ReportNotice>{report.exceptions.length} records excluded because canonical store identity is unresolved.</ReportNotice>}
        <section id="dc-panel-scheduled" role="tabpanel" aria-labelledby="dc-tab-scheduled" hidden={tab!=='scheduled'} tabIndex={0}>
          <div className="thv2-table-title"><h2>Scheduled Deep Cleaning</h2><p>{rows.length} matching schedules / selected reporting range</p></div>
          <div className="thv2-table-scroll" role="region" aria-label="Cleaning schedules" tabIndex={0}><table><thead><tr>{['State','Store Code','Store Name','Scheduled Date','Assigned FO / Completion FO','Status','Actions'].map(label=><th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{reportPage(rows,page,size).map(row=><tr key={row.id}>
            <td><span className="thv2-state">{REPORTING_STATES.find(item=>item.code===row.reporting_state)?.label||row.reporting_state||row.store.state||'Not recorded'}</span></td>
            <td>{row.store.id?<button className="retail-report-link" onClick={()=>{resetView();setStore(row.store.id);}}>{row.store.store_code}</button>:<strong>{row.store.store_code}</strong>}</td>
            <td>{row.store.store_name||'Store name unavailable'}{isExcelSource(row)&&<small>Excel reported / {row.match_status==='MATCHED'?'Store matched':'Store identity unresolved'}</small>}</td>
            <td>{row.scheduled_date}</td><td>{row.completion?.fo_name||row.completion?.employee_code||row.assigned_fo_name||row.assigned_fo_employee_code||'Unassigned / not recorded'}</td>
            <td><span className="retail-report-status" data-status={row.display_status}>{row.display_status}</span>{isExcelSource(row)&&<small>Excel reported / not FO verified</small>}{row.overdue&&<small>Overdue / completion not recorded</small>}</td>
            <td><details className="dc-row-details"><summary>Details &amp; evidence</summary><p>Actual visit: {row.completion?.actual_date||'Not recorded'}</p><p>{row.not_done_reason||'No recorded exception reason'}</p>{(row.submission_ids||[]).map(id=><button key={id} disabled={evidenceBusy} onClick={()=>void inspect(id)}>Before / after evidence</button>)}</details>{!isExcelSource(row)&&isPlatformAdmin(user)&&!isReadOnlyUser(user)&&row.display_status==='Scheduled'&&<VerifiedFoLink scheduleId={row.id} onSaved={()=>{resetView();setRefresh(value=>value+1);}}/>}</td>
          </tr>)}</tbody></table>{!rows.length&&<p className="dc-empty">No matching recorded schedules.</p>}</div>
          <ReportPager label="Cleaning schedules" count={rows.length} page={page} size={size} onPage={setPage} onSize={setSize}/>
          <section id="dc-schedule-history" ref={historySection} hidden={!scheduleHistory} className="dc-inline-note" aria-label="Schedule history"><h2>Schedule History</h2><p>Full-month administration is separate from the date-filtered reporting table above. Corrections require the existing permission, a reason and the recorded revision. Historical completion links retain original dates.</p>{monthlyAllowed?<RetailCleaningMonthlyPlan key={from.slice(0,7)} showImport={false} initialMonth={from.slice(0,7)} refreshKey={refresh} onImported={()=>setRefresh(value=>value+1)}/>:<p>Use Details &amp; evidence to inspect available schedule records. Additional administration history requires your existing schedule-write permission.</p>}</section>
        </section>
        <section id="dc-panel-submitted" role="tabpanel" aria-labelledby="dc-tab-submitted" hidden={tab!=='submitted'} tabIndex={0} className="dc-work">
          <div className="thv2-table-title"><h2><Table2 size={17}/>Store-wise Submitted Work</h2><p>{work.length.toLocaleString('en-IN')} submissions <button disabled={!work.length} onClick={()=>{setSize(100);setWorkPage(0);}}>Show 100</button></p></div>
          <div className="dc-table-scroll thv2-table-scroll" role="region" aria-label="Submitted cleaning work" tabIndex={0}><table><thead><tr>{['Store Code','Store Name','State','FO Name','Scheduled Date','Visit Date','Status','Evidence','Actions'].map(label=><th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{reportPage(work,workPage,size).map(row=><tr key={row.id} className={selected?.id===row.id?'dc-selected':''}>
            <td><strong>{row.store.store_code}</strong></td><td>{row.store.store_name}</td><td>{row.store.state}</td><td>{recordedFoName(row)||recordedFoCode(row)||'Not recorded'}</td><td>{row.scheduled_date||'Not recorded'}</td><td>{row.deep_cleaning_date||'Not recorded'}</td><td><span className="dc-status" data-status={recordedStatus(row)}>{recordedStatus(row)}</span>{isExcelSource(row)&&<small>Excel reported / unverified</small>}</td><td><span className="dc-evidence-count"><Images size={13}/>{isExcelSource(row)?'Not supplied':cleaningPhotoCount(row)==null?'Not recorded':cleaningPhotoCount(row)+' photos'}</span></td>
            <td>{isExcelSource(row)?<small>No FO evidence</small>:<DeepCleaningExportControls row={row} from={from} to={to} state={state} store={store} status={status} query={query}><button aria-label={'View evidence for '+row.store.store_code} onClick={()=>void inspect(row.id,row)}><Eye size={12}/>View</button></DeepCleaningExportControls>}</td>
          </tr>)}</tbody></table>{!work.length&&<p className="dc-empty">No authorized submissions match these filters.</p>}</div>
          <ReportPager label="Cleaning work" count={work.length} page={workPage} size={size} onPage={setWorkPage} onSize={setSize}/>
        </section>
        <details className="dc-report-notes"><summary><Filter size={14}/>Reporting definitions and source history</summary><p>Completed Till Date and green state-chart bars count submitted Deep Cleaning reports with a recorded Completed outcome, independently of schedule linkage. Main completion percentage divides confirmed completed reports by scheduled jobs. Verified schedule-linked completion is shown separately; Pending and overdue still use verified schedule fulfilment. Different actual dates never rewrite scheduled dates. Cancelled schedules and Excel-reported rows are excluded from operational KPIs. Filters retain the same authorized state/store/date scope.</p><p>Month-on-month comparison and additional audit events are unavailable unless supplied by the existing API. Missing FO details and timestamps are never inferred.</p>{historical.schedules.length>0&&<p>October Excel: {historical.schedules.length} source schedules; {reportedCompleted} source-reported completions, without FO-verified evidence.</p>}{excel.loading&&<ReportNotice>Loading October Excel history...</ReportNotice>}{excel.error&&<ReportNotice error>October Excel records could not be loaded: {excel.error}</ReportNotice>}</details>
      </>}
    </div>
    {selected&&<DeepCleaningEvidenceDrawer key={selected.id} record={selected} uploads={evidence} busy={evidenceBusy} error={evidenceError} onClose={clearEvidence} onRetry={()=>void inspect(selected.id,selected)}/>}
  </section>;
}
