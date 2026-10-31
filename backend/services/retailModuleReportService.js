import {unifiedSnapshot} from './retailUnifiedService.js';
import {assertRetailAccess} from './relianceRetailManagementService.js';
import {canonicalActivityStore,cleaningReport,completedTrainingReport} from '../shared/retailModuleReports.js';
import {resolveTrainingReadScope,RELIANCE_TRAINING_CLIENT_ID} from './trainingAccessService.js';
import {retailTrainingEnvelopeIds,applyRetailTrainingStoreScope} from './retailTrainingReadScopeService.js';
import {indiaToday,validDate,stateLabel,summarizeAttendance} from '../shared/retailAttendance.js';
import {attendanceAccess} from './retailAttendanceService.js';
import {CLIENT_DEEP_CLEANING_BUCKET,buildClientDeepCleaningStoragePath,verifyClientDeepCleaningStorageObject} from './clientDeepCleaningService.js';
import {retailOperationsSource} from './retailOperationsService.js';
import {maintenanceReport,thermographyReport} from '../shared/retailOperations.js';
const fail=(statusCode,message)=>Object.assign(Error(message),{statusCode});
export function moduleReportRange(input={}) {
 let to,from;try{to=validDate(input.to||indiaToday());from=validDate(input.from||to.slice(0,7)+'-01');}catch{throw fail(400,'Select valid reporting dates.');}
 if(to<from||(Date.parse(to)-Date.parse(from))/86400000>366)throw fail(400,'Select a reporting range up to 366 days.');
 return {from,to};
}
async function authorizedSnapshot(client,profile,range){
 try{return await unifiedSnapshot(client,profile,range);}catch(e){
  if(['PGRST202','42P01','42883'].includes(e.code))throw fail(503,'Existing Retail reporting infrastructure awaits separate authorized database setup.');
  if(e.code==='42501')throw fail(403,'Verified Retail state/store permission required.');throw e;
 }
}
export async function retailCleaningReport(client,profile,input={}) {
 assertRetailAccess(profile,'deepCleaning');
 if(profile.is_active===false||['INACTIVE','DISABLED'].includes(String(profile.status||'').toUpperCase()))throw fail(403,'Active Retail access required.');
 const range=moduleReportRange(input),snapshot=await authorizedSnapshot(client,profile,range);
 return {...range,...cleaningReport(snapshot,{state:input.state,store:input.store,to:range.to}),stores:snapshot.stores.map(({id,store_code,store_name,state})=>({id,store_code,store_name,state}))};
}
export async function retailCleaningEvidence(client,profile,id,input={}) {
 // Recheck the authenticated actor's canonical state/store scope before signing anything.
 const report=await retailCleaningReport(client,profile,input);
 const submission=report.submissions.find(s=>s.id===id);
 if(!submission)throw fail(403,'Submission is outside the authorized report scope.');
 const prefix=buildClientDeepCleaningStoragePath({submission:{...submission,store_code:submission.store_code||submission.store.store_code},uploadType:'before',mimeType:'image/jpeg',id:'prefix'}).split('/').slice(0,-2).join('/')+'/';
 const {data,error}=await client.from('client_deep_cleaning_uploads').select('id,submission_id,upload_type,storage_bucket,storage_path,original_filename,mime_type,file_size').eq('submission_id',id).eq('upload_status','uploaded').order('id').limit(101);
 if(error)throw error;if(data.length>100)throw fail(413,'This submission exceeds the evidence viewing limit.');
 const uploads=[];
 for(const row of data){
  if(row.storage_bucket!==CLIENT_DEEP_CLEANING_BUCKET||!row.storage_path||!['image/jpeg','image/png','image/webp','application/pdf'].includes(row.mime_type))continue;
  if(!row.storage_path.startsWith(prefix)||row.storage_path.split('/').some(p=>p==='..'||p==='.'||p.includes('\\')))throw fail(409,'Recorded evidence path is outside this submission.');
  await verifyClientDeepCleaningStorageObject(client,CLIENT_DEEP_CLEANING_BUCKET,row.storage_path,row.file_size==null?null:Number(row.file_size));
  const signed=await client.storage.from(CLIENT_DEEP_CLEANING_BUCKET).createSignedUrl(row.storage_path,600);
  if(signed.error)throw signed.error;
  uploads.push({id:row.id,type:row.upload_type,name:row.original_filename,mime_type:row.mime_type,url:signed.data.signedUrl});
 }
 return uploads;
}

export async function retailCompletedTraining(client,profile,input={},existingSnapshot=null) {
 assertRetailAccess(profile,'training');
 const range=moduleReportRange(input),scope=await resolveTrainingReadScope(client,profile);
 const snapshot=existingSnapshot||await authorizedSnapshot(client,profile,range);
 const ids=await retailTrainingEnvelopeIds(client,[...scope.employeeCodes]),sessions=new Map();
 // Bounded ID batches preserve the existing employee-envelope and verified HK store scope.
 // No 200-row UI cap is used for period totals, and no training mutation workflow changes.
 for(let start=0;start<ids.length;start+=200){
  let q=client.from('training_sessions').select('id,retail_store_id,store_code_snapshot,state_snapshot,training_date,status,category_id,submitted_at,trainer_name_snapshot')
   .eq('access_client_id',RELIANCE_TRAINING_CLIENT_ID).eq('access_client_code','reliance_retail').in('id',ids.slice(start,start+200))
   .in('status',['submitted','completed']).gte('training_date',range.from).lte('training_date',range.to).order('id').range(0,199);
  if(scope.retailScope)q=applyRetailTrainingStoreScope(q,scope.retailScope);
  const {data,error}=await q;if(error)throw error;for(const s of data||[])sessions.set(s.id,s);
 }
 const values=[...sessions.values()],categoryIds=[...new Set(values.map(s=>s.category_id))];
 const categories=categoryIds.length?await client.from('training_categories').select('id,code').in('id',categoryIds):{data:[]};if(categories.error)throw categories.error;
 const categoryById=new Map(categories.data.map(c=>[c.id,c]));
 return {...range,...completedTrainingReport(values.map(s=>({...s,category:categoryById.get(s.category_id),trainer_name:s.trainer_name_snapshot})),snapshot.stores,{state:input.state,store:input.store}),complete:true};
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
  assertRetailAccess(profile,'deepCleaning');const report=cleaningReport(snapshot),groups=new Map();
  if(report.schedules===null)modules.cleaning=unavailable('Deep Cleaning schedule infrastructure is unavailable.');
  else{
   for(const r of report.schedules){if(r.display_status==='Cancelled')continue;const g=groups.get(r.reporting_state)||{state:r.reporting_state,scheduled:0,completed:0,not_completed:0,pending:0,remaining:0};g.scheduled++;if(r.display_status==='Completed')g.completed++;if(r.display_status==='Not Completed')g.not_completed++;if(r.display_status==='Scheduled')g.pending++;g.remaining=g.scheduled-g.completed;groups.set(g.state,g);}
   modules.cleaning={status:'ready',rows:[...groups.values()],identity_exceptions:report.exceptions.length};
  }
 }catch{modules.cleaning=unavailable('Deep Cleaning is unavailable in this authorized scope.');}
 try{
  const report=await retailCompletedTraining(client,profile,range,snapshot);
  modules.technical={status:'ready',rows:report.states.map(r=>({state:r.state,completed:r.mepc})),identity_exceptions:report.exceptions.length};
  modules.soft={status:'ready',rows:report.states.map(r=>({state:r.state,completed:r.hk})),identity_exceptions:report.exceptions.length};
 }catch{modules.technical=modules.soft=unavailable('Completed Training is unavailable in this authorized scope or its reporting dependency failed.');}
 try{
  const {source,month}=await retailOperationsSource(client,profile,'maintenance',{month:range.from.slice(0,7)});
  const current={...source,calls:source.calls.filter(c=>c.completed_on<=range.to),thermography:source.thermography.filter(t=>t.scheduled_date<=range.to)};
  const maintenance=maintenanceReport(current,month),thermography=thermographyReport(current,month);
  modules.cm=maintenance.modules.cm;modules.pm=maintenance.modules.pm;
  modules.thermography={status:'ready',rows:thermography.states};
 }catch(e){for(const key of ['cm','pm','thermography'])modules[key]=unavailable(e.statusCode===503?e.message:'Operational data is unavailable in this authorized scope.');}
 return {...range,updated_at:new Date().toISOString(),stores:snapshot.stores.map(({id,store_code,store_name,state})=>({id,store_code,store_name,state})),modules};
}
