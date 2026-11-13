import {reportingState, stateLabel, storeKey} from './retailAttendance.js';

const completed = value => ['SUBMITTED','COMPLETED'].includes(storeKey(value));
// Resolve only unique canonical codes. A UUID never overrides contradictory source identity.
export function canonicalActivityStore(stores, record) {
  const code = storeKey(record.store_code || record.store_code_snapshot || record.store?.store_code);
  const id = record.retail_store_id || record.canonical_store_id;
  const candidates = stores.filter(s => code ? storeKey(s.store_code) === code : s.id === id);
  if (candidates.length !== 1) return null;
  const store = candidates[0], geography = record.state || record.state_snapshot || record.store?.state;
  if (id && store.id !== id || geography && stateLabel(geography) !== stateLabel(store.state)) return null;
  return store;
}

export function cleaningReport(snapshot, filter = {}) {
  const stores = snapshot.stores || [], exceptions = [];
  const visible = store => (!filter.state || reportingState(store.state) === reportingState(filter.state)) && (!filter.store || store.id === filter.store);
  const submissions = (snapshot.deep_cleaning || []).flatMap(row => {
    const store = canonicalActivityStore(stores,row);
    if (!store) { exceptions.push({id:row.id,reason:'Ambiguous, conflicting or unknown canonical Store Code'}); return []; }
    if (!visible(store)) return [];
    const images = (snapshot.images || []).filter(i => i.submission_id === row.id && i.uploaded);
    return [{...row,store,reporting_state:reportingState(store.state),before_count:images.filter(i=>storeKey(i.photo_type)==='BEFORE').length,after_count:images.filter(i=>storeKey(i.photo_type)==='AFTER').length}];
  });
  const schedules = snapshot.schedules == null ? null : snapshot.schedules.flatMap(plan => {
    const store = canonicalActivityStore(stores,plan);
    if (!store) { exceptions.push({id:plan.id,reason:'Ambiguous, conflicting or unknown canonical Store Code'}); return []; }
    if (!visible(store)) return [];
    const matches = [...new Map(submissions.filter(s => s.store.id === store.id && s.schedule_id === plan.id && s.deep_cleaning_date === plan.scheduled_date && completed(s.status) && !['NOT DONE','NOT COMPLETED'].includes(storeKey(s.final_outcome))).map(s=>[s.id,s])).values()];
    const recordedNotDone = submissions.some(s => s.store.id === store.id && s.schedule_id === plan.id && s.deep_cleaning_date === plan.scheduled_date && completed(s.status) && ['NOT DONE','NOT COMPLETED'].includes(storeKey(s.final_outcome)));
    const status = storeKey(plan.status), terminal = ['CANCELLED','NOT DONE','NOT COMPLETED'].includes(status);
    const effective = status === 'CANCELLED' ? 'Cancelled' : ['NOT DONE','NOT COMPLETED'].includes(status) ? 'Not Completed' : !terminal && matches.length ? 'Completed' : recordedNotDone ? 'Not Completed' : ['PLANNED','SCHEDULED','COMPLETED'].includes(status) ? 'Scheduled' : 'Unknown';
    return [{...plan,store,reporting_state:reportingState(store.state),display_status:effective,submission_ids:matches.map(s=>s.id),overdue:effective==='Scheduled' && plan.scheduled_date < (filter.to || snapshot.to)}];
  });
  return {schedules,submissions,exceptions,states:[...new Set(stores.filter(visible).map(s=>reportingState(s.state)))].sort(),
    totals:schedules===null?null:{scheduled:schedules.filter(s=>s.display_status!=='Cancelled').length,completed:schedules.filter(s=>s.display_status==='Completed').length,not_completed:schedules.filter(s=>s.display_status==='Not Completed').length,pending:schedules.filter(s=>s.display_status==='Scheduled').length}};
}

// Submitted-report counts are independent of schedule KPIs and their denominator.
export function submittedCleaningReport(snapshot, filter = {}) {
 if(!Array.isArray(snapshot.deep_cleaning)||!Array.isArray(snapshot.stores))return {status:'unavailable',rows:[],identity_exceptions:1};
 const source=(snapshot.deep_cleaning||[]).filter(r=>completed(r.status)&&(!filter.from||r.deep_cleaning_date>=filter.from)&&(!filter.to||r.deep_cleaning_date<=filter.to));
 const report=cleaningReport({...snapshot,deep_cleaning:source,schedules:null},filter),groups=new Map(),seen=new Set();
 const exceptions=[...report.exceptions];
 for(const row of report.submissions){
  if(!row.id){exceptions.push({reason:'Missing submission identity'});continue;}
  if(seen.has(row.id))continue;seen.add(row.id);
  const outcome=storeKey(row.final_outcome);
  if(outcome&&!['COMPLETED','NOT DONE','NOT COMPLETED'].includes(outcome)){exceptions.push({id:row.id,reason:'Unknown recorded outcome'});continue;}
  const group=groups.get(row.reporting_state)||{state:row.reporting_state,submitted:0,done:0,not_done:0};
  group.submitted++;group[['NOT DONE','NOT COMPLETED'].includes(outcome)?'not_done':'done']++;groups.set(group.state,group);
 }
 return {status:exceptions.length?'unavailable':'ready',rows:exceptions.length?[]:[...groups.values()],identity_exceptions:exceptions.length};
}

export function completedTrainingReport(sessions, stores, filter = {}) {
 const rows=[],exceptions=[],seen=new Set();
 for(const session of sessions){
  if(!completed(session.status))continue;
  const store=canonicalActivityStore(stores,session),code=session.category?.code;
  const training_class=code==='hk'?'HK':code==='technical_mep'?'MEPC':null;
  if(!store||!training_class){exceptions.push({id:session.id,reason:!store?'Unresolved canonical Store Code':'Unclassified training category'});continue;}
  if(filter.state&&reportingState(store.state)!==reportingState(filter.state)||filter.store&&store.id!==filter.store)continue;
  if(filter.from&&session.training_date<filter.from||filter.to&&session.training_date>filter.to)continue;
  if(!session.id){exceptions.push({reason:'Missing session identity'});continue;}
  if(seen.has(session.id))continue;seen.add(session.id);
  rows.push({...session,store,canonical_store_id:store.id,training_class,reporting_state:reportingState(store.state)});
 }
 const group=key=>{const groups=new Map();for(const r of rows){const id=key==='state'?r.reporting_state:r.store.id;const g=groups.get(id)||{state:r.reporting_state,...(key==='store'?{store_id:r.store.id,store_code:r.store.store_code,store_name:r.store.store_name}:{}),hk:0,mepc:0};g[r.training_class==='HK'?'hk':'mepc']++;groups.set(id,g);}return [...groups.values()];};
 return {rows,exceptions,states:group('state'),stores:group('store'),total:{hk:rows.filter(r=>r.training_class==='HK').length,mepc:rows.filter(r=>r.training_class==='MEPC').length}};
}
