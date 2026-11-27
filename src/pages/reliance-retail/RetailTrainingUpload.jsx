import {useCallback, useEffect, useRef, useState} from 'react';
import {useAuth} from '../../context/auth-context.js';
import {authenticatedApiRequest} from '../../services/api.js';
import TrainingWebUpload from '../../components/reliance-retail/TrainingWebUpload.jsx';
import TrainingV2Drawer from '../../components/reliance-retail/TrainingV2Drawer.jsx';
import {downloadUnified} from '../../utils/retailUnifiedExport.js';
import {indiaToday} from '../../../backend/shared/retailAttendance.js';
import '../../components/reliance-retail/deepCleaningV2.css';
import '../../components/reliance-retail/trainingV2.css';

// Navigation admits the upload screen only; the existing RPCs authorize every row.
export default function RetailTrainingUpload() {
  const {user}=useAuth();
  const [rows,setRows]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [from,setFrom]=useState(indiaToday().slice(0,7)+'-01'),[to,setTo]=useState(indiaToday());
  const [revision,setRevision]=useState(0),[selected,setSelected]=useState(null),[detail,setDetail]=useState(null);
  const [detailError,setDetailError]=useState(''),[detailBusy,setDetailBusy]=useState(false),[links,setLinks]=useState({}),[linkErrors,setLinkErrors]=useState({});
  const generation=useRef(0);
  const cancel=useCallback(()=>{generation.current++;},[]);
  const close=useCallback(()=>{generation.current++;setSelected(null);setDetail(null);setLinks({});setLinkErrors({});setDetailBusy(false);},[]);
  useEffect(()=>{
    let live=true;close();
    queueMicrotask(()=>{if(live){setBusy(true);setError('');setRows([]);}});
    authenticatedApiRequest({url:'/api/training/sessions',params:{date_from:from,date_to:to}})
      .then(r=>{if(live){if(!Array.isArray(r.data?.sessions))throw Error('Training report is incomplete.');setRows(r.data.sessions.filter(s=>s.category?.code==='technical_mep'));}})
      .catch(e=>{if(live)setError(e.response?.data?.message||e.message);})
      .finally(()=>{if(live)setBusy(false);});
    return ()=>{live=false;cancel();};
  },[from,to,revision,user?.profileId,user?.id,close,cancel]);
  const inspect=async row=>{
    const request=++generation.current;setSelected({...row,training_class:'MEPC'});setDetail(null);setLinks({});setLinkErrors({});setDetailError('');setDetailBusy(true);
    try {const r=await authenticatedApiRequest({url:`/api/training/sessions/${row.id}`});if(request===generation.current)setDetail(r.data);}
    catch(e){if(request===generation.current)setDetailError(e.response?.data?.message||e.message);}
    finally{if(request===generation.current)setDetailBusy(false);}
  };
  const authorize=async evidence=>{
    const current=generation.current;
    try{const r=await authenticatedApiRequest({url:`/api/training/sessions/${selected.id}/evidence/${evidence.id}/view-url`});const url=r.data?.view?.url;if(!url?.startsWith('https://'))throw Error('Private evidence is unavailable.');if(current===generation.current)setLinks(v=>({...v,[evidence.id]:url}));}
    catch(e){if(current===generation.current)setLinkErrors(v=>({...v,[evidence.id]:e.response?.data?.message||e.message}));}
  };
  const exportRows=async()=>{
    setBusy(true);
    try{const {default:ExcelJS}=await import('exceljs'),book=new ExcelJS.Workbook(),sheet=book.addWorksheet('MEPC Training');
      sheet.addRow(['Training date','Store code','Store name','State','Actual trainer','Status','Verified evidence count']);
      rows.forEach(r=>sheet.addRow([r.training_date,r.store?.store_code,r.store?.store_name,r.store?.state,r.trainer_name,r.status,r.evidence_count]));
      await downloadUnified(book,'MEPC_Training_Reports.xlsx');
    }catch(e){setError(e.message);}finally{setBusy(false);}
  };
  return <section className={'retail-report dc-v2 tv-v2 dc-layout'+(selected?' dc-with-drawer':'')}><div className="dc-main">
    <h1>MEPC Training uploads</h1><p>Upload and review Training within your authorized Reliance Retail store and regional scope.</p>
    <TrainingWebUpload key={user?.profileId||user?.id} profile={user} onSubmitted={()=>setRevision(v=>v+1)} />
    <section className="dc-card"><h2>Authorized MEPC Training reports</h2><div className="tv-filters">
      <label>From<input aria-label="MEPC report from" type="date" max={to} value={from} onChange={e=>setFrom(e.target.value)} /></label>
      <label>To<input aria-label="MEPC report to" type="date" min={from} max={indiaToday()} value={to} onChange={e=>setTo(e.target.value)} /></label>
      <button disabled={busy} onClick={()=>setRevision(v=>v+1)}>Refresh reports</button>
      <button disabled={busy||!rows.length||!!error} onClick={exportRows}>Download MEPC reports</button></div>
      {busy&&<p role="status">Loading reports…</p>}{error&&<p role="alert">{error}</p>}
      <div className="dc-table-wrap"><table><thead><tr><th>Date</th><th>Store</th><th>State</th><th>Actual trainer</th><th>Status</th><th>Details</th></tr></thead><tbody>
        {rows.map(row=><tr key={row.id}><td>{row.training_date}</td><td>{row.store?.store_code} / {row.store?.store_name}</td><td>{row.store?.state}</td><td>{row.trainer_name}</td><td>{row.status}</td><td><button onClick={()=>inspect(row)}>View {row.store?.store_code||row.id}</button></td></tr>)}
      </tbody></table></div>{!busy&&!error&&!rows.length&&<p>No authorized MEPC reports in this period.</p>}
    </section></div>
    {selected&&<TrainingV2Drawer key={selected.id} record={selected} detail={detail} busy={detailBusy} error={detailError} links={links} linkErrors={linkErrors} onAuthorize={authorize} onRetry={()=>inspect(selected)} onClose={close} />}
  </section>;
}
