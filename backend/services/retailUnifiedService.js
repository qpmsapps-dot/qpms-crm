import {createHash,randomUUID} from 'node:crypto';
import {parseUnifiedMaster,previewUnifiedMaster} from './retailUnifiedImport.js';
import {indiaToday} from '../shared/retailAttendance.js';
const sha=v=>createHash('sha256').update(v).digest('hex');
async function rpc(client,name,args){const {data,error}=await client.rpc(name,args);if(error)throw error;return data;}
export const unifiedSnapshot=(client,profile,input={})=>rpc(client,'rpc_retail_unified_snapshot',{p_actor:profile.id,p_from:input.from||indiaToday(),p_to:input.to||indiaToday()});
export async function previewUnified(client,profile,bytes,name){const snapshot=await unifiedSnapshot(client,profile);return previewUnifiedMaster(parseUnifiedMaster(bytes,name),snapshot);}
export async function stageUnified(client,profile,bytes,name,stamp){
 const preview=await previewUnified(client,profile,bytes,name);
 if(!preview.can_save)throw Object.assign(Error('This workbook contains states outside your editor scope. No rows were discarded or saved.'),{statusCode:403});
 if(stamp!==preview.stamp)throw Object.assign(Error('Master changed; preview again.'),{statusCode:409});
 return rpc(client,'rpc_retail_unified_stage',{p_actor:profile.id,p_filename:name,p_sha256:preview.checksum,p_original:bytes.toString('base64'),p_rows:preview.rows,p_sheets:preview.sheets,p_format:preview.format,p_stamp:stamp,p_receipt:preview.receipt});
}
export async function createPendingStore(client,profile,input){
 const code=String(input.store_code||'').trim().toUpperCase(),state=String(input.state||'').trim().toUpperCase();
 if(!code||!['TN','PY','KA','KL','TG','AP-1','AP-2'].includes(state))throw Object.assign(Error('Store Code and valid Geographic State required.'),{statusCode:400});
 const source={store_code:code,state,store_name:String(input.store_name||'').trim(),request_id:String(input.request_id||randomUUID())};
 const bytes=Buffer.from(JSON.stringify(source)),snapshot=await unifiedSnapshot(client,profile);
 const row={source_row:2,source_sheet:'MANUAL PENDING STORE',row_digest:sha(bytes),store_code:code,state,raw:source,review:{store_name:source.store_name,state,city:'',operating_status:'UNKNOWN',store_format:'',mis_remarks:'Manual pending record'},issues:['PENDING_IDENTITY_APPROVAL','ZONE_PENDING','FO_IDENTITY_UNVERIFIED','HK_TOTAL_PENDING','MEPC_TOTAL_PENDING']};
 return rpc(client,'rpc_retail_unified_stage',{p_actor:profile.id,p_filename:'Manual pending store.json',p_sha256:sha(bytes),p_original:bytes.toString('base64'),p_rows:[row],p_sheets:{manual:[source]},p_format:'MANUAL PENDING STORE',p_stamp:snapshot.stamp,p_receipt:{source_rows:1,inserted:0,matched:snapshot.stores.some(s=>s.store_code===code)?1:0,proposed_updates:0,conflicts:0,rejected_technical_rows:0,operational_writes:0}});
}
export const proposeUnified=(client,profile,input)=>rpc(client,'rpc_retail_unified_propose',{p_actor:profile.id,p_kind:input.kind,p_state:input.state,p_store:input.store_id||null,p_zone:input.zone_id||null,p_row:input.row_id||null,p_revision:input.revision??null,p_changes:input.changes,p_reason:input.reason});
export const decideUnified=(client,profile,input)=>rpc(client,'rpc_retail_unified_decide',{p_actor:profile.id,p_proposal:input.proposal_id,p_approve:input.approve,p_reason:input.reason});
export async function applyUnified(client,profile,input,environment=process.env){
 if(environment.RETAIL_STORE_IMPORT_WRITES_ENABLED!=='true')throw Object.assign(Error('Operational changes are awaiting separately authorized activation of the existing Store Master write gate.'),{statusCode:409});
 return rpc(client,'rpc_retail_unified_apply',{p_actor:profile.id,p_proposal:input.proposal_id});
}
