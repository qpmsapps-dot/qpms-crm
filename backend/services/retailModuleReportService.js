import {unifiedSnapshot} from './retailUnifiedService.js';
import {assertRetailAccess,retailAccess} from './relianceRetailManagementService.js';
import {canonicalActivityStore,cleaningReport,completedTrainingReport,submittedCleaningReport} from '../shared/retailModuleReports.js';
import {resolveTrainingReadScope,RELIANCE_TRAINING_CLIENT_ID} from './trainingAccessService.js';
import {retailTrainingEnvelopeIds,applyRetailTrainingStoreScope} from './retailTrainingReadScopeService.js';
import {indiaToday,validDate,stateLabel,reportingState,summarizeAttendance} from '../shared/retailAttendance.js';
import {attendanceAccess} from './retailAttendanceService.js';
import {CLIENT_DEEP_CLEANING_BUCKET,buildClientDeepCleaningStoragePath,verifyClientDeepCleaningStorageObject} from './clientDeepCleaningService.js';
import {retailOperationsSource} from './retailOperationsService.js';
import {maintenanceReport,thermographyReport} from '../shared/retailOperations.js';
import {linkedFoCleaningSource,signLinkedFoCleaningEvidence,signVerifiedFoCleaningSource,boundedCleaningReads,reportRead} from './retailCleaningFoLinkService.js';
const fail=(statusCode,message)=>Object.assign(Error(message),{statusCode});
export function moduleReportRange(input={}) {
 let to,from;try{to=validDate(input.to||indiaToday());from=validDate(input.from||to.slice(0,7)+'-01');}catch{throw fail(400,'Select valid reporting dates.');}
 if(to<from||(Date.parse(to)-Date.parse(from))/86400000>366)throw fail(400,'Select a reporting range up to 366 days.');
 return {from,to};
}
async function authorizedSnapshot(client,profile,range){
 try{return await reportRead('rpc_retail_unified_snapshot',()=>unifiedSnapshot(client,profile,range));}catch(e){
  if(['PGRST202','42P01','42883'].includes(e.code))throw Object.assign(fail(503,'Existing Retail reporting infrastructure awaits separate authorized database setup.'),{code:e.code,reportOperation:e.reportOperation,reportDurationMs:e.reportDurationMs});
  if(e.code==='42501')throw Object.assign(fail(403,'Verified Retail state/store permission required.'),{code:e.code,reportOperation:e.reportOperation,reportDurationMs:e.reportDurationMs});throw e;
 }
}
export async function retailCleaningReport(client,profile,input={}) {
 assertRetailAccess(profile,'deepCleaning');
 if(profile.is_active===false||['INACTIVE','DISABLED'].includes(String(profile.status||'').toUpperCase()))throw fail(403,'Active Retail access required.');
 const range=moduleReportRange(input),original=await authorizedSnapshot(client,profile,range);
 return {...range,...await cleaningFromSnapshot(client,profile,original,range,input)};
}
async function includeVerifiedCleaningSources(client,snapshot,range){
 const existing=new Set((snapshot.deep_cleaning||[]).map(row=>row.id));
 const plans=(snapshot.schedules||[]).filter(plan=>plan.metadata?.verified_link_contract==='cleaning-match.manual.v2'&&!existing.has(plan.metadata.verified_submission_id));
 const ids=[...new Set(plans.map(plan=>plan.metadata.verified_submission_id))];
 if(ids.length>1000)throw fail(413,'Narrow the manual-link reporting range.');
 for(let start=0;start<ids.length;start+=100){
  const result=await client.from('client_deep_cleaning_submissions').select('id,business,schedule_id,retail_store_id,store_code,store_name,state,deep_cleaning_date,status,final_outcome,submitted_by_user_id,submitted_by_employee_code,submitted_at,metadata').in('id',ids.slice(start,start+100)).eq('status','submitted');
  if(result.error)throw result.error;
  for(const row of result.data||[]){
   if(plans.some(plan=>plan.retail_store_id===row.retail_store_id&&plan.metadata.verified_submission_id===row.id&&plan.metadata.verified_actual_date===row.deep_cleaning_date))snapshot.deep_cleaning.push({...row,linked_only:row.deep_cleaning_date<range.from||row.deep_cleaning_date>range.to});
  }
 }
 return snapshot;
}
async function cleaningFromSnapshot(client,profile,original,range,input={}) {
 const snapshot={...original,deep_cleaning:[...(original.deep_cleaning||[])],images:[...(original.images||[])]};
 await includeVerifiedCleaningSources(client,snapshot,range);
 // Names come only from the already-authorized Retail FO envelope; ambiguous
 // identities remain unrecorded rather than resolving against company-wide staff.
 snapshot.deep_cleaning=snapshot.deep_cleaning.map(row=>{
  const matches=(original.fos||[]).filter(fo=>fo.auth_user_id?fo.auth_user_id===row.submitted_by_user_id:fo.employee_code&&fo.employee_code===row.submitted_by_employee_code);
  return matches.length===1?{...row,fo_name:row.fo_name||matches[0].name||matches[0].full_name}:row;
 });
 snapshot.schedules=snapshot.schedules?.map(plan=>{
  const matches=(original.fos||[]).filter(fo=>fo.id===plan.assigned_fo_profile_id);
  return matches.length===1?{...plan,assigned_fo_name:matches[0].name||matches[0].full_name,assigned_fo_employee_code:matches[0].employee_code}:plan;
 })??snapshot.schedules;
 const linked=(snapshot.schedules||[]).filter(s=>s.metadata?.retail_fo_completion);
 if(linked.length>1000)throw fail(413,'Narrow the schedule reporting range.');
 const sources=await boundedCleaningReads(linked,schedule=>reportRead('rpc_retail_cleaning_link_source',()=>linkedFoCleaningSource(client,profile,schedule.id)));
 for(const source of sources){
  if(source){snapshot.deep_cleaning=[...(snapshot.deep_cleaning||[]),{...source,uploads:undefined}];snapshot.images=[...(snapshot.images||[]),...(source.uploads||[]).map(u=>({submission_id:source.id,photo_type:u.upload_role==='deep_cleaning_before'?'before':'after',uploaded:true}))];}
 }
 return {...range,...cleaningReport(snapshot,{state:input.state,store:input.store,...range}),stores:snapshot.stores.map(({id,store_code,store_name,state})=>({id,store_code,store_name,state}))};
}
export async function retailCleaningEvidence(client,profile,id,input={}) {
 // Recheck the authenticated actor's canonical state/store scope before signing anything.
 assertRetailAccess(profile,'deepCleaning');
 if(profile.is_active===false||['INACTIVE','DISABLED'].includes(String(profile.status||'').toUpperCase()))throw fail(403,'Active Retail access required.');
 const range=moduleReportRange(input),original=await authorizedSnapshot(client,profile,range);
 const snapshot=await includeVerifiedCleaningSources(client,{...original,deep_cleaning:[...(original.deep_cleaning||[])]},range);
 const report=cleaningReport(snapshot,{state:input.state,store:input.store,to:range.to});
 const submission=report.submissions.find(s=>s.id===id);
 if(!submission&&String(id).startsWith('fo:')){
  const schedule=report.schedules?.find(s=>s.metadata?.retail_fo_completion?.source_id===id.slice(3));
  if(!schedule)throw fail(403,'Submission is outside the authorized report scope.');
  const source=await reportRead('rpc_retail_cleaning_link_source',()=>linkedFoCleaningSource(client,profile,schedule.id));
  if(!source||source.id!==id||!cleaningReport({...snapshot,deep_cleaning:[source]},{state:input.state,store:input.store,to:range.to}).submissions.length)
   throw fail(403,'Submission is outside the authorized report scope.');
  return reportRead('legacy_cleaning_storage_evidence',()=>signVerifiedFoCleaningSource(client,source));
 }
 if(!submission)throw fail(403,'Submission is outside the authorized report scope.');
 if(submission.source_kind==='verified_fo_link')return signLinkedFoCleaningEvidence(client,profile,submission.schedule_id);
 const prefix=buildClientDeepCleaningStoragePath({submission:{...submission,store_code:submission.store_code||submission.store.store_code},uploadType:'before',mimeType:'image/jpeg',id:'prefix'}).split('/').slice(0,-2).join('/')+'/';
 const {data,error}=await reportRead('client_deep_cleaning_uploads.select',async()=>{
  const result=await client.from('client_deep_cleaning_uploads').select('id,submission_id,upload_type,storage_bucket,storage_path,original_filename,mime_type,file_size,uploaded_at').eq('submission_id',id).eq('upload_status','uploaded').order('id').limit(101);
  if(result.error)throw result.error;return result;
 });
 if(error)throw error;if(data.length>100)throw fail(413,'This submission exceeds the evidence viewing limit.');
 const uploads=await boundedCleaningReads(data,async row=>{
  if(row.storage_bucket!==CLIENT_DEEP_CLEANING_BUCKET||!row.storage_path||!['image/jpeg','image/png','image/webp','application/pdf'].includes(row.mime_type))return null;
  if(!row.storage_path.startsWith(prefix)||row.storage_path.split('/').some(p=>p==='..'||p==='.'||p.includes('\\')))throw fail(409,'Recorded evidence path is outside this submission.');
  await reportRead('cleaning_storage.object_verify',()=>verifyClientDeepCleaningStorageObject(client,CLIENT_DEEP_CLEANING_BUCKET,row.storage_path,row.file_size==null?null:Number(row.file_size)));
  const signed=await reportRead('cleaning_storage.sign_read_url',async()=>{
   const result=await client.storage.from(CLIENT_DEEP_CLEANING_BUCKET).createSignedUrl(row.storage_path,600);
   if(result.error)throw result.error;return result;
  });
  return {id:row.id,type:row.upload_type,name:row.original_filename,mime_type:row.mime_type,url:signed.data.signedUrl,...(row.uploaded_at?{uploaded_at:row.uploaded_at}:{})};
 });
 return uploads.filter(Boolean);
}

export async function retailCompletedTraining(client,profile,input={},existingSnapshot=null) {
 assertRetailAccess(profile,'training');
 const range=moduleReportRange(input),scope=await resolveTrainingReadScope(client,profile);
 const snapshot=existingSnapshot||await authorizedSnapshot(client,profile,range);
 const ids=await retailTrainingEnvelopeIds(client,[...scope.employeeCodes]),sessions=new Map();
 // Bounded ID batches preserve the existing employee-envelope and verified HK store scope.
 // No 200-row UI cap is used for period totals, and no training mutation workflow changes.
 for(let start=0;start<ids.length;start+=200){
  let q=client.from('training_sessions').select('id,store_id,retail_store_id,store_code_snapshot,state_snapshot,training_date,status,category_id,submitted_at,trainer_name_snapshot')
   .eq('access_client_id',RELIANCE_TRAINING_CLIENT_ID).eq('access_client_code','reliance_retail').in('id',ids.slice(start,start+200))
   .in('status',['submitted','completed']).gte('training_date',range.from).lte('training_date',range.to).order('id').range(0,199);
  if(scope.retailScope)q=applyRetailTrainingStoreScope(q,scope.retailScope);
  const {data,error}=await q;if(error)throw error;for(const s of data||[])sessions.set(s.id,s);
 }
 const values=[...sessions.values()],categoryIds=[...new Set(values.map(s=>s.category_id))];
 // Resolve legacy identities only after employee-envelope/client/HK store guards.
 const legacyIds=[...new Set(values.filter(s=>!s.retail_store_id&&!s.store_code_snapshot&&s.store_id).map(s=>s.store_id))],legacyStores=[];
 for(let start=0;start<legacyIds.length;start+=200){
  const result=await client.from('store_master').select('id,store_code,state,business').in('id',legacyIds.slice(start,start+200)).in('business',['Reliance Retail','Reliance']).order('id').range(0,199);
  if(result.error)throw result.error;legacyStores.push(...result.data||[]);
 }
 const normalized=values.map(s=>{
  const legacy=legacyStores.find(row=>row.id===s.store_id);
  if(legacy&&s.state_snapshot&&stateLabel(s.state_snapshot)!==stateLabel(legacy.state))throw fail(409,'Conflicting legacy Training state mapping.');
  return {...s,store_code_snapshot:s.store_code_snapshot||legacy?.store_code,state_snapshot:s.state_snapshot||legacy?.state,
   canonical_store_id:!s.retail_store_id&&snapshot.stores.some(store=>store.id===s.store_id)?s.store_id:undefined};
 });
 const categories=categoryIds.length?await client.from('training_categories').select('id,code').in('id',categoryIds):{data:[]};if(categories.error)throw categories.error;
 const categoryById=new Map(categories.data.map(c=>[c.id,c]));
 // A regional leader's FO envelope spans multiple states. Do not expose even
 // exception IDs for out-of-scope sessions through state-scoped reports.
 const scopedSessions=Array.isArray(profile._retailRoleStates)
  ? normalized.filter(s=>canonicalActivityStore(snapshot.stores,s))
  : normalized;
 return {...range,...completedTrainingReport(scopedSessions.map(s=>({...s,category:categoryById.get(s.category_id),trainer_name:s.trainer_name_snapshot})),snapshot.stores,{state:input.state,store:input.store}),complete:true};
}

export async function retailModuleDashboard(client,profile,input={}) {
 assertRetailAccess(profile,'dashboard');
 if(profile.is_active===false||['INACTIVE','DISABLED'].includes(String(profile.status||'').toUpperCase()))throw fail(403,'Active Retail access required.');
 const range=moduleReportRange(input);
 if(range.from!==range.to.slice(0,7)+'-01'||range.to>indiaToday())throw fail(400,'Select a month-to-date or historical monthly reporting period.');
 const snapshot=await authorizedSnapshot(client,profile,range),modules={};
 const unavailable=reason=>({status:'unavailable',reason});
 try{
  const scope=attendanceAccess(profile),stores=snapshot.stores.filter(s=>canonicalActivityStore(snapshot.stores,{retail_store_id:s.id,store_code:s.store_code})&&(!scope.state||stateLabel(s.state)===scope.state));
  const ids=new Set(stores.map(s=>s.id));
  const summary=summarizeAttendance({stores,attendance:(snapshot.attendance||[]).filter(r=>ids.has(r.retail_store_id)),aop:(snapshot.aop||[]).filter(r=>ids.has(r.retail_store_id)),cutoff:range.to});
  modules.attendance={status:'ready',rows:summary.states,total:summary.total};
 }catch{modules.attendance=unavailable('Attendance is unavailable in this authorized scope.');}
 try{
  assertRetailAccess(profile,'deepCleaning');const report=await cleaningFromSnapshot(client,profile,snapshot,range);
  modules.cleaning={status:'ready',rows:report.summary.rows,stores:report.summary.stores,
   schedule_available:report.summary.schedule_available,identity_exceptions:report.exceptions.length};
  modules.cleaning.submitted_reports=submittedCleaningReport(snapshot,range);
 }catch{modules.cleaning=unavailable('Deep Cleaning is unavailable in this authorized scope.');}
 const trainingRead=(async()=>{try{
  const report=await reportRead('dashboard.completed_training',()=>retailCompletedTraining(client,profile,range,snapshot));
  modules.technical={status:'ready',rows:report.states.map(r=>({state:r.state,completed:r.mepc})),identity_exceptions:report.exceptions.length};
  modules.soft={status:'ready',rows:report.states.map(r=>({state:r.state,completed:r.hk})),identity_exceptions:report.exceptions.length};
 }catch{modules.technical=modules.soft=unavailable('Completed Training is unavailable in this authorized scope or its reporting dependency failed.');}})();
 const operationsRead=(async()=>{try{
  const {source,month}=await reportRead('dashboard.operations_source',()=>retailOperationsSource(client,profile,'maintenance',{month:range.from.slice(0,7)}));
  const current={...source,calls:source.calls.filter(c=>c.completed_on<=range.to),thermography:source.thermography.filter(t=>t.scheduled_date<=range.to)};
  const maintenance=maintenanceReport(current,month),thermography=thermographyReport(current,month);
  modules.cm=maintenance.modules.cm;modules.pm=maintenance.modules.pm;
  modules.thermography={status:'ready',rows:thermography.states};
 }catch(e){for(const key of ['cm','pm','thermography'])modules[key]=unavailable(e.statusCode===503?e.message:'Operational data is unavailable in this authorized scope.');}})();
 // Workbook-reported state aggregates are historical, not canonical completion or OOS orders.
 // State totals can exceed a single FO/store's authorization; expose to platform admin only.
 let historical_ifms=null;
 const historicalRead=(async()=>{if(retailAccess({...profile,business:''}).allowed&&range.from==='2026-10-01'&&range.to>='2026-10-28'){
  try{
   const result=await client.from('retail_ifms_historical_summary')
    .select('source_filename,source_sha256,snapshot_date,module,reporting_state,source_rows,distinct_store_codes,metrics,source_class')
    .gte('snapshot_date',range.from).lte('snapshot_date',range.to)
    .order('snapshot_date',{ascending:false}).limit(100);
   if(result.error)throw result.error;
   const authorizedStates=new Set(snapshot.stores.map(store=>reportingState(store.state)));
   const rows=(result.data||[]).filter(record=>authorizedStates.has(reportingState(record.reporting_state)));
   historical_ifms=rows.length?{status:'ready',snapshot_date:rows[0].snapshot_date,
    source_filename:rows[0].source_filename,source_class:'EXCEL_REPORTED_HISTORICAL_UNVERIFIED',
    rows:rows.map(record=>({...record,state:reportingState(record.reporting_state)}))}:null;
  }catch{
   historical_ifms={status:'unavailable',rows:[]};
  }
 }
 })();
 await Promise.all([trainingRead,operationsRead,historicalRead]);
 return {...range,updated_at:new Date().toISOString(),stores:snapshot.stores.map(({id,store_code,store_name,state})=>({id,store_code,store_name,state})),modules,historical_ifms};
}
