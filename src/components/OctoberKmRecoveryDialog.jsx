import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { authenticatedFetch } from '../services/api.js';

const reasons = ['Missing Check-Out','Missing Check-In','Missing End Day','Sourcing / Recruitment','Emergency Site Visit','GPS Failure','Offline Sync Failure','Other Official Travel'];
const km = n => n === null || n === undefined ? 'Unknown - verification required' : `${Number(n).toFixed(2)} km`;
const key = () => crypto.randomUUID();

export default function OctoberKmRecoveryDialog({ employee, endpoint, onClose, onApproved, request = authenticatedFetch }) {
  const dialog = useRef(null), requestKey = useRef(key()), decisionKey = useRef(key());
  const [date,setDate] = useState('2026-10-01'), [rows,setRows] = useState([]), [evidence,setEvidence] = useState(null);
  const [capabilities,setCapabilities] = useState({}), [busy,setBusy] = useState(false), [error,setError] = useState(''), [notice,setNotice] = useState('');
  const [form,setForm] = useState({ reason:reasons[0],journey_type:'Official journey',start_location:'',destination:'',intermediate_stops:'',explanation:'',evidence_refs:'',journey_start:'09:00',journey_end:'18:00',travel_mode:'',journey_total_km:'',requested_km:'' });
  const [selected,setSelected] = useState(null), [approval,setApproval] = useState({ approved_km:'',verified_included_km:'',inclusion_resolution:'',remarks:'' });
  useEffect(() => { const previous=document.activeElement;dialog.current.showModal();return()=>{dialog.current?.close();previous?.focus?.();}; },[]);
  async function api(path, body) {
    const response=await request(endpoint+path,body ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)} : {});
    const result=await response.json();if(!response.ok)throw Error(result.message || result.code || 'Recovery request failed.');return result;
  }
  async function load() { const result=await api(`?employee_code=${encodeURIComponent(employee)}&date=${date}`);setRows(result.rows);setCapabilities(result); }
  useEffect(()=>{let live=true;setEvidence(null);setSelected(null);requestKey.current=key();decisionKey.current=key();setRows([]);setCapabilities({});setError('');
    api(`?employee_code=${encodeURIComponent(employee)}&date=${date}`).then(result=>{if(live){setRows(result.rows);setCapabilities(result);}}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};
  },[employee,date,endpoint]);
  async function run(action) {setBusy(true);setError('');setNotice('');try{await action();}catch(e){setError(e.message);}finally{setBusy(false);}}
  async function submit(event) {event.preventDefault();await run(async()=>{
    const result=await api('/requests',{...form,employee_code:employee,date,journey_start:`${date}T${form.journey_start}:00+05:30`,journey_end:`${date}T${form.journey_end}:00+05:30`,
      intermediate_stops:form.intermediate_stops.split('\n').map(s=>s.trim()).filter(Boolean),evidence_refs:form.evidence_refs.split('\n').map(s=>s.trim()).filter(Boolean),requested_km:Number(form.requested_km),journey_total_km:Number(form.journey_total_km),idempotency_key:requestKey.current});
    setNotice('Request stored as pending. No payable credit was added.');await load();setSelected(result);
  });}
  async function decide(action) {await run(async()=>{
    const result=await api('/decision',{id:selected.id,version:selected.version,action,...approval,idempotency_key:decisionKey.current});
    setNotice(result.status==='approved'?'One additional recovery credit approved. Original attendance and settlement values remain unchanged.':'Request rejected. No payable credit added.');await load();setSelected(result);if(result.status==='approved')onApproved?.();
  });}
  async function download() {await run(async()=>{
    const response=await request(endpoint+'.csv?'+new URLSearchParams({employee_code:employee,date_from:'2026-10-01',date_to:'2026-10-31'}));
    if(!response.ok)throw Error('October export unavailable. No totals are assumed.');const url=URL.createObjectURL(await response.blob());const link=document.createElement('a');link.href=url;link.download=`${employee}-october-2026-recovery.csv`;link.click();URL.revokeObjectURL(url);
  });}
  const field=(name,label,type='text')=><label className="grid gap-1 text-sm" key={name}>{label}<input required type={type} step={type === 'number' ? '0.01' : undefined} value={form[name]} onChange={e=>setForm({...form,[name]:e.target.value})} className="rounded border p-2" /></label>;
  const approved=rows.filter(r=>r.status==='approved'), recovered=approved.reduce((n,r)=>n+Number(r.approved_additional_km),0);
  return createPortal(<dialog ref={dialog} aria-labelledby="october-recovery-title" onCancel={e=>{e.preventDefault();if(!busy)onClose();}} className="m-auto max-h-[92vh] w-[min(70rem,96vw)] overflow-auto rounded-xl bg-white p-6 text-slate-900 shadow-xl backdrop:bg-black/50">
    <h2 id="october-recovery-title" className="text-lg font-bold">October 2026 official travel recovery</h2>
    <p>{employee}. Additional adjustments only; saved approved and settled values are preserved.</p>
    <p className="my-2 text-sm">Missing GPS, Check-Out or End Day does not deny a documented official journey. Travel evidence is not automatically unpaid or petrol eligible. Financial approval remains inactive until separately authorized.</p>
    <label>Attendance / journey date <input aria-label="Recovery date" type="date" min="2026-10-01" max="2026-10-31" value={date} disabled={busy} onChange={e=>setDate(e.target.value)} /></label>
    {error?<p role="alert" className="my-2 text-red-700">{error}</p>:null}{notice?<p role="status" className="my-2 text-green-800">{notice}</p>:null}
    <button type="button" disabled={busy} className="my-3 rounded border p-2" onClick={()=>run(async()=>setEvidence(await api('/evidence',{employee_code:employee,date,journey_start:`${date}T${form.journey_start}:00+05:30`,journey_end:`${date}T${form.journey_end}:00+05:30`})))}>Analyse continuous GPS evidence (no save)</button>
    {evidence?<section aria-label="Recovery evidence" className="my-3 rounded border p-3">
      <p>Existing saved payable: {km(evidence.existing_payable_km)} | Reconstructed GPS travel: {km(evidence.calculated_travel_km)} | Approved additional: {km(recovered)}</p>
      <p>{evidence.message}</p>{evidence.recovery_history_status === 'unavailable_not_assumed_empty' ? <p>Recovery ledger unavailable. Prior recovery inclusion is unknown; persistence is inactive.</p> : null}<p>Recorded attendance modes: {evidence.attendances.map(a=>a.mode || 'Unknown').join(', ') || 'No attendance - actual mode requires documented verification.'}</p>
      <details><summary>Travel segments and inclusion evidence ({evidence.segments.length})</summary>{evidence.segments.map(s=><p key={s.id}>{s.from_time} to {s.to_time}: {km(s.gps_km)}; {s.status}; saved legs: {s.saved_leg_ids.join(', ') || 'None matched (not proof of unpaid travel)'}{s.late_sync_review?' | Late sync - review required':''}</p>)}</details>
      {evidence.route_estimates.map(r=><p key={r.segment_id}>Google estimate: {km(r.km)} ({r.status}). Not actual travelled distance.</p>)}
    </section>:null}
    <form onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <label className="grid text-sm">Recovery reason<select value={form.reason} onChange={e=>setForm({...form,reason:e.target.value})} className="border p-2">{reasons.map(r=><option key={r}>{r}</option>)}</select></label>
      {field('journey_type','Journey type')}{field('start_location','Start location')}{field('destination','Destination')}{field('journey_start','Journey start (India time)','time')}{field('journey_end','Journey end (India time)','time')}
      <label className="grid text-sm">Actual transport mode<select required value={form.travel_mode} onChange={e=>setForm({...form,travel_mode:e.target.value})} className="border p-2"><option value="">Select recorded / verified mode</option>{['bike','own_vehicle','car','auto','bus','train','other'].map(m=><option key={m}>{m}</option>)}</select></label>
      {field('journey_total_km','Documented total journey KM (not additional)','number')}{field('requested_km','Additional eligible KM requested','number')}
      {['intermediate_stops','explanation','evidence_refs'].map(name=><label key={name} className="grid text-sm">{name==='intermediate_stops'?'Intermediate official stops (one per line)':name==='explanation'?'Supporting employee explanation / official purpose':'Evidence references (one per line; no upload or URL fetch)'}<textarea required={name==='explanation'} value={form[name]} onChange={e=>setForm({...form,[name]:e.target.value})} className="rounded border p-2" /></label>)}
      <button disabled={busy||!capabilities.submission_enabled} className="rounded border p-2">Submit pending recovery request</button>
    </form>
    <h3 className="mt-5 font-bold">Requests and decisions</h3>
    <div className="overflow-auto"><table className="w-full text-left text-sm"><thead><tr>{['Select','Status','Reason','Requested additional','Approved additional','Rate','Additional amount','Original payable','Final payable','Final claim amount','Already included','Approved by'].map(h=><th key={h} className="p-2">{h}</th>)}</tr></thead><tbody>{rows.map(r=><tr key={r.id}><td><button type="button" onClick={()=>{setSelected(r);setApproval({approved_km:'',verified_included_km:'',inclusion_resolution:'',remarks:''});decisionKey.current=key();}}>Review</button></td><td>{r.status}</td><td>{r.recovery_reason}</td><td>{km(r.requested_km)}</td><td>{km(r.approved_additional_km)}</td><td>{r.travel_rate}</td><td>{r.additional_amount}</td><td>{km(r.original_payable_km)}</td><td>{km(r.resulting_payable_km)}</td><td>{r.resulting_claim_amount ?? 'Unknown'}</td><td>{km(r.verified_included_km)}</td><td>{r.approved_by || 'Pending'}</td></tr>)}</tbody></table></div>
    {selected?.status==='pending'?<section className="my-4 grid gap-2 rounded border p-3"><h3 className="font-bold">Approve one additional recovery: {selected.start_location} to {selected.destination}</h3><p>{selected.explanation}</p><p>Documented total: {km(selected.journey_total_km)}. Rate: {selected.travel_rate}. Existing protected totals and overlapping credits are checked again transactionally.</p>
      {Object.keys(approval).map(name=><label key={name} className="grid">{({approved_km:'Additional KM approved',verified_included_km:'Verified already-included journey KM (explicit verification required)',inclusion_resolution:'Explain inclusion verification and why the addition is unpaid (20+ characters)',remarks:'Approval / rejection remarks (10+ characters)'})[name]}<input type={name.endsWith('_km')?'number':'text'} step="0.01" value={approval[name]} onChange={e=>setApproval({...approval,[name]:e.target.value})} className="border p-2" /></label>)}
      <p>Proposed final payable: {km(selected.original_payable_km == null ? null : Number(selected.original_payable_km) + Number(approval.approved_km || 0))}. Proposed extra reimbursement: {(Number(approval.approved_km||0)*Number(selected.travel_rate)).toFixed(2)}. Proposed final claim amount: {selected.original_claim_amount == null ? 'Unknown' : (Number(selected.original_claim_amount) + Number(approval.approved_km || 0)*Number(selected.travel_rate)).toFixed(2)}. This preview is not an approval.</p>
      <div className="flex gap-2"><button disabled={busy||!capabilities.approval_enabled} onClick={()=>decide('approve')} type="button" className="rounded border p-2">Approve additional KM</button><button disabled={busy||!capabilities.approval_enabled} onClick={()=>decide('reject')} type="button" className="rounded border p-2">Reject recovery request</button></div>
    </section>:null}
    <div className="mt-4 flex justify-end gap-3"><button type="button" disabled={busy} onClick={download} className="rounded border p-2">Export October recovery claims CSV</button><button type="button" disabled={busy} onClick={onClose} className="rounded border p-2">Close</button></div>
  </dialog>,document.body);
}
