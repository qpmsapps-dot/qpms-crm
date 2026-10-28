import { randomUUID } from 'node:crypto';
import { attendanceError } from './retailAttendanceService.js';
import { parseStoreReview, validateStoreReview } from './retailStoreImportValidation.js';

export function storeImportAdmin(profile) {
  if (!profile?.id || profile.is_active !== true || (profile.status && String(profile.status).toUpperCase() !== 'ACTIVE') ||
    !['ADMIN','QPMSADMIN'].includes(String(profile.role || '').toUpperCase().replace(/[^A-Z0-9]/g,''))) throw attendanceError(403, 'Active Admin role required for Store Master and AOP uploads.');
}
async function result(query) { const {data,error}=await query; if(error)throw error;return data; }
export async function storeImportCapability(client, profile) {
  try { storeImportAdmin(profile); } catch { return {allowed:false}; }
  try { await result(client.rpc('rpc_retail_store_import_source',{p_actor:profile.id}));return {allowed:true,installed:true}; }
  catch(e) { if (['PGRST202','42P01'].includes(e.code))return {allowed:true,installed:false};throw e; }
}
export async function previewStoreImport(client, profile, bytes, filename) {
  storeImportAdmin(profile);
  const parsed=parseStoreReview(bytes,filename);
  let source;
  try { source=await result(client.rpc('rpc_retail_store_import_source',{p_actor:profile.id})); }
  catch(e) {
    if (!['PGRST202','42P01'].includes(e.code))throw e;
    // Read-only validation remains available before the separately reviewed schema installation.
    const stores=[];for(let start=0;;start+=1000){const page=await result(client.from('reliance_retail_store_master').select('id,store_code,store_name,state,status').order('id').range(start,start+999));stores.push(...page);if(page.length<1000)break;}
    return {...validateStoreReview(parsed,stores),id:null,installed:false,can_confirm:false,note:'Validation only. Import setup and approval evidence must be reviewed before confirmation is available.'};
  }
  const review=validateStoreReview(parsed,source.stores,{decisions:source.decisions,aop:source.aop});
  const existing=await result(client.from('retail_store_import_batches').select('id,status,uploaded_by,receipt').eq('checksum',parsed.checksum).maybeSingle());
  if(existing && existing.uploaded_by!==profile.id)throw attendanceError(409,'This file already belongs to another Admin review. Use its recorded import history.');
  if(existing && existing.status!=='preview')return {...review,id:existing.id,status:existing.status,receipt:existing.receipt,installed:true,can_confirm:false};
  const key=randomUUID();const data={checksum:parsed.checksum,filename,original_base64:bytes.toString('base64'),uploaded_by:profile.id,preview_key:key,baseline_stamp:source.stamp,review};
  const saved=existing?await result(client.from('retail_store_import_batches').update(data).eq('id',existing.id).eq('status','preview').select('id').single()):await result(client.from('retail_store_import_batches').insert(data).select('id').single());
  return {...review,id:saved.id,preview_key:key,status:'preview',installed:true,can_confirm:review.identity_ready+review.aop_ready>0};
}
export async function confirmStoreImport(client,profile,input,environment=process.env) {
  storeImportAdmin(profile);
  if(environment.RETAIL_STORE_IMPORT_WRITES_ENABLED!=='true')throw attendanceError(409,'Store Master and AOP activation is awaiting review of the preview and approval decisions.');
  if(typeof input.identity!=='boolean'||typeof input.aop!=='boolean'||!input.preview_key)throw attendanceError(400,'Fresh preview and explicit independent import scopes required.');
  return result(client.rpc('rpc_confirm_retail_store_import',{p_actor:profile.id,p_batch:input.id,p_preview_key:input.preview_key,p_identity:input.identity,p_aop:input.aop}));
}
export async function rollbackStoreImport(client,profile,input,environment=process.env) {
  storeImportAdmin(profile);
  if(environment.RETAIL_STORE_IMPORT_WRITES_ENABLED!=='true')throw attendanceError(409,'Import corrections are awaiting approval.');
  return result(client.rpc('rpc_rollback_retail_store_import',{p_actor:profile.id,p_batch:input.id,p_reason:String(input.reason||'').trim().slice(0,500)}));
}
export async function storeImportHistory(client,profile) {
  storeImportAdmin(profile);
  return result(client.from('retail_store_import_batches').select('id,checksum,filename,created_at,status,committed_at,receipt,rollback_reason,rolled_back_at').order('created_at',{ascending:false}).limit(100));
}
