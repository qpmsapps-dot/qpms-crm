import {assertRetailMis,RETAIL_MIS_MODULES} from '../shared/retailMisAccess.js';
import {summarizeAttendance} from '../shared/retailAttendance.js';
import {parseQuotation} from './retailQuotationImport.js';
import {assertScopedQuotation} from '../shared/retailMisAccess.js';
export async function misRpc(client,name,args){const {data,error}=await client.rpc(name,args);if(error){const statusCode=({'42501':403,'22023':400,'23505':409,'40001':409,P0001:409,PGRST202:503,'42883':503}[error.code])||503;throw Object.assign(Error(statusCode===503?'Retail MIS capability unavailable; no result can be confirmed.':error.message),{statusCode});}return data;}
export async function retailMisAccess(client,profile,authUser){
 if(!profile?.id||!authUser?.id||profile.auth_user_id!==authUser.id)throw Object.assign(Error('Verified account required.'),{statusCode:401});
 return misRpc(client,'rpc_retail_mis_access',{p_actor:profile.id,p_auth:authUser.id});
}
export async function retailMisReport(client,profile,access,module,input={}){
 assertRetailMis(access,module);const today=new Date(Date.now()+330*60000).toISOString().slice(0,10),to=input.to||today,from=input.from||to.slice(0,7)+'-01';
 if(module.startsWith('attendance-')&&from!==to.slice(0,7)+'-01')throw Object.assign(Error('Attendance targets require a month-start to cutoff reporting period.'),{statusCode:400});
 const result=await misRpc(client,'rpc_retail_mis_report',{p_actor:profile.id,p_module:module,p_from:from,p_to:to,p_state:input.state||null});
 if(module.startsWith('attendance-')){const kind=module==='attendance-hk'?'HK':'MEPC';result.summary=summarizeAttendance({stores:result.stores,attendance:result.rows,aop:result.aop.map(a=>({...a,hk_count:kind==='HK'?a.hk_count:0,mepc_count:kind==='MEPC'?a.mepc_count:0,aop_class:null})),cutoff:to});}
 return result;
}
export async function retailMisQuotation(client,profile,access,bytes,name,save,environment){
 assertRetailMis(access,'oos');if(save&&environment.RETAIL_OOS_MUTATIONS_FROZEN!=='false')throw Object.assign(Error('OOS mutations are frozen or configuration is unverified.'),{statusCode:503});
 // New MIS OOS writes remain closed until separate production go-live approval.
 if(save&&environment.RETAIL_MIS_OOS_WRITES_ENABLED!=='true')throw Object.assign(Error('Retail MIS OOS writes await separate activation.'),{statusCode:503});
 const report=await misRpc(client,'rpc_retail_mis_oos_stores',{p_actor:profile.id});
 const parsed=parseQuotation(bytes,name,report);if(!parsed.can_save)throw Object.assign(Error('Quotation contains invalid or unauthorized Store Codes; entire file rejected.'),{statusCode:400});
 assertScopedQuotation(parsed.groups,report,access);
 if(!save)return {...parsed,original_base64:undefined};
 return misRpc(client,'rpc_retail_mis_oos_import',{p_actor:profile.id,p_sha256:parsed.sha256,p_filename:name,p_original:parsed.original_base64,p_groups:parsed.groups});
}
export function retailMisPermissions(access){return {...access,modules:RETAIL_MIS_MODULES[access?.role]||[],can_administer:false};}
