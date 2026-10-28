import{useState}from'react';
import{authenticatedApiRequest}from'../../services/api.js';
const base='/api/reliance-retail/store-import/bulk-identity';
export default function BulkIdentityReview({batchId,onChanged}){
 const[file,setFile]=useState(null),[preview,setPreview]=useState(null),[enabled,setEnabled]=useState(false),[checked,setChecked]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[receipt,setReceipt]=useState(null);
 async function run(action){setBusy(true);setError('');try{await action();}catch(e){setError(e.response?.data?.message||e.message);}finally{setBusy(false);}}
 return <details className="rounded border p-3 text-sm"><summary>Bulk identity decisions (Admin)</summary>
 <p className="my-2">Validate the final source first. Decision workbook rows must match its final file SHA-256, source row and row digest. Blank decisions stay pending. Review one geographic state per batch. This step records identity decisions only; it does not import stores or approve AOP.</p>
 <input aria-label="Bulk identity decision workbook" type="file" accept=".xlsx" disabled={busy} onChange={e=>{setFile(e.target.files[0]);setPreview(null);setChecked(false);setReceipt(null);}}/>
 <button disabled={!file||!batchId||busy} className="m-2 rounded border p-2 disabled:opacity-40" onClick={()=>run(async()=>{const r=(await authenticatedApiRequest({url:base+'/preview',method:'POST',data:file,headers:{'Content-Type':'application/octet-stream','X-File-Name':encodeURIComponent(file.name),'X-Source-Batch-Id':batchId}})).data;setPreview(r.preview);setEnabled(r.approval_enabled);setChecked(false);})}>Validate bulk decisions</button>
 {error&&<p role="alert" className="text-red-800">{error}</p>}
 {preview&&<div><p>{preview.state}: {preview.approved} request approval · {preview.rejected} reject · {preview.held} hold</p><p>Decision file SHA-256: {preview.decision_file_sha256}</p><div className="max-h-48 overflow-auto">{preview.decisions.map(d=><p key={d.source_row}>{d.source_row} · {d.store_code} · {d.decision} · {d.store_name} · {d.store_status} · {d.approval_ref}</p>)}</div>
 <label className="block"><input type="checkbox" checked={checked} onChange={e=>setChecked(e.target.checked)}/> I explicitly confirm this exact state-wise identity decision scope and evidence</label>
 {!enabled&&<p>Approval confirmation is disabled until the reviewed bulk-approval SQL is installed and its gate is explicitly enabled.</p>}
 <button className="my-2 rounded border p-2 disabled:opacity-40" disabled={busy||!enabled||!checked||!!receipt} onClick={()=>run(async()=>{const r=(await authenticatedApiRequest({url:base+'/confirm',method:'POST',data:{id:preview.id,preview_key:preview.preview_key,confirm:true}})).data;setReceipt(r.receipt);onChanged();})}>Confirm identity decisions</button>
 {receipt&&<p>Decision receipt recorded. Validate the final source again before separate identity-only import; previous source preview is stale. AOP and recovery remain separate and disabled.</p>}
 </div>}
 </details>;
}
