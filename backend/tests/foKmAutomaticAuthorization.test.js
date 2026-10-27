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
 const result=await processKmReconciliationJobs(client,{environment:{...environment,END_DAY_KM_AUTO_RECALC_MAX_GOOGLE_DIRECTIONS_CALLS:'100'},reconcile:async(_db,_payload,o)=>{options=o;return{status:'partial_unresolved',additionalKm:0,financial_posted:false};}});
 assert.equal(result.processed,1);assert.equal(options.automaticKm,true);assert.equal(options.actorSource,lease);assert.equal(options.maxGoogleDirectionsCalls,100);assert.equal(calls.find(c=>c.name==='rpc_finish_fo_km_reconciliation_v1').args.p_error,'partial_unresolved');assert.ok(!calls.some(c=>c.name==='rpc_claim_fo_policy_km_v1'));
 const old={async rpc(){return{data:246}}};await assert.rejects(processKmReconciliationJobs(old,{environment}),{code:'KM_ATTENDANCE_AUTHORIZATION_REQUIRED'});
});
test('application kill switch prevents claims while keeping manual holds enforced',async()=>{
 const result=await processKmReconciliationJobs({rpc(){throw Error('Paused worker claimed a job');}},{environment:{...environment,KM_CANONICAL_AUTOMATION_ENABLED:'false'}});
 assert.equal(result.disabled,true);assert.equal(result.processed,0);
});
test('transient route failures retry even after a supported partial posting; rejected evidence does not',async()=>{
 const temporary={evidence_status:'google_timeout',fallback_reason:'google_timeout',payable:false,decision:'REJECTED',payable_km_allowed:true};
 const cases=[
  ...['google_timeout','google_deadline_exceeded','google_fetch_error','google_unavailable','google_unknown_error','google_over_query_limit','google_http_429','google_http_503'].map(reason=>({name:reason,legs:[{...temporary,evidence_status:reason,fallback_reason:reason}],retry:true})),
  ...['google_zero_results','google_disabled','google_key_missing','google_request_denied','google_call_limit'].map(reason=>({name:reason,legs:[{...temporary,evidence_status:reason,fallback_reason:reason}],retry:false})),
  ...['recorded_leg_window_requires_review','persisted_overlap_requires_review','applied_correction_preserved','baseline_inclusion_unknown','supplement_overlap_requires_review'].map(reason=>({name:reason,legs:[{...temporary,evidence_status:reason}],retry:false})),
  {name:'reason outranks provider detail',legs:[{reason:'persisted_boundaries_require_review',fallback_reason:'google_timeout'}],retry:false},
  {name:'unknown baseline',legs:[temporary],baselineKnown:false,retry:false},
  {name:'explicit non-payable policy',legs:[{...temporary,payable_km_allowed:false}],retry:false},
  {name:'checkout needs approval',legs:[{...temporary,review_flags:['CHECKOUT_ELIGIBILITY_REVIEW_REQUIRED']}],retry:false},
  {name:'independent transient leg can retry alongside a rejected leg',legs:[{...temporary,evidence_status:'recorded_leg_window_requires_review'},temporary],retry:true},
 ];
 for(const {name,legs,baselineKnown=true,retry}of cases){
  let claims=0,finish;
  const client={async rpc(name,args){if(name==='rpc_fo_km_automatic_authorization_version_v1')return{data:247};if(name==='rpc_claim_fo_automatic_km_v1')return{data:claims++?null:{attendance_id:'a',generation:1,claimed_generation:1,lease,trigger_source:'manual_end_day',authorization_version:247,authorization_reference:'CANONICAL_END_DAY_AUTOMATION'}};finish=args;return{data:null};}};
  await processKmReconciliationJobs(client,{environment,reconcile:async()=>({status:'posted',financial_posted:true,baselineKnown,unresolved:legs})});
  assert.equal(finish.p_posted,!retry,name);assert.equal(finish.p_error,retry?'KM_ROUTING_RETRYABLE':null,name);
 }
});
test('routing retries without a posting remain deferred and road budgets are fail-closed outside ordinary automation',async()=>{
 for(const [budget,expected]of [['100',100],['2.9',2],['invalid',0],['-1',0],['Infinity',0]]){
  let claimed=false,finish,options;
  const client={async rpc(name,args){if(name==='rpc_fo_km_automatic_authorization_version_v1')return{data:247};if(name==='rpc_claim_fo_automatic_km_v1')return{data:claimed?null:(claimed=true,{attendance_id:'a',generation:1,claimed_generation:1,lease,trigger_source:'late_gps',authorization_version:247,authorization_reference:'CANONICAL_END_DAY_AUTOMATION'})};finish=args;return{data:null};}};
  await processKmReconciliationJobs(client,{environment:{...environment,END_DAY_KM_AUTO_RECALC_MAX_GOOGLE_DIRECTIONS_CALLS:budget},reconcile:async(_db,_payload,o)=>{options=o;return{status:'partial_unresolved',financial_posted:false,unresolved:[{evidence_status:'google_http_503'}]};}});
  assert.equal(options.maxGoogleDirectionsCalls,expected);assert.equal(finish.p_posted,false);assert.equal(finish.p_error,'KM_ROUTING_RETRYABLE');
 }
 let options;
 const client={async rpc(name){if(name==='rpc_fo_km_attendance_authorization_version_v1')return{data:246};if(name==='rpc_claim_fo_policy_km_v1')return{data:{attendance_id:'a',generation:1,claimed_generation:1,lease,trigger_source:'manual_end_day',authorization_version:246,authorization_reference:'SCOPED_TEST_246'}};return{data:null};}};
 await processKmReconciliationJobs(client,{limit:1,environment:{...environment,KM_CANONICAL_AUTOMATION_ENABLED:'false',KM_FINANCIAL_WRITES_EMERGENCY_PAUSE:'false',END_DAY_KM_AUTO_RECALC_MAX_GOOGLE_DIRECTIONS_CALLS:'100'},reconcile:async(_db,_payload,o)=>{options=o;return{status:'unchanged',financial_posted:false};}});
 assert.equal(options.maxGoogleDirectionsCalls,0);
});
