import test from 'node:test';
import assert from 'node:assert/strict';
import {loadWebTrainingSetup} from '../services/trainingWebService.js';
import {retailMisApiAllowed} from '../shared/retailMisAccess.js';

const actor={id:'actor',employee_code:'M1',role:'MIS_MEPC',business:'Reliance Retail',is_active:true,status:'Active',web_access_enabled:true};
const input={store_code:'S1',trainer_employee_code:'FO1',training_date:'2026-11-27'};
function fixture({gate,trainerAllowed=true}={}) {
  const calls=[];
  const data={reliance_retail_store_master:{id:'store',store_code:'S1',store_name:'Synthetic',state:'TN'},profiles:{id:'fo',employee_code:'FO1',full_name:'Synthetic trainer'},training_categories:{id:'mep',code:'technical_mep'},training_types:[{id:'type',name:'Toolbox'}],training_topics:[{id:'topic',module_name:'Existing topic'}]};
  return {calls,client:{from(table){calls.push(table);const query={select(){return this;},eq(){return this;},order(){return this;},maybeSingle:async()=>({data:data[table]}),then(resolve){return Promise.resolve({data:data[table]}).then(resolve);}};return query;},async rpc(name,args){calls.push({name,args});return name==='training_v2_assert_web'?{error:gate}: {data:trainerAllowed};}}};
}
test('Web setup binds authenticated actor, gate, scoped store, real trainer and existing MEPC masters',async()=>{
  for(const role of ['MIS_MEPC','Operations Manager','Admin']) {
    const {client,calls}=fixture();const result=await loadWebTrainingSetup(client,{...actor,role},input);
    assert.equal(result.store.id,'store');assert.equal(result.trainer.id,'fo');assert.equal(result.category.code,'technical_mep');
    assert.deepEqual(calls.find(c=>c.name==='training_v2_assert_web').args,{p_actor:'actor',p_store:'store',p_date:input.training_date});
    assert.ok(calls.indexOf('profiles')>calls.findIndex(c=>c.name==='training_v2_assert_web'));
  }
});
test('HK MIS, Branch Head, KAM, FO, inactive and Web-disabled actors cannot perform setup',async()=>{
  for(const p of ['MIS_HK','Branch Head','KAM','FO'].map(role=>({...actor,role})).concat([{...actor,is_active:false},{...actor,web_access_enabled:false}])) {
    const {client,calls}=fixture();await assert.rejects(()=>loadWebTrainingSetup(client,p,input),{statusCode:403});assert.equal(calls.length,0);
  }
});
test('gate/scope denial returns no trainer or master data; neither is inferred from a reporting label',async()=>{
  for(const message of ['training_web_release_disabled','training_web_scope_forbidden']) {
    const {client,calls}=fixture({gate:{code:'42501',message}});
    await assert.rejects(()=>loadWebTrainingSetup(client,actor,input),{statusCode:403});
    assert.equal(calls.includes('profiles'),false);assert.equal(calls.includes('training_topics'),false);
  }
  const {client}=fixture({trainerAllowed:false});await assert.rejects(()=>loadWebTrainingSetup(client,actor,input),{statusCode:400});
});
test('forged source, uploader, invalid dates and fake attendance are rejected before lookup',async()=>{
  for(const value of [{...input,p_actor:'forged'},{...input,submission_source:'Mobile'},{...input,attendance_id:'fake'},{...input,training_date:'2026-02-30'}]) {
    const {client,calls}=fixture();await assert.rejects(()=>loadWebTrainingSetup(client,actor,value),{statusCode:400});assert.equal(calls.length,0);
  }
});
test('MIS exception is limited to exact Web setup/session paths and existing session contracts',()=>{
  for(const path of ['/api/training/web/setup','/api/training/web/sessions'])assert.equal(retailMisApiAllowed(actor,path),true);
  for(const path of ['/api/training/web/setup-unsafe','/api/training/web/sessions-unsafe','/api/training/administration/fo/categories','/api/admin/users'])assert.equal(retailMisApiAllowed(actor,path),false);
  assert.equal(retailMisApiAllowed({...actor,role:'MIS_HK'},'/api/training/web/setup'),false);
});
