import {useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import {retailUnifiedApi} from '../../services/retailUnifiedApi.js';
import {indiaToday} from '../../../backend/shared/retailAttendance.js';
import {ReportNotice} from './RetailReportUi.jsx';

// Reuse the established maker/checker workflow. Saving a request is not activation.
export default function RetailCleaningSchedule({onClose,readOnly=false}) {
 const [snapshot,setSnapshot]=useState(null),[storeId,setStoreId]=useState(''),[date,setDate]=useState(indiaToday()),[reason,setReason]=useState('');
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[saved,setSaved]=useState(false);
 useEffect(()=>{let live=true;retailUnifiedApi.snapshot({from:indiaToday(),to:indiaToday()}).then(r=>{if(live)setSnapshot(r);}).catch(e=>{if(live)setError(e.response?.data?.message||e.message);});return()=>{live=false;};},[]);
 const stores=(snapshot?.stores||[]).filter(s=>s.status==='Active'&&(snapshot.admin||snapshot.permissions?.some(p=>p.state===s.state&&['editor','reviewer'].includes(p.permission))));
 const selected=stores.find(s=>s.id===storeId);
 async function save(e){
  e.preventDefault();const store=stores.find(s=>s.id===storeId);if(!store||busy||readOnly)return;
  setBusy(true);setError('');
  try{await retailUnifiedApi.propose({kind:'DC_SCHEDULE',state:store.state,store_id:store.id,changes:{scheduled_date:date},reason:reason.trim()});setSaved(true);}
  catch(e){setError(e.response?.data?.message||e.message);}finally{setBusy(false);}
 }
 return <section className="retail-report-evidence" aria-label="Schedule Deep Cleaning">
  <header><h2>Schedule Deep Cleaning</h2><button disabled={busy} onClick={onClose}>Close scheduling</button></header>
  <p>Submit a schedule request for independent approval. The schedule appears in reports after an Admin applies the approved request.</p>
  {error&&<ReportNotice error>{error}</ReportNotice>}
  {saved?<ReportNotice>Schedule request saved for independent review. No schedule has been activated. Review it in Store Master → Unified Management → AOP &amp; Approvals.</ReportNotice>:<form onSubmit={save} className="retail-report-filters">
   <label>Store<select required aria-label="Schedule cleaning store" value={storeId} onChange={e=>setStoreId(e.target.value)} disabled={busy||readOnly}><option value="">Select an authorized store</option>{stores.map(s=><option key={s.id} value={s.id}>{s.store_code} · {s.store_name} · {s.state}</option>)}</select></label>
   <label>Scheduled date<input required type="date" aria-label="Schedule cleaning date" value={date} onChange={e=>setDate(e.target.value)} disabled={busy||readOnly}/></label>
   <label>Reason / approval reference<input required minLength={3} maxLength={2000} aria-label="Cleaning schedule reason" value={reason} onChange={e=>setReason(e.target.value)} disabled={busy||readOnly}/></label>
   <button disabled={busy||readOnly||!storeId||reason.trim().length<3}>{busy?'Saving request…':'Submit schedule request'}</button>
  </form>}
  {selected&&<p aria-label="Selected cleaning store">{selected.store_code} · {selected.store_name} · {selected.state}{selected.city?` · ${selected.city}`:''}{selected.store_format?` · ${selected.store_format}`:''}</p>}
  {!snapshot&&!error&&<ReportNotice>Loading permitted stores…</ReportNotice>}
  {snapshot&&!stores.length&&<ReportNotice>No active stores are available for scheduling under your existing permissions.</ReportNotice>}
  {readOnly&&<ReportNotice>Read-only access. Schedule requests cannot be submitted.</ReportNotice>}
  <p>After approval, the assigned FO records the work and before/after photos through the existing Deep Cleaning submission workflow. Refresh this report after submission.</p>
  <Link to="/reliance-retail/store-master" className="retail-report-button">Open schedule approvals</Link>
 </section>;
}
