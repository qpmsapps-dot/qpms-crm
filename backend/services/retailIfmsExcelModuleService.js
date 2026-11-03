import {assertRetailAccess,retailAccess} from './relianceRetailManagementService.js';

export const IFMS_EXCEL_SOURCE_SHA='18bb0fd237dd3151ad119f9aa97dce21da08c2f748e3f0f4a29f3b880ec722a5';
const SOURCE_MONTH='2026-10';
const MODULES=new Set(['cmpm','thermography','technical_training','soft_skill_training','deep_cleaning','shortage','manpower_vacancy','oos_historical']);
const STATES=new Set(['TN','KA','KL','TG','AP-1','AP-2']);
const fail=(statusCode,message)=>Object.assign(new Error(message),{statusCode});

export function assertIfmsExcelReader(profile){
  assertRetailAccess(profile,'dashboard');
  if(!profile?.id||profile.is_active===false||['INACTIVE','DISABLED'].includes(String(profile.status||'').toUpperCase()))
    throw fail(403,'Active Retail administrator required.');
  // These spreadsheets contain source employee names, field-officer telephone
  // numbers and historically unverified OOS financial amounts.
  // Never extend this endpoint to all authenticated or Retail MIS accounts.
  if(!retailAccess({...profile,business:''}).allowed)
    throw fail(403,'Historical source records require platform administrator access.');
}
export async function retailIfmsExcelModuleRows(client,profile,input={}){
  assertIfmsExcelReader(profile);
  const module=String(input.module||'').trim();
  if(!MODULES.has(module))throw fail(400,'Unknown IFMS Excel source module.');
  const month=String(input.month||SOURCE_MONTH);
  if(!/^\\d{4}-\\d{2}$/.test(month))throw fail(400,'Select a valid reporting month.');
  const state=String(input.state||'').trim().toUpperCase();
  if(state&&!STATES.has(state))throw fail(400,'Select a valid Retail reporting state.');
  const page=Math.max(1,Math.min(100000,Math.floor(Number(input.page)||1)));
  const size=Math.max(1,Math.min(100,Math.floor(Number(input.limit)||25)));
  const search=String(input.search||'').trim();
  if(search.length>100)throw fail(400,'Search must be 100 characters or fewer.');
  if(month!==SOURCE_MONTH)return {module,month,snapshot_date:null,rows:[],total:0,page,limit:size,source_type:'EXCEL_REPORTED_UNVERIFIED'};
  let q=client.from('retail_ifms_excel_module_rows')
    .select('id,module,source_row,state,store_code,retail_store_id,match_status,record_date,status,data,snapshot_date',{count:'exact'})
    .eq('source_sha256',IFMS_EXCEL_SOURCE_SHA)
    .eq('snapshot_month',month+'-01')
    .eq('module',module);
  if(state)q=q.eq('state',state);
  if(search){
    const clean=search.replace(/[%,()\\]/g,' ').replace(/\\s+/g,' ').trim();
    if(clean)q=q.ilike('search_text',`%${clean}%`);
  }
  const {data,error,count}=await q.order('source_row',{ascending:true}).range((page-1)*size,page*size-1);
  if(error){if(['42P01','PGRST205','PGRST202'].includes(error.code))throw fail(503,'Historical IFMS row-level import is not available.');throw fail(503,'IFMS source records could not be loaded.');}
  return {module,month,snapshot_date:'2026-10-28',rows:data||[],total:count||0,page,limit:size,
    source_type:'EXCEL_REPORTED_UNVERIFIED',source_filename:'IFMS - Daily Dashboard Format - Oct 28th (1).xlsx'};
}
