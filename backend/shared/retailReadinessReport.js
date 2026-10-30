import {unifiedReport,ownershipAt} from './retailUnifiedModel.js';
import {stateLabel,reportingState,dailyTarget} from './retailAttendance.js';
export const RETAIL_GEOGRAPHIES=['TN','PY','KA','KL','TG','AP-1','AP-2'];
const component=value=>value==null||value===''?null:value;
const geo=value=>stateLabel(value)==='KN'?'KA':stateLabel(value);
export function latestSourceRows(snapshot){
 const files=(snapshot.files||[]).filter(f=>!f.withdrawn_at).sort((a,b)=>Number(b.version)-Number(a.version));
 const file=files.find(f=>f.source_format==='UNIFIED MASTER')||files.find(f=>f.source_format!=='MANUAL PENDING STORE')||files[0];return file?(snapshot.rows||[]).filter(r=>!r.withdrawn_at&&((file.sha256&&r.sha256===file.sha256)||(file.id&&r.batch_id===file.id))):[];
}
export function sourceAopReview(snapshot){return latestSourceRows(snapshot).map(r=>{
 const raw=r.source?.raw||r.source||{},hk=r.source?.review?.hk||r.review?.hk||{},mepc=r.source?.review?.mepc||r.review?.mepc||{};
 return {state:geo(r.source_state),store_code:r.store_code,row_id:r.id,row_revision:r.revision,source_version:r.version,source_sha256:r.sha256,row_digest:r.row_digest,source_row:r.source_row,source_conflict_flags:r.source?.issues||[],canonical_id:snapshot.stores.find(s=>s.store_code===r.store_code&&geo(s.state)===geo(r.source_state))?.id||null,hk_staff:component(raw['HK Staff']),hk_supervisor:component(raw['HK Supervisor']),mepc_shared:component(raw['MEPC Shared']),mepc_supervisor:component(raw['MEPC Supervisor']),mepc_stationed:component(raw['MEPC Stationed']),hk_effective_from:hk.effective_from||null,hk_effective_to:hk.effective_to||null,mepc_effective_from:mepc.effective_from||null,mepc_effective_to:mepc.effective_to||null,proposed_hk_total:null,proposed_mepc_total:null,calculation_reference:'',approval_reference:'',decision:'',status:'REVIEW_ONLY_NOT_APPROVED',original_values:raw};
 });}
function aggregate(rows){const actual=rows.filter(r=>r.actual!==null),approved=rows.filter(r=>r.target!==null),complete=rows.length>0&&actual.length===rows.length&&approved.length===rows.length;const recorded=actual.reduce((n,r)=>n+r.actual,0),target=approved.reduce((n,r)=>n+r.target,0);return {store_class_days:rows.length,covered_class_days:actual.length,approved_class_days:approved.length,recorded_man_days:recorded,actual:actual.length?recorded:null,target:approved.length?target:null,complete,percentage:complete&&target>0?recorded/target*100:null};}
export function retailReadinessReport(snapshot,{from=snapshot.from,to=snapshot.to,foId='',state:filterState=''}={}){
 if(snapshot.scope==='FO_SELF')return selfReadiness(snapshot,{from,to,foId,state:filterState});
 const report=unifiedReport(snapshot,{from,to});const source=latestSourceRows(snapshot),daily=report.daily.filter(r=>(!foId||r.fo_id===foId)&&(!filterState||geo(r.state)===geo(filterState)));
 const allowed=state=>snapshot.admin||(snapshot.permissions||[]).some(p=>geo(p.state)===state);
 const states=RETAIL_GEOGRAPHIES.map(state=>{const stores=snapshot.stores.filter(s=>geo(s.state)===state),rows=source.filter(r=>geo(r.source_state)===state),days=report.daily.filter(r=>geo(r.state)===state);return {state,reporting_state:reportingState(state),authorized:!!allowed(state),operational_stores:stores.filter(s=>s.status==='Active').length,source_rows:rows.length,pending_codes:new Set(rows.filter(r=>!snapshot.stores.some(s=>s.store_code===r.store_code)).map(r=>r.store_code)).size,...aggregate(days),HK:aggregate(days.filter(r=>r.class==='HK')),MEPC:aggregate(days.filter(r=>r.class==='MEPC'))};});
 const groups=keys=>{const m=new Map();for(const r of daily){const key=keys.map(k=>r[k]??'UNASSIGNED_OR_UNKNOWN').join('|');const group=m.get(key)||{key,rows:[]};group.rows.push(r);m.set(key,group);}return [...m.values()].map(g=>({key:g.key,...aggregate(g.rows)}));};
 const current=snapshot.stores.map(s=>({...s,current_owner:ownershipAt(snapshot,s,`${to}T23:59:59+05:30`)})).filter(s=>(!foId||s.current_owner.fo_profile_id===foId)&&(!filterState||geo(s.state)===geo(filterState)));
 const currentIds=new Set(current.map(s=>s.id));const unattributed_current_store_days=foId?report.daily.filter(r=>currentIds.has(r.store_id)&&!r.ownership_known&&r.actual!==null):[];
 return {states,daily,unattributed_current_store_days,current_stores:current,totals:aggregate(daily),by_zone:groups(['zone_id','class']),by_fo:groups(['fo_id','class']),historical_ownership_unknown:report.daily.filter(r=>r.actual!==null&&!r.ownership_known).length,source_aop:sourceAopReview(snapshot)};
}

function selfReadiness(snapshot,{from,to,foId,state}){
 if(foId&&foId!==snapshot.actor_id)throw Error('Self-service cannot select another profile.');
 const daily=snapshot.self_days.filter(r=>r.fo_id===snapshot.actor_id&&r.date>=from&&r.date<=to&&(!state||geo(r.state)===geo(state))).map(r=>{
  const aop=r.approved_aop==null?null:Number(r.approved_aop),actual=r.actual==null?null:Number(r.actual),target=aop===null?null:dailyTarget(aop,r.date,r.class,r.mepc_cycle_anchor||r.date.slice(0,7)+'-01');
  return {...r,actual,aop,target,reporting_state:reportingState(r.state),aop_status:aop===null?'AOP Pending':'APPROVED',shortage:actual===null||target===null?null:Math.max(0,target-actual),excess:actual===null||target===null?null:Math.max(0,actual-target)};
 });
 const current=snapshot.self_current_stores.filter(s=>s.current_owner.fo_profile_id===snapshot.actor_id&&(!state||geo(s.state)===geo(state)));
 const groups=key=>[...new Set(daily.map(r=>r[key]))].map(id=>({key:id,...aggregate(daily.filter(r=>r[key]===id))}));
 const states=[...new Set([...current.map(s=>geo(s.state)),...daily.map(r=>geo(r.state))])].map(state=>({state,reporting_state:reportingState(state),authorized:true,operational_stores:current.filter(s=>geo(s.state)===state).length,...aggregate(daily.filter(r=>geo(r.state)===state))}));
 return {states,daily,current_stores:current,totals:aggregate(daily),by_zone:groups('zone_id'),by_fo:groups('fo_id'),historical_ownership_unknown:0,unattributed_current_store_days:[],source_aop:[]};
}
