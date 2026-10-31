import {reportingState} from './retailAttendance.js';
import {ownershipAt} from './retailUnifiedModel.js';
export function trainingReport(sessions,snapshot,filter={}){
 return sessions.map(session=>{
  const category=session.category?.code,training_class=category==='technical_mep'?'MEPC':category==='hk'?'HK':'Unclassified';
  const candidates=(snapshot?.stores||[]).filter(s=>s.id===session.store?.id||(s.store_code===session.store?.store_code&&s.state===session.store?.state));
  const store=candidates.length===1?candidates[0]:null;
  const ownership=store?ownershipAt(snapshot,store,session.submitted_at||`${session.training_date}T23:59:59+05:30`):{known:false,zone_id:null,fo_profile_id:null};
  return {...session,training_class,canonical_store_id:store?.id||null,state:session.store?.state||'',ownership};
 }).filter(s=>(!filter.state||reportingState(s.state)===reportingState(filter.state))&&(!filter.class||s.training_class===filter.class)&&(!filter.zone||s.ownership.zone_id===filter.zone)&&(!filter.fo||s.ownership.fo_profile_id===filter.fo)&&(!filter.store||s.canonical_store_id===filter.store)&&(!filter.status||s.status===filter.status));
}
