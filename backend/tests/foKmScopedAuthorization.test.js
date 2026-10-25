import test from 'node:test';
import assert from 'node:assert/strict';
import {persistCanonicalKmV2} from '../services/foKmV2PersistenceService.js';
import {processKmReconciliationJobs} from '../services/foKmReconciliationWorker.js';
import {attachRangeRecovery,recoveryTotals,recoveryCsv} from '../services/foOctoberRecoveryReportingService.js';
const environment={KM_SHARED_RECONCILIATION_ENABLED:'true',KM_INCREMENTAL_REPORTING_ENABLED:'true',KM_FINANCIAL_WRITES_MAINTENANCE:'true',KM_FINANCIAL_WRITES_EMERGENCY_PAUSE:'false'};
const input={attendanceId:'isolated',calculation:{incrementalRecovery:true},sourceEntryPoint:'admin_recalculation',environment,adminAuthorization:{userId:'trusted-admin'},scopedAuthorizationReference:'ISOLATED_AUTHORIZATION'};
test('scoped Admin selects only the scope validating RPC while maintenance remains on',async()=>{
 const calls=[];const db={async rpc(name,args){calls.push({name,args});return {data:{receipt_id:'receipt'}};}};
 assert.equal((await persistCanonicalKmV2(db,input)).receipt_id,'receipt');assert.equal(calls.length,1);assert.equal(calls[0].name,'rpc_reconcile_fo_scoped_km_v1');assert.equal(calls[0].args.p_reference,input.scopedAuthorizationReference);assert.equal(calls[0].args.p_admin,'trusted-admin');assert.equal('p_trigger' in calls[0].args,false);assert.equal('p_lease' in calls[0].args,false);
});
test('application emergency pause and non-scoped maintenance remain unconditional before RPC',async()=>{
 const db={rpc(){throw Error('Must not reach database');}};
 await assert.rejects(persistCanonicalKmV2(db,{...input,environment:{...environment,KM_FINANCIAL_WRITES_EMERGENCY_PAUSE:'true'}}),e=>e.code==='KM_FINANCIAL_WRITES_MAINTENANCE');
 for(const missingOrInvalid of [undefined,'','invalid'])await assert.rejects(persistCanonicalKmV2(db,{...input,environment:{...environment,KM_FINANCIAL_WRITES_EMERGENCY_PAUSE:missingOrInvalid}}),e=>e.code==='KM_FINANCIAL_WRITES_MAINTENANCE');
 await assert.rejects(persistCanonicalKmV2(db,{...input,scopedAuthorizationReference:null}),e=>e.code==='KM_FINANCIAL_WRITES_MAINTENANCE');
});
test('scope reference never grants a worker or unauthenticated action maintenance permission',async()=>{
 const db={rpc(){throw Error('Must not reach database');}};
 for(const change of [{adminAuthorization:null},{sourceEntryPoint:'manual_end_day'},{sourceEntryPoint:'auto_end_day'},{actorSource:'worker-lease'},{scopedAuthorizationReference:'bad'}])await assert.rejects(persistCanonicalKmV2(db,{...input,...change}),e=>e.code==='KM_SCOPE_ADMIN_REQUIRED');
 assert.equal((await processKmReconciliationJobs(db,{environment})).disabled,true);
});
test('missing scope RPC is an error with no fallback to ordinary persistence',async()=>{
 const calls=[];await assert.rejects(persistCanonicalKmV2({async rpc(name){calls.push(name);return {error:{code:'PGRST202',message:'Scope schema unavailable'}};}},input),e=>e.code==='PGRST202');assert.deepEqual(calls,['rpc_reconcile_fo_scoped_km_v1']);
});
test('settled supplement reporting and CSV export deduplicate receipt without double counting canonical credits',()=>{
 const row={id:'receipt',status:'approved',employee_code:'ISOLATED_FO',attendance_date:'2026-10-23',approved_additional_km:10,additional_amount:40,applied_to_attendance:false,original_payable_km:0,resulting_payable_km:10,original_claim_amount:0,resulting_claim_amount:40,travel_rate:4};
 const rows=[row,row,{...row,id:'canonical',applied_to_attendance:true}];
 assert.equal(recoveryTotals(rows).recovered_km,10);const data=attachRangeRecovery({period_summary:{canonical_payable_km:0,canonical_petrol_amount:0},daily_summary:[]},rows);assert.equal(data.period_summary.canonical_payable_km,10);assert.equal(data.period_summary.canonical_petrol_amount,40);assert.equal(data.daily_summary.length,1);assert.equal(data.daily_summary[0].payable_km,10);
 const csv=recoveryCsv([row,row]);assert.equal(csv.split('\r\n').length,2);
});
