import {useEffect,useRef,useState} from 'react';
import {authenticatedApiRequest} from '../../services/api.js';
import {indiaToday,reportingState} from '../../../backend/shared/retailAttendance.js';
import {REPORTING_STATES} from './ifmsDashboardModel.js';
import {ReportHeader,ReportFilters,ReportStats,ReportNotice,ReportPager} from '../../components/reliance-retail/RetailReportUi.jsx';
import {matchesReportQuery,reportPage} from '../../utils/retailReportView.js';
import {downloadUnified} from '../../utils/retailUnifiedExport.js';
import {usePageTitle} from '../../hooks/usePageTitle.js';
import {useAuth} from '../../context/auth-context.js';
import {isPlatformAdmin} from '../../utils/authRoles.js';
import {isCompleteOperationsReport} from '../../utils/retailOperationsReport.js';

const emptyForm=()=>({store_id:'',scheduled_date:indiaToday(),request_id:crypto.randomUUID()});
export default function RetailOperations({kind='maintenance'}) {
 const {user}=useAuth();
 const entry=useRef(null);
 const maintenance=kind==='maintenance',title=maintenance?'CM / PM Calls':'Thermography';
 usePageTitle(`Reliance Retail ${title}`);
 const [month,setMonth]=useState(indiaToday().slice(0,7)),[state,setState]=useState(''),[store,setStore]=useState(''),[query,setQuery]=useState('');
 const [loadedReport,setReport]=useState(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[saving,setSaving]=useState(false),[refresh,setRefresh]=useState(0);
 const [form,setForm]=useState(emptyForm),[confirmation,setConfirmation]=useState(null),[history,setHistory]=useState(null),[callKind,setCallKind]=useState('CM'),[page,setPage]=useState(0),[size,setSize]=useState(25);
 const endpoint=`/api/reliance-retail/operations/${kind}`;
 const reportKey=JSON.stringify([kind,month,state,store]);
 const report=loadedReport?.key===reportKey&&isCompleteOperationsReport(loadedReport.data,kind)?loadedReport.data:null;
 useEffect(()=>{
  let live=true;
  queueMicrotask(()=>{if(live){setBusy(true);setReport(null);setError('');setHistory(null);setConfirmation(null);setPage(0);}});
  authenticatedApiRequest({url:endpoint,params:{month,state,store}}).then(r=>{if(live){setReport({key:reportKey,data:r.data?.result});if(!isCompleteOperationsReport(r.data?.result,kind))setError('Operational report is incomplete or unavailable. Refresh to try again.');}}).catch(e=>{if(live)setError(e.response?.data?.message||e.message);}).finally(()=>{if(live)setBusy(false);});
  return()=>{live=false;};
 },[endpoint,kind,month,state,store,refresh,reportKey]);
 useEffect(()=>{
  if(maintenance&&report?.today&&month===report.today.slice(0,7))queueMicrotask(()=>setCallKind(Number(report.today.slice(8,10))<=15?'CM':'PM'));
 },[maintenance,report?.today,month]);
 function openEntry(){entry.current?.scrollIntoView({behavior:'smooth',block:'center'});entry.current?.querySelector('select')?.focus({preventScroll:true});}
 const selected=report?.stores.find(s=>s.id===form.store_id);
 const module=report?.modules?.[callKind.toLowerCase()];
 const rows=(maintenance?module?.stores||[]:report?.rows||[]).filter(r=>matchesReportQuery([r.store_code||r.store?.store_code,r.store_name||r.store?.store_name,r.status,r.reporting_state],query));
 const visible=reportPage(rows,page,size);
 const window=module?.window;
 const canComplete=Boolean(selected?.can_save&&selected.status==='Active'&&window?.open&&!module.stores.find(s=>s.id===selected.id)?.completed);
 const canSchedule=Boolean(selected?.can_save&&selected.status==='Active'&&form.scheduled_date);
 function resetFilters(fn){fn();setPage(0);setNotice('');setForm(emptyForm());}
 function prepare(e){e.preventDefault();if(!(maintenance?canComplete:canSchedule))return;setConfirmation({data:{...form,...(maintenance?{kind:callKind,month}:{status:'Scheduled'})},label:maintenance?`Record ${callKind} completion for ${selected.store_code}? Completion is recorded now and cannot be edited or deleted.`:`Schedule Thermography for ${selected.store_code} on ${form.scheduled_date}?`});}
 async function save(){
  setSaving(true);setError('');
  try{await authenticatedApiRequest({method:'POST',url:endpoint,data:confirmation.data});if(!maintenance&&confirmation.data.status==='Scheduled')setMonth(confirmation.data.scheduled_date.slice(0,7));setConfirmation(null);setForm(emptyForm());setNotice('Saved. Refreshing the report.');setRefresh(v=>v+1);}
  catch(e){setError(e.response?.data?.message||e.message);}
  finally{setSaving(false);}
 }
 async function exportReport(){
  try{
   const {default:ExcelJS}=await import('exceljs'),book=new ExcelJS.Workbook();
   const states=book.addWorksheet('State summary');
   states.addRow(['Reporting month',month,'State',state||'All authorized states','Store',store||'All authorized stores']);
   if(maintenance){states.addRow(['State','CM applicable','CM completed','CM pending','PM applicable','PM completed','PM pending']);for(const cm of report.modules.cm.rows){const pm=report.modules.pm.rows.find(r=>r.state===cm.state);states.addRow([cm.state,cm.eligible,cm.completed,cm.remaining,pm?.eligible,pm?.completed,pm?.remaining]);}}
   else{states.addRow(['State','Scheduled','Completed awaiting approval','Client Approved','Approval overdue','Approved late']);report.states.forEach(r=>states.addRow([r.state,r.scheduled,r.awaiting,r.approved,r.overdue,r.approved_late]));}
   const details=book.addWorksheet('Store details');
   if(maintenance){details.addRow(['Kind','Store Code','Store Name','State','Status','Completed on','Completed at','Completed by']);for(const k of ['cm','pm'])report.modules[k].stores.filter(r=>matchesReportQuery([r.store_code,r.store_name,r.reporting_state],query)).forEach(r=>details.addRow([k.toUpperCase(),r.store_code,r.store_name,r.reporting_state,r.completed?'Completed':'Pending',r.completed_on,r.completed_at,r.completed_by]));}
   else{details.addRow(['Reference','Store Code','Store Name','State','Scheduled date','Status','Completed on','Approval due','Approved on','Approval overdue','Approved late']);rows.forEach(r=>details.addRow([r.id,r.store.store_code,r.store.store_name,r.reporting_state,r.scheduled_date,r.status,r.completed_on,r.approval_due_on,r.approved_on,r.approval_overdue?'Yes':'No',r.approved_late?'Yes':'No']));}
   const audit=book.addWorksheet('Audit history');audit.addRow(['At','Action','Record','Actor','Before','After']);report.events.forEach(e=>audit.addRow([e.created_at,e.action,e.entity_id,e.actor_profile_id,JSON.stringify(e.before_state),JSON.stringify(e.after_state)]));
   await downloadUnified(book,`Retail_${maintenance?'CM_PM':'Thermography'}_${month}.xlsx`);
  }catch(e){setError(e.message);}
 }
 const stats=maintenance?report?[{label:'Applicable stores',value:module.total.eligible},{label:`${callKind} completed`,value:module.total.completed},{label:`${callKind} pending`,value:module.total.remaining}]:[]:report?[{label:'Scheduled',value:report.total.scheduled},{label:'Completed awaiting approval',value:report.total.awaiting},{label:'Client Approved',value:report.total.approved},{label:'Approval overdue',value:report.total.overdue}]:[];
 return <section className="retail-report">
  <ReportHeader title={title} description={maintenance?'Record completed CM and PM calls and review monthly progress.':'Schedule inspections, record completion and track client approval within 10 calendar days.'}>
   <button disabled={!report||busy||saving} onClick={openEntry}>{maintenance?'Record CM/PM Call':'Schedule Thermography'}</button>
   <button onClick={()=>setRefresh(v=>v+1)} disabled={busy||saving}>Refresh</button><button disabled={!report||busy} onClick={()=>void exportReport()}>Export Excel</button>
  </ReportHeader>
  <ReportFilters>
   <label>Month<input aria-label={`${title} month`} type="month" value={month} onChange={e=>resetFilters(()=>setMonth(e.target.value))}/></label>
   <label>State<select aria-label={`${title} state`} value={state} onChange={e=>resetFilters(()=>{setState(e.target.value);setStore('');})}><option value="">All authorized states</option>{REPORTING_STATES.map(s=><option key={s.code} value={s.code}>{s.label}</option>)}</select></label>
   <label>Store Code<select aria-label={`${title} store filter`} value={store} onChange={e=>resetFilters(()=>setStore(e.target.value))}><option value="">All authorized stores</option>{report?.stores.map(s=><option key={s.id} value={s.id}>{s.store_code} · {s.store_name}</option>)}</select></label>
   <label>Search<input aria-label={`${title} search`} value={query} onChange={e=>{setQuery(e.target.value);setPage(0);}} placeholder="Store Code, name or status"/></label>
   {maintenance&&<label>Call<select aria-label="Maintenance kind" value={callKind} onChange={e=>{setCallKind(e.target.value);setPage(0);setConfirmation(null);}}><option>CM</option><option>PM</option></select></label>}
  </ReportFilters>
  {busy&&<ReportNotice>Loading authorized operational data…</ReportNotice>}{error&&<ReportNotice error>{error}</ReportNotice>}{notice&&<ReportNotice>{notice}</ReportNotice>}
  {report&&<>
   <ReportStats items={stats}/>
   <ReportNotice>{maintenance?`${callKind}: ${window.start} through ${window.end} · ${window.status}. Today (India): ${report.today}. Previous months are locked. Completed calls cannot be edited or deleted.`:`Reports follow the scheduled month. Client approval is due 10 calendar days after completion; overdue starts the next day. Late approvals remain marked late.`}</ReportNotice>
   <form ref={entry} onSubmit={prepare} className="retail-report-filters" aria-label={`${title} entry`}>
    <label>Store Code<select required aria-label={`${title} entry Store Code`} value={form.store_id} onChange={e=>{setConfirmation(null);setForm({...emptyForm(),store_id:e.target.value});}}><option value="">Select authorized store</option>{report.stores.filter(s=>s.can_save&&s.status==='Active').map(s=><option key={s.id} value={s.id}>{s.store_code} · {s.store_name}</option>)}</select></label>
    {!maintenance&&<label>Scheduled Date<input required aria-label="Thermography Scheduled Date" type="date" value={form.scheduled_date} onChange={e=>setForm(f=>({...f,scheduled_date:e.target.value,request_id:crypto.randomUUID()}))}/></label>}
    <button disabled={saving||busy||!(maintenance?canComplete:canSchedule)}>{maintenance?`Record ${callKind} Call`:'Save scheduled inspection'}</button>
    {selected&&<p>{selected.store_code} · {selected.store_name} · {REPORTING_STATES.find(s=>s.code===reportingState(selected.state))?.label} · {selected.store_format||'Format unavailable'} · {selected.city||'City unavailable'}</p>}
   </form>
   {maintenance&&<section className="retail-report-panel retail-report-table" aria-label="CM PM state summary"><table><thead><tr>{['State','CM completed','CM pending','PM completed','PM pending'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{report.modules.cm.rows.map(cm=>{const pm=report.modules.pm.rows.find(r=>r.state===cm.state);return <tr key={cm.state}><td>{REPORTING_STATES.find(s=>s.code===cm.state)?.label}</td><td>{cm.completed}</td><td>{cm.remaining}</td><td>{pm?.completed}</td><td>{pm?.remaining}</td></tr>;})}</tbody></table></section>}
   {!maintenance&&<section className="retail-report-panel retail-report-table" aria-label="Thermography state summary"><table><thead><tr>{['State','Scheduled','Awaiting approval','Client Approved','Approval overdue'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{report.states.map(s=><tr key={s.state}><td>{REPORTING_STATES.find(r=>r.code===s.state)?.label}</td><td>{s.scheduled}</td><td>{s.awaiting}</td><td>{s.approved}</td><td>{s.overdue}</td></tr>)}</tbody></table></section>}
   <section className="retail-report-panel retail-report-table" aria-label={`${title} store details`}><table><thead><tr>{(maintenance?['Store Code','Store Name','State','Status','Completed on','History']:['Store Code','Store Name','Scheduled','Status','Completed','Approval due','Approved','Overdue history','Actions']).map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{visible.map(r=><tr key={r.id}>
    <td>{r.store_code||r.store?.store_code}</td><td>{r.store_name||r.store?.store_name}</td>
    {maintenance?<><td>{REPORTING_STATES.find(s=>s.code===r.reporting_state)?.label}</td><td>{r.completed?'Completed':'Pending'}</td><td>{r.completed_on||'—'}</td><td>{r.record_id&&<button onClick={()=>setHistory(r.record_id)}>View history</button>}</td></>:<><td>{r.scheduled_date}</td><td>{r.status}</td><td>{r.completed_on||'—'}</td><td>{r.approval_due_on||'—'}</td><td>{r.approved_on||'—'}</td><td>{r.approval_overdue?'Approval overdue':r.approved_late?'Approved late — retained':'—'}</td><td><button onClick={()=>setHistory(r.id)}>View history</button>{r.store.can_save&&r.status!=='Client Approved'&&<button disabled={saving||(r.status==='Scheduled'&&report.today<r.scheduled_date)} onClick={()=>setConfirmation({data:{id:r.id,status:r.status==='Scheduled'?'Completed':'Client Approved',revision:r.revision,request_id:crypto.randomUUID()},label:`Record ${r.status==='Scheduled'?'completion':'client approval'} for ${r.store.store_code}? The actual date is recorded by the server.`})}>{r.status==='Scheduled'?'Record completion':'Record client approval'}</button>}</td></>}
   </tr>)}</tbody></table>{!rows.length&&<ReportNotice>No operational records match this authorized scope.</ReportNotice>}</section>
   <ReportPager label={title} count={rows.length} page={page} size={size} onPage={setPage} onSize={setSize}/>
   {history&&<section aria-label="Operational audit history"><h2>Recorded history</h2>{report.events.filter(e=>e.entity_id===history).map(e=><p key={e.id}>{e.created_at} · {e.action}{isPlatformAdmin(user)&&<> · Actor {e.actor_profile_id}</>}</p>)}<button onClick={()=>setHistory(null)}>Close history</button></section>}
  </>}
  {confirmation&&<section role="dialog" aria-modal="false" aria-label="Confirm operational save" className="retail-report-notice"><p>{confirmation.label}</p><button disabled={saving} onClick={()=>void save()}>{saving?'Saving…':'Confirm save'}</button><button autoFocus disabled={saving} onClick={()=>setConfirmation(null)}>Cancel</button></section>}
 </section>;
}
