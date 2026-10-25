import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCompletedTravelLegs, calculateTravelLegKm, recalculateAttendanceTravelLegs, resolveEffectiveAttendanceEnd } from '../foKmRecalculationService.js';
import { detectSiteDeparture, evidencePages, trustworthyFixes } from '../services/foKmEvidenceService.js';
import { buildIncrementalKmPlan, reconcileSupportedKm } from '../services/foKmIncrementalReconciliationService.js';
import { processKmReconciliationJobs } from '../services/foKmReconciliationWorker.js';
import { normalizeGpsEvidence } from '../services/foCanonicalKmEngineV2.js';
import { persistCanonicalKmV2 } from '../services/foKmV2PersistenceService.js';
import { recoveryTotals, attachRangeRecovery } from '../services/foOctoberRecoveryReportingService.js';

const time = minutes => new Date(Date.parse('2026-10-16T03:00:00Z') + minutes * 60000).toISOString();
const attendance = { id:'a',employee_code:'FO1',fo_user_id:'FO1',attendance_date:'2026-10-16',login_time:time(0),logout_time:time(150),status:'Completed',travel_mode:'bike',payable_km_allowed:true,rate_per_km:4,total_approved_km:0,petrol_amount:0,start_latitude:12,start_longitude:75, end_latitude:12,end_longitude:75.02,metadata:{} };
const gps = Array.from({length:21},(_,i)=>({id:`g${i}`,attendance_id:'a',employee_code:'FO1',fo_user_id:'FO1',source:'mobile',latitude:12,longitude:75+i*.001,accuracy:8,is_mocked:false,captured_at:time(100+i),logged_at:time(100+i)}));
const client = {from(){throw Error('Unexpected database query');}};
test('strict evidence paging distinguishes empty results, timeouts and truncation',async()=>{
 assert.deepEqual(await evidencePages(()=>({range:async()=>({data:[]})})),[]);
 await assert.rejects(evidencePages(()=>({range:async()=>({error:{code:'57014',message:'timeout'}})})),e=>e.code==='57014');
 await assert.rejects(evidencePages(()=>({range:async()=>({data:[1,2]})}),{pageSize:2,maximum:2}),/bounded limit/);
});
test('auto-end uses last actual same-day mobile fix, retains age and excludes next day',async()=>{
 const a={...attendance,status:'Stale Auto Ended',logout_time:'2026-10-16T18:29:59Z'};
 const end=await resolveEffectiveAttendanceEnd(client,a,{evidenceRows:[...gps,{...gps.at(-1),id:'future',captured_at:'2026-10-16T18:30:01Z'}]});
 assert.equal(end.time.toISOString(),time(120));assert.equal(end.coordinate.longitude,75.02);assert.equal(end.evidenceStatus,'stale_last_observed_fix');assert.equal(end.administrativeEndAt,a.logout_time);
});
test('mocked, wrong-attendance and impossible last fixes do not become auto-end destinations',()=>{
 const points=trustworthyFixes([...gps,{...gps.at(-1),id:'bad',latitude:80,captured_at:time(121),logged_at:time(121)},{...gps[0],id:'mock',is_mocked:true},{...gps[0],id:'other',attendance_id:'other'}],attendance);
 assert.ok(!points.some(p=>['bad','mock','other'].includes(p.id)));
});
test('missing checkout needs corroborated actual departure; a Google route alone is not proof',()=>{
 const site={latitude:12,longitude:75};const points=trustworthyFixes(gps,attendance);
 assert.ok(detectSiteDeparture(points,site,time(90),time(130)));
 assert.equal(detectSiteDeparture([],site,time(90),time(130)),null);
 const visits=[{id:'v1',check_in_time:time(90),check_in_latitude:12,check_in_longitude:75},{id:'v2',check_in_time:time(130),check_in_latitude:12,check_in_longitude:75.02}];
 const legs=buildCompletedTravelLegs(attendance,visits,{time:new Date(time(150)),coordinate:{latitude:12,longitude:75.02}},{sharedRecovery:true,validPoints:points});
 assert.equal(legs[1].fromSource,'corroborated_mobile_departure');assert.ok(legs[1].fromTime>new Date(time(90)));
});
test('Directions failure is unresolved, never payable Haversine or confirmed zero',async()=>{
 const result=await calculateTravelLegKm({client,attendance,fromTime:time(0),toTime:time(30),fromLat:12,fromLng:75,toLat:12,toLng:75.02,options:{sharedRecovery:true,evidenceRows:[],googleDirectionsContext:{enabled:false,maxCalls:0,callsAttempted:0}}});
 assert.equal(result.legKm,null);assert.equal(result.payable,false);assert.equal(result.legSource,'UNRESOLVED');
});
test('actual GPS detour remains GPS first and is not replaced by a shorter route',async()=>{
 const rows=Array.from({length:21},(_,i)=>({...gps[i],longitude:75+Math.sin(i/20*Math.PI)*.02,captured_at:time(100+i),logged_at:time(100+i)}));
 const r=await calculateTravelLegKm({client,attendance,fromTime:time(99),toTime:time(121),fromLat:12,fromLng:75,toLat:12,toLng:75,options:{sharedRecovery:true,evidenceRows:rows,googleDirectionsContext:{enabled:false,maxCalls:0,callsAttempted:0}}});
 assert.ok(r.acceptedGpsKm>3);assert.notEqual(r.legSource,'HAVERSINE_ROUTE_FALLBACK');
});
test('Directions road fallback succeeds only for trusted completed endpoints; quota/timeouts stay unresolved',async()=>{
 const original=globalThis.fetch;
 const input={client,attendance,fromTime:time(0),toTime:time(30),fromLat:12,fromLng:75,toLat:12,toLng:75.02};
 try{
   globalThis.fetch=async url=>{assert.match(String(url),/\/directions\/json/);return {ok:true,status:200,json:async()=>({status:'OK',routes:[{legs:[{distance:{value:3000},duration:{value:600}}]}]})};};
   const makeOptions=()=>({sharedRecovery:true,evidenceRows:[],googleMapsApiKey:'isolated-test-key',googleDirectionsContext:{enabled:true,callsAttempted:0,maxCalls:1}});
   const r=await calculateTravelLegKm({...input,options:makeOptions()});assert.equal(r.legSource,'GOOGLE_ROUTE_FALLBACK');assert.equal(r.legKm,3);assert.equal(r.payable,true);
   globalThis.fetch=async()=>({ok:true,status:200,json:async()=>({status:'OVER_QUERY_LIMIT'})});
   const quota=await calculateTravelLegKm({...input,options:makeOptions()});assert.equal(quota.legSource,'UNRESOLVED');assert.equal(quota.legKm,null);
   globalThis.fetch=async()=>{throw Object.assign(new Error('timeout'),{name:'AbortError'});};
   const timeout=await calculateTravelLegKm({...input,options:makeOptions()});assert.equal(timeout.payable,false);assert.equal(timeout.legKm,null);
 }finally{globalThis.fetch=original;}
});
function planFixture(){const leg={type:'last_checkout_to_end_day',from_visit_id:'last',from_time:time(100),to_time:time(120),status:'calculated',source:'GPS_BASED',payable:true,payable_km:40,rate_per_km:4,travel_mode:'bike'};return {e:{attendance:{...attendance,total_approved_km:68.31,petrol_amount:273.24},visits:[],snapshots:[{id:'old',status:'completed',started_at:time(0),ended_at:time(80),payable_km:68.31}],recoveries:[],corrections:[],originalRows:gps},c:{travel_legs:[leg],effective_end_evidence:{}}};}
test('positive increment is 40, retries and prior supplements contribute exactly once',()=>{
 const {e,c}=planFixture();const p=buildIncrementalKmPlan(e,c);assert.equal(p.additionalKm,40);assert.equal(p.additionalAmount,160);assert.equal(p.finalPayableKm,108.31);
 const credit={leg_key:p.legs[0].leg_key,added_km:40,applied_to_attendance:true};e.attendance.total_approved_km=108.31;assert.equal(buildIncrementalKmPlan(e,c,[credit]).additionalKm,0);
 e.attendance.total_approved_km=68.31;e.recoveries=[{journey_start:time(100),journey_end:time(120),approved_additional_km:40}];assert.equal(buildIncrementalKmPlan(e,c).additionalKm,0);
});
test('27.97 already-included final leg produces no addition',()=>{
 const {e,c}=planFixture();c.travel_legs[0].payable_km=27.97;e.snapshots.push({id:'final',status:'completed',started_at:time(100),ended_at:time(120),payable_km:27.97});e.attendance.total_approved_km=96.28;assert.equal(buildIncrementalKmPlan(e,c).additionalKm,0);
});
test('unknown included KM and applied corrections are not assumed zero; no deductions',()=>{
 const {e,c}=planFixture();e.attendance.total_approved_km=100;assert.equal(buildIncrementalKmPlan(e,c).additionalKm,0);
 e.attendance.total_approved_km=68.31;e.corrections=[{id:'protected'}];assert.equal(buildIncrementalKmPlan(e,c).additionalKm,0);
});
test('active attendance yields calculated closed evidence without persistence; Auto never becomes Bike',async()=>{
 const e={attendance:{...attendance,logout_time:null,travel_mode:'auto'},visits:[{id:'v',check_in_time:time(120),check_in_latitude:12,check_in_longitude:75.02}],snapshots:[],rows:gps,originalRows:gps,recoveries:[],corrections:[]};
 const rpcClient={...client,rpc:async name=>{assert.equal(name,'rpc_fo_km_reconciliation_state_v1');return {data:{digest:'state',credits:[]}};}};
 const r=await reconcileSupportedKm(rpcClient,{attendance_id:'a'},{evidence:e,persist:true,trigger:'manual_end_day',actorSource:'lease',environment:{KM_SHARED_RECONCILIATION_ENABLED:'true',KM_INCREMENTAL_REPORTING_ENABLED:'true'}});assert.equal(r.status,'active_closed_windows_only');assert.equal(r.additionalKm,0);assert.equal(r.financial_posted,false);
});
test('worker reports paused posting as deferred, not completed; disabled workers do not query',async()=>{
 assert.equal((await processKmReconciliationJobs(client,{environment:{}})).disabled,true);
 let claimed=false;const calls=[];const c={rpc:async(name,args)=>{calls.push({name,args});if(name==='rpc_claim_fo_km_reconciliation_v1'){if(claimed)return {data:null};claimed=true;return {data:{attendance_id:'a',lease:'lease',trigger_source:'manual_end_day'}};}return {data:null};}};
 await processKmReconciliationJobs(c,{environment:{KM_SHARED_RECONCILIATION_ENABLED:'true',KM_INCREMENTAL_REPORTING_ENABLED:'true',END_DAY_KM_AUTO_RECALC_ENABLED:'true'},reconcile:async()=>({status:'deferred',code:'KM_FINANCIAL_WRITES_MAINTENANCE',financial_posted:false})});
 assert.equal(calls.find(c=>c.name==='rpc_finish_fo_km_reconciliation_v1').args.p_posted,false);
});
test('16 October representative route retains existing inbound legs and calculates only supported final GPS window',async()=>{
 const e={attendance:{...attendance,status:'Stale Auto Ended',logout_time:'2026-10-16T18:29:59Z',end_latitude:null,end_longitude:null,total_approved_km:27.83,petrol_amount:111.32},visits:[
 {id:'v1',check_in_time:time(10),check_out_time:time(60),petrol_eligible_after_checkout:true,check_in_latitude:12,check_in_longitude:75,check_out_latitude:12,check_out_longitude:75,route_km:26.79},
 {id:'v2',check_in_time:time(70),check_out_time:time(99),petrol_eligible_after_checkout:true,check_in_latitude:12,check_in_longitude:75,check_out_latitude:12,check_out_longitude:75,route_km:1.04}],snapshots:[],rows:gps,originalRows:gps,recoveries:[],corrections:[]};
 const c=await recalculateAttendanceTravelLegs(client,'a',{evidenceSnapshot:e,evidenceRows:gps,evidenceOnly:true,sharedRecovery:true,auditDelayedCheckout:false});
 const final=c.travel_legs.find(l=>l.type==='last_checkout_to_end_day');assert.equal(final.to_time,time(120));assert.ok(final.km>0);assert.equal(final.source,'GPS_BASED');
 const p=buildIncrementalKmPlan(e,c);assert.ok(p.additionalKm>0);assert.equal(p.additionalKm,final.payable_km);assert.equal(p.baselineKnown,true);
});
test('late offline upload retains original capture/receipt; truly stale provider fixes remain rejected',()=>{
 const row={...gps[0],logged_at:'2026-10-24T12:00:00Z',metadata:{provider_timestamp_quality:'provider_timestamp',received_at:gps[0].captured_at}};
 assert.equal(normalizeGpsEvidence({rows:[row],attendance}).points.length,1);
 assert.equal(normalizeGpsEvidence({rows:[{...row,metadata:{provider_timestamp_quality:'provider_timestamp',received_at:time(130)}}],attendance}).points.length,0);
});
test('an overlapping legacy paid window with a different boundary is not treated as unpaid',()=>{
 const {e,c}=planFixture();e.snapshots=[{id:'wide',status:'completed',started_at:time(0),ended_at:time(140),payable_km:68.31}];
 assert.equal(buildIncrementalKmPlan(e,c).additionalKm,0);assert.equal(buildIncrementalKmPlan(e,c).legs[0].evidence_status,'persisted_overlap_requires_review');
});
test('automatic persistence never uses the Admin maintenance exemption or P1 exception',async()=>{
 const c={rpc(){throw Error('Financial RPC must never run while paused');}};
 for(const environment of [{KM_FINANCIAL_WRITES_EMERGENCY_PAUSE:'true'},{KM_FINANCIAL_WRITES_MAINTENANCE:'true'}])await assert.rejects(persistCanonicalKmV2(c,{attendanceId:'a',calculation:{incrementalRecovery:true},adminAuthorization:{userId:'admin'},environment:{...environment,KM_SHARED_RECONCILIATION_ENABLED:'true'}}),e=>e.code==='KM_FINANCIAL_WRITES_MAINTENANCE');
});
test('canonical-applied credits export as audit history without being added to claim totals again',()=>{
 const credit={id:'credit',status:'approved',applied_to_attendance:true,approved_additional_km:40,additional_amount:160};
 assert.equal(recoveryTotals([credit]).recovered_km,0);
 const d={period_summary:{canonical_payable_km:108.31,canonical_petrol_amount:433.24,kilometer:108.31,distance_amount:433.24,total_amount:433.24},daily_summary:[]};
 attachRangeRecovery(d,[credit]);assert.equal(d.period_summary.canonical_payable_km,108.31);assert.equal(d.recovery_adjustments.length,1);
});
test('missing final checkout can recover actual departure, but wrong-location review remains protected',async()=>{
 const e={attendance:{...attendance,status:'Stale Auto Ended'},visits:[{id:'v',check_in_time:time(90),check_in_latitude:12,check_in_longitude:75,petrol_eligible_after_checkout:false}],snapshots:[],rows:gps};
 let r=await recalculateAttendanceTravelLegs(client,'a',{evidenceSnapshot:e,evidenceRows:gps,evidenceOnly:true,sharedRecovery:true});
 let final=r.travel_legs.find(l=>l.type==='last_checkout_to_end_day');assert.ok(final.payable_km>0);assert.equal(final.from_source,'corroborated_mobile_departure');
 e.visits[0].metadata={requires_checkout_review:true};
 r=await recalculateAttendanceTravelLegs(client,'a',{evidenceSnapshot:e,evidenceRows:gps,evidenceOnly:true,sharedRecovery:true});
 final=r.travel_legs.find(l=>l.type==='last_checkout_to_end_day');assert.equal(final.payable_km,0);assert.ok(final.review_flags.includes('CHECKOUT_ELIGIBILITY_REVIEW_REQUIRED'));
});
test('public-transport snapshots cannot be repriced as Bike when persisted mode coverage is incomplete',async()=>{
 const e={attendance,visits:[{id:'v',check_in_time:time(90),check_out_time:time(99),check_in_latitude:12,check_in_longitude:75,check_out_latitude:12,check_out_longitude:75,petrol_eligible_after_checkout:true}],snapshots:[{id:'train',attendance_id:'a',started_at:time(105),ended_at:time(115),start_lat:12,start_lng:75.005,end_lat:12,end_lng:75.015,status:'completed',travel_mode:'train',payable_km:0,payable_km_allowed:false}],rows:gps};
 const r=await recalculateAttendanceTravelLegs(client,'a',{evidenceSnapshot:e,evidenceRows:gps,evidenceOnly:true,sharedRecovery:true});
 const final=r.travel_legs.find(l=>l.type==='last_checkout_to_end_day');assert.equal(final.payable_km,undefined);assert.equal(final.reason,'recorded_mode_requires_review');
});
test('held outbox work defers without calculating or reporting financial posting',async()=>{
 const {processKmReconciliationJobs}=await import('../services/foKmReconciliationWorker.js');
 const calls=[];const db={async rpc(name,args){calls.push({name,args});return {data:name==='rpc_claim_fo_km_reconciliation_v1'?{attendance_id:'a',lease:'lease'}:null,error:null};}};
 const r=await processKmReconciliationJobs(db,{limit:1,environment:{KM_SHARED_RECONCILIATION_ENABLED:'true',KM_INCREMENTAL_REPORTING_ENABLED:'true',END_DAY_KM_AUTO_RECALC_ENABLED:'true',KM_FINANCIAL_WRITES_EMERGENCY_PAUSE:'true'},reconcile(){throw Error('Must not calculate while held');}});
 assert.equal(r.results[0].status,'deferred');assert.equal(r.results[0].financial_posted,false);
 assert.equal(calls[1].args.p_posted,false);assert.equal(calls[1].args.p_error,'KM_FINANCIAL_WRITES_MAINTENANCE');
});

test('recorded segment modes override the day mode; only Bike, mapped Own Vehicle and Car pay', async () => {
 const {calculateCanonicalRoutePayableKm,ratePerKmForTravelMode}=await import('../foKmRecalculationService.js');
 const legs=['bike','car','bus','train','auto','other','unknown'].map((travel_mode,index)=>({type:'segment_'+index,status:'calculated',source:'GPS_BASED',km:10,travel_mode,rate_per_km:travel_mode==='car'?8:4}));
 const r=calculateCanonicalRoutePayableKm({attendance:{travel_mode:'bike'},gpsTravelLegs:legs});
 assert.equal(r.calculatedPayableKm,20);assert.equal(r.petrolAmount,120);
 assert.deepEqual(r.auditTravelLegs.map(l=>l.payable_km),[10,10,0,0,0,0,0]);
 assert.equal(ratePerKmForTravelMode('own_vehicle'),ratePerKmForTravelMode('bike'));
 for(const mode of ['bus','train','auto','other','unknown'])assert.equal(ratePerKmForTravelMode(mode,4),0);
});

test('complete persisted Bike-Train-Bike chain keeps segment modes through shared reconstruction', async () => {
 const rows=Array.from({length:151},(_,i)=>({...gps[0],id:'mixed'+i,captured_at:time(i),logged_at:time(i),longitude:75+i*0.0002}));
 const a={...attendance,end_longitude:75.03};
 const snapshots=['bike','train','bike'].map((travel_mode,i)=>({id:'leg'+i,attendance_id:'a',status:'completed',started_at:time(i*50),ended_at:time((i+1)*50),start_lat:12,start_lng:75+i*.01,end_lat:12,end_lng:75+(i+1)*.01,travel_mode,rate_per_km:travel_mode==='train'?0:4,payable_km_allowed:travel_mode==='bike',payable_km:0}));
 const r=await recalculateAttendanceTravelLegs(client,'a',{evidenceSnapshot:{attendance:a,visits:[],snapshots,rows},evidenceRows:rows,evidenceOnly:true,sharedRecovery:true,maxGoogleDirectionsCalls:0});
 assert.deepEqual(r.travel_legs.map(l=>l.travel_mode),['bike','train','bike']);
 assert.ok(r.travel_legs[0].payable_km>0);assert.equal(r.travel_legs[1].payable_km,0);assert.ok(r.travel_legs[2].payable_km>0);
 assert.equal(r.petrol_amount,Number((r.travel_legs[0].payable_amount+r.travel_legs[2].payable_amount).toFixed(2)));
});

test('direct inactive service and outbox never access evidence, Migration239 tables or RPCs',async()=>{
 const calls=[];const db={from(){calls.push('table');throw Error('No table access allowed');},rpc(){calls.push('rpc');throw Error('No RPC access allowed');}};
 for(const environment of [{},{KM_SHARED_RECONCILIATION_ENABLED:'true'},{KM_SHARED_RECONCILIATION_ENABLED:'false',KM_INCREMENTAL_REPORTING_ENABLED:'true'}]){
  const r=await reconcileSupportedKm(db,{attendance_id:'a'},{environment,persist:true,trigger:'admin_recalculation',adminAuthorization:{userId:'admin'}});
  assert.equal(r.code,'KM_SHARED_RECONCILIATION_INACTIVE');assert.equal(r.financial_posted,false);
  assert.equal((await processKmReconciliationJobs(db,{environment:{...environment,END_DAY_KM_AUTO_RECALC_ENABLED:'true'}})).disabled,true);
 }assert.deepEqual(calls,[]);
});
test('unauthorized direct Admin action is rejected before protected database access',async()=>{
 const db={from(){throw Error('No evidence access allowed');},rpc(){throw Error('No RPC allowed');}};
 await assert.rejects(reconcileSupportedKm(db,{attendance_id:'a'},{environment:{KM_SHARED_RECONCILIATION_ENABLED:'true',KM_INCREMENTAL_REPORTING_ENABLED:'true'},trigger:'admin_recalculation'}),e=>e.statusCode===403&&e.code==='KM_ADMIN_REQUIRED');
});
test('enabled unavailable Migration239 read or outbox RPC yields controlled dependency error with no posting',async()=>{
 const environment={KM_SHARED_RECONCILIATION_ENABLED:'true',KM_INCREMENTAL_REPORTING_ENABLED:'true',END_DAY_KM_AUTO_RECALC_ENABLED:'true'};
 for(const code of ['PGRST202','PGRST205','42P01','42883']){
  const calls=[];const db={from(){throw Error('No table writes allowed');},async rpc(name){calls.push(name);return {error:{code,message:'Isolated missing schema'}};}};
  await assert.rejects(reconcileSupportedKm(db,{attendance_id:'a'},{environment,trigger:'admin_recalculation',adminAuthorization:{userId:'admin'},evidence:{attendance:{id:'a'}}}),e=>e.statusCode===503&&e.code==='KM_SHARED_SCHEMA_UNAVAILABLE'&&e.retryable);
  assert.deepEqual(calls,['rpc_fo_km_reconciliation_state_v1']);calls.length=0;
  await assert.rejects(processKmReconciliationJobs(db,{environment}),e=>e.code==='KM_SHARED_SCHEMA_UNAVAILABLE');
  assert.deepEqual(calls,['rpc_claim_fo_km_reconciliation_v1']);
 }
});
