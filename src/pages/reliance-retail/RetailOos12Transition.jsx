import {useRef,useState} from 'react';
import {authenticatedApiRequest} from '../../services/api.js';
import {stageLabel} from './retailOosModel.js';
import {OOS12_FIELDS} from '../../../backend/shared/retailOos12Workflow.js';
const api=async(path,config={})=>(await authenticatedApiRequest({url:'/api/reliance-retail/mis'+path,...config})).data.result;
const label=key=>key.replaceAll('_',' ').replace(/^./,c=>c.toUpperCase());
const message=e=>e.response?.data?.message||e.message;
export default function RetailOos12Transition({order,capabilities,onSaved}){
 const [fields,setFields]=useState({}),[remarks,setRemarks]=useState(''),[files,setFiles]=useState([]),[evidence,setEvidence]=useState([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[confirm,setConfirm]=useState(false);
 const inflight=useRef(false),request=useRef(null),input=useRef(null);
 const requirement=capabilities?.requirements?.[order.id],next=requirement?.next?.code,spec=requirement?.spec;
 const canSubmit=requirement?.can_submit===true&&capabilities?.actions?.[order.id]?.includes(next);
 const enabled=capabilities?.writes_enabled===true&&capabilities?.twelve_stage_enabled===true;
 const required=Array.isArray(spec?.fields)?spec.fields:[];
 const schemaValid=JSON.stringify(required)===JSON.stringify(OOS12_FIELDS[next]||[]);
 async function run(fn){if(inflight.current)return;inflight.current=true;setBusy(true);setError('');try{await fn();}catch(e){setError(message(e));setConfirm(false);}finally{inflight.current=false;setBusy(false);}}
 async function upload(){await run(async()=>{for(const file of files){
  const meta=await api('/oos/evidence/prepare',{method:'POST',data:{order_id:order.id,revision:order.revision,filename:file.name,mime_type:file.type,file_size:file.size}});
  const response=await fetch(meta.signedUrl,{method:'PUT',headers:{'Content-Type':file.type,'x-upsert':'false'},body:file});if(!response.ok)throw Error('Evidence upload failed. No status was changed.');
  await api('/oos/evidence/finalize',{method:'POST',data:{id:meta.id}});setEvidence(v=>[...v,{id:meta.id,name:file.name}]);
 }setFiles([]);if(input.current)input.current.value='';});}
 async function save(){await run(async()=>{
  const data={order_id:order.id,revision:order.revision,fields,evidence_ids:evidence.map(e=>e.id),reason:remarks};
  const signature=JSON.stringify({action:next,data});if(request.current?.signature!==signature)request.current={signature,id:crypto.randomUUID()};
  await api('/command/oos',{method:'POST',data:{action:next,data:{...data,request_id:request.current.id}}});setConfirm(false);onSaved();
 });}
 return <section className="oos-status-form" aria-label="Twelve-stage status update"><h3>Update status</h3><p>Current status: {stageLabel(order.status)}</p>
 <p>Next status: <strong>{next?stageLabel(next):order.stage===12?'Complete — Invoice Raised':'Unavailable'}</strong></p>
 {next&&<p>Required authority: {spec?.authority||'Unavailable'}. Supporting evidence is mandatory; upload alone does not change status.</p>}
 {!enabled&&<p className="oos-warning">Twelve-stage writes are disabled by an operational control.</p>}
 {!canSubmit&&next&&<p>This account lacks the required independent next-stage authority in this state.</p>}
 {error&&<p role="alert" className="oos-error">{error}</p>}
 {canSubmit&&schemaValid&&<form onSubmit={e=>{e.preventDefault();setConfirm(true);}}><fieldset disabled={busy||!enabled}>
 {required.map(key=><label key={key}>{label(key)}<input aria-label={label(key)} required type={key.endsWith('date')?'date':'text'} inputMode={key.endsWith('amount')?'decimal':undefined} pattern={key.endsWith('amount')?'[0-9]{1,18}(\\.[0-9]{1,2})?':undefined} maxLength={key.endsWith('amount')?21:2000} value={fields[key]||''} onChange={e=>{setFields(v=>({...v,[key]:e.target.value}));setConfirm(false);}}/></label>)}
 <label>Remarks<textarea aria-label="Transition remarks" required minLength={3} maxLength={2000} value={remarks} onChange={e=>{setRemarks(e.target.value);setConfirm(false);}}/></label>
 <label>Supporting documents<input ref={input} aria-label="Supporting documents" type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.xlsx,.docx" onChange={e=>{setFiles([...e.target.files]);setConfirm(false);}}/></label>
 <button type="button" disabled={!files.length} onClick={()=>void upload()}>Upload supporting evidence</button>
 <ul aria-label="Verified supporting evidence">{evidence.map(e=><li key={e.id}>{e.name} — verified</li>)}</ul>
 <button disabled={evidence.length<(spec?.minimum_evidence||1)}>Review status change</button>
 </fieldset></form>}
 {confirm&&<div className="oos-overlay"><section className="oos-dialog" role="dialog" aria-modal="true" aria-label="Confirm twelve-stage transition"><h2>Confirm status change</h2><p>{order.reference}: {stageLabel(order.status)} → {stageLabel(next)}</p><p>Revision {order.revision}. Evidence files: {evidence.length}. This creates immutable history.</p>{Object.entries(fields).map(([key,value])=><p key={key}>{label(key)}: {value}</p>)}<p>{remarks}</p><button disabled={busy} onClick={()=>setConfirm(false)}>Cancel</button><button disabled={busy||!enabled} onClick={()=>void save()}>{busy?'Saving…':'Confirm and save'}</button></section></div>}
 </section>;
}
