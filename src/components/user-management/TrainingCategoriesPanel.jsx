import {useEffect,useState} from 'react';
import {authenticatedApiRequest} from '../../services/api.js';

// Independent operation: never included in the ordinary employee/profile payload.
export default function TrainingCategoriesPanel({profileId,request=authenticatedApiRequest}) {
  const [data,setData]=useState(null),[changes,setChanges]=useState({}),[reason,setReason]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const url=`/api/training/administration/${encodeURIComponent(profileId)}/categories`;
  useEffect(()=>{
    let current=true;
    request({url}).then(r=>{if(current)setData(r.data.result);}).catch(e=>{
      if(current)setError(e.response?.status===403?'Super Admin access is required to view or change Training categories.':'Training categories could not be loaded.');
    });
    return()=>{current=false;};
  },[url,request]);
  async function save() {
    setBusy(true);setError('');setMessage('');
    try {
      const payload=data.categories.filter(c=>Object.hasOwn(changes,c.code)).map(c=>({code:c.code,active:changes[c.code],expected_revision:c.revision}));
      const r=await request({url,method:'PUT',data:{changes:payload,reason}});
      setData(r.data.result);setChanges({});setReason('');setMessage('Training permissions saved.');
    } catch(e) {
      setError(e.response?.status===409?'Permissions changed elsewhere. Close and reopen this user before retrying.':e.response?.data?.message || 'Training permissions could not be saved.');
    } finally {setBusy(false);}
  }
  return <section className="rounded-xl border border-slate-200 p-4" aria-label="Training Categories">
    <h3 className="text-sm font-bold text-slate-950">Training Categories</h3>
    <p className="mt-1 text-xs text-slate-600">Individual submission permissions. Store and regional authorization still apply.</p>
    {error&&<p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    {message&&<p role="status" className="mt-2 text-sm text-green-700">{message}</p>}
    {!data&&!error&&<p role="status">Loading Training categories…</p>}
    {data&&<>
      {!data.eligible&&<p>This profile is not eligible for FO Training assignments.</p>}
      <div className="mt-3 flex flex-wrap gap-4">{data.categories.map(c=><label key={c.code} className="text-sm">
        <input type="checkbox" className="mr-2" checked={changes[c.code]??c.active} disabled={busy||!data.can_administer||!data.eligible} onChange={e=>setChanges({...changes,[c.code]:e.target.checked})}/>
        {c.code==='hk'?'HK Training':'MEPC Training'}
        <span className="ml-2 text-xs text-slate-500">Currently {c.effective?'effective':'not effective'} · revision {c.revision}</span>
        {(c.effective_from||c.effective_to)&&<span className="block text-xs text-slate-500">{c.effective_from||'Immediate'} → {c.effective_to||'No expiry'}</span>}
      </label>)}</div>
      <label className="mt-3 block text-sm">Change reason<input aria-label="Training permission change reason" maxLength={500} value={reason} onChange={e=>setReason(e.target.value)} disabled={busy||!data.can_administer||!data.eligible} className="mt-1 block w-full rounded border border-slate-300 p-2"/></label>
      <button type="button" onClick={save} disabled={busy||!data.can_administer||!data.eligible||!reason.trim()||!Object.keys(changes).length} className="mt-3 rounded bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50">{busy?'Saving…':'Save Training permissions'}</button>
      <details className="mt-3 text-sm"><summary>Assignment and revocation history</summary>
        {!data.history.length?<p>No changes recorded.</p>:<ul>{data.history.map((h,i)=><li key={i} className="mt-2">{h.created_at} · {h.metadata?.category} · {h.after_state?.active?'Assigned':'Revoked'} · {h.metadata?.reason}<br/>Changed by: {h.actor_user_id}</li>)}</ul>}
      </details>
    </>}
  </section>;
}
