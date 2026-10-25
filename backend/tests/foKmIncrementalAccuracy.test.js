import test from 'node:test';
import assert from 'node:assert/strict';
import {buildIncrementalKmPlan} from '../services/foKmIncrementalReconciliationService.js';
import {calculateTravelLegKm,recalculateAttendanceTravelLegs} from '../foKmRecalculationService.js';
const time=m=>new Date(Date.parse('2026-10-01T03:00:00Z')+m*60000).toISOString();
const base={id:'isolated',employee_code:'FO1',fo_user_id:'FO1',attendance_date:'2026-10-01',login_time:time(0),logout_time:time(120),travel_mode:'car',rate_per_km:8,payable_km_allowed:true,total_approved_km:0,petrol_amount:0,metadata:{}};
const evidence=(attendance=base,visits=[],snapshots=[])=>({attendance,visits,snapshots,recoveries:[],corrections:[],originalRows:[]});
const leg=(i,km,over={})=>({type:'window_'+i,from_time:time(i*20),to_time:time(i*20+10),status:'calculated',payable:true,payable_km:km,km,travel_mode:'car',rate_per_km:8,source:'GPS_BASED',...over});

// Arithmetic fixtures reproduce reported totals; they do not verify a road estimate.
test('positive-only recovery preserves the paid 0.37 difference without crediting it twice',()=>{
 const e=evidence({...base,total_approved_km:3.48,petrol_amount:27.84},[{id:'visit',route_km:3.48}]);
 const p=buildIncrementalKmPlan(e,{travel_legs:[leg(0,3.11,{to_visit_id:'visit'}),leg(1,6.10)]});
 assert.equal(p.baselineKnown,true);assert.equal(p.additionalKm,6.10);assert.equal(p.finalPayableKm,9.58);assert.equal(p.legs[0].new_eligible_km,0);
});
test('paid but unreconstructed/ineligible inbound legs explain 9.88 retained KM',()=>{
 const visits=[.01,4.66,4.93,4.34].map((route_km,i)=>({id:'v'+i,route_km}));
 const legs=[leg(0,41.50),...visits.map((v,i)=>leg(i+1,i===3?4.06:0,{to_visit_id:v.id,payable:i===3,status:i===3?'calculated':'skipped'}))];
 const p=buildIncrementalKmPlan(evidence({...base,total_approved_km:13.94,petrol_amount:111.52},visits),{travel_legs:legs});
 assert.equal(p.baselineKnown,true);assert.equal(p.additionalKm,41.50);assert.equal(p.finalPayableKm,55.44);assert.equal(Math.round((p.finalPayableKm-45.56)*100)/100,9.88);
});
const split=()=>[leg(0,0,{type:'start_to_first_checkin',to_visit_id:'v',travel_mode:'train',payable:false,mode_segment:true,persisted_travel_leg_id:'train'}),leg(1,6.25,{type:'start_to_first_checkin',to_visit_id:'v',travel_mode:'bike',rate_per_km:4,mode_segment:true,persisted_travel_leg_id:'bike'})];
test('unpaid visit-route metadata is not duplicated across Train/Bike segments',()=>{
 const e=evidence(base,[{id:'v',route_km:1.47}]);const p=buildIncrementalKmPlan(e,{travel_legs:split()});
 assert.equal(p.baselineKnown,true);assert.deepEqual(p.legs.map(x=>x.baseline_km),[0,0]);assert.equal(p.additionalKm,6.25);assert.equal(p.additionalAmount,25);
 const credit={leg_key:p.legs[1].leg_key,added_km:6.25,applied_to_attendance:true};
 const retry=buildIncrementalKmPlan({...e,attendance:{...base,total_approved_km:6.25,petrol_amount:25}},{travel_legs:split()},[credit]);assert.equal(retry.baselineKnown,true);assert.equal(retry.additionalKm,0);
});
test('a positive legacy baseline with unallocatable split-route credit still fails closed',()=>{
 const p=buildIncrementalKmPlan(evidence({...base,total_approved_km:1.47,petrol_amount:5.88},[{id:'v',route_km:1.47}]),{travel_legs:split()});assert.equal(p.baselineKnown,false);assert.equal(p.additionalKm,0);
});

test('identical route lookups share one request; failure cause is retained without budget replay',async()=>{
 const original=globalThis.fetch;let requests=0;
 globalThis.fetch=async()=>{requests++;return {ok:true,status:200,json:async()=>({status:'OK',routes:[{legs:[{distance:{value:2000},duration:{value:300}}]}]})};};
 const context={enabled:true,callsAttempted:0,maxCalls:6};const input={client:{from(){throw Error('Unexpected DB');}},attendance:base,fromTime:time(0),toTime:time(60),fromLat:12,fromLng:75,toLat:12,toLng:75.01,options:{sharedRecovery:true,evidenceRows:[],googleMapsApiKey:'isolated-key',googleDirectionsContext:context}};
 try{
  const results=await Promise.all([calculateTravelLegKm(input),calculateTravelLegKm(input)]);assert.equal(requests,1);assert.equal(context.callsAttempted,1);assert(results.every(r=>r.legSource==='GOOGLE_ROUTE_FALLBACK'));
  requests=0;globalThis.fetch=async()=>{requests++;return {ok:true,status:200,json:async()=>({status:'OVER_QUERY_LIMIT'})};};
  const opts={...input.options,googleDirectionsContext:{enabled:true,callsAttempted:0,maxCalls:2}};
  const a=await calculateTravelLegKm({...input,options:opts});const b=await calculateTravelLegKm({...input,options:opts});assert.equal(requests,2);assert.equal(a.fallbackReason,b.fallbackReason);assert.notEqual(a.fallbackReason,'google_call_limit');assert.equal(a.payable,false);
 }finally{globalThis.fetch=original;}
});
test('shared reconstruction spends no road budget on non-payable segments',async()=>{
 const original=globalThis.fetch;const requests=[];globalThis.fetch=async url=>{const u=new URL(url);requests.push(u.searchParams.get('origin'));return {ok:true,status:200,json:async()=>({status:'OK',routes:[{legs:[{distance:{value:2000},duration:{value:300}}]}]})};};
 const a={...base,travel_mode:'train',logout_time:time(60),start_latitude:12,start_longitude:75,end_latitude:12,end_longitude:75.03};
 const rows=Array.from({length:61},(_,i)=>({id:'g'+i,attendance_id:a.id,employee_code:'FO1',fo_user_id:'FO1',source:'mobile',latitude:12,longitude:75+i*.0005,accuracy:8,is_mocked:false,captured_at:time(i),logged_at:time(i)}));
 const snapshots=['train','bike'].map((travel_mode,i)=>({id:'mode'+i,attendance_id:a.id,status:'completed',started_at:time(i*30),ended_at:time((i+1)*30),start_lat:12,start_lng:75+i*.015,end_lat:12,end_lng:75+(i+1)*.015,travel_mode,payable_km_allowed:i===1,rate_per_km:4,payable_km:0}));
 try{const r=await recalculateAttendanceTravelLegs({from(){throw Error('Unexpected DB');}},a.id,{evidenceSnapshot:{attendance:a,visits:[],snapshots,rows},evidenceRows:rows,evidenceOnly:true,sharedRecovery:true,auditDelayedCheckout:false,googleMapsApiKey:'isolated-key',googleDirectionsContext:{enabled:true,callsAttempted:0,maxCalls:6}});assert.equal(r.travel_legs[0].payable_km,0);assert(r.travel_legs[1].payable_km>0);assert.equal(requests.length,1);assert.equal(requests[0],'12,75.015');}finally{globalThis.fetch=original;}
});

test('persisted leg timestamps retain PostgreSQL microseconds for the transaction guard',async()=>{
 const a={...base,travel_mode:'bike',rate_per_km:4,login_time:'2026-10-01T03:00:00.123456Z',logout_time:'2026-10-01T04:00:00.654321Z',start_latitude:12,start_longitude:75,end_latitude:12,end_longitude:75.03};
 const rows=Array.from({length:61},(_,i)=>({id:'precision'+i,attendance_id:a.id,employee_code:'FO1',fo_user_id:'FO1',source:'mobile',latitude:12,longitude:75+i*.0005,accuracy:8,is_mocked:false,captured_at:new Date(Date.parse(a.login_time)+i*60000).toISOString()}));
 const snapshot={id:'precise',status:'completed',started_at:a.login_time,ended_at:a.logout_time,start_lat:12,start_lng:75,end_lat:12,end_lng:75.03,travel_mode:'bike',rate_per_km:4,payable_km_allowed:true,payable_km:0};
 const r=await recalculateAttendanceTravelLegs({from(){throw Error('Unexpected DB');}},a.id,{evidenceSnapshot:{attendance:a,visits:[],snapshots:[snapshot],rows},evidenceRows:rows,evidenceOnly:true,sharedRecovery:true,auditDelayedCheckout:false,maxGoogleDirectionsCalls:0});
 assert.equal(r.travel_legs[0].persisted_travel_leg_id,'precise');assert.equal(r.travel_legs[0].from_time,snapshot.started_at);assert.equal(r.travel_legs[0].to_time,snapshot.ended_at);
});
