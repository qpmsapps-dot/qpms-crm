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
    const matches = submissions.filter(s => s.store.id === store.id && s.deep_cleaning_date === plan.scheduled_date && completed(s.status));
    const status = storeKey(plan.status), terminal = ['CANCELLED','NOT DONE','NOT COMPLETED'].includes(status);
    const effective = status === 'COMPLETED' || (!terminal && matches.length) ? 'Completed' : ['NOT DONE','NOT COMPLETED'].includes(status) ? 'Not Completed' : status === 'CANCELLED' ? 'Cancelled' : ['PLANNED','SCHEDULED'].includes(status) ? 'Scheduled' : 'Unknown';
    return [{...plan,store,reporting_state:reportingState(store.state),display_status:effective,submission_ids:matches.map(s=>s.id),overdue:effective==='Scheduled' && plan.scheduled_date < (filter.to || snapshot.to)}];
  });
  return {schedules,submissions,exceptions,states:[...new Set(stores.filter(visible).map(s=>reportingState(s.state)))].sort(),
    totals:schedules===null?null:{scheduled:schedules.filter(s=>s.display_status!=='Cancelled').length,completed:schedules.filter(s=>s.display_status==='Completed').length,not_completed:schedules.filter(s=>s.display_status==='Not Completed').length,pending:schedules.filter(s=>s.display_status==='Scheduled').length}};
}

export function completedTrainingReport(sessions, stores, filter = {}) {
 const rows=[],exceptions=[];
 for(const session of sessions){
  if(!completed(session.status))continue;
  const store=canonicalActivityStore(stores,session),code=session.category?.code;
  const training_class=code==='hk'?'HK':code==='technical_mep'?'MEPC':null;
  if(!store||!training_class){exceptions.push({id:session.id,reason:!store?'Unresolved canonical Store Code':'Unclassified training category'});continue;}
  if(filter.state&&reportingState(store.state)!==reportingState(filter.state)||filter.store&&store.id!==filter.store)continue;
  rows.push({...session,store,canonical_store_id:store.id,training_class,reporting_state:reportingState(store.state)});
 }
 const group=key=>{const groups=new Map();for(const r of rows){const id=key==='state'?r.reporting_state:r.store.id;const g=groups.get(id)||{state:r.reporting_state,...(key==='store'?{store_id:r.store.id,store_code:r.store.store_code,store_name:r.store.store_name}:{}),hk:0,mepc:0};g[r.training_class==='HK'?'hk':'mepc']++;groups.set(id,g);}return [...groups.values()];};
 return {rows,exceptions,states:group('state'),stores:group('store'),total:{hk:rows.filter(r=>r.training_class==='HK').length,mepc:rows.filter(r=>r.training_class==='MEPC').length}};
}
