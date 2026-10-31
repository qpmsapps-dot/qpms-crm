import {useCallback,useEffect,useRef,useState} from 'react';
import {Download,RefreshCw} from 'lucide-react';
import {authenticatedApiRequest} from '../../services/api.js';
import {indiaToday} from '../../../backend/shared/retailAttendance.js';
import {REPORTING_STATES} from './ifmsDashboardModel.js';
import {usePageTitle} from '../../hooks/usePageTitle.js';
import {ReportHeader,ReportFilters,ReportStats,ReportNotice,ReportPager} from '../../components/reliance-retail/RetailReportUi.jsx';
import {matchesReportQuery,reportPage} from '../../utils/retailReportView.js';
import RetailCleaningSchedule from '../../components/reliance-retail/RetailCleaningSchedule.jsx';
import {useAuth} from '../../context/auth-context.js';
import {isReadOnlyUser} from '../../utils/demoAccess.js';

export default function RetailScopedDeepCleaning() {
 usePageTitle('Reliance Retail Deep Cleaning');
 const {user}=useAuth();
 const [scheduling,setScheduling]=useState(false);
 const today=indiaToday();
 const [from,setFrom]=useState(today.slice(0,7)+'-01'),[to,setTo]=useState(today),[state,setState]=useState(''),[store,setStore]=useState(''),[status,setStatus]=useState('');
 const [query,setQuery]=useState(''),[page,setPage]=useState(0),[workPage,setWorkPage]=useState(0),[size,setSize]=useState(25),[refresh,setRefresh]=useState(0);
 const [report,setReport]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[exporting,setExporting]=useState(false),[evidence,setEvidence]=useState(null),[evidenceBusy,setEvidenceBusy]=useState(false);
 const evidenceRequest=useRef(0);
 const invalidateEvidence=useCallback(()=>{evidenceRequest.current++;},[]);
 function clearEvidence(){evidenceRequest.current++;setEvidence(null);setEvidenceBusy(false);}
 function resetView(){setPage(0);setWorkPage(0);clearEvidence();}
 useEffect(()=>{
  let live=true;invalidateEvidence();
  queueMicrotask(()=>{if(live){setBusy(true);setError('');setReport(null);setEvidence(null);setEvidenceBusy(false);}});
  authenticatedApiRequest({url:'/api/reliance-retail/module-reports/deep-cleaning',params:{from,to,state,store}}).then(r=>{if(live)setReport(r.data.report);}).catch(e=>{if(live)setError(e.response?.data?.message||e.message);}).finally(()=>{if(live)setBusy(false);});
  return()=>{live=false;invalidateEvidence();};
 },[from,to,state,store,refresh,invalidateEvidence]);
 async function inspect(id){
  const request=++evidenceRequest.current;setError('');setEvidence(null);setEvidenceBusy(true);
  try{const result=await authenticatedApiRequest({url:`/api/reliance-retail/module-reports/deep-cleaning/${encodeURIComponent(id)}/evidence`,params:{from,to,state,store}});if(request===evidenceRequest.current)setEvidence(result.data.uploads);}
  catch(e){if(request===evidenceRequest.current)setError(e.response?.data?.message||e.message);}
  finally{if(request===evidenceRequest.current)setEvidenceBusy(false);}
 }
 const matches=row=>matchesReportQuery([row.store?.store_code,row.store?.store_name,row.not_done_reason,row.display_status,row.status],query);
 const rows=(report?.schedules||[]).filter(row=>(!status||row.display_status===status)&&matches(row));
 const work=(report?.submissions||[]).filter(matches),totals=report?.totals;
 const remaining=totals?Math.max(0,totals.scheduled-totals.completed):null;
 const completion=totals?.scheduled>0?`${Math.round(totals.completed/totals.scheduled*10000)/100}%`:'N/A';
 async function exportReport(){
  setExporting(true);setError('');
  try{
   const {default:ExcelJS}=await import('exceljs'),{downloadUnified}=await import('../../utils/retailUnifiedExport.js'),book=new ExcelJS.Workbook(),sheet=book.addWorksheet('Filtered schedules');
   sheet.addRow(['Store Code','Store Name','Geographic State','Reporting State','Scheduled Date','Status','Not Completed Reason','Overdue','Completion Submission IDs']);
   rows.forEach(row=>sheet.addRow([row.store.store_code,row.store.store_name,row.store.state,row.reporting_state,row.scheduled_date,row.display_status,row.not_done_reason,Boolean(row.overdue),(row.submission_ids||[]).join(', ')]));
   const submitted=book.addWorksheet('Recorded work');submitted.addRow(['Store Code','Date','Recorded Status','Before Images','After Images']);
   work.forEach(row=>submitted.addRow([row.store.store_code,row.deep_cleaning_date,row.status,row.before_count,row.after_count]));
   await downloadUnified(book,'Retail_Deep_Cleaning.xlsx');
  }catch(e){setError(e.message);}finally{setExporting(false);}
 }
 return <section className="retail-report">
  <ReportHeader title="Reliance Retail Deep Cleaning" description="Plan cleaning visits, track completion and review before/after evidence.">
   <button onClick={()=>setScheduling(true)}>Schedule Deep Cleaning</button>
   <button disabled={busy} onClick={()=>{resetView();setRefresh(value=>value+1);}}><RefreshCw size={15}/>Refresh</button>
   <button disabled={!report||busy||exporting} onClick={()=>void exportReport()}><Download size={15}/>{exporting?'Exporting…':'Export cleaning report'}</button>
  </ReportHeader>
  {scheduling&&<RetailCleaningSchedule readOnly={isReadOnlyUser(user)} onClose={()=>setScheduling(false)}/>}
  <ReportFilters>
   <label>From<input aria-label="Cleaning from" type="date" value={from} max={to} onChange={e=>{if(e.target.value){resetView();setFrom(e.target.value);}}}/></label>
   <label>To<input aria-label="Cleaning to" type="date" value={to} min={from} onChange={e=>{if(e.target.value){resetView();setTo(e.target.value);}}}/></label>
   <label>State<select aria-label="Cleaning state" value={state} onChange={e=>{resetView();setState(e.target.value);setStore('');}}><option value="">All authorized states</option>{REPORTING_STATES.map(item=><option key={item.code} value={item.code}>{item.label}</option>)}</select></label>
   <label>Store<select aria-label="Cleaning store" value={store} onChange={e=>{resetView();setStore(e.target.value);}}><option value="">All stores</option>{report?.stores.map(item=><option key={item.id} value={item.id}>{item.store_code} · {item.store_name}</option>)}</select></label>
   <label>Status<select aria-label="Cleaning status" value={status} onChange={e=>{resetView();setStatus(e.target.value);}}><option value="">All statuses</option>{['Scheduled','Completed','Not Completed','Cancelled','Unknown'].map(value=><option key={value}>{value}</option>)}</select></label>
   <label>Search<input aria-label="Search cleaning records" type="search" placeholder="Store code, name or reason" value={query} onChange={e=>{resetView();setQuery(e.target.value);}}/></label>
  </ReportFilters>
  {busy&&<ReportNotice>Loading cleaning tracker…</ReportNotice>}
  {error&&<ReportNotice error>{error}</ReportNotice>}
  {report&&<>
   <ReportStats items={[{label:'Scheduled',value:totals?.scheduled},{label:'Completed',value:totals?.completed},{label:'Remaining',value:remaining},{label:'Completion',value:completion}]}/>
   <p className="retail-report-description">Period/state/store totals. Recorded Not Completed: {totals?.not_completed??'N/A'} · Scheduled and pending: {totals?.pending??'N/A'}. Remaining includes all non-completed, non-cancelled schedules. An overdue schedule is not automatically a recorded failure.</p>
   {!totals&&<ReportNotice>Schedule storage is unavailable. Completion submissions remain visible; scheduled totals are unavailable.</ReportNotice>}
   {!!report.exceptions.length&&<ReportNotice>{report.exceptions.length} records excluded from totals because canonical store identity is unresolved.</ReportNotice>}
   <div className="retail-report-panel"><div className="retail-report-panel-heading"><h2>Store-wise cleaning schedules</h2><span>{rows.length} matching schedules</span></div>
    <div className="retail-report-table" role="region" aria-label="Cleaning schedules" tabIndex={0}><table><thead><tr>{['Store Code / Name','State','Scheduled date','Status','Reason / Evidence'].map(label=><th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{reportPage(rows,page,size).map(row=><tr key={row.id}>
     <td><button className="retail-report-link" onClick={()=>{resetView();setStore(row.store.id);}}>{row.store.store_code}</button><p>{row.store.store_name||'Store name unavailable'}</p></td><td>{REPORTING_STATES.find(item=>item.code===row.reporting_state)?.label||row.reporting_state}</td><td>{row.scheduled_date}</td>
     <td><span className="retail-report-status" data-status={row.display_status}>{row.display_status}</span>{row.overdue&&<span className="retail-report-overdue">Overdue · completion not recorded</span>}</td>
     <td>{row.not_done_reason||'—'}{(row.submission_ids||[]).map(id=><p key={id}><button className="retail-report-link" disabled={evidenceBusy} onClick={()=>void inspect(id)}>Before / after evidence</button></p>)}</td>
    </tr>)}</tbody></table></div>{!rows.length&&<p className="retail-report-empty">No matching recorded schedules.</p>}
    <ReportPager label="Cleaning schedules" count={rows.length} page={page} size={size} onPage={setPage} onSize={setSize}/>
   </div>
   <div className="retail-report-panel"><div className="retail-report-panel-heading"><h2>Store-wise submitted work</h2><span>{work.length} matching submissions</span></div>
    <div className="retail-report-table" role="region" aria-label="Submitted cleaning work" tabIndex={0}><table><thead><tr>{['Store Code','Date','Recorded status','Before / After','Evidence'].map(label=><th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{reportPage(work,workPage,size).map(row=><tr key={row.id}><td>{row.store.store_code}<p>{row.store.store_name}</p></td><td>{row.deep_cleaning_date}</td><td>{row.status}</td><td>{row.before_count} / {row.after_count}</td><td><button disabled={evidenceBusy} onClick={()=>void inspect(row.id)}>View evidence</button></td></tr>)}</tbody></table></div>
    {!work.length&&<p className="retail-report-empty">No authorized submissions match this period, scope and search.</p>}
    <ReportPager label="Cleaning work" count={work.length} page={workPage} size={size} onPage={setWorkPage} onSize={setSize}/>
   </div>
   <p className="retail-report-description">Export includes all matching records. Completed work is recorded by the assigned FO with before/after evidence.</p>
  </>}
  {evidenceBusy&&<ReportNotice>Checking authorization and loading private evidence…</ReportNotice>}
  {evidence&&<section className="retail-report-evidence" aria-label="Authorized cleaning evidence"><header><h2>Authorized evidence</h2><button onClick={clearEvidence}>Close evidence</button></header>{!evidence.length&&<ReportNotice>No uploaded evidence recorded.</ReportNotice>}<div className="retail-report-images">{evidence.map(item=><a key={item.id} href={item.url} target="_blank" rel="noreferrer"><span>{item.type} · {item.name}</span>{item.mime_type.startsWith('image/')?<img src={item.url} alt={`${item.type} cleaning evidence`}/>:'Open document'}</a>)}</div></section>}
 </section>;
}
