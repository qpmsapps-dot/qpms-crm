import test from 'node:test';import assert from 'node:assert/strict';
import {buildCompletedTravelLegs,recalculateAttendanceTravelLegs,resolveEffectiveAttendanceEnd} from '../foKmRecalculationService.js';
import {processKmReconciliationJobs} from '../services/foKmReconciliationWorker.js';
const time=n=>new Date(Date.parse('2026-10-20T03:00Z')+n*60000).toISOString();
const attendance={id:'a',fo_user_id:'FO',employee_code:'FO',attendance_date:'2026-10-20',login_time:time(0),logout_time:time(60),status:'Completed',start_latitude:12,start_longitude:75,end_latitude:12,end_longitude:75.03,travel_mode:'bike',rate_per_km:4,payable_km_allowed:true,total_approved_km:0,petrol_amount:0,metadata:{}};
const db={from(){throw Error('No database or financial writes expected');}};
test('final return receives the bounded routing opportunity before earlier journeys',async()=>{
 const prior=globalThis.fetch;const urls=[];try{globalThis.fetch=async url=>{urls.push(new URL(url));return{ok:true,status:200,json:async()=>({status:'OK',routes:[{legs:[{distance:{value:2400},duration:{value:500}}]}]})};};
 const evidence={attendance,visits:[{id:'v',attendance_id:'a',check_in_time:time(20),check_out_time:time(35),check_in_latitude:12,check_in_longitude:75.01,check_out_latitude:12,check_out_longitude:75.01,petrol_eligible_after_checkout:true}],snapshots:[]};
 const r=await recalculateAttendanceTravelLegs(db,'a',{evidenceOnly:true,sharedRecovery:true,evidenceSnapshot:evidence,evidenceRows:[],auditDelayedCheckout:false,googleMapsApiKey:'local-only-key',googleDirectionsContext:{enabled:true,maxCalls:1,callsAttempted:0}});
 assert.equal(urls.length,1);assert.equal(urls[0].searchParams.get('origin'),'12,75.01');assert.equal(urls[0].searchParams.get('destination'),'12,75.03');
 const final=r.travel_legs.find(l=>l.type==='last_checkout_to_end_day');assert.equal(final.source,'GOOGLE_ROUTE_FALLBACK');assert.equal(final.payable_km,2.4);assert.equal(final.payable_amount,9.6);assert.equal(r.travel_legs.at(-1).type,'last_checkout_to_end_day');
 }finally{globalThis.fetch=prior;}
});
test('invalid, mocked, stale or inaccurate manual End Day coordinates are not route destinations',async()=>{
 for(const override of [{end_latitude:0,end_longitude:0},{metadata:{end_location_is_mocked:true}},{metadata:{end_location_accuracy:120}},{metadata:{end_location_captured_at:time(20)}}]){
  const invalid={...attendance,...override};const r=await resolveEffectiveAttendanceEnd(db,invalid,{evidenceRows:[]});assert.equal(r.coordinate,null);
  const legs=buildCompletedTravelLegs(invalid,[{id:'v',check_in_time:time(20),check_out_time:time(30),check_in_latitude:12,check_in_longitude:75.01,check_out_latitude:12,check_out_longitude:75.01}],r,{sharedRecovery:true});assert.equal(legs.at(-1).to,null);
 }
 const valid=await resolveEffectiveAttendanceEnd(db,{...attendance,metadata:{end_location_captured_at:time(59),end_location_accuracy:18}},{evidenceRows:[]});assert.equal(valid.coordinate.longitude,75.03);
});
test('enabled routing budget exhaustion defers partial posting without duplicating its credits',async()=>{
 const lease='12345678-1234-4234-a234-123456789abc';let claim=false,finish,options;
 const client={async rpc(name,args){if(name==='rpc_fo_km_automatic_authorization_version_v1')return{data:247};if(name==='rpc_claim_fo_automatic_km_v1')return{data:claim?null:(claim=true,{attendance_id:'a',generation:1,claimed_generation:1,lease,trigger_source:'manual_end_day',authorization_version:247,authorization_reference:'CANONICAL_END_DAY_AUTOMATION',final_leg_only:true})};finish=args;return{data:null};}};
 const environment={KM_CANONICAL_AUTOMATION_ENABLED:'true',KM_CANONICAL_POLICY_ENABLED:'true',KM_SHARED_RECONCILIATION_ENABLED:'true',KM_INCREMENTAL_REPORTING_ENABLED:'true',END_DAY_KM_AUTO_RECALC_ENABLED:'true',END_DAY_KM_AUTO_RECALC_MAX_GOOGLE_DIRECTIONS_CALLS:'2'};
 await processKmReconciliationJobs(client,{environment,reconcile:async(_client,_payload,o)=>{options=o;return{status:'posted',financial_posted:true,baselineKnown:true,unresolved:[{evidence_status:'google_call_limit',payable_km_allowed:true}]};}});assert.equal(options.finalLegOnly,true);assert.equal(finish.p_posted,false);assert.equal(finish.p_error,'KM_ROUTING_RETRYABLE');
});
