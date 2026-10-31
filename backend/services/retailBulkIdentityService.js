import XLSX from 'xlsx';
import {randomUUID,createHash}from'node:crypto';
import {storeImportAdmin}from'./retailStoreImportService.js';
import {validateExcelContainer,attendanceError}from'./retailAttendanceService.js';
const text=v=>String(v??'').trim();
const columns=['Source row','Store Code','Decision','Corrected official name','Operating status','Evidence reference','Reviewer profile ID','Evidence SHA-256','Ownership model','Supervisor name','Final file SHA-256','Final row digest'];
const fail=m=>{throw attendanceError(400,m);};
export function parseBulkIdentityDecisions(bytes,filename){
 validateExcelContainer(bytes,filename);const book=XLSX.read(bytes,{type:'buffer',cellFormula:true});const s=book.Sheets['Identity decisions'];if(!s?.['!ref'])fail('Missing Identity decisions sheet.');const range=XLSX.utils.decode_range(s['!ref']);if(range.e.r>10000||range.e.c>60)fail('Decision workbook too large.');
 const grid=XLSX.utils.sheet_to_json(s,{header:1,defval:''});const indexes=columns.map(h=>{if(grid[0].filter(v=>v===h).length!==1)fail('Missing or duplicated decision header: '+h);return grid[0].indexOf(h);});
 const out=[];for(let i=1;i<grid.length;i++){const row={};for(let c=0;c<columns.length;c++){if(s[XLSX.utils.encode_cell({r:i,c:indexes[c]})]?.f)fail('Formula in decision row '+(i+1));row[columns[c]]=grid[i][indexes[c]]??'';}const decision=text(row.Decision);if(!decision)continue;if(!['Approve Identity','Reject','Hold'].includes(decision))fail('Invalid decision at row '+(i+1));out.push({source_row:Number(row['Source row']),store_code:text(row['Store Code']),decision,store_name:text(row['Corrected official name']),store_status:text(row['Operating status']),approval_ref:text(row['Evidence reference']),reviewer_id:text(row['Reviewer profile ID']),evidence_sha256:text(row['Evidence SHA-256']),operational_model:text(row['Ownership model']),supervisor_name:text(row['Supervisor name']),file_sha256:text(row['Final file SHA-256']),row_digest:text(row['Final row digest'])});}if(!out.length)fail('Enter explicit decisions; blank rows remain pending.');return out;
}
export function validateBulkIdentityDecisions(decisions,batch,profile){
 const seen=new Set(),states=new Set();for(const d of decisions){if(seen.has(d.store_code)||!Number.isInteger(d.source_row))fail('Duplicate code or invalid source row.');seen.add(d.store_code);const r=batch.review.rows.find(r=>r.source_row===d.source_row&&r.store_code===d.store_code);if(!r)fail('Decision does not match source row/code.');states.add(r.state);
 if(d.file_sha256!==batch.checksum||d.row_digest!==r.row_digest)fail('Final source hash/row digest changed; obtain a fresh preview and rebind decisions.');
 if(d.reviewer_id!==profile.id||!d.approval_ref||!/^[a-f0-9]{64}$/.test(d.evidence_sha256))fail('Authenticated reviewer, evidence reference and evidence SHA-256 required.');
 if(d.decision==='Approve Identity'){
  if(r.canonical_id)fail('Existing canonical identity is protected.');
  if(r.approval!=='YES'||r.approval_ref!==d.approval_ref)fail('Final source must explicitly say YES with the reviewed reference.');
 if(r.store_name!==d.store_name||!['Active','Inactive'].includes(d.store_status)||!['IDENTITY_ONLY','SUPERVISOR_ONLY'].includes(d.operational_model)||(d.operational_model==='SUPERVISOR_ONLY'&&!d.supervisor_name))fail('Confirm exact official name, explicit status and supported identity model.');
  const blockers=r.issues.filter(i=>!['INVALID_BUDGET_PERIOD','EXPIRED_BUDGET_PERIOD','INVALID_AOP_COMPONENT'].includes(i));if(blockers.length)fail('Resolve source evidence before approval: '+blockers.join('; '));
 }
 }if(states.size!==1)fail('Review and confirm one geographic state per decision batch.');return {state:[...states][0],decisions,approved:decisions.filter(d=>d.decision==='Approve Identity').length,rejected:decisions.filter(d=>d.decision==='Reject').length,held:decisions.filter(d=>d.decision==='Hold').length};
}
async function result(q){const r=await q;if(r.error)throw r.error;return r.data;}
export async function previewBulkIdentity(client,profile,bytes,filename,batchId){
 storeImportAdmin(profile);const b=await result(client.from('retail_store_import_batches').select('*').eq('id',batchId).single());if(b.uploaded_by!==profile.id||b.status!=='preview')fail('Your uncommitted source preview is required.');const source=await result(client.rpc('rpc_retail_store_import_source',{p_actor:profile.id}));if(source.stamp!==b.baseline_stamp)throw attendanceError(409,'Source/approvals changed; validate source again.');
 const validated=validateBulkIdentityDecisions(parseBulkIdentityDecisions(bytes,filename),b,profile);const key=randomUUID();const receiptHash=createHash('sha256').update(bytes).digest('hex');
 await result(client.from('retail_store_import_batches').update({preview_key:key,review:{...b.review,bulk_identity:{...validated,decision_file_sha256:receiptHash}}}).eq('id',b.id).eq('status','preview').eq('preview_key',b.preview_key).select('id').single());
 return {...validated,id:b.id,preview_key:key,decision_file_sha256:receiptHash};
}
export async function confirmBulkIdentity(client,profile,input,environment=process.env){storeImportAdmin(profile);if(environment.RETAIL_BULK_IDENTITY_APPROVALS_ENABLED!=='true')throw attendanceError(409,'Bulk identity approval awaits reviewed database setup and explicit release enablement.');if(input.confirm!==true)fail('Explicit approval confirmation required.');return result(client.rpc('rpc_confirm_retail_bulk_identity',{p_actor:profile.id,p_batch:input.id,p_preview_key:input.preview_key}));}
