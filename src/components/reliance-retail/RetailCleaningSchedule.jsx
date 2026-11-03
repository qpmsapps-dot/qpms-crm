import {useEffect,useMemo,useState} from 'react';
import {authenticatedApiRequest} from '../../services/api.js';
import {useAuth} from '../../context/auth-context.js';
import {retailMisRole} from '../../../backend/shared/retailMisAccess.js';
import {retailUnifiedApi} from '../../services/retailUnifiedApi.js';
import {indiaToday} from '../../../backend/shared/retailAttendance.js';
import {ReportNotice} from './RetailReportUi.jsx';

// A successful save is a real Planned schedule, not a proposal awaiting approval.
export default function RetailCleaningSchedule({onClose,onSaved=()=>{},readOnly=false}){
 const {user}=useAuth(),mis=Boolean(retailMisRole(user?.role)),today=indiaToday();
 const [source,setSource]=useState(null),[state,setState]=useState(''),[zone,setZone]=useState('');
 const [storeId,setStoreId]=useState(''),[search,setSearch]=useState(''),[date,setDate]=useState(today),[notes,setNotes]=useState('');
 const [request,setRequest]=useState(()=>crypto.randomUUID());
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[receipt,setReceipt]=useState(null);
 useEffect(()=>{
  let live=true;
  const loader=mis?authenticatedApiRequest({url:'/api/reliance-retail/mis/report/cleaning',params:{from:today,to:today}}).then(x=>({stores:x.data?.result?.stores||[],mis:true})):retailUnifiedApi.snapshot({from:today,to:today});
  loader.then(x=>{if(live)setSource(x);}).catch(e=>{if(live)setError(e.response?.data?.message||e.message);});
  return()=>{live=false;};
 },[mis,today]);
 const stores=useMemo(()=>((source?.stores||[]).filter(s=>s.status==='Active'&&
  (mis||source.admin||source.permissions?.some(p=>p.state===s.state&&p.permission==='editor')))),[source,mis]);
 const states=[...new Set(stores.map(s=>s.state))].sort();
 const scoped=stores.filter(s=>(!state||s.state===state)&&(!zone||s.zone_id===zone)&&
  (!search||[s.store_code,s.store_name,s.city,s.zone_name].join(' ').toLowerCase().includes(search.trim().toLowerCase())));
 const selected=stores.find(s=>s.id===storeId);
 const zones=[...new Map(stores.filter(s=>(state==='TN'||state==='PY'||state==='Tamil Nadu')&&s.zone_id).map(s=>[s.zone_id,{id:s.zone_id,name:s.zone_name||s.zone_code||s.zone_id}])).values()];
 async function save(e){
  e.preventDefault();if(!selected||busy||readOnly||date<today)return;
  setBusy(true);setError('');
  try{
   const input={store_id:selected.id,scheduled_date:date,reason:notes.trim(),request_id:request};
   const result=mis?(await authenticatedApiRequest({method:'POST',url:'/api/reliance-retail/mis/cleaning/schedule',data:input})).data.result:await retailUnifiedApi.schedule(input);
   setReceipt({store:selected,day:date,assignmentPending:result.assignment_pending===true||result.schedule?.metadata?.assignment_pending===true,scope:result.dispatch_scope||result.schedule?.metadata?.dispatch_scope});
   onSaved(result);
  }catch(e){setError(e.response?.data?.message||e.message);}
  finally{setBusy(false);}
 }
 function next(){setStoreId('');setSearch('');setNotes('');setRequest(crypto.randomUUID());setReceipt(null);}
 return <section className="retail-report-evidence" aria-label="Schedule Deep Cleaning">
  <header><h2>Schedule Deep Cleaning</h2><button type="button" disabled={busy} onClick={onClose}>Close scheduling</button></header>
  <p>Select an active store and a date. Saving creates the schedule immediately — no approval or separate activation.</p>
  {error&&<ReportNotice error>{error}</ReportNotice>}
  {receipt?<div role="status"><ReportNotice>Deep Cleaning scheduled for {receipt.store.store_code} · {receipt.day}. {receipt.assignmentPending?'Zone FO assignment is pending; the schedule is saved and remains visible to MIS.':receipt.scope==='ZONE'?'Shared with the assigned zone FO.':'Available to Retail FOs in the authorized state.'}</ReportNotice><button type="button" onClick={next}>Schedule another store</button></div>:
  <form onSubmit={save} className="retail-report-filters">
   <label>State<select aria-label="Deep Cleaning schedule state" value={state} onChange={e=>{setState(e.target.value);setZone('');setStoreId('');}} disabled={busy||readOnly}><option value="">All permitted states</option>{states.map(s=><option key={s} value={s}>{s}</option>)}</select></label>
   {(state==='TN'||state==='PY'||state==='Tamil Nadu')&&zones.length>0&&<label>TN Zone<select aria-label="TN Deep Cleaning zone" value={zone} onChange={e=>{setZone(e.target.value);setStoreId('');}} disabled={busy||readOnly}><option value="">All authorized TN zones</option>{zones.map(z=><option key={z.id} value={z.id}>{z.name}</option>)}</select></label>}
   <label>Find store<input aria-label="Search Deep Cleaning stores" type="search" placeholder="Search Store Code or store name" value={search} onChange={e=>{setSearch(e.target.value);setStoreId('');}} disabled={busy||readOnly}/></label>
   <label>Store<select required aria-label="Schedule cleaning store" value={storeId} onChange={e=>setStoreId(e.target.value)} disabled={busy||readOnly}><option value="">Choose store ({scoped.length} matches)</option>{scoped.slice(0,100).map(s=><option key={s.id} value={s.id}>{s.store_code} · {s.store_name} · {s.state}</option>)}</select></label>
   <label>Schedule date<input required type="date" aria-label="Schedule cleaning date" min={today} value={date} onChange={e=>setDate(e.target.value)} disabled={busy||readOnly}/></label>
   <label>Notes (optional)<input maxLength={2000} aria-label="Cleaning schedule notes" value={notes} onChange={e=>setNotes(e.target.value)} disabled={busy||readOnly}/></label>
   <button disabled={busy||readOnly||!storeId||date<today}>{busy?'Saving schedule…':'Add Deep Cleaning Schedule'}</button>
  </form>}
  {selected&&!receipt&&<p aria-label="Selected cleaning store">{selected.store_code} · {selected.store_name} · {selected.state}{selected.zone_name?' · '+selected.zone_name:''}</p>}
  {!source&&!error&&<ReportNotice>Loading authorized stores…</ReportNotice>}
  {source&&!stores.length&&<ReportNotice>No active authorized stores are available for scheduling.</ReportNotice>}
  {source&&scoped.length>100&&<p>Showing the first 100 matches; search by Store Code to narrow the selection.</p>}
  {readOnly&&<ReportNotice>Read-only access. Schedules cannot be created.</ReportNotice>}
  <p>TN/PY schedules follow zone FO assignment. Other states allow their Retail FOs to find stores state-wise. Before/after cleaning evidence remains required on completion.</p>
 </section>;
}
