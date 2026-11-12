import {assertRetailMis,RETAIL_MIS_MODULES,retailOosState} from '../shared/retailMisAccess.js';
import {summarizeAttendance} from '../shared/retailAttendance.js';
import {parseQuotation} from './retailQuotationImport.js';
import {assertScopedQuotation} from '../shared/retailMisAccess.js';
export async function misRpc(client,name,args){const {data,error}=await client.rpc(name,args);if(error){const statusCode=({'42501':403,'22023':400,'22007':400,'22008':400,'22P02':400,'22003':400,'23514':400,'23505':409,'40001':409,P0001:409,PGRST202:503,'42883':503}[error.code])||503;throw Object.assign(Error(statusCode===503?'Retail MIS capability unavailable; no result can be confirmed.':error.message),{statusCode});}return data;}
export async function retailMisAccess(client,profile,authUser){
 if(!profile?.id||!authUser?.id||profile.auth_user_id!==authUser.id)throw Object.assign(Error('Verified account required.'),{statusCode:401});
 return misRpc(client,'rpc_retail_mis_access',{p_actor:profile.id,p_auth:authUser.id});
}
export async function signMisTrainingEvidence(client,profile,access,module,sessionId,evidenceId){
 assertRetailMis(access,module);
 if(!['training-hk','training-mepc'].includes(module))throw Object.assign(Error('Training module required.'),{statusCode:403});
 const meta=await misRpc(client,'rpc_retail_mis_training_evidence_v4',{p_actor:profile.id,p_auth:profile.auth_user_id,p_category:module==='training-hk'?'hk':'technical_mep',p_session:sessionId,p_evidence:evidenceId});
 if(meta?.bucket!=='training-evidence'||!meta.path?.startsWith(`training/${sessionId}/${evidenceId}/`)||/[\\?#]|\.\./.test(meta.path))throw Object.assign(Error('Private evidence metadata invalid.'),{statusCode:403});
 const result=await client.storage.from('training-evidence').createSignedUrl(meta.path,120);
 if(result.error||!result.data?.signedUrl?.startsWith('https://'))throw Object.assign(Error('Private evidence unavailable.'),{statusCode:503});
 return {url:result.data.signedUrl,expires_in:120};
}
export async function retailMisReport(client,profile,access,module,input={}){
 assertRetailMis(access,module);const today=new Date(Date.now()+330*60000).toISOString().slice(0,10),to=input.to||today,from=input.from||to.slice(0,7)+'-01';
 if(module.startsWith('attendance-')&&from!==to.slice(0,7)+'-01')throw Object.assign(Error('Attendance targets require a month-start to cutoff reporting period.'),{statusCode:400});
 if(['training-hk','training-mepc'].includes(module))return misRpc(client,'rpc_retail_mis_training_v4',{p_actor:profile.id,p_auth:profile.auth_user_id,p_category:module==='training-hk'?'hk':'technical_mep',p_from:from,p_to:to,p_state:input.state||null});
 const result=await misRpc(client,'rpc_retail_mis_report',{p_actor:profile.id,p_module:module,p_from:from,p_to:to,p_state:input.state||null});
 if(module==='dashboard'){
  const reports=await Promise.all(['hk','technical_mep'].map(category=>misRpc(client,'rpc_retail_mis_training_v4',{p_actor:profile.id,p_auth:profile.auth_user_id,p_category:category,p_from:from,p_to:to,p_state:input.state||null})));
  const hk=reports[0].counts.completed_sessions,mepc=reports[1].counts.completed_sessions;
  result.rows=(result.rows||[{}]).map(row=>({...row,existing_training_sessions:hk+mepc,hk_training_completed:hk,mepc_training_completed:mepc}));
 }
 if(module.startsWith('attendance-')){const kind=module==='attendance-hk'?'HK':'MEPC';result.summary=summarizeAttendance({stores:result.stores,attendance:result.rows,aop:result.aop.map(a=>({...a,hk_count:kind==='HK'?a.hk_count:0,mepc_count:kind==='MEPC'?a.mepc_count:0,aop_class:null})),cutoff:to});}
 return result;
}
export async function retailMisQuotation(client,profile,access,bytes,name,save,environment,reviewed){
 assertRetailMis(access,'oos');if(save&&environment.RETAIL_OOS_MUTATIONS_FROZEN!=='false')throw Object.assign(Error('OOS mutations are frozen or configuration is unverified.'),{statusCode:503});
 // New MIS OOS writes remain closed until separate production go-live approval.
 if(save&&environment.RETAIL_MIS_OOS_WRITES_ENABLED!=='true')throw Object.assign(Error('Retail MIS OOS writes await separate activation.'),{statusCode:503});
 const report=await misRpc(client,'rpc_retail_oos12_stores',{p_actor:profile.id});
 const parsed=parseQuotation(bytes,name,report);if(!parsed.can_save)throw Object.assign(Error('Quotation contains invalid or unauthorized Store Codes; entire file rejected.'),{statusCode:400});
 assertScopedQuotation(parsed.groups,report,access);
 const current=await misRpc(client,'rpc_retail_oos_register',{p_actor:profile.id});
 const plan=parsed.groups.map(g=>{const order=current.rows.find(o=>o.reference===g.quotation_number);return {reference:g.quotation_number,expected_revision:order?.revision||0,workflow_version:order?.workflow_version||(current.twelve_stage_enabled?2:1),disposition:order?'REWORK_OR_REPLAY':'CREATE'};});
 if(!save)return {...parsed,plan,original_base64:undefined};
 if(!Array.isArray(reviewed)||reviewed.length!==parsed.groups.length)throw Object.assign(Error('Review the exact workbook and quotation revisions before import.'),{statusCode:409});
 for(const group of parsed.groups){const matches=reviewed.filter(p=>p.reference===group.quotation_number);if(matches.length!==1||!Number.isInteger(matches[0].expected_revision)||matches[0].expected_revision<0||![1,2].includes(matches[0].workflow_version??1))throw Object.assign(Error('Invalid reviewed quotation revision/version.'),{statusCode:409});group.expected_revision=matches[0].expected_revision;group.expected_workflow_version=matches[0].workflow_version??1;}
 return misRpc(client,'rpc_retail_oos12_import',{p_actor:profile.id,p_sha256:parsed.sha256,p_filename:name,p_original:parsed.original_base64,p_groups:parsed.groups});
}
export function retailMisPermissions(access){return {...access,...(access?.role==='MIS_OOS'?{states:[...new Set((access.states||[]).map(retailOosState))]}:{}),modules:RETAIL_MIS_MODULES[access?.role]||[],can_administer:false};}
