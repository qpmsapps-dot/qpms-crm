import test from 'node:test';
import assert from 'node:assert/strict';
import {persistCanonicalKmV2} from '../services/foKmV2PersistenceService.js';
import {processKmReconciliationJobs} from '../services/foKmReconciliationWorker.js';

const lease='12345678-1234-4234-a234-123456789abc';
const environment={KM_CANONICAL_AUTOMATION_ENABLED:'true',KM_CANONICAL_POLICY_ENABLED:'true',END_DAY_KM_AUTO_RECALC_ENABLED:'true',KM_SHARED_RECONCILIATION_ENABLED:'true',KM_INCREMENTAL_REPORTING_ENABLED:'true',KM_FINANCIAL_WRITES_EMERGENCY_PAUSE:'true',KM_FINANCIAL_WRITES_MAINTENANCE:'true'};
const calculation={incrementalRecovery:true,calculationVersion:'KM_ENGINE_V2'};
test('ordinary permission never releases legacy or manual financial routes',async()=>{
 const client={rpc(){throw Error('Legacy hold must reject before database access');}};
 await assert.rejects(persistCanonicalKmV2(client,{attendanceId:'a',calculation,sourceEntryPoint:'manual_end_day',actorSource:lease,environment}),{code:'KM_FINANCIAL_WRITES_MAINTENANCE'});
});
test('ordinary persistence rejects an Admin action, missing lease or disabled flag',async()=>{
 const client={rpc(){throw Error('Invalid ordinary action reached RPC');}};
 for(const over of [{adminAuthorization:{userId:'admin'}},{actorSource:null},{sourceEntryPoint:'admin_recalculation'},{environment:{...environment,KM_CANONICAL_AUTOMATION_ENABLED:'false'}}]){
  await assert.rejects(persistCanonicalKmV2(client,{attendanceId:'a',calculation,sourceEntryPoint:'manual_end_day',actorSource:lease,environment,automaticKm:true,...over}),{code:'KM_AUTOMATIC_AUTHORIZATION_REQUIRED'});
 }
});
test('worker requires version 247 and forwards the actual automatic lease under manual holds',async()=>{
 const calls=[];let claims=0,options;
 const client={async rpc(name,args){calls.push({name,args});if(name==='rpc_fo_km_automatic_authorization_version_v1')return{data:247};if(name==='rpc_claim_fo_automatic_km_v1')return{data:claims++?null:{attendance_id:'a',generation:3,claimed_generation:3,lease,trigger_source:'late_gps',authorization_version:247,authorization_reference:'CANONICAL_END_DAY_AUTOMATION'}};if(name==='rpc_finish_fo_km_reconciliation_v1')return{data:null};throw Error(name);}};
 const result=await processKmReconciliationJobs(client,{environment,reconcile:async(_db,_payload,o)=>{options=o;return{status:'partial_unresolved',additionalKm:0,financial_posted:false};}});
 assert.equal(result.processed,1);assert.equal(options.automaticKm,true);assert.equal(options.actorSource,lease);assert.equal(calls.find(c=>c.name==='rpc_finish_fo_km_reconciliation_v1').args.p_error,'partial_unresolved');assert.ok(!calls.some(c=>c.name==='rpc_claim_fo_policy_km_v1'));
 const old={async rpc(){return{data:246}}};await assert.rejects(processKmReconciliationJobs(old,{environment}),{code:'KM_ATTENDANCE_AUTHORIZATION_REQUIRED'});
});
test('application kill switch prevents claims while keeping manual holds enforced',async()=>{
 const result=await processKmReconciliationJobs({rpc(){throw Error('Paused worker claimed a job');}},{environment:{...environment,KM_CANONICAL_AUTOMATION_ENABLED:'false'}});
 assert.equal(result.disabled,true);assert.equal(result.processed,0);
});
