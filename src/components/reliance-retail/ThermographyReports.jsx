import {useEffect,useRef,useState} from 'react';
import {Download,Upload,RefreshCw,History,X} from 'lucide-react';
import {useAuth} from '../../context/auth-context.js';
import {authenticatedApiRequest} from '../../services/api.js';
import {indiaToday,reportingState} from '../../../backend/shared/retailAttendance.js';
import {usePageTitle} from '../../hooks/usePageTitle.js';
import {REPORTING_STATES} from '../../pages/reliance-retail/ifmsDashboardModel.js';
import {ReportHeader,ReportFilters,ReportStats,ReportNotice,ReportPager} from './RetailReportUi.jsx';
import {THERMO_XLSX_MIME,THERMO_UPLOAD_LIMIT,isCompleteThermoReport,thermoMonthRange,thermoFileIdentity,thermoPendingKey,readThermoPending,saveThermoPending,thermoOperation,uploadThermoFile,loadThermoExport,buildThermoSummary} from '../../utils/thermographyReports.js';
import './thermographyReports.css';
import {uploadThermoResumable} from '../../utils/thermographyTusUpload.js';

const base='/api/reliance-retail/mis/thermography';
const api=async(url,config={})=>(await authenticatedApiRequest({url:base+url,...config})).data.result;
const recorded=v=>v==null||v===''?'Not recorded':String(v);
const timestamp=v=>v?new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium',timeStyle:'short'}).format(new Date(v)):'Not recorded';
export default function ThermographyReports({legacy}){
 usePageTitle('Reliance Retail Thermography');const {user}=useAuth(),userKey=user?.profileId||user?.id||'unverified';
 const [month,setMonth]=useState(()=>indiaToday().slice(0,7)),[dates,setDates]=useState(()=>thermoMonthRange()),[state,setState]=useState(''),[store,setStore]=useState(''),[status,setStatus]=useState(''),[query,setQuery]=useState(''),[deleted,setDeleted]=useState(false);
 const [page,setPage]=useState(0),[size,setSize]=useState(25),[refresh,setRefresh]=useState(0),[report,setReport]=useState(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[setupMissing,setSetupMissing]=useState(false);
 const [upload,setUpload]=useState(null),[file,setFile]=useState(null),[progress,setProgress]=useState(null),[uploadError,setUploadError]=useState(''),[confirmation,setConfirmation]=useState(null),[reason,setReason]=useState(''),[history,setHistory]=useState(null),[showLegacy,setShowLegacy]=useState(false),[resumable,setResumable]=useState(false);
 const running=useRef(false),dialog=useRef(null),returnFocus=useRef(null);
 const filter={...dates,state:state||undefined,store:store||undefined,status:status||undefined,q:query||undefined,deleted:deleted?'true':undefined};
 const filterKey=JSON.stringify(filter);
 useEffect(()=>{let live=true;const controller=new AbortController();queueMicrotask(()=>{if(live){setLoading(true);setError('');setReport(null);}});api('/reports',{params:{...JSON.parse(filterKey),page,limit:size},signal:controller.signal}).then(data=>{if(!isCompleteThermoReport(data))throw Error('Thermography report contract is incomplete or unavailable.');if(live){setReport(data);setSetupMissing(false);}}).catch(e=>{if(live&&e.code!=='ERR_CANCELED'){setError(e.response?.data?.message||e.message);setSetupMissing(e.response?.status===503);}}).finally(()=>{if(live)setLoading(false);});return()=>{live=false;controller.abort();};},[filterKey,page,size,refresh]);
 useEffect(()=>{queueMicrotask(()=>setResumable(!!readThermoPending(sessionStorage,userKey)));},[userKey,refresh]);
 const dialogOpen=!!(upload||confirmation||history);
 useEffect(()=>{
  if(!dialogOpen)return;const previous=document.activeElement;returnFocus.current=previous;dialog.current?.querySelector('input,button,select,textarea')?.focus();return()=>previous?.focus();
 },[dialogOpen]);
 const change=fn=>{fn();setPage(0);};
 function close(){if(running.current)return;setUpload(null);setFile(null);setUploadError('');setConfirmation(null);setReason('');setHistory(null);returnFocus.current?.focus();}
 async function work(fn){if(running.current)return;running.current=true;setBusy(true);setError('');try{await fn();}catch(e){setError(e.response?.data?.message||e.message||'Thermography action failed. Retry safely.');}finally{running.current=false;setBusy(false);}}
 function openUpload(row){
  const pending=readThermoPending(sessionStorage,userKey);setUploadError('');setProgress(null);setFile(null);
  if(pending&&(!row||pending.inspection_id===row.id||pending.payload.id===row.id)){setUpload({...pending.payload,row,resume:true});return;}
  const p=row?.pending_upload;
  setUpload({id:row?.id,revision:p?.revision??row?.revision,request_id:p?.request_id,source_sha256:p?.source_sha256,store_id:row?.retail_store_id||store,date:row?.report_date||row?.scheduled_date||indiaToday(),period_end:row?.report_period_end||'',row});
 }
 async function submitUpload(e){e.preventDefault();if(running.current)return;running.current=true;setBusy(true);setUploadError('');setProgress(0);
  try{
   if(!file)throw Error('Select the original .xlsx workbook.');
   setNotice('Checking workbook identity...');const digest=await thermoFileIdentity(file,report.max_bytes);
   if(upload.source_sha256&&upload.source_sha256!==digest)throw Error('This retry belongs to a different workbook. Re-select the same original file; confirmed versions will not be overwritten.');
   const payload={id:upload.id,revision:upload.revision,request_id:upload.request_id||crypto.randomUUID(),store_id:upload.store_id,date:upload.date,period_end:upload.period_end||undefined,filename:file.name,size:file.size,mime:file.type||THERMO_XLSX_MIME,source_sha256:digest};
   let pending=readThermoPending(sessionStorage,userKey);
   if(pending){if(JSON.stringify({...pending.payload,mime:undefined})!==JSON.stringify({...payload,request_id:pending.payload.request_id,mime:undefined})){throw Error('A pending upload has a different file or report selection. Resume it or explicitly discard its retry identity first.');}payload.request_id=pending.payload.request_id;}
   pending={payload,inspection_id:pending?.inspection_id};saveThermoPending(sessionStorage,userKey,pending);setResumable(true);setUpload(u=>({...u,...payload}));
   const prepared=await api('/uploads/prepare',{method:'POST',data:payload});pending.inspection_id=prepared.inspection_id;saveThermoPending(sessionStorage,userKey,pending);
   if(prepared.upload_url){
    setNotice(prepared.tus?'Uploading resumable workbook chunks...':'Uploading the original workbook...');
    if(file.size>6*1024*1024){
     if(!prepared.tus)throw Error('Resumable upload authorization is unavailable. Retry the same report.');
     await uploadThermoResumable(prepared.tus,file,{actor:userKey,requestId:payload.request_id,sourceSha:digest,storage:sessionStorage,onProgress:setProgress});
    }else await uploadThermoFile(prepared.upload_url,file,setProgress);
   }
   setNotice('Verifying stored workbook and finalizing report...');setProgress(100);
   const receipt=await api('/uploads/finalize',{method:'POST',data:{request_id:payload.request_id},timeout:240000});
   if(!receipt?.id||!receipt.version_id||!Number.isInteger(receipt.revision))throw Error('Server submission confirmation is incomplete. Retry with the retained identity.');
   sessionStorage.removeItem(thermoPendingKey(userKey));setResumable(false);setUpload(null);setFile(null);setNotice('Workbook upload confirmed by the server. Current status is shown in the refreshed table; original versions remain in history.');setRefresh(v=>v+1);
  }catch(e){setNotice('');setUploadError(e.response?.data?.message||e.message);setResumable(!!readThermoPending(sessionStorage,userKey));}
  finally{running.current=false;setBusy(false);}
 }
 function ask(action,row){setReason('');setConfirmation({action,row});}
 async function act(e){e.preventDefault();await work(async()=>{
  const {action,row}=confirmation,payload=action==='schedule'?{store_id:confirmation.store_id,date:confirmation.date}:{id:row.id,revision:row.revision,reason:reason||undefined};
  if(['restore','reopen'].includes(action)&&reason.trim().length<3)throw Error('Enter an audit reason of at least three characters.');
  const key=`myqpms.thermography.action.${userKey}.${action}.${row?.id||'new'}`,request_id=thermoOperation(sessionStorage,key,payload);
  const result=await api('/reports/'+action,{method:'POST',data:{...payload,request_id}});if(!result?.id)throw Error('Server confirmation unavailable. Retain this action and retry.');
  sessionStorage.removeItem(key);setConfirmation(null);setNotice(action==='approve'?'MIS confirmation of external client approval recorded.':`${action==='schedule'?'Schedule':action.charAt(0).toUpperCase()+action.slice(1)} confirmed by the server.`);setRefresh(v=>v+1);
 });}
 async function download(row,version){await work(async()=>{
  const response=await authenticatedApiRequest({url:`${base}/reports/${encodeURIComponent(row.id)}/${version?'versions/'+encodeURIComponent(version.id)+'/':''}download`,responseType:'blob'});
  const bytes=response.data;if(!(bytes instanceof Blob)||bytes.size>THERMO_UPLOAD_LIMIT||bytes.size<22)throw Error('Workbook download was incomplete or oversized.');
  const url=URL.createObjectURL(bytes),a=document.createElement('a');a.href=url;a.download=version?.filename||row.filename||'Thermography.xlsx';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);setNotice('Original workbook download prepared. Approval status was not changed.');
 });}
 async function inspect(row,historyPage=0){await work(async()=>{const data=await api(`/reports/${encodeURIComponent(row.id)}/history`,{params:{page:historyPage,limit:25}});setHistory({row,...data});});}
 async function exportSummary(){await work(async()=>{const data=await loadThermoExport(params=>api('/reports',{params}),filter);const book=await buildThermoSummary(data,filter);const {downloadUnified}=await import('../../utils/retailUnifiedExport.js');await downloadUnified(book,`Retail_Thermography_${dates.from}_${dates.to}.xlsx`);setNotice(`Summary downloaded: ${data.total} authorized records, using the same filters as the table.`);});}
 const states=new Set((report?.stores||[]).map(s=>reportingState(s.state))),stores=(report?.stores||[]).filter(s=>!state||reportingState(s.state)===state);
 const uploadStores=(report?.stores||[]).filter(s=>s.can_upload&&s.status==='Active');
 return <section className="retail-report retail-thermography-report thermo-reports">
  <ReportHeader title="Thermography" description="Original Excel reports, rework and MIS confirmation of external client approval.">
   {report?.can_upload&&<button disabled={busy||loading} onClick={()=>openUpload()}><Upload size={15}/>Upload Thermography Report</button>}
   {report?.can_schedule&&<button disabled={busy||loading} onClick={()=>setConfirmation({action:'schedule',store_id:'',date:indiaToday()})}>Schedule Thermography</button>}
   <button disabled={busy||loading} onClick={()=>setRefresh(v=>v+1)}><RefreshCw size={15}/>Refresh</button><button disabled={busy||loading||!report} onClick={()=>void exportSummary()}><Download size={15}/>Export Excel</button>
  </ReportHeader>
  <ReportFilters>
   <label>Month<input aria-label="Thermography month" type="month" value={month} onChange={e=>{if(e.target.value)change(()=>{setMonth(e.target.value);setDates(thermoMonthRange(e.target.value));});}}/></label>
   <label>From<input aria-label="Thermography from" type="date" value={dates.from} max={dates.to} onChange={e=>change(()=>setDates(d=>({...d,from:e.target.value})))}/></label><label>To<input aria-label="Thermography to" type="date" value={dates.to} min={dates.from} onChange={e=>change(()=>setDates(d=>({...d,to:e.target.value})))}/></label>
   <label>State<select aria-label="Thermography state" value={state} onChange={e=>change(()=>{setState(e.target.value);setStore('');})}><option value="">All authorized states</option>{REPORTING_STATES.filter(s=>states.has(s.code)).map(s=><option key={s.code} value={s.code}>{s.label}</option>)}</select></label>
   <label>Store Code / Name<select aria-label="Thermography store" value={store} onChange={e=>change(()=>setStore(e.target.value))}><option value="">All authorized stores</option>{stores.map(s=><option key={s.id} value={s.id}>{s.store_code} — {s.store_name}</option>)}</select></label>
   <label>Approval status<select aria-label="Thermography status" value={status} onChange={e=>change(()=>setStatus(e.target.value))}><option value="">All statuses</option><option>Scheduled</option><option value="awaiting">Awaiting Client Approval (all versions)</option><option>Awaiting Client Approval — Revised</option><option>Rework Required</option><option>Client Approved</option><option>Completed (legacy; no workbook)</option></select></label>
   <label>Search<input aria-label="Search Thermography reports" type="search" placeholder="Store Code / Store Name / status" value={query} onChange={e=>change(()=>setQuery(e.target.value))}/></label>
   {report?.is_super&&<label className="thermo-check"><input type="checkbox" checked={deleted} onChange={e=>change(()=>setDeleted(e.target.checked))}/>Deleted reports</label>}
  </ReportFilters>
  <p className="retail-report-description">Dates use Asia/Kolkata. Reports are grouped by inspection date / reporting-period start. Approval counts are not thermal-condition results. Legacy status-only records retain their original meaning.</p>
  {loading&&<ReportNotice>Loading authorized Thermography reports...</ReportNotice>}{error&&<ReportNotice error>{error}</ReportNotice>}{notice&&<ReportNotice>{notice}</ReportNotice>}
  {resumable&&report?.can_upload&&<ReportNotice>An upload retry identity is retained. The local workbook is not saved by this page. <button disabled={busy} onClick={()=>openUpload()}>Resume pending upload</button></ReportNotice>}
  {report&&<>
   <ReportStats items={[['Scheduled','scheduled'],['Awaiting Client Approval','awaiting'],['Rework Required','rework'],['Client Approved','approved'],['Total Active Reports','active_reports']].map(([label,key])=>({label,value:report.counts[key]}))}/>
   <div className="retail-report-panel retail-report-table" role="region" aria-label="Thermography reports" tabIndex={0}><table><thead><tr>{['State','Store Code','Store Name','Inspection Date / Period','Report File','Version','Status','Uploaded By','Uploaded On','Approved By','Approved On','Actions'].map(h=><th scope="col" key={h}>{h}</th>)}</tr></thead><tbody>{report.rows.map(r=><tr key={r.id}>
    <td>{REPORTING_STATES.find(s=>s.code===reportingState(r.state))?.label||r.state}</td><td>{r.store_code}</td><td>{r.store_name}</td><td>{r.report_date||r.scheduled_date}{r.report_period_end&&<> to {r.report_period_end}</>}</td><td>{r.filename||'No uploaded workbook'}</td><td>{recorded(r.version_number)}<small>Rework: {r.report_rework_count||0}</small></td><td>{r.display_status}{!r.report_managed&&<small>Legacy status record; no uploaded workbook</small>}{r.approval_due_on&&<small>Approval due: {r.approval_due_on}</small>}{r.approval_overdue&&<small>Approval overdue</small>}</td><td>{recorded(r.uploaded_by_name||r.uploaded_by)}</td><td>{timestamp(r.uploaded_at)}</td><td>{recorded(r.approved_by_name||r.approved_by)}</td><td>{timestamp(r.approved_at)}</td>
    <td><div className="thermo-row-actions">
     {r.active_version_id&&<button disabled={busy} onClick={()=>void download(r)}><Download size={13}/>Download Excel</button>}
     {!r.report_deleted_at&&r.can_upload&&<button disabled={busy} onClick={()=>openUpload(r)}>Upload Report</button>}
     {!r.report_deleted_at&&r.can_replace&&<button disabled={busy} onClick={()=>openUpload(r)}>Replace Report</button>}
     {!r.report_deleted_at&&r.can_approve&&<><button disabled={busy} onClick={()=>ask('approve',r)}>Mark Client Approved</button><button disabled={busy} onClick={()=>ask('reject',r)}>Mark Rework Required</button></>}
     {!r.report_deleted_at&&r.can_reopen&&r.status==='Client Approved'&&r.active_version_id&&<button disabled={busy} onClick={()=>ask('reopen',r)}>Authorized Reopening</button>}
     {!r.report_deleted_at&&r.can_write&&<button disabled={busy} onClick={()=>ask('delete',r)}>Delete Report</button>}
     {r.report_deleted_at&&r.can_restore&&<button disabled={busy} onClick={()=>ask('restore',r)}>Restore Report</button>}
     <button disabled={busy} onClick={()=>void inspect(r)}><History size={13}/>Version History</button>
    </div></td>
   </tr>)}</tbody></table>{!report.rows.length&&<p className="thermo-empty">No authorized reports match these filters.</p>}</div>
   <ReportPager label="Thermography" count={report.total} page={page} size={size} onPage={setPage} onSize={setSize}/>
  </>}
  {setupMissing&&legacy&&<><button onClick={()=>setShowLegacy(v=>!v)}>View existing tracker</button>{showLegacy&&legacy}</>}
  {dialogOpen&&<div className="thermo-modal-backdrop"><section ref={dialog} className="thermo-modal" role="dialog" aria-modal="true" aria-label={upload?upload.row?.active_version_id?'Replace Thermography Report':'Upload Thermography Report':history?'Thermography Version History':'Confirm Thermography action'} onKeyDown={e=>{
   if(e.key==='Escape'){e.preventDefault();close();}if(e.key==='Tab'){const items=[...e.currentTarget.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]')];const first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}
  }}>
   <button type="button" className="thermo-close" aria-label="Close Thermography dialog" disabled={busy} onClick={close}><X size={18}/></button>
   {upload&&<form onSubmit={e=>void submitUpload(e)}><h2>{upload.row?.active_version_id?'Replace rejected report':'Upload Thermography Report'}</h2>
    <p>The original workbook, including photographs, formatting and worksheets, is stored unchanged. Only server-confirmed uploads become active.</p>
    <label>State<select aria-label="Upload state" required disabled={busy||!!upload.id||upload.resume} value={report?.stores.find(s=>s.id===upload.store_id)?.state||upload.state||''} onChange={e=>setUpload(u=>({...u,state:e.target.value,store_id:''}))}><option value="">Select state</option>{[...new Set(uploadStores.map(s=>s.state))].map(s=><option key={s}>{s}</option>)}</select></label>
    <label>Store Code / Store Name<select aria-label="Upload store" required disabled={busy||!!upload.id||upload.resume} value={upload.store_id||''} onChange={e=>setUpload(u=>({...u,store_id:e.target.value}))}><option value="">Select authorized store</option>{uploadStores.filter(s=>!upload.state||s.state===upload.state).map(s=><option key={s.id} value={s.id}>{s.store_code} — {s.store_name}</option>)}</select></label>
    <label>Inspection date / Period start<input aria-label="Inspection date" required type="date" max={report.today} disabled={busy||!!upload.row?.active_version_id||upload.resume} value={upload.date||''} onChange={e=>setUpload(u=>({...u,date:e.target.value}))}/></label>
    <label>Period end (optional)<input aria-label="Period end" type="date" min={upload.date} max={report.today} disabled={busy||!!upload.row?.active_version_id||upload.resume} value={upload.period_end||''} onChange={e=>setUpload(u=>({...u,period_end:e.target.value}))}/></label>
    <label>Excel workbook (.xlsx, up to {Math.floor(report.max_bytes/1024/1024)} MiB)<input aria-label="Thermography workbook" required type="file" accept=".xlsx" disabled={busy} onChange={e=>{setFile(e.target.files?.[0]||null);setUploadError('');}}/></label>
    {file&&<p>{file.name} — {(file.size/1024/1024).toFixed(2)} MiB</p>}{upload.resume&&<p>Re-select the same workbook to continue. Nothing is claimed as saved locally.</p>}
    {progress!==null&&<label>Upload progress<progress max="100" value={progress}/>{progress}%</label>}{uploadError&&<p role="alert">{uploadError}</p>}
    <button disabled={busy||!file||!upload.store_id}>{busy?'Uploading / verifying...':uploadError?'Retry Upload':'Confirm Upload'}</button><button type="button" disabled={busy} onClick={close}>Close</button>
    {resumable&&!busy&&<button type="button" onClick={()=>{if(window.confirm('Discard this retry identity? No confirmed workbook is deleted. Re-select the report row before starting a different file. Abandoned pending objects require reconciliation.')){sessionStorage.removeItem(thermoPendingKey(userKey));setResumable(false);setUpload(null);setFile(null);}}}>Discard pending retry identity</button>}
   </form>}
   {confirmation&&<form onSubmit={e=>void act(e)}><h2>{confirmation.action==='approve'?'Confirm external client approval':confirmation.action==='reject'?'Record client rejection':confirmation.action==='delete'?'Delete Report':confirmation.action==='restore'?'Restore Report':confirmation.action==='reopen'?'Authorized correction / reopening':'Schedule Thermography'}</h2>
    {confirmation.row&&<p>{confirmation.row.store_code} — {confirmation.row.store_name}<br/>{confirmation.row.filename||'No uploaded workbook'}</p>}
    {confirmation.action==='approve'&&<p>You are confirming that the client approved the current workbook externally. No attachment is required.</p>}
    {confirmation.action==='delete'&&<p>This removes the record from active listings and KPIs. Files and version history are retained. Super Admin can restore it.</p>}
    {confirmation.action==='schedule'&&<><label>Store<select required aria-label="Schedule store" value={confirmation.store_id} onChange={e=>setConfirmation(c=>({...c,store_id:e.target.value}))}><option value="">Select authorized store</option>{report.stores.filter(s=>s.can_schedule&&s.status==='Active').map(s=><option key={s.id} value={s.id}>{s.store_code} — {s.store_name}</option>)}</select></label><label>Scheduled date<input required aria-label="Scheduled date" type="date" value={confirmation.date} onChange={e=>setConfirmation(c=>({...c,date:e.target.value}))}/></label></>}
    {['reject','reopen','restore'].includes(confirmation.action)&&<label>{confirmation.action==='reject'?'Rejection remark (optional)':'Audit reason (required)'}<textarea aria-label="Thermography action reason" maxLength={2000} required={confirmation.action!=='reject'} value={reason} onChange={e=>setReason(e.target.value)}/></label>}
    {error&&<p role="alert">{error}</p>}<button disabled={busy}>{busy?'Confirming...':'Confirm'}</button><button type="button" disabled={busy} onClick={close}>Cancel</button>
   </form>}
   {history&&<><h2>Version History — {history.row.store_code}</h2><p>Only confirmed versions are downloadable. Earlier workbooks are retained unchanged.</p>{!history.versions.length&&<p>No workbook versions recorded. Existing status history is shown below.</p>}{history.versions.map(v=><article key={v.id} className="thermo-version"><strong>Version {v.version_number}{v.active?' — Current':''}</strong><p>{v.filename} — {v.state} — {recorded(v.review_status)}</p><p>{timestamp(v.uploaded_at)}{v.remark&&<> — {v.remark}</>}</p>{v.state==='uploaded'&&<button disabled={busy} onClick={()=>void download(history.row,v)}>Download Version {v.version_number}</button>}</article>)}<h3>Audit trail</h3>{[...history.legacy_events,...history.events].sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at))).map(e=><p key={e.id}>{timestamp(e.created_at)} — {e.action} — Actor: {e.actor_id}{e.remark&&<> — {e.remark}</>}</p>)}<nav className="thermo-history-pages" aria-label="Version history pages"><button disabled={busy||!history.page} onClick={()=>void inspect(history.row,history.page-1)}>History previous</button><span>Page {history.page+1}</span><button disabled={busy||(history.page+1)*history.limit>=Math.max(history.versions_total,history.events_total,history.legacy_total)} onClick={()=>void inspect(history.row,history.page+1)}>History next</button></nav></>}
  </section></div>}
 </section>;
}
