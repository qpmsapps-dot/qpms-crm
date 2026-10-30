import {reportingState,storeKey,validDate} from './retailAttendance.js';
import {classifyUnifiedRow} from './retailUnifiedClassification.js';
export const ZONE_STATES=['TN','PY','KA','KL','TG','AP-1','AP-2'];
export const ZONE_MAPPING_HEADERS=['Record Type','State / Business Group','Store Code','Source Row ID','Zone Code','FO Employee Code','Effective From','Effective To','Reason'];
export const zoneStates=snapshot=>ZONE_STATES.filter(state=>snapshot.admin||snapshot.permissions.some(p=>p.state===state));
export const canEditZone=(snapshot,state)=>ZONE_STATES.includes(state)&&(snapshot.admin||snapshot.permissions.some(p=>p.state===state&&['editor','reviewer'].includes(p.permission)));
export const zoneFoCandidates=(snapshot,state)=>snapshot.fos.filter(f=>ZONE_STATES.includes(f.state==='KN'?'KA':f.state)&&reportingState(f.state==='KN'?'KA':f.state)===reportingState(state));
export function currentZoneFo(snapshot,zone,at=Date.now()){
 const rows=snapshot.assignments.filter(a=>a.zone_id===zone&&Date.parse(a.effective_from)<=at&&(!a.effective_to||at<Date.parse(a.effective_to)));
 return rows.length===1?rows[0]:null;
}
export function zoneStateSummary(snapshot,at=Date.now()){
 return zoneStates(snapshot).map(state=>{
  const zones=snapshot.zones.filter(z=>z.state===state),stores=snapshot.stores.filter(s=>s.state===state),sources=snapshot.rows.filter(r=>!r.withdrawn_at&&r.source_state===state);
  const fos=new Set([...zones.map(z=>currentZoneFo(snapshot,z.id,at)?.fo_profile_id),...stores.map(s=>s.ownership?.fo_profile_id)].filter(Boolean));
  return {state,reporting_state:reportingState(state),zones:zones.length,assigned_stores:stores.filter(s=>s.ownership?.zone_id).length,unassigned_verified_stores:stores.filter(s=>!s.ownership?.zone_id).length,mapped_fos:fos.size,zones_without_fo:zones.filter(z=>!currentZoneFo(snapshot,z.id,at)).length,provisional_codes:new Set(sources.filter(r=>!snapshot.stores.some(s=>storeKey(s.store_code)===storeKey(r.store_code))).map(r=>r.store_code)).size,source_rows:sources.length,legacy_shared_state_stores:stores.filter(s=>s.ownership?.zone_id&&snapshot.zones.find(z=>z.id===s.ownership.zone_id)?.state!==state).length};
 });
}
const clean=v=>String(v??'').trim();
export function previewZoneMappings(records,snapshot,at=Date.now()){
 const seen=new Set();
 const rows=records.map((record,index)=>{
  const raw={...record},type=clean(raw['Record Type']).toUpperCase(),state=clean(raw['State / Business Group']).toUpperCase(),code=storeKey(raw['Store Code']),zoneCode=clean(raw['Zone Code']),foCode=storeKey(raw['FO Employee Code']),from=clean(raw['Effective From']),to=clean(raw['Effective To']),reason=clean(raw.Reason);
  const issues=[...(raw._technical_issues||[])],warnings=[];
  if(!ZONE_STATES.includes(state))issues.push('DEFINED_STATE_REQUIRED');if(!canEditZone(snapshot,state))issues.push('OUTSIDE_EDITOR_SCOPE');
  if(!['STORE','ZONE_FO','PROVISIONAL_DRAFT'].includes(type))issues.push('INVALID_RECORD_TYPE');
  let start=from==='ON_ACTIVATION'?at:Date.parse(from),end=to?Date.parse(to):null;
  try{if(from!=='ON_ACTIVATION'){validDate(from.slice(0,10));if(!from.includes('T')||!/(Z|[+-]\d{2}:\d{2})$/.test(from))throw Error();}if(to){validDate(to.slice(0,10));if(!to.includes('T')||!/(Z|[+-]\d{2}:\d{2})$/.test(to))throw Error();}}catch{issues.push('ISO_EFFECTIVE_TIMESTAMP_REQUIRED');}
  if(!Number.isFinite(start)||start<at-60000||end!==null&&(!Number.isFinite(end)||end<=start))issues.push('CURRENT_OR_FUTURE_NONEMPTY_INTERVAL_REQUIRED');
  const matches=snapshot.zones.filter(z=>storeKey(z.zone_code)===storeKey(zoneCode));const zone=matches.length===1?matches[0]:null;
  if(!zoneCode)issues.push('EXPLICIT_ZONE_OR_UNASSIGNED_REQUIRED');
  if(zoneCode!=='UNASSIGNED'&&(!zone||zone.status!=='Active'))issues.push('ACTIVE_EXISTING_ZONE_REQUIRED');
  if(type==='ZONE_FO'&&zoneCode==='UNASSIGNED')issues.push('ZONE_REQUIRED_FOR_FO');
  let store=null,source=null,fo=null,kind=null,changes=null;
  if(type==='STORE'){
   const stores=snapshot.stores.filter(s=>storeKey(s.store_code)===code);store=stores.length===1?stores[0]:null;
   if(!store)issues.push('VERIFIED_CANONICAL_STORE_REQUIRED');else if(store.state!==state)issues.push('STORE_STATE_CONFLICT');
   if(store&&snapshot.store_zone_history.some(h=>h.retail_store_id===store.id&&Date.parse(h.changed_at)>=start)){
    if(from==='ON_ACTIVATION'&&!to&&(store.ownership?.zone_id||'')===(zone?.id||''))warnings.push('FUTURE_STORE_TIMELINE_PRESERVED');else issues.push('FUTURE_STORE_MAPPING_REQUIRES_REVIEW');
   }
   if(foCode)issues.push('FO_MUST_BE_ASSIGNED_TO_ZONE');kind='store_zone';changes={zone_id:zone?.id||'',effective_from:from,effective_to:to};
  }else if(type==='ZONE_FO'){
   if(code||clean(raw['Source Row ID']))issues.push('FO_MUST_BE_ASSIGNED_TO_ZONE');
   const candidates=zoneFoCandidates(snapshot,state).filter(f=>storeKey(f.employee_code)===foCode);fo=candidates.length===1?candidates[0]:null;
   if(foCode!=='UNASSIGNED'&&!fo)issues.push('VERIFIED_SCOPED_FO_REQUIRED');
   const sameCurrent=zone&&from==='ON_ACTIVATION'&&!to&&(currentZoneFo(snapshot,zone.id,at)?.fo_profile_id||'')===(fo?.id||'');
   if(zone&&snapshot.assignments.some(a=>a.zone_id===zone.id&&(Date.parse(a.effective_from)>=start||a.effective_to&&Date.parse(a.effective_from)<start&&Date.parse(a.effective_to)>start))){if(sameCurrent)warnings.push('FUTURE_FO_TIMELINE_PRESERVED');else issues.push('FUTURE_FO_MAPPING_REQUIRES_REVIEW');}
   kind='zone_fo';changes={fo_profile_id:fo?.id||'',effective_from:from,effective_to:to};
  }else if(type==='PROVISIONAL_DRAFT'){
   source=snapshot.rows.find(r=>r.id===clean(raw['Source Row ID'])&&!r.withdrawn_at);
   if(!source||source.source_state!==state||storeKey(source.store_code)!==code)issues.push('EXACT_RETAINED_SOURCE_REQUIRED');
   if(snapshot.stores.some(s=>storeKey(s.store_code)===code))issues.push('CANONICAL_MATCH_USE_VERIFIED_STORE_WORKFLOW');
   if(foCode)issues.push('FO_MUST_BE_ASSIGNED_TO_ZONE');
   warnings.push('DRAFT_ONLY_PENDING_IDENTITY_VERIFICATION');kind='provisional_zone_draft';changes={zone_id:zone?.id||'',effective_from:from,effective_to:to};
   if(source)warnings.push(...classifyUnifiedRow(source).blocking_identity_issues.map(issue=>'SOURCE_IDENTITY_REVIEW_'+issue));
  }
  if(zone&&zone.state!==state){if(type==='STORE'&&store?.state===state&&store?.ownership?.zone_id===zone.id&&from==='ON_ACTIVATION'&&!to)warnings.push('LEGACY_SHARED_MAPPING_UNCHANGED');else issues.push('CROSS_STATE_ZONE_CONFLICT');}
  const key=`${type}|${type==='ZONE_FO'?zoneCode:code}|${type==='PROVISIONAL_DRAFT'?source?.id:state}`;if(seen.has(key))issues.push('DUPLICATE_OR_CONFLICTING_MAPPING');seen.add(key);
  let disposition=type==='PROVISIONAL_DRAFT'?'PROVISIONAL_DRAFT':'REVIEW_PROPOSAL';
  if(!issues.length&&from==='ON_ACTIVATION'&&!to&&((type==='STORE'&&(store.ownership?.zone_id||'')===(zone?.id||''))||(type==='ZONE_FO'&&(currentZoneFo(snapshot,zone.id,at)?.fo_profile_id||'')===(fo?.id||''))))disposition='UNCHANGED';
  if(disposition!=='UNCHANGED'&&(reason.length<3||reason.length>2000))issues.push('EVIDENCE_REASON_REQUIRED');
  const existing=!issues.length&&type!=='PROVISIONAL_DRAFT'&&snapshot.proposals.find(p=>['PENDING','APPROVED'].includes(p.status)&&p.kind===kind&&p.target_store===(store?.id||null)&&p.target_zone===(type==='ZONE_FO'?zone?.id:null)&&Object.keys(p.changes).length===Object.keys(changes).length&&Object.keys(changes).every(k=>p.changes[k]===changes[k]));
  if(existing)disposition='EXISTING_REVIEW_PROPOSAL';
  return {source_row:record._source_row||index+2,raw,type,state,store_code:code,zone_code:zoneCode,fo_employee_code:foCode,store_id:store?.id||null,zone_id:zone?.id||null,row_id:source?.id||null,revision:source?.revision??null,row_digest:source?.row_digest||null,kind,changes,reason,issues:[...new Set(issues)],warnings,disposition:issues.length?'CONFLICT':disposition,existing_proposal_id:existing?.id||null};
 });
 return {stamp:snapshot.stamp,rows,receipt:{source_rows:rows.length,conflicts:rows.filter(r=>r.issues.length).length,verified_store_proposals:rows.filter(r=>r.type==='STORE'&&r.disposition==='REVIEW_PROPOSAL').length,zone_fo_proposals:rows.filter(r=>r.type==='ZONE_FO'&&r.disposition==='REVIEW_PROPOSAL').length,provisional_drafts:rows.filter(r=>r.disposition==='PROVISIONAL_DRAFT').length,unchanged:rows.filter(r=>r.disposition==='UNCHANGED').length,existing_proposals:rows.filter(r=>r.disposition==='EXISTING_REVIEW_PROPOSAL').length,operational_writes:0},can_submit:rows.length>0&&rows.every(r=>!r.issues.length)};
}
