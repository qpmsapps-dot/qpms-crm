import test from 'node:test';
import assert from 'node:assert/strict';
import {persistCanonicalKmV2} from '../services/foKmV2PersistenceService.js';
import {processKmReconciliationJobs} from '../services/foKmReconciliationWorker.js';
import {buildIncrementalKmPlan} from '../services/foKmIncrementalReconciliationService.js';
const env={KM_CANONICAL_POLICY_ENABLED:'true',KM_SHARED_RECONCILIATION_ENABLED:'true',KM_INCREMENTAL_REPORTING_ENABLED:'true',END_DAY_KM_AUTO_RECALC_ENABLED:'true',KM_FINANCIAL_WRITES_EMERGENCY_PAUSE:'false',KM_FINANCIAL_WRITES_MAINTENANCE:'true'};
test('Admin and all automatic triggers use only policy validator while maintenance remains enabled',async()=>{
 for(const trigger of ['admin_recalculation','manual_end_day','auto_end_day','late_gps']){
  const calls=[];const r=await persistCanonicalKmV2({rpc:async(name,args)=>{calls.push({name,args});return {data:{receipt_id:'receipt',additionalKm:6.25}};}},{attendanceId:'attendance',calculation:{incrementalRecovery:true},sourceEntryPoint:trigger,adminAuthorization:trigger==='admin_recalculation'?{userId:'admin'}:null,actorSource:trigger==='admin_recalculation'?null:'lease',environment:env});
  assert.equal(r.additionalKm,6.25);assert.equal(calls[0].name,'rpc_reconcile_fo_policy_km_v1');assert.equal(calls[0].args.p_trigger,trigger);
 }
});
test('policy emergency true/unset blocks before any RPC and workers do not claim',async()=>{
 for(const value of ['true',undefined,'invalid']){
  const e={...env,KM_FINANCIAL_WRITES_EMERGENCY_PAUSE:value};const db={rpc(){throw Error('RPC forbidden');}};
  await assert.rejects(persistCanonicalKmV2(db,{calculation:{incrementalRecovery:true},environment:e}),x=>x.code==='KM_FINANCIAL_WRITES_MAINTENANCE');
  assert.equal((await processKmReconciliationJobs(db,{environment:e})).processed,0);
 }
});
test('missing policy DB dependency does not fall back to another financial RPC',async()=>{
 const calls=[];await assert.rejects(persistCanonicalKmV2({rpc:async name=>{calls.push(name);return {error:{code:'PGRST202',message:'Policy unavailable'}};}},{calculation:{incrementalRecovery:true},environment:env}),e=>e.code==='PGRST202');assert.deepEqual(calls,['rpc_reconcile_fo_policy_km_v1']);
});
test('policy worker uses attested claim and passes exact lease; unresolved-only work completes without false posting',async()=>{
 const calls=[];const db={rpc:async(name,args)=>{calls.push({name,args});return name==='rpc_fo_km_attendance_authorization_version_v1'?{data:246}:name==='rpc_claim_fo_policy_km_v1'?{data:{attendance_id:'a',lease:'trusted-lease',trigger_source:'auto_end_day',generation:1,claimed_generation:1,authorization_version:246,authorization_reference:'VERIFIED_ATTENDANCE'}}:{data:null};}};
 const result=await processKmReconciliationJobs(db,{environment:env,limit:1,reconcile:async(c,p,o)=>{assert.equal(o.actorSource,'trusted-lease');assert.equal(o.trigger,'auto_end_day');assert.equal(o.maxGoogleDirectionsCalls,0);return {status:'partial_unresolved',financial_posted:false};}});
 assert.equal(result.results[0].financial_posted,false);assert.equal(calls[2].args.p_posted,true);assert.equal(calls[2].args.p_error,'unchanged');
});
test('finish failure is not silently reported as successful queue completion',async()=>{
 const db={rpc:async name=>name==='rpc_fo_km_attendance_authorization_version_v1'?{data:246}:name==='rpc_claim_fo_policy_km_v1'?{data:{attendance_id:'a',lease:'l',trigger_source:'manual_end_day',generation:1,claimed_generation:1,authorization_version:246,authorization_reference:'VERIFIED_ATTENDANCE'}}:{error:{code:'NETWORK_ERROR'}}};
 await assert.rejects(processKmReconciliationJobs(db,{environment:env,limit:1,reconcile:async()=>({status:'posted',financial_posted:true})}),e=>e.code==='NETWORK_ERROR');
});
test('settled receipts and P1 supplements are counted once in existing/projected payable',()=>{
 const attendance={id:'a',total_approved_km:0,petrol_amount:0};
 const e={attendance,snapshots:[],visits:[],corrections:[],recoveries:[{approved_additional_km:2}],originalRows:[]};
 const p=buildIncrementalKmPlan(e,{travel_legs:[]},[{added_km:6.25,applied_to_attendance:false}]);
 assert.equal(p.existingPayableKm,8.25);assert.equal(p.finalPayableKm,8.25);assert.equal(p.additionalKm,0);
});

test('policy worker requires installed attendance authorization before claiming, with no legacy fallback',async()=>{
 for(const response of [{error:{code:'PGRST202'}},{data:241},{data:null}]){
  const calls=[];const db={rpc:async name=>{calls.push(name);return response;}};
  await assert.rejects(processKmReconciliationJobs(db,{environment:env}),e=>['KM_SHARED_SCHEMA_UNAVAILABLE','KM_ATTENDANCE_AUTHORIZATION_REQUIRED'].includes(e.code));
  assert.deepEqual(calls,['rpc_fo_km_attendance_authorization_version_v1']);
 }
});
test('a malformed authorization response never reaches the canonical calculation',async()=>{
 const calls=[];const db={rpc:async name=>{calls.push(name);return {data:name==='rpc_fo_km_attendance_authorization_version_v1'?246:{attendance_id:'a',lease:'l',generation:2,claimed_generation:1,authorization_version:246,authorization_reference:'VERIFIED_ATTENDANCE'}};}};
 await assert.rejects(processKmReconciliationJobs(db,{environment:env,reconcile(){throw Error('Must not calculate');}}),e=>e.code==='KM_ATTENDANCE_AUTHORIZATION_REQUIRED');
 assert.deepEqual(calls,['rpc_fo_km_attendance_authorization_version_v1','rpc_claim_fo_policy_km_v1']);
});
