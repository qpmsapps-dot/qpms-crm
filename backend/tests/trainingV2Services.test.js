import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {readTrainingEntitlements,saveTrainingEntitlements} from '../services/trainingEntitlementService.js';
import {createWebTrainingSession} from '../services/trainingWebService.js';
import {createTrainingRouter} from '../routes/trainingRoutes.js';
import {retailMisApiAllowed} from '../shared/retailMisAccess.js';
import {assertTrainingCategory} from '../services/trainingAccessService.js';

const admin={id:'d40c2b3f-87f1-4c34-8798-cf9b0d9ca784',auth_user_id:'79cd196c-c6f3-404a-b22a-d4683afefa3f',employee_code:'QPMSADMIN',role:'Admin',is_active:true,status:'Active',web_access_enabled:true};
const fo={id:'fo',auth_user_id:'auth',role:'FO',business:'Reliance Retail',employee_code:'FO1',is_active:true,status:'Active'};
test('entitlement admin binds exact active identity and never trusts an actor in the payload',async()=>{
 const calls=[],client={rpc:async(name,args)=>{calls.push({name,args});return {data:{categories:[],history:[]}};}};
 for(const actor of [fo,{...admin,id:'forged'},{...admin,auth_user_id:'foreign'},{...admin,web_access_enabled:false},{...admin,is_active:false}])await assert.rejects(()=>readTrainingEntitlements(client,actor,fo.id),{statusCode:403});
 assert.equal(calls.length,0);
 const input={changes:[{code:'hk',active:false,expected_revision:7}],reason:'Approved revocation'};
 await saveTrainingEntitlements(client,admin,fo.id,input);assert.deepEqual(calls[0].args,{p_actor:admin.id,p_target:fo.id,p_changes:input.changes,p_reason:input.reason});
 for(const body of [{...input,p_actor:'forged'},{...input,changes:[{code:'other',active:true,expected_revision:0}]},{...input,changes:[{code:'hk',active:'true',expected_revision:0}]},{...input,changes:[{code:'hk',active:true,expected_revision:-1}]},{...input,reason:''}])await assert.rejects(()=>saveTrainingEntitlements(client,admin,fo.id,body),{statusCode:400});
});
test('FO categories are explicit; designation, department and business grant nothing',()=>{
 for(const categories of [[],['hk'],['technical_mep'],['hk','technical_mep']])for(const code of ['hk','technical_mep']){
  const p={...fo,department:'Operations',designation:'MEPC FO',trainingCategories:categories};
  if(categories.includes(code))assert.doesNotThrow(()=>assertTrainingCategory(p,code));else assert.throws(()=>assertTrainingCategory(p,code),{statusCode:403});
 }
 for(const role of ['KAM','Branch Head','Operations Manager','MIS_MEPC'])assert.throws(()=>assertTrainingCategory({...fo,role,trainingCategories:['technical_mep']},'technical_mep'),{statusCode:403});
});
test('web contract sends authenticated uploader and actual trainer separately; dates and forged source rejected',async()=>{
 const calls=[],client={rpc:async(name,args)=>{calls.push({name,args});return {data:name==='rpc_create_reliance_training_web_v2'?'session':[{id:'session'},{id:'possible-overlap'}]};}};
 const input={retail_store_id:'store',training_date:'2026-11-26',training_type_id:'type',actual_trainer_profile_id:'trainer',creation_key:'durable-key'};
 const result=await createWebTrainingSession(client,fo,input);assert.equal(calls[0].args.p_actor,fo.id);assert.equal(calls[0].args.p_trainer,'trainer');assert.deepEqual(result.duplicate_candidates,[{id:'possible-overlap'}]);
 for(const bad of [{...input,submission_source:'Mobile'},{...input,attendance_id:'fake'},{...input,training_date:'2026-02-30'},{...input,training_date:'2026-99-01'}])await assert.rejects(()=>createWebTrainingSession(client,fo,bad),{statusCode:400});
 await assert.rejects(()=>createWebTrainingSession({rpc:async()=>({error:{code:'42501',message:'training_web_release_disabled'}})},fo,input),{statusCode:403});
});
test('MIS API restriction opens only protected Training routes for MEPC-MIS',()=>{
 assert.equal(retailMisApiAllowed({role:'MIS_MEPC'},'/api/training/web/sessions'),true);
 assert.equal(retailMisApiAllowed({role:'MIS_MEPC'},'/api/training/administration/fo/categories'),false);
 assert.equal(retailMisApiAllowed({role:'MIS_HK'},'/api/training/web/sessions'),false);
 assert.equal(retailMisApiAllowed({role:'MIS_MEPC'},'/api/admin/users'),false);
});
test('mounted entitlement endpoint is authenticated and rejects non-admin without an RPC',async()=>{
 let rpcCalls=0;const app=express();app.use(express.json());app.use('/api/training',createTrainingRouter({requireAuth:(req,res,next)=>{req.profile=fo;next();},getClient:()=>({rpc:async()=>{rpcCalls++;return {data:{}};}})}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{const r=await fetch(`http://127.0.0.1:${server.address().port}/api/training/administration/fo/categories`);assert.equal(r.status,403);assert.equal(rpcCalls,0);}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
