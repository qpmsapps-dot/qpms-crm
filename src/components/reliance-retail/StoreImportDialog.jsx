import { useEffect, useState } from 'react';
import { authenticatedApiRequest } from '../../services/api.js';
import { exportRetailStoreReview } from '../../utils/retailStoreReviewExport.js';

const base='/api/reliance-retail/store-import';
async function request(path,config={}) { return (await authenticatedApiRequest({url:base+path,...config})).data; }
const message=e=>e.response?.data?.message||e.message;
const button='rounded-lg border px-3 py-2 text-sm disabled:opacity-40';

function ImportHistoryActions({batch,enabled,onChanged}) {
  const [reason,setReason]=useState('');const [attendance,setAttendance]=useState('');const [recovery,setRecovery]=useState(null);
  const [recoveryEnabled,setRecoveryEnabled]=useState(false);const [reviewed,setReviewed]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  async function run(action){setBusy(true);setError('');try{await action();}catch(e){setError(message(e));}finally{setBusy(false);}}
  if(batch.status!=='committed')return null;
  return <div className="my-2 space-y-2 rounded border p-3">
    <p>Rollback preserves audit history and deactivates unused new identities. Referenced or changed records require separate correction review.</p>
    <input aria-label={`Rollback reason ${batch.id}`} placeholder="Reviewed rollback reason (at least 10 characters)" value={reason} onChange={e=>setReason(e.target.value)} className="w-full rounded border p-2"/>
    <button className={button} disabled={!enabled||busy||reason.trim().length<10} onClick={()=>run(async()=>{await request('/rollback',{method:'POST',data:{id:batch.id,reason}});await onChanged();})}>Confirm reviewed rollback</button>
    {!!batch.receipt?.stores?.length&&<>
      <p>Recover previously unmatched attendance for this exact approved Store Master batch. Existing employee-days cannot be replaced here.</p>
      <input aria-label={`Original attendance batch ${batch.id}`} placeholder="Original committed attendance batch ID" value={attendance} onChange={e=>{setAttendance(e.target.value);setRecovery(null);setReviewed(false);}} className="w-full rounded border p-2"/>
      <button className={button} disabled={busy||!attendance.trim()} onClick={()=>run(async()=>{const r=await request('/recovery/preview',{method:'POST',data:{store_batch_id:batch.id,attendance_batch_id:attendance.trim()}});setRecovery(r.preview);setRecoveryEnabled(r.activation_enabled);setReviewed(false);})}>Preview unmatched attendance recovery</button>
      {recovery&&<div><p>{recovery.valid_rows} valid · {recovery.rejected_rows} rejected · {recovery.affected_records?.length||0} existing employee-day conflicts</p><p>{recovery.recovery_blocked}</p>
        <details><summary>Review recovery rows and exceptions</summary><pre className="max-h-48 overflow-auto whitespace-pre-wrap">{JSON.stringify({rows:recovery.preview,rejected:recovery.rejected},null,2)}</pre></details>
        <label className="block"><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/> I approve this exact recovery preview</label>
        <button className={button} disabled={busy||!recoveryEnabled||!reviewed||!recovery.can_commit} onClick={()=>run(async()=>{await request('/recovery/confirm',{method:'POST',data:{id:recovery.id,preview_key:recovery.preview_key}});setRecovery({...recovery,can_commit:false});await onChanged();})}>Confirm attendance recovery</button>
        {!recoveryEnabled&&<p>Attendance recovery awaits separate approval.</p>}
      </div>}
    </>}
    {error&&<p role="alert" className="text-red-800">{error}</p>}
  </div>;
}

export function StoreImportButton({onImported}) {
  const [allowed,setAllowed]=useState(false);const [open,setOpen]=useState(false);
  useEffect(()=>{let live=true;request('/capability').then(r=>{if(live)setAllowed(r.capability.allowed);}).catch(()=>{});return()=>{live=false;};},[]);
  if(!allowed)return null;
  return <><button className={button} onClick={()=>setOpen(true)}>Upload Store Master &amp; AOP</button>{open&&<StoreImportDialog onClose={()=>setOpen(false)} onImported={onImported}/>}</>;
}

export default function StoreImportDialog({onClose,onImported}) {
  const [file,setFile]=useState(null);const [preview,setPreview]=useState(null);const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');const [identity,setIdentity]=useState(false);const [aop,setAop]=useState(false);
  const [reviewed,setReviewed]=useState(false);const [enabled,setEnabled]=useState(false);const [filter,setFilter]=useState('');const [history,setHistory]=useState([]);
  async function loadHistory(){setHistory((await request('/history')).history);}
  async function validate(){setBusy(true);setError('');setPreview(null);setReviewed(false);setIdentity(false);setAop(false);
    try{const r=await request('/preview',{method:'POST',data:file,headers:{'Content-Type':'application/octet-stream','X-File-Name':encodeURIComponent(file.name)},timeout:120000});setPreview(r.preview);setEnabled(r.activation_enabled);if(r.preview.installed)await loadHistory();}
    catch(e){setError(message(e));}finally{setBusy(false);}}
  async function confirm(){setBusy(true);setError('');try{const r=await request('/confirm',{method:'POST',data:{id:preview.id,preview_key:preview.preview_key,identity,aop}});setPreview({...preview,status:'committed',receipt:r.receipt,can_confirm:false});await loadHistory();await onImported();}catch(e){setError(message(e));}finally{setBusy(false);}}
  const rows=(preview?.rows||[]).filter(r=>!filter||`${r.store_code} ${r.store_name} ${r.state} ${r.issues.join(' ')}`.toLowerCase().includes(filter.toLowerCase()));
  async function download(){setBusy(true);setError('');try{await exportRetailStoreReview(preview,{filename:file?.name||''});}catch(e){setError(message(e));}finally{setBusy(false);}}
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"><section role="dialog" aria-modal="true" aria-label="Upload Store Master and AOP" className="max-h-[90vh] w-full max-w-6xl overflow-auto rounded-2xl bg-white p-6 shadow-xl">
    <div className="flex justify-between"><h2 className="text-lg font-bold">Upload Store Master &amp; AOP</h2><button aria-label="Close store upload" disabled={busy} onClick={onClose}>Close</button></div>
    <p className="my-3 text-sm">Use the Store Master Audit Upload Review template. Existing canonical identities are preserved. Rows marked NO or missing approved evidence stay pending. Identity approval and effective-dated AOP approval are separate.</p>
    <input aria-label="Store Master and AOP Excel file" type="file" accept=".xlsx" disabled={busy} onChange={e=>{setFile(e.target.files[0]);setPreview(null);setError('');setReviewed(false);}}/>
    <button className={`${button} ml-3`} disabled={!file||busy} onClick={validate}>{busy?'Processing…':'Validate and Preview'}</button>
    {error&&<p role="alert" className="my-3 rounded bg-red-50 p-3 text-red-800">{error}</p>}
    {preview&&<div className="mt-4 space-y-4">
      <p>{preview.total_rows} source rows · {preview.canonical_count} existing stores · {preview.identity_ready} approved identity additions · {preview.aop_ready} approved AOP rows</p>
      {preview.note&&<p className="rounded bg-amber-50 p-3 text-sm">{preview.note}</p>}
      {!enabled&&<p className="text-sm text-amber-900">Activation is awaiting review of the preview and approval decisions.</p>}
      <div className="overflow-auto"><table className="w-full text-left text-xs"><thead><tr>{['Geography','Reporting','Existing','Upload rows','Existing matches','Proposed new codes','Approved identities','Approved AOP'].map(h=><th className="p-2" key={h}>{h}</th>)}</tr></thead><tbody>{preview.states.map(s=><tr className="border-t" key={s.state}>{[s.state,s.reporting_state,s.existing,s.uploaded_rows,s.existing_matches,s.proposed_new_codes.length,s.approved_identity_rows,s.approved_aop_rows].map((v,i)=><td className="p-2" key={i}>{v}</td>)}</tr>)}</tbody></table></div>
      <h3 className="font-semibold">Conflict Review</h3><input aria-label="Filter store conflicts" placeholder="Filter by code, state or issue" className="w-full rounded border p-2 text-sm" value={filter} onChange={e=>setFilter(e.target.value)}/>
      <div className="max-h-72 overflow-auto"><table className="w-full text-left text-xs"><thead><tr>{['Row','Store code','Name','Geography','Identity','AOP','Issues / pending decisions'].map(h=><th key={h} className="p-2">{h}</th>)}</tr></thead><tbody>{rows.map(r=><tr className="border-t" key={r.source_row}>{[r.source_row,r.store_code,r.store_name,r.state,r.identity_action,r.aop_action,r.issues.join('; ')].map((v,i)=><td key={i} className="p-2 align-top">{v}</td>)}</tr>)}</tbody></table></div>
      <button className={button} disabled={busy} onClick={download}>Export Excel review</button>
      <p className="text-xs text-slate-600">Excel decision fields are review requests. Editing the workbook never approves a store or AOP. Re-upload the final reviewed source for fresh row-bound validation before explicit Admin confirmation.</p>
      {preview.status==='committed'?<p className="rounded bg-green-50 p-3">This file was imported. Replay returns the original receipt and adds no duplicate rows.</p>:preview.status==='rolled_back'?<p>This import was rolled back. A new reviewed file is required.</p>:<>
        <label className="block text-sm"><input type="checkbox" disabled={!preview.identity_ready||busy} checked={identity} onChange={e=>setIdentity(e.target.checked)}/> Import approved Store Master additions ({preview.identity_ready})</label>
        <label className="block text-sm"><input type="checkbox" disabled={!preview.aop_ready||busy} checked={aop} onChange={e=>setAop(e.target.checked)}/> Import independently approved AOP values ({preview.aop_ready})</label>
        <label className="block text-sm"><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/> I reviewed the preview, conflicts and exact approved scope</label>
        <button className={`${button} bg-blue-600 text-white`} disabled={busy||!enabled||!preview.can_confirm||!reviewed||(!identity&&!aop)} onClick={confirm}>Confirm Import</button>
      </>}
      <p className="text-xs text-slate-600">Budget components are proposals. Final AOP values, approval evidence and periods must be approved separately. Pending or closed-source records receive no automatic activation. Attendance reprocessing requires a separate reviewed preview.</p>
      {!!history.length&&<details><summary>Import history</summary>{history.map(h=><div key={h.id} className="border-t p-2 text-xs">{h.filename} · {h.status} · {h.created_at} · {h.id}<ImportHistoryActions batch={h} enabled={enabled} onChanged={async()=>{await loadHistory();await onImported();}}/></div>)}</details>}
    </div>}
  </section></div>;
}
