import test from 'node:test';
import assert from 'node:assert/strict';
import {assertMobileManagementActor,createMobileManagementSession,loadMobileManagementSetup,todayInIndia} from '../services/trainingMobileManagementService.js';
import {trainingSubmissionChannel,withTrainingChannels} from '../services/trainingSubmissionChannel.js';
import {createWebTrainingSession} from '../services/trainingWebService.js';
import {retailMisApiAllowed} from '../shared/retailMisAccess.js';

const actor={id:'authenticated-uploader',employee_code:'SYN-MIS',auth_user_id:'verified-auth',role:'MIS_MEPC',business:'Reliance Retail',is_active:true,status:'Active',mobile_access_enabled:true,web_access_enabled:true};
const input={retail_store_id:'store',training_date:todayInIndia(),training_type_id:'type',actual_trainer_profile_id:'actual-trainer',creation_key:'durable-identity'};
test('mobile setup reuses scoped management store/trainer validation and adds its own server gate',async()=>{
  const calls=[];
  let disabled=false;
  const values={reliance_retail_store_master:{id:'store'},profiles:{id:'trainer'},training_categories:{id:'mepc'},training_types:[],training_topics:[]};
  const client={rpc:async(name,args)=>{calls.push({name,args});return disabled&&name==='rpc_training_mobile_management_setup_allowed_v3'?{error:{code:'42501',message:'training_mobile_management_release_disabled'}}:{data:true};},from:table=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:values[table]}),order:async()=>({data:values[table]})})};
  const query={store_code:'SYN-STORE',trainer_employee_code:'SYN-TRAINER',training_date:todayInIndia()};
  const result=await loadMobileManagementSetup(client,actor,query);assert.equal(result.store.id,'store');
  assert.deepEqual(calls.map(c=>c.name),['training_v2_assert_web','training_retail_actor_v4','rpc_training_mobile_management_setup_allowed_v3']);
  assert.deepEqual(calls[2].args,{p_actor:actor.id,p_store:'store',p_date:query.training_date});
  disabled=true;await assert.rejects(()=>loadMobileManagementSetup(client,actor,query),{statusCode:403});
  await assert.rejects(()=>loadMobileManagementSetup(client,actor,{...query,submission_source:'Mobile'}),{statusCode:400});
});
test('only active mobile-enabled MEPC MIS and OM enter management creation; no designation fallback',()=>{
  for(const role of ['MIS_MEPC','Operations Manager'])assert.doesNotThrow(()=>assertMobileManagementActor({...actor,role}));
  for(const role of ['FO','MIS_HK','Branch Head','KAM','Admin','MEPC-MIS','MIS'])assert.throws(()=>assertMobileManagementActor({...actor,role,designation:'Operations Manager'}),{statusCode:403});
  for(const patch of [{mobile_access_enabled:false},{mobile_access_enabled:null},{web_access_enabled:false},{is_active:false},{status:'Inactive'}])assert.throws(()=>assertMobileManagementActor({...actor,...patch}),{statusCode:403});
});
test('dedicated contract binds uploader, actual trainer, today and original durable key without FO context',async()=>{
  const calls=[],client={rpc:async(name,args)=>{calls.push({name,args});return {data:name==='rpc_create_reliance_training_mobile_management_v3'?'session':[{id:'session'},{id:'overlap'}]};}};
  const result=await createMobileManagementSession(client,actor,input);
  assert.equal(calls[0].name,'rpc_create_reliance_training_mobile_management_v3');
  assert.deepEqual(calls[0].args,{p_actor:actor.id,p_store:'store',p_date:input.training_date,p_type:'type',p_trainer:'actual-trainer',p_key:'durable-identity',p_remarks:null});
  assert.deepEqual(result,{id:'session',submission_channel:'Mobile Management',duplicate_candidates:[{id:'overlap'}]});
  for(const extra of ['attendance_id','site_visit_id','submission_source','uploader_profile_id','submission_channel','p_actor'])await assert.rejects(()=>createMobileManagementSession(client,actor,{...input,[extra]:'forged'}),{statusCode:400});
});
test('IST midnight, historical/future dates, missing migration and disabled gate fail closed',async()=>{
  assert.equal(todayInIndia(new Date('2026-11-27T18:29:59Z')),'2026-11-27');
  assert.equal(todayInIndia(new Date('2026-11-27T18:30:00Z')),'2026-11-28');
  const unavailable={rpc:async()=>({error:{code:'42501',message:'training_mobile_management_release_disabled'}})};
  await assert.rejects(()=>createMobileManagementSession(unavailable,actor,input),{statusCode:403});
  for(const date of ['2020-01-01','2099-01-01','invalid'])await assert.rejects(()=>createMobileManagementSession(unavailable,actor,{...input,training_date:date}),{statusCode:400});
  await assert.rejects(()=>createWebTrainingSession(unavailable,actor,{...input,creation_key:'mm3:forged'}),{statusCode:400});
});
test('MIS route exception admits exact management routes and never operational APIs',()=>{
  for(const path of ['/api/training/mobile-management/setup','/api/training/mobile-management/sessions'])assert.equal(retailMisApiAllowed(actor,path),true);
  for(const path of ['/api/training/mobile-management/permissions','/api/fo/attendance','/api/fo/km','/api/admin/users'])assert.equal(retailMisApiAllowed(actor,path),false);
  assert.equal(retailMisApiAllowed({...actor,role:'MIS_HK'},'/api/training/mobile-management/sessions'),false);
});
test('channel is derived from atomic audit provenance and never rewrites historical unknown sessions',async()=>{
  const event={training_session_id:'management',event_type:'management_mobile_created_v3',metadata:{submission_channel:'Mobile Management'}};
  const records=[{id:'management',submission_source:'Web'},{id:'web',submission_source:'Web'},{id:'fo',submission_source:'Mobile'},{id:'historic'}];
  assert.equal(trainingSubmissionChannel(records[1],[event]),'Web');
  const client={from:table=>{assert.equal(table,'training_events');return {select:()=>({in:(key,ids)=>{assert.deepEqual(ids,['management','web']);return {eq:async()=>({data:[event]})};}})};}};
  assert.deepEqual((await withTrainingChannels(client,records)).map(s=>s.submission_channel),['Mobile Management','Web','FO Mobile','Unknown']);
  await assert.rejects(()=>withTrainingChannels({from:()=>({select:()=>({in:()=>({eq:async()=>({error:Error('provenance unavailable')})})})})},records),/provenance unavailable/);
});
