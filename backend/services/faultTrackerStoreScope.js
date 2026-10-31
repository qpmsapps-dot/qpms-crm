import {stateLabel,reportingState,validDate} from '../shared/retailAttendance.js';
import {resolveCurrentUserAccess} from './accessControlService.js';

export const normalizedFaultStoreCode=value=>String(value??'').trim().toUpperCase();
const fail=(statusCode,message)=>Object.assign(Error(message),{statusCode});
const compact=value=>String(value??'').toUpperCase().replace(/[^A-Z0-9]/g,'');
async function rows(query){const {data,error}=await query;if(error)throw error;return data||[];}
async function pages(makeQuery){const result=[];for(let from=0;from<100000;from+=1000){const page=await rows(makeQuery().range(from,from+999));result.push(...page);if(page.length<1000)return result;}throw fail(503,'Fault Tracker source exceeds the safe reporting bound; no partial totals are returned.');}
function geographicState(value,stateCode){const state=stateLabel(value);return state==='PY'?'PY':stateCode(state)||stateCode(value);}

// Existing role/state authorization remains an upper bound. Explicit verified
// module assignments, when present, may narrow it; they never enlarge it.
export async function faultTrackerAssignmentGrants(client,profile,isAdmin){
 if(isAdmin)return null;
 const {data:module,error}=await client.from('access_modules').select('id').eq('code','fault_tracker').maybeSingle();
 if(error)throw error;if(!module)return null;
 const match=[`profile_id.eq.${profile.id}`,...(profile.auth_user_id?[`auth_user_id.eq.${profile.auth_user_id}`]:[])].join(',');
 const assigned=await rows(client.from('access_user_assignments').select('id').eq('module_id',module.id).or(match).limit(1));
 if(!assigned.length)return null;
 const {data:retail,error:clientError}=await client.from('access_clients').select('id').eq('code','reliance_retail').eq('active',true).maybeSingle();
 if(clientError)throw clientError;if(!retail)throw fail(403,'Verified Retail Fault Tracker scope required.');
 const access=await resolveCurrentUserAccess({client,profile,authUser:{id:profile.auth_user_id},requestedModule:'fault_tracker',requestedClientId:retail.id});
 if(!access.access_granted||access.source!=='unified')throw fail(403,'Verified Retail Fault Tracker scope required.');
 return access.assignments.map(a=>({states:a.scopes.filter(s=>s.scope_type==='state').map(s=>s.scope_code||s.scope_text),stores:a.scopes.filter(s=>s.scope_type==='store').map(s=>s.scope_id),all:a.scopes.some(s=>['global','client','all_client'].includes(s.scope_type))}));
}
export function scopeFaultTickets(source,master,{readAll=false,profileState='',stateCode,isAdmin=false,grants=null}={}){
 const ownState=geographicState(profileState,stateCode);
 if(!readAll&&!ownState)throw fail(403,'State mapping not configured for your profile.');
 const byCode=new Map(),ambiguous=new Set();
 for(const store of master){const code=normalizedFaultStoreCode(store.store_code);if(!code)continue;if(byCode.has(code))ambiguous.add(code);else byCode.set(code,store);}
 const allowed=store=>{
  if(!readAll&&geographicState(store.state,stateCode)!==ownState)return false;
  if(!grants)return true;
  return grants.some(g=>(!g.states.length||g.states.some(s=>geographicState(s,stateCode)===geographicState(store.state,stateCode)))&&(!g.stores.length||g.stores.includes(store.id))&&(g.all||g.states.length||g.stores.length));
 };
 const unmatched=new Set(),tickets=[];
 for(const ticket of source){
  const code=normalizedFaultStoreCode(ticket.store_code),store=byCode.get(code);
  if(!store||ambiguous.has(code)){unmatched.add(code||'[MISSING STORE CODE]');continue;}
  if(ticket.is_active===false||compact(store.status)!=='ACTIVE'||!allowed(store))continue;
  tickets.push({...ticket,canonical_store_id:store.id,canonical_store_code:code,operational_state_code:stateCode(reportingState(store.state))});
 }
 return {tickets,...(isAdmin?{reconciliation:{imported_tickets:source.length,matched_in_scope_tickets:tickets.length,excluded_tickets:source.length-tickets.length,unmatched_store_codes:[...unmatched].sort()}}:{})};
}
export function filterScopedFaultTickets(tickets,input={},stateCode){
 const state=input.state?stateCode(reportingState(input.state)):'',store=normalizedFaultStoreCode(input.store_code||input.store),search=String(input.search||'').trim().toLowerCase();
 if(input.state&&!state)throw fail(400,'Select a supported reporting state.');
 if(input.month&&!/^\d{4}-\d{2}$/.test(input.month))throw fail(400,'Select a reporting month.');
 try{for(const value of [input.date_from,input.date_to])if(value)validDate(value);}catch{throw fail(400,'Select valid reporting dates.');}
 return tickets.filter(t=>(!state||t.operational_state_code===state)&&(!store||t.canonical_store_code===store)
  &&(!input.ticket_id||t.id===input.ticket_id)&&(!input.id||t.id===input.id)&&(!input.ticket_no||t.ticket_no===input.ticket_no)
  &&(!input.stage||t.stage===input.stage)&&(!input.ageing_bucket||t.ageing_bucket===input.ageing_bucket)&&(!input.category||t.category_group===input.category)
  &&(!input.supervisor||t.supervisor_name===input.supervisor)&&(!input.month||String(t.created_at_source||'').startsWith(input.month))
  &&(!(input.date_from||input.date_to)||/^\d{4}-\d{2}-\d{2}/.test(String(t.created_at_source||'')))
  &&(!input.date_from||String(t.created_at_source||'').slice(0,10)>=input.date_from)&&(!input.date_to||String(t.created_at_source||'').slice(0,10)<=input.date_to)
  &&(!search||[t.ticket_no,t.canonical_store_code,t.store_name,t.supervisor_name,t.remarks,t.stage].some(v=>String(v??'').toLowerCase().includes(search))));
}
export async function scopedFaultTrackerReport(client,profile,input,authorization){
 if(profile.is_active===false||String(profile.status||'Active').toUpperCase()!=='ACTIVE')throw fail(403,'Active profile required.');
 let batchId=String(input.import_batch_id||'').trim();
 if(!batchId||input.latest==='true'){const latest=await rows(client.from('fault_tracker_import_batches').select('*').order('imported_at',{ascending:false}).limit(1));batchId=latest[0]?.id;}
 if(!batchId)return {ok:true,import_batch:null,tickets:[]};
 const [master,source,grants]=await Promise.all([
  pages(()=>client.from('reliance_retail_store_master').select('id,store_code,state,status').order('id')),
  pages(()=>client.from('fault_tracker_tickets').select('*').eq('import_batch_id',batchId).order('created_at_source',{ascending:false,nullsFirst:false}).order('id')),
  faultTrackerAssignmentGrants(client,profile,authorization.isAdmin),
 ]);
 const scoped=scopeFaultTickets(source,master,{...authorization,profileState:profile.state,grants});
 const filtered=filterScopedFaultTickets(scoped.tickets,input,authorization.stateCode);
 if((input.ticket_id||input.id||input.ticket_no)&&!filtered.length)throw fail(404,'Ticket unavailable in the authorized operational scope.');
 const batches=await rows(client.from('fault_tracker_import_batches').select('*').eq('id',batchId).limit(1)),batch=batches[0];
 let tickets=filtered;
 if(input.page||input.limit){const size=Math.min(500,Math.max(1,parseInt(input.limit,10)||100)),page=Math.max(1,parseInt(input.page,10)||1);tickets=filtered.slice((page-1)*size,page*size);}
 return {ok:true,import_batch:batch?{id:batch.id,original_file_name:batch.original_file_name,imported_at:batch.imported_at,ticket_count:scoped.tickets.length}:null,tickets,total:filtered.length,...(scoped.reconciliation?{reconciliation:scoped.reconciliation}:{})};
}
