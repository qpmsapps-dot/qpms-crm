import {assertRetailAccess,retailAccess} from './relianceRetailManagementService.js';

// Imported IFMS Excel rows are reference-only. They must never become canonical
// FO completion, expense, OOS orders, or financial events through this endpoint.
export const IFMS_HISTORY_MODULES=Object.freeze([
  'cmpm','thermography','deep_cleaning','technical_training',
  'soft_skill_training','shortage','manpower_vacancy','oos_historical'
]);
const allowed=new Set(IFMS_HISTORY_MODULES);
const error=(statusCode,message)=>Object.assign(new Error(message),{statusCode});
const clean=value=>String(value??'').trim();
const adminProfile=profile=>retailAccess({...profile,business:''}).allowed;

export async function retailIfmsHistoryRows(client,profile,input={}){
 assertRetailAccess(profile,'dashboard');
 if(profile.is_active===false||['INACTIVE','DISABLED'].includes(clean(profile.status).toUpperCase()))throw error(403,'Active Retail account required.');
 // The source workbook contains employee names and operational remarks.
 // Do not expand access until state/store row-level authorizations are verified.
 if(!adminProfile(profile))throw error(403,'October Excel source records require platform administrative access.');
 const module=clean(input.module).toLowerCase();
 if(!allowed.has(module))throw error(400,'Select an authorized IFMS module.');
 const month=clean(input.month||'2026-10');
 if(!/^\d{4}-\d{2}$/.test(month))throw error(400,'Invalid reporting month.');
 const state=clean(input.state).toUpperCase()==='KN'?'KA':clean(input.state).toUpperCase();
 if(state&&!['TN','KA','KL','TG','AP-1','AP-2'].includes(state))throw error(400,'Invalid reporting state.');
 const match=clean(input.match_status).toUpperCase();
 if(match&&!['MATCHED','NOT_IN_MASTER','STATE_MISMATCH','NO_STORE_CODE'].includes(match))throw error(400,'Invalid store match filter.');
 const q=clean(input.q).replace(/[%,()\\]/g,'').slice(0,35);
 const page=Math.max(1,Math.min(100000,Math.trunc(Number(input.page)||1)));
 const limit=Math.max(1,Math.min(500,Math.trunc(Number(input.limit)||25)));
 if(month!=='2026-10')return {module,month,rows:[],total:0,page,limit,source:'EXCEL_REPORTED_HISTORICAL_UNVERIFIED'};
 let query=client.from('retail_ifms_source_rows')
  .select('id,source_filename,snapshot_date,snapshot_month,module,source_row,reporting_state,store_code,record_date,status,data,retail_store_id,match_status',{count:'exact'})
  .eq('module',module).eq('snapshot_month','2026-10-01');
 if(state)query=query.eq('reporting_state',state);
 if(match)query=query.eq('match_status',match);
 if(q)query=query.ilike('store_code',`%${q}%`);
 const {data,error:readError,count}=await query.order('source_row',{ascending:true}).range((page-1)*limit,page*limit-1);
 if(readError){
  if(['42P01','PGRST202','42501'].includes(readError.code))throw error(503,'IFMS historical source is unavailable.');
  throw error(503,'IFMS historical report could not be loaded.');
 }
 return {module,month,rows:data||[],total:count??(data||[]).length,page,limit,
  source:'EXCEL_REPORTED_HISTORICAL_UNVERIFIED',snapshot_date:'2026-10-28'};
}
