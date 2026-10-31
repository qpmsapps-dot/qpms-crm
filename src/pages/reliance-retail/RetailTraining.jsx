import {useCallback,useEffect,useRef,useState} from 'react';
import {Download,RefreshCw} from 'lucide-react';
import RetailStateCoverage from '../../components/reliance-retail/RetailStateCoverage.jsx';
import {reportingState,indiaToday} from '../../../backend/shared/retailAttendance.js';
import {REPORTING_STATES} from './ifmsDashboardModel.js';
import {downloadUnified} from '../../utils/retailUnifiedExport.js';
import {usePageTitle} from '../../hooks/usePageTitle.js';
import {authenticatedApiRequest} from '../../services/api.js';
import {retailUnifiedApi} from '../../services/retailUnifiedApi.js';
import {trainingReport} from '../../../backend/shared/retailTrainingReport.js';
import {ReportHeader,ReportFilters,ReportStats,ReportNotice,ReportPager} from '../../components/reliance-retail/RetailReportUi.jsx';
import {matchesReportQuery,reportPage} from '../../utils/retailReportView.js';
import {useAuth} from '../../context/auth-context.js';
import {isPlatformAdmin} from '../../utils/authRoles.js';

export default function RetailTraining() {
 const {user}=useAuth();
 usePageTitle('Reliance Retail HK & MEPC Training');
 const [sessions,setSessions]=useState([]),[snapshot,setSnapshot]=useState(null),[error,setError]=useState(''),[ownershipError,setOwnershipError]=useState(''),[busy,setBusy]=useState(false),[detail,setDetail]=useState(null),[evidenceLinks,setEvidenceLinks]=useState({});
 const [from,setFrom]=useState(indiaToday().slice(0,7)+'-01'),[to,setTo]=useState(indiaToday()),[filter,setFilter]=useState({}),[query,setQuery]=useState('');
 const [page,setPage]=useState(0),[size,setSize]=useState(25),[refresh,setRefresh]=useState(0),[detailBusy,setDetailBusy]=useState(false),[exporting,setExporting]=useState(false);
 const inspection=useRef(0);
 const invalidateInspection=useCallback(()=>{inspection.current++;},[]);
 function closeDetail(){inspection.current++;setDetail(null);setEvidenceLinks({});setDetailBusy(false);}
 function resetView(){setPage(0);closeDetail();}
 useEffect(()=>{
  let live=true;invalidateInspection();
  queueMicrotask(()=>{if(live){setBusy(true);setError('');setOwnershipError('');setSessions([]);setSnapshot(null);setDetail(null);setEvidenceLinks({});setDetailBusy(false);}});
  Promise.allSettled([authenticatedApiRequest({url:'/api/reliance-retail/module-reports/training',params:{from,to}}),retailUnifiedApi.snapshot({from,to})]).then(([training,master])=>{
   if(!live)return;
   if(training.status==='fulfilled')setSessions(training.value.data?.report?.rows||[]);else setError(training.reason.response?.data?.message||training.reason.message);
   if(master.status==='fulfilled')setSnapshot(master.value);else setOwnershipError('Zone/FO ownership unavailable in your authorized scope. Training records remain available.');
   setBusy(false);
  });
  return()=>{live=false;invalidateInspection();};
 },[from,to,refresh,invalidateInspection]);
 const rows=trainingReport(sessions,snapshot,filter).filter(row=>matchesReportQuery([row.store?.store_code,row.store?.store_name,row.trainer_name,row.training_date,row.training_class],query));
 const change=(key,value)=>{resetView();setFilter(previous=>({...previous,[key]:value}));};
 async function inspect(id){
  const request=++inspection.current;setError('');setDetail(null);setEvidenceLinks({});setDetailBusy(true);
  try{const response=await authenticatedApiRequest({url:`/api/training/sessions/${encodeURIComponent(id)}`});if(request===inspection.current)setDetail(response.data);}
  catch(e){if(request===inspection.current)setError(e.response?.data?.message||e.message);}
  finally{if(request===inspection.current)setDetailBusy(false);}
 }
 async function viewEvidence(evidence){
  const request=inspection.current;
  try{setError('');const response=await authenticatedApiRequest({url:`/api/training/sessions/${encodeURIComponent(detail.session.id)}/evidence/${encodeURIComponent(evidence.id)}/view-url`}),url=response.data?.view?.url;
   if(!url||!url.startsWith('https://'))throw Error('Evidence link unavailable.');if(request===inspection.current)setEvidenceLinks(previous=>({...previous,[evidence.id]:url}));
  }catch(e){if(request===inspection.current)setError(e.response?.data?.message||e.message);}
 }
 async function exportReport(){
  setExporting(true);setError('');
  try{
   const {default:ExcelJS}=await import('exceljs'),book=new ExcelJS.Workbook(),sheet=book.addWorksheet('Training');
   sheet.addRow(['Date','Class','Source Store Code','Geographic State','Reporting State','Identity Status','Trainer','Status','Participants','Evidence Count','Historical Zone ID','Historical FO ID']);
   rows.forEach(row=>sheet.addRow([row.training_date,row.training_class,row.store?.store_code,row.state,reportingState(row.state),row.canonical_store_id?'Verified':'Identity review required',row.trainer_name,row.status,row.attendee_count??null,row.evidence_count??null,row.ownership.zone_id,row.ownership.fo_profile_id]));
   await downloadUnified(book,'Retail_Training_Review.xlsx');
  }catch(e){setError(e.message);}finally{setExporting(false);}
 }
 const select=(label,key,options)=><label key={key}>{label}<select aria-label={`Training ${label}`} value={filter[key]||''} onChange={e=>change(key,e.target.value)}><option value="">All</option>{options.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>;
 const hk=rows.filter(row=>row.training_class==='HK').length,mepc=rows.filter(row=>row.training_class==='MEPC').length;
 const trainedStores=new Set(rows.filter(row=>row.canonical_store_id).map(row=>row.canonical_store_id)).size;
 return <section className="retail-report">
  <ReportHeader title="HK & MEPC Training" description="Review completed HK and MEPC sessions, attendees, topics and evidence.">
   <button disabled={busy} onClick={()=>{resetView();setRefresh(value=>value+1);}}><RefreshCw size={15}/>Refresh</button><button disabled={busy||!sessions.length||exporting} onClick={()=>void exportReport()}><Download size={15}/>{exporting?'Exporting…':'Export Training review'}</button>
  </ReportHeader>
  <ReportFilters>
   <label>From<input aria-label="Training from" type="date" value={from} max={to} onChange={e=>{if(e.target.value){resetView();setFrom(e.target.value);}}}/></label><label>To<input aria-label="Training to" type="date" value={to} min={from} onChange={e=>{if(e.target.value){resetView();setTo(e.target.value);}}}/></label>
   {select('Class','class',[['HK','HK'],['MEPC','MEPC']])}{select('State','state',REPORTING_STATES.map(item=>[item.code,item.label]))}
   {select('Zone','zone',(snapshot?.zones||[]).map(item=>[item.id,item.zone_name]))}{select('FO','fo',(snapshot?.fos||[]).map(item=>[item.id,item.full_name||item.employee_code]))}{select('Store','store',(snapshot?.stores||[]).map(item=>[item.id,`${item.store_code} · ${item.store_name}`]))}
   <label>Search<input aria-label="Search Training records" type="search" value={query} placeholder="Store code, name or trainer" onChange={e=>{resetView();setQuery(e.target.value);}}/></label>
  </ReportFilters>
  {busy&&<ReportNotice>Loading Training records…</ReportNotice>}{error&&<ReportNotice error>{error}</ReportNotice>}{ownershipError&&<ReportNotice>{ownershipError}</ReportNotice>}
  {!busy&&!error&&<ReportStats items={[{label:'HK trainings completed',value:hk},{label:'MEPC trainings completed',value:mepc},{label:'Completed training records',value:rows.length},{label:'Verified trained stores',value:snapshot?trainedStores:null,note:snapshot?'Distinct stores, not training count':'Canonical store coverage unavailable'}]}/>}
  {isPlatformAdmin(user)&&<details className="retail-report-panel"><summary className="retail-report-panel-heading">Admin: state coverage and ownership</summary><RetailStateCoverage snapshot={snapshot||undefined}/></details>}
  {!!rows.length&&<div className="retail-report-filters" aria-label="State-wise completed trainings">{[...new Set(rows.map(row=>reportingState(row.state)))].sort().map(state=><p key={state}>{state}: HK {rows.filter(row=>reportingState(row.state)===state&&row.training_class==='HK').length} · MEPC {rows.filter(row=>reportingState(row.state)===state&&row.training_class==='MEPC').length}</p>)}</div>}
  <div className="retail-report-panel"><div className="retail-report-panel-heading"><h2>Completed training records</h2><span>{rows.length} matching records</span></div>
   <div className="retail-report-table" role="region" aria-label="Completed training records" tabIndex={0}><table><thead><tr>{['Date / Class','Store','Trainer','Status','Historical Zone / FO','Attendees / Topics / Evidence','Details'].map(label=><th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{reportPage(rows,page,size).map(row=><tr key={row.id}>
    <td>{row.training_date}<p>{row.training_class}</p></td><td>{row.store?.store_code}<p>{row.store?.store_name||'Store not recorded'}</p></td><td>{row.trainer_name||'Not recorded'}</td><td><span className="retail-report-status" data-status={row.status}>{row.status}</span></td>
    <td>{row.ownership.known?(snapshot?.zones.find(item=>item.id===row.ownership.zone_id)?.zone_name||'Unassigned Zone'):'Historical ownership unknown'}<p>{row.ownership.known?(snapshot?.fos.find(item=>item.id===row.ownership.fo_profile_id)?.full_name||'Unassigned FO'):'Historical FO unknown'}</p></td>
    <td>{row.attendee_count??'Unknown'} / {row.topic_count??'Unknown'} / {row.evidence_count??'Unknown'}</td><td><button disabled={detailBusy} onClick={()=>void inspect(row.id)}>View Training evidence</button></td>
   </tr>)}</tbody></table></div>
   {!busy&&!rows.length&&!error&&<p className="retail-report-empty">No authorized Training records match these filters.</p>}
   <ReportPager label="Training records" count={rows.length} page={page} size={size} onPage={setPage} onSize={setSize}/>
  </div>
  <p className="retail-report-description">Export includes every matching record. Unknown historical ownership is shown as unavailable.</p>
  {detailBusy&&<ReportNotice>Loading authorized Training details…</ReportNotice>}
  {detail&&<section className="retail-report-evidence" aria-label="Training evidence and history"><header><h2>Training evidence and history</h2><button onClick={closeDetail}>Close Training details</button></header><p>{detail.session?.training_date} · {detail.session?.trainer_name_snapshot||'Trainer not recorded'} · {detail.session?.status}</p>
   <div>{!(detail.evidence||[]).length&&<p className="retail-report-description">No evidence recorded for this session.</p>}{(detail.evidence||[]).map(item=><p key={item.id||item.file_name}>{item.file_name} {evidenceLinks[item.id]?<a className="retail-report-button" href={evidenceLinks[item.id]} target="_blank" rel="noreferrer">Open authorized evidence</a>:<button onClick={()=>void viewEvidence(item)}>Get evidence link</button>}</p>)}</div>
   <div className="retail-report-detail-grid"><section><h3>Attendees</h3>{(detail.attendees||[]).map(item=><p key={item.id}>{item.employee_code} · {item.employee_name}</p>)}</section><section><h3>Topics</h3>{(detail.topics||[]).map(item=><p key={item.id}>{item.topic?.module_name||item.topic?.name||'Topic'} · {item.is_covered?'Covered':'Pending'}</p>)}</section><section><h3>History</h3>{(detail.events||[]).map(item=><p key={item.id}>{item.created_at} · {item.event_type}</p>)}</section></div>
  </section>}
 </section>;
}
