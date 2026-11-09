import {reportingState} from '../../backend/shared/retailAttendance.js';

// One reporting geography per state; KA and KN are the same reporting bucket,
// while AP-1 and AP-2 remain distinct. PY reports under TN.
export const RETAIL_STATE_ORDER=Object.freeze([
 {code:'TN',label:'TN'}, {code:'KN',label:'KA'}, {code:'KL',label:'KL'},
 {code:'AP-1',label:'AP-1'}, {code:'AP-2',label:'AP-2'}, {code:'TG',label:'TG'}
]);
export const retailReportState=value=>reportingState(value);
export const retailPercent=(done,total)=>total>0?Math.round(done/total*1000)/10:null;
const numbers=['scheduled','completed','pending','other','verified','shortage','vacancies','entries'];
export function summarizeStateRows(records,values,stateOf=row=>row.reporting_state||row.state){
 const map=new Map(RETAIL_STATE_ORDER.map(s=>[s.code,{state:s.code,label:s.label,
  scheduled:0,completed:0,pending:0,other:0,verified:0,shortage:0,vacancies:0,entries:0}]));
 for(const record of records||[]){
  const key=retailReportState(stateOf(record));
  const target=map.get(key);
  if(!target)continue; // Unknown state is never guessed or merged.
  const source=values(record)||{};
  for(const field of numbers){
   const n=Number(source[field]||0);
   if(Number.isFinite(n)&&n>=0)target[field]+=n;
  }
 }
 const rows=[...map.values()].map(row=>({...row,percentage:retailPercent(row.completed,row.scheduled)}));
 const total=Object.fromEntries(numbers.map(k=>[k,rows.reduce((n,r)=>n+r[k],0)]));
 return {rows,total:{...total,state:'total',label:'Total',percentage:retailPercent(total.completed,total.scheduled)}};
}
export function summarizeCleaningSchedules(schedules){
 return summarizeStateRows(schedules,row=>{
  const status=String(row.display_status||row.status||'').toLowerCase();
  return {scheduled:1,completed:status==='completed'?1:0,
   pending:status==='scheduled'||status==='planned'||status==='pending'?1:0,
   other:!['completed','scheduled','planned','pending'].includes(status)?1:0,
   verified:row.source_kind==='IFMS_EXCEL'?0:(status==='completed'?1:0),entries:row.source_kind==='IFMS_EXCEL'?1:0};
 });
}
// Operational KPI only. Historical rows remain visible in the detailed report.
export function summarizeVerifiedCleaningSchedules(schedules){
 return summarizeCleaningSchedules(schedules.filter(row=>row.source_kind!=='IFMS_EXCEL'&&String(row.display_status||row.status).toLowerCase()!=='cancelled').map(row=>
  String(row.display_status||row.status).toLowerCase()==='completed'&&!row.submission_ids?.length?{...row,display_status:'Scheduled'}:row));
}
export function summarizeReportedOperations(rows){
 return summarizeStateRows(rows,row=>{
  const state=String(row.status||'').trim().toLowerCase();
  const complete=row.completed===true||['submitted','completed','client approved','approved'].includes(state);
  return {scheduled:1,completed:complete?1:0,pending:complete?0:1,
   verified:row.source_kind==='IFMS_EXCEL'?0:(complete?1:0),
   entries:row.source_kind==='IFMS_EXCEL'?1:0};
 });
}
export function summarizeTrainingEntries(rows){
 return summarizeStateRows(rows,row=>{
  const status=String(row.status||'').trim().toLowerCase();
  const completed=['completed','done','submitted','verified'].includes(status);
  return {scheduled:1,completed:completed?1:0,pending:completed?0:1,
   verified:row.source_kind==='IFMS_EXCEL'?0:(completed?1:0),
   entries:row.source_kind==='IFMS_EXCEL'?1:0};
 },row=>row.reporting_state||row.state);
}
export function operationalTrainingRows(rows){
 const seen=new Set();return (rows||[]).filter(row=>{
  if(!row.id||row.source_kind==='IFMS_EXCEL'||!['submitted','completed'].includes(String(row.status).toLowerCase())||!['HK','MEPC'].includes(row.training_class)||seen.has(row.id))return false;
  seen.add(row.id);return true;
 });
}

export function summarizeTrainingByClass(rows){
 const base=summarizeTrainingEntries(rows);
 const byState=new Map(base.rows.map(row=>[row.state,{hk_total:0,hk_completed:0,mepc_total:0,mepc_completed:0}]));
 for(const row of rows||[]){
  const state=retailReportState(row.reporting_state||row.state),target=byState.get(state);
  if(!target)continue;
  const type=String(row.training_class||'').trim().toUpperCase();
  if(type!=='HK'&&type!=='MEPC')continue;
  const key=type.toLowerCase();
  const status=String(row.status||'').trim().toLowerCase();
  target[`${key}_total`]++;
  if(['completed','done','submitted','verified'].includes(status))target[`${key}_completed`]++;
 }
 const keys=['hk_total','hk_completed','mepc_total','mepc_completed'];
 const results=base.rows.map(row=>({...row,...byState.get(row.state)}));
 const total={...base.total,...Object.fromEntries(keys.map(key=>[key,results.reduce((n,r)=>n+r[key],0)]))};
 return {rows:results,total};
}
