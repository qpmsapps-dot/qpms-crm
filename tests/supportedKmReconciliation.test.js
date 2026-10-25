import test from 'node:test';
import assert from 'node:assert/strict';
import { runSupportedKmPeriod, supportedKmDryRun } from '../src/utils/supportedKmReconciliation.js';
test('selected-period posting uses explicit employee/dates, shows real added KM and partial failures', async () => {
  const bodies = [], progress = [];
  const result = await runSupportedKmPeriod({ dryRun:false, employee:'FO1', dates:['2026-10-16','2026-10-17'], endpoint:'/reconcile-supported', onProgress:m=>progress.push(m), request:async(url,init)=>{
    bodies.push(JSON.parse(init.body));
    if(bodies.length===2)throw Error('GPS query timed out');
    return {ok:true,json:async()=>({results:[{date:'2026-10-16',status:'posted',financial_posted:true,existingPayableKm:68.31,additionalKm:40,finalPayableKm:108.31,additionalAmount:160}]})};
  }});
  assert.equal(result.ok,false);assert.match(result.message,/108.31/);assert.match(result.message,/timed out/);assert.equal(progress.length,2);
  assert.deepEqual(bodies[0],{employee_code:'FO1',from_date:'2026-10-16',to_date:'2026-10-16',dry_run:false});
});
test('financial pause is never displayed as successful posting or a journey-entry form',async()=>{
  const r=await runSupportedKmPeriod({dryRun:false,employee:'FO1',dates:['2026-10-16'],endpoint:'/reconcile-supported',request:async()=>({ok:true,json:async()=>({results:[{date:'2026-10-16',status:'deferred',financial_posted:false,message:'KM financial writes are paused.'}]})})});
  assert.equal(r.ok,false);assert.match(r.message,/paused/);assert.doesNotMatch(r.message,/Recalculation completed/);
});

test('preview is default and shows actual returned evidence, partial KM and unresolved legs',async()=>{
 const bodies=[];const row={date:'2026-10-16',status:'calculated_not_posted',financial_posted:false,updated:false,existingPayableKm:27.83,additionalKm:0,finalPayableKm:27.83,additionalAmount:0,sourceRowIds:[],legs:[{type:'start_to_first_checkin',payable_km:26.79,source:'GOOGLE_ROUTE_FALLBACK',evidence_status:'supported'},{type:'site_checkout_to_next_checkin',payable_km:1.04,source:'GOOGLE_ROUTE_FALLBACK',evidence_status:'supported'},{type:'last_checkout_to_end_day',source:'SKIPPED',evidence_status:'missing_leg_coordinates'}],unresolved:[{type:'last_checkout_to_end_day',evidence_status:'missing_leg_coordinates'}],effectiveEnd:{source:'missing_valid_mobile_gps_before_auto_end',captured_at:null,status:'insufficient_evidence'}};
 const r=await runSupportedKmPeriod({employee:'FO1',dates:[row.date],endpoint:'/preview',request:async(u,init)=>{bodies.push(JSON.parse(init.body));return {ok:true,json:async()=>({results:[row]})};}});
 assert.equal(bodies[0].dry_run,true);assert.equal(r.mode,'preview');assert.equal(r.ok,true);assert.match(r.message,/Preview Only — no KM credited/);assert.match(r.message,/Recalculated eligible KM: 27.83/);assert.match(r.message,/supported missing: 0.00/);assert.match(r.message,/0 GPS rows/);assert.match(r.message,/GOOGLE_ROUTE_FALLBACK/);assert.match(r.message,/missing_leg_coordinates/);assert.match(r.message,/partial/);assert.doesNotMatch(r.message,/Refreshing payable|updated payable/i);
});

test('posting is an explicit future option and the UI flag is not financial authorization',()=>{
 for(const environment of [{},{VITE_KM_RECONCILIATION_POSTING_ENABLED:'false'},{VITE_KM_RECONCILIATION_POSTING_ENABLED:true}])assert.equal(supportedKmDryRun(environment),true);
 assert.equal(supportedKmDryRun({VITE_KM_RECONCILIATION_POSTING_ENABLED:'true'}),false);
});

test('preview does not fabricate zero calculation for absent attendance or malformed responses',async()=>{
 for(const body of [{results:[]},{}]){const r=await runSupportedKmPeriod({employee:'FO1',dates:['2026-10-16'],endpoint:'/preview',request:async()=>({ok:true,json:async()=>body})});assert.doesNotMatch(r.message,/Recalculated eligible KM: 0.00/);assert.match(r.message,/No attendance found|incomplete/);}
});

test('preview refuses a server response reporting posted credits and invalid request mode',async()=>{
 const r=await runSupportedKmPeriod({employee:'FO1',dates:['2026-10-16'],endpoint:'/preview',request:async()=>({ok:true,json:async()=>({results:[{status:'posted',financial_posted:true}]})})});assert.equal(r.ok,false);assert.match(r.message,/Preview verification failed/);assert.doesNotMatch(r.message,/no KM credited/);
 await assert.rejects(runSupportedKmPeriod({dryRun:'true'}),/Boolean/);
});
