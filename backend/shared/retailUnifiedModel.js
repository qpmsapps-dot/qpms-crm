import {dailyTarget,reportingState,validDate} from './retailAttendance.js';
export function ownershipAt(snapshot,store,at){
 const time=Date.parse(at);if(time<Date.parse(snapshot.epoch_at))return {known:false,zone_id:null,fo_profile_id:null};
 const history=snapshot.store_zone_history.filter(h=>h.retail_store_id===store.id&&Date.parse(h.changed_at)<=time).sort((a,b)=>Date.parse(b.changed_at)-Date.parse(a.changed_at));
 const zone=history.length?history[0].new_zone_id:store.observed_zone_id||null;
 const assignments=snapshot.assignments.filter(a=>a.zone_id===zone&&Date.parse(a.effective_from)<=time&&(!a.effective_to||time<Date.parse(a.effective_to)));
 return {known:true,zone_id:zone,fo_profile_id:assignments.length===1?assignments[0].fo_profile_id:null};
}
const belongs=(store,owner,filter)=> (!filter.state||store.state===filter.state)&&(!filter.zone_id||(filter.zone_id==='UNASSIGNED'?!owner.zone_id:filter.zone_id===owner.zone_id))&&(!filter.fo_id||(filter.fo_id==='UNASSIGNED'?!owner.fo_profile_id:filter.fo_id===owner.fo_profile_id))&&(!filter.store_id||store.id===filter.store_id);
export function unifiedReport(snapshot,filter={}){
 const from=validDate(filter.from||snapshot.from),to=validDate(filter.to||snapshot.to);if(to<from||(Date.parse(to)-Date.parse(from))/86400000>366)throw Error('Invalid date range');
 const dates=[];for(let d=from;d<=to;d=new Date(Date.parse(d)+86400000).toISOString().slice(0,10))dates.push(d);
 const stores=snapshot.stores.filter(s=>belongs(s,s.ownership,filter));
 const attendanceByDay=new Map();for(const a of snapshot.attendance){const key=`${a.retail_store_id}|${a.attendance_date}|${a.class}`;attendanceByDay.set(key,(attendanceByDay.get(key)||0)+Number(a.credit));}
 const aopByStore=new Map();for(const a of snapshot.aop){const list=aopByStore.get(a.retail_store_id)||[];list.push(a);aopByStore.set(a.retail_store_id,list);}
 const daily=[];
 for(const store of snapshot.stores)for(const date of dates){
  const owner=ownershipAt(snapshot,store,`${date}T23:59:59+05:30`);if(!belongs(store,owner,filter))continue;
  for(const kind of ['HK','MEPC']){
   const versions=(aopByStore.get(store.id)||[]).filter(a=>(!a.aop_class||a.aop_class===kind)&&a.effective_from<=date&&(!a.effective_to||date<=a.effective_to)&&a[kind==='HK'?'hk_count':'mepc_count']!=null);
   const config=versions.length===1?versions[0]:null;
   const actual=attendanceByDay.get(`${store.id}|${date}|${kind}`)??null;
   const total=config?Number(config[kind==='HK'?'hk_count':'mepc_count']):null;
   const target=config?dailyTarget(total,date,kind,config.mepc_cycle_anchor||date.slice(0,7)+'-01'):null;
   daily.push({store_id:store.id,store_code:store.store_code,store_name:store.store_name,state:store.state,reporting_state:reportingState(store.state),date,class:kind,zone_id:owner.zone_id,fo_id:owner.fo_profile_id,ownership_known:owner.known,aop:total,target,actual,shortage:target===null||actual===null?null:Math.max(0,target-actual),excess:target===null||actual===null?null:Math.max(0,actual-target),aop_status:config?'APPROVED':'AOP Pending'});
  }
 }
 const activities=(source,kind)=>source.filter(a=>{const s=snapshot.stores.find(s=>s.id===a.retail_store_id||s.store_code===(a.store_code||a.store_code_snapshot));return s&&belongs(s,a.ownership||{known:false},filter)&&(!filter.activity_status||String(a.status).toUpperCase()===filter.activity_status);}).map(a=>({...a,activity_kind:kind}));
 const cleaning=activities(snapshot.deep_cleaning,'Deep Cleaning'),training=activities(snapshot.training,'Training');
 const joinedSchedules=(snapshot.schedules||[]).map(plan=>{const completed=snapshot.deep_cleaning.find(a=>a.retail_store_id===plan.retail_store_id&&a.deep_cleaning_date===plan.scheduled_date&&['SUBMITTED','COMPLETED'].includes(String(a.status).toUpperCase()));return completed&&['PLANNED','SCHEDULED'].includes(String(plan.status).toUpperCase())?{...plan,status:'Completed',completed_at:completed.submitted_at,completion_source:completed.id}:plan;});
 const schedules=snapshot.schedules===null?null:activities(joinedSchedules,'Deep Cleaning schedule');
 const activeRows=snapshot.rows.filter(r=>!r.withdrawn_at&&(!filter.state||r.source_state===filter.state));
 const currentAop=(s,kind)=>snapshot.aop.some(a=>a.retail_store_id===s.id&&(!a.aop_class||a.aop_class===kind)&&a.effective_from<=to&&(!a.effective_to||a.effective_to>=to)&&a[kind==='HK'?'hk_count':'mepc_count']!=null);
 return {stores,daily,cleaning,training,schedules,counts:{canonical_stores:stores.length,canonical_active_stores:stores.filter(s=>s.status==='Active').length,provisional_source_rows:activeRows.length,provisional_codes:new Set(activeRows.map(r=>r.store_code).filter(Boolean)).size,new_provisional_codes:new Set(activeRows.filter(r=>!snapshot.stores.some(s=>s.store_code===r.store_code)).map(r=>r.store_code).filter(Boolean)).size,pending_mis_rows:activeRows.filter(r=>r.verification_status!=='VERIFIED').length,zones:snapshot.zones.filter(z=>!filter.state||z.state===filter.state).length,zones_without_fo:snapshot.zones.filter(z=>(!filter.state||z.state===filter.state)&&!snapshot.assignments.some(a=>a.zone_id===z.id&&Date.parse(a.effective_from)<=Date.now()&&(!a.effective_to||Date.now()<Date.parse(a.effective_to)))).length,stores_without_zone:stores.filter(s=>!s.ownership.zone_id).length,missing_hk_aop:stores.filter(s=>!currentAop(s,'HK')).length,missing_mepc_aop:stores.filter(s=>!currentAop(s,'MEPC')).length,deep_cleaning_scheduled:schedules===null?null:schedules.length,deep_cleaning_pending:schedules===null?null:schedules.filter(a=>!['COMPLETED','CANCELLED'].includes(String(a.status).toUpperCase())).length,deep_cleaning_overdue:schedules===null?null:schedules.filter(a=>a.scheduled_date<to&&!['COMPLETED','CANCELLED'].includes(String(a.status).toUpperCase())).length,training_planned:training.filter(a=>['DRAFT','PLANNED','SCHEDULED'].includes(String(a.status).toUpperCase())).length,training_pending:training.filter(a=>!['SUBMITTED','COMPLETED','CANCELLED'].includes(String(a.status).toUpperCase())).length,deep_cleaning_completed:cleaning.filter(a=>['SUBMITTED','COMPLETED'].includes(String(a.status).toUpperCase())).length,training_completed:training.filter(a=>['SUBMITTED','COMPLETED'].includes(String(a.status).toUpperCase())).length}};
}
