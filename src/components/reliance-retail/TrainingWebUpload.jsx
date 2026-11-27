import {useRef, useState} from 'react';
import {authenticatedApiRequest} from '../../services/api.js';
import {indiaToday} from '../../../backend/shared/retailAttendance.js';
import {uploadWebTrainingEvidence, webTrainingReady, webTrainingUploader} from '../../utils/trainingWebUpload.js';
import './trainingWebUpload.css';

function savedDraft(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
}

export default function TrainingWebUpload({profile, onSubmitted = () => {}, request = authenticatedApiRequest}) {
  const actor = profile?.profileId || profile?.id;
  const storageKey = `training-web-v3:${actor}`;
  const [saved,setSaved] = useState(() => savedDraft(storageKey));
  const [form,setForm] = useState({store_code:'',trainer_employee_code:'',training_date:indiaToday()});
  const [setup,setSetup] = useState(null), [detail,setDetail] = useState(null);
  const [type,setType] = useState(''), [remarks,setRemarks] = useState('');
  const [topics,setTopics] = useState([]), [busy,setBusy] = useState(false);
  const [error,setError] = useState(''), [notice,setNotice] = useState('');
  const working = useRef(false);
  if (!actor || !webTrainingUploader(profile)) return null;

  const persist = value => {
    // Persist before sending creation, so a lost response retries the same key.
    localStorage.setItem(storageKey, JSON.stringify(value));
    setSaved(value);
  };
  const call = async (url,method='get',data) => (await request({url:'/api/training'+url,method,data})).data;
  const run = async work => {
    if (working.current) return;
    working.current = true;
    setBusy(true); setError(''); setNotice('');
    try { await work(); } catch (e) { setError(e.response?.data?.message || e.message); }
    finally { working.current = false; setBusy(false); }
  };
  const refresh = async id => {
    const value = await call(`/sessions/${id}`);
    if (value.session?.submission_source !== 'Web' || value.category?.code !== 'technical_mep') {
      throw Error('This is not an MEPC Web report.');
    }
    setDetail(value);
    return value;
  };
  const loadSetup = async e => {
    e.preventDefault();
    await run(async () => {
      const value = (await request({url:'/api/training/web/setup',params:form})).data.setup;
      setSetup(value); setType(''); setTopics([]);
    });
  };
  const create = async () => run(async () => {
    if (!setup || !type || !topics.length) throw Error('Select a Training type and at least one topic.');
    const draft = savedDraft(storageKey) || saved || {creation_key:crypto.randomUUID(), topic_ids:topics, payload:{
      retail_store_id:setup.store.id, actual_trainer_profile_id:setup.trainer.id,
      training_date:setup.training_date, training_type_id:type, remarks:remarks.trim() || null,
    }};
    persist(draft);
    const result = await call('/web/sessions','post',{...draft.payload,creation_key:draft.creation_key});
    persist({...draft,id:result.id,duplicate_ids:(result.duplicate_candidates || []).map(s=>s.id)});
    await call(`/sessions/${result.id}/topics`,'put',{topic_ids:topics});
    await refresh(result.id);
  });
  const resume = async () => run(async () => {
    if (!saved?.id) {
      // A request may have created the session even when its response was lost.
      const result = await call('/web/sessions','post',{...saved.payload,creation_key:saved.creation_key});
      persist({...saved,id:result.id,duplicate_ids:(result.duplicate_candidates || []).map(s=>s.id)}); await refresh(result.id);
    } else await refresh(saved.id);
  });
  const upload = async (file, topicId) => run(async () => {
    if (!file || !detail?.session?.id) return;
    const id = detail.session.id;
    let current = savedDraft(storageKey) || saved;
    const evidenceId = await uploadWebTrainingEvidence(request,id,file,topicId, pendingId => {
      current = {...current,pending:[...new Set([...(current.pending || []),pendingId])]};
      persist(current);
    });
    persist({...current,pending:(current.pending || []).filter(p => p !== evidenceId)});
    if (topicId) await call(`/sessions/${id}/topics/${topicId}`,'patch',{is_covered:true});
    await refresh(id);
  });
  const editable = detail?.session?.status === 'draft' && detail.session.can_edit === true;
  return <details className="dc-card training-web-upload"><summary>Upload MEPC Training report</summary>
    <p>Web uploads require separate release approval and current store authorization. HK submissions remain on the mobile workflow.</p>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {saved?.duplicate_ids?.length > 0 && <p role="status">Possible overlapping reports: {saved.duplicate_ids.join(', ')}. Review before submitting; multiple sessions are permitted.</p>}
    {saved && !detail && <p>A Web report request is saved on this browser. <button disabled={busy} onClick={resume}>Resume saved report</button></p>}
    {!saved && !detail && <form onSubmit={loadSetup}><fieldset disabled={busy}>
      <label>Store code<input required maxLength={80} value={form.store_code} onChange={e=>{setSetup(null);setForm({...form,store_code:e.target.value});}} /></label>
      <label>Actual trainer employee code<input required maxLength={80} value={form.trainer_employee_code} onChange={e=>{setSetup(null);setForm({...form,trainer_employee_code:e.target.value});}} /></label>
      <label>Training conducted date<input required type="date" min={indiaToday()} max={indiaToday()} value={form.training_date} onChange={e=>{setSetup(null);setForm({...form,training_date:e.target.value});}} /></label>
      <button>Verify store and trainer</button></fieldset></form>}
    {setup && !detail && !saved && <fieldset disabled={busy}>
      <p>{setup.store.store_code} / {setup.store.store_name} / {setup.store.state}<br/>Trainer: {setup.trainer.full_name || setup.trainer.employee_code}</p>
      <label>Training type<select aria-label="Training type" value={type} onChange={e=>setType(e.target.value)}><option value="">Select type</option>{setup.types.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
      <label>Remarks<textarea maxLength={500} value={remarks} onChange={e=>setRemarks(e.target.value)} /></label>
      <p>Select topics. Every selected topic needs a verified photograph.</p>
      {setup.topics.map(t=><label key={t.id}><input type="checkbox" checked={topics.includes(t.id)} onChange={e=>setTopics(e.target.checked?[...topics,t.id]:topics.filter(id=>id!==t.id))}/>{t.module_name}</label>)}
      <button disabled={!type || !topics.length} onClick={create}>Create Web draft</button>
    </fieldset>}
    {detail && <fieldset disabled={busy || !editable}>
      <p>Report {detail.session.id}<br/>{detail.store?.store_code} / {detail.store?.store_name} / {String(detail.session.training_date).slice(0,10)}<br/>Status: {detail.session.status}</p>
      {!detail.topics?.length && saved?.topic_ids?.length > 0 && <button onClick={()=>run(async()=>{
        await call(`/sessions/${detail.session.id}/topics`,'put',{topic_ids:saved.topic_ids});
        await refresh(detail.session.id);
      })}>Retry saved topic selection</button>}
      {(detail.topics || []).map(t=><div key={t.id}>
        <label>{t.topic?.module_name || 'Selected topic'} — {t.is_covered?'Covered':'Not covered'}
          <input aria-label={`Photograph for ${t.topic?.module_name || t.id}`} type="file" accept="image/jpeg,image/png" onChange={e=>{const f=e.target.files?.[0];e.target.value='';void upload(f,t.id);}} /></label>
        {t.is_covered === false && <button onClick={()=>run(async()=>{await call(`/sessions/${detail.session.id}/topics/${t.id}`,'patch',{is_covered:true});await refresh(detail.session.id);})}>Confirm topic coverage</button>}
      </div>)}
      <label>Completion proof (required)<input type="file" accept="application/pdf,image/jpeg,image/png" onChange={e=>{const f=e.target.files?.[0];e.target.value='';void upload(f,null);}} /></label>
      <p>{detail.evidence?.length || 0} verified evidence files. Use JPG/PNG photos or PDF/JPG/PNG completion proof, at most 5 MB per file.</p>
      {(detail.evidence || []).map(e=><p key={e.id}>{e.file_name} ({e.evidence_type==='topic_photo'?'Topic photograph':'Completion proof'}) <button onClick={()=>run(async()=>{
        await call(`/sessions/${detail.session.id}/evidence/${e.id}`,'delete');await refresh(detail.session.id);
      })}>Remove {e.file_name}</button></p>)}
      {(saved?.pending || []).map(id=><p key={id}>Unconfirmed upload {id}. Reselect the same file to retry, or <button onClick={()=>run(async()=>{await call(`/sessions/${detail.session.id}/evidence/${id}`,'delete');persist({...saved,pending:saved.pending.filter(p=>p!==id)});await refresh(detail.session.id);})}>Remove incomplete upload</button></p>)}
      <button disabled={!webTrainingReady(detail) || saved?.pending?.length > 0} onClick={()=>run(async()=>{
        await call(`/sessions/${detail.session.id}/submit`,'post',{});
        await refresh(detail.session.id); setNotice('Training report submitted.'); onSubmitted();
      })}>Submit MEPC Training report</button>
    </fieldset>}
    {detail && <button disabled={busy} onClick={()=>run(async()=>{await refresh(detail.session.id);})}>Refresh saved report</button>}
    {detail?.session?.status === 'submitted' && <button disabled={busy} onClick={()=>{
      localStorage.removeItem(storageKey);setSaved(null);setDetail(null);setSetup(null);setTopics([]);
    }}>Start another report</button>}
  </details>;
}
