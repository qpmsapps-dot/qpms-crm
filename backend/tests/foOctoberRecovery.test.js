import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { reconstructOctoberTravel, recoveryPages } from '../services/foOctoberRecoveryEvidenceService.js';
import { validateRecoveryJourney, createOctoberRecoveryService } from '../services/foOctoberRecoveryService.js';
import { recoveryTotals, overlayRecoveryRows, attachRangeRecovery, recoveryCsv } from '../services/foOctoberRecoveryReportingService.js';
import { storedAttendancePayableKm, storedAttendancePetrolAmount, summarizeOperationsRows, buildConsolidatedTravelClaimReportDataset } from '../services/operationsSummaryService.js';
import { createOctoberRecoveryRouter } from '../routes/foOctoberRecoveryRoutes.js';

const employee={id:'profile-1',employee_code:'QPMSTNC17015',full_name:'Balaji'};
const attendance={id:'attendance-1',employee_code:employee.employee_code,fo_user_id:employee.id,attendance_date:'2026-10-01',login_time:'2026-10-01T03:00:00Z',logout_time:'2026-10-01T17:00:00Z',total_approved_km:71.25,petrol_amount:285,travel_mode:'bike',payable_km_allowed:true};
const points=()=>[[12.9,80.1],[12.91,80.1],[12.91,80.11],[12.9,80.11]].map(([latitude,longitude],i)=>({id:'gps-'+i,local_id:'local-'+i,attendance_id:attendance.id,employee_code:employee.employee_code,fo_user_id:employee.id,latitude,longitude,accuracy:10,is_mocked:false,source:'mobile',captured_at:new Date(Date.parse('2026-10-01T04:30:00Z')+i*60000).toISOString(),logged_at:new Date(Date.parse('2026-10-01T04:30:01Z')+i*60000).toISOString(),metadata:{}}));
const reconstruct=extra=>reconstructOctoberTravel({date:'2026-10-01',employee,attendances:[attendance],rows:points(),now:new Date('2026-10-24T12:00:00Z'),...extra});
test('A: existing final leg is included evidence, never another payable award',()=>{
 const result=reconstruct({savedLegs:[{id:'final-leg',started_at:'2026-10-01T04:30:00Z',ended_at:'2026-10-01T04:33:00Z',payable_km:27.97,status:'completed'}]});
 assert.equal(result.existing_payable_km,71.25);assert.ok(result.segments.every(s=>s.status==='already_included'));assert.equal(result.auto_payable_km,null);assert.equal(result.writes,0);
});
test('B: missing End Day endpoint/GPS is unknown evidence; manual journey remains valid',()=>{
 const result=reconstruct({rows:[]});assert.equal(result.calculated_travel_km,null);assert.equal(result.existing_payable_km,71.25);assert.equal(result.status,'insufficient_evidence');
 assert.equal(validateRecoveryJourney(journey()).reason,'Missing End Day');
});
test('C: missing Check-Out does not delimit or reject workday reconstruction',()=>{
 const result=reconstruct({attendances:[{...attendance,logout_time:null}]});assert.equal(result.segments.length,3);assert.ok(result.calculated_travel_km>3);assert.equal(result.auto_payable_km,null);
});
test('D: sourcing detour preserves all accepted GPS movement, not direct-route replacement',()=>{
 const result=reconstruct();assert.ok(result.calculated_travel_km>3);assert.ok(result.segments.every(s=>s.source==='quality_filtered_gps'));assert.equal(result.segments.length,3);
});
test('E: delayed mobile synchronization retains original capture date and deduplicates repeats',()=>{
 const rows=points().map(p=>({...p,logged_at:'2026-10-02T10:00:00Z'}));const result=reconstruct({rows:[...rows,...rows]});
 assert.equal(result.segments.length,3);assert.equal(result.late_sync_point_ids.length,4);assert.ok(result.segments.every(s=>s.late_sync_review));assert.equal(result.calculated_travel_km,reconstruct().calculated_travel_km);
});
test('late evidence without local ID, with mocking or stale provider marker is not admitted',()=>{
 for(const change of [{local_id:null},{is_mocked:true},{metadata:{provider_timestamp_quality:'stale_provider_timestamp'}}])assert.equal(reconstruct({rows:points().map(p=>({...p,...change,logged_at:'2026-10-02T10:00:00Z'}))}).calculated_travel_km,null);
});
test('long gaps, unrelated days, foreign sessions and ambiguous sessions do not form journeys',()=>{
 const rows=points();rows[1].captured_at='2026-10-01T10:00:00Z';const result=reconstruct({rows:[rows[0],rows[1]]});assert.equal(result.calculated_travel_km,null);assert.equal(result.segments[0].status,'gap_review_required');
 assert.equal(reconstruct({rows:points().map(p=>({...p,attendance_id:'another'}))}).segments.length,0);
 assert.equal(reconstruct({attendances:[attendance,{...attendance,id:'overlap'}]}).segments.length,0);
 assert.equal(reconstruct({rows:points().map(p=>({...p,captured_at:'2026-10-02T04:30:00Z'}))}).segments.length,0);
});
test('G: public mode retains physical evidence but has no automatic petrol credit or deduction',()=>{
 const result=reconstruct({attendances:[{...attendance,travel_mode:'train',payable_km_allowed:false}]});assert.ok(result.calculated_travel_km>0);assert.equal(result.recorded_transport_review,true);assert.equal(result.existing_payable_km,71.25);assert.equal(result.auto_payable_km,null);
});
test('GPS retrieval failures propagate rather than becoming zero evidence',async()=>{
 await assert.rejects(recoveryPages(()=>({range:async()=>({error:Object.assign(Error('timeout'),{code:'57014'})})})),/timeout/);
});
test('Directions fallback uses only recorded/filtered boundary coordinates, never client invented locations',async()=>{
 const row={...attendance,start_latitude:12.9,start_longitude:80.1,end_latitude:13.0,end_longitude:80.2};let calls=0;
 class Query {constructor(table){this.table=table;}select(){return this;}eq(){return this;}in(){return this;}is(){return this;}or(){return this;}gte(){return this;}lt(){return this;}lte(){return this;}order(){return this;}limit(){return Promise.resolve({data:[employee]});}range(){return Promise.resolve({data:this.table==='fo_attendance'?[row]:[]});}}
 const client={from:table=>new Query(table),rpc(){throw Error('Evidence must not invoke persistence');}};
 const service=createOctoberRecoveryService({environment:{},estimate:async(from,to)=>{calls++;assert.equal(from.source,'recorded_start_day');assert.equal(to.source,'recorded_end_day');return{ok:true,distanceKm:18};}});
 const result=await service.evidence({client,profile,authUser:{id:'admin'}},{employee_code:employee.employee_code,date:'2026-10-01',journey_start:row.login_time,journey_end:row.logout_time,from:{latitude:0,longitude:0}});
 assert.equal(calls,1);assert.equal(result.calculated_travel_km,null);assert.equal(result.route_estimates[0].km,18);assert.equal(result.auto_payable_km,null);
 row.end_latitude=null;calls=0;
 const missing=await service.evidence({client,profile,authUser:{id:'admin'}},{employee_code:employee.employee_code,date:'2026-10-01',journey_start:row.login_time,journey_end:row.logout_time});
 assert.equal(calls,0);assert.equal(missing.route_estimates.length,0);
});
const credit={id:'credit-1',employee_code:employee.employee_code,employee_name:'Balaji',attendance_date:'2026-10-01',status:'approved',approved_additional_km:40,additional_amount:160,travel_mode:'bike',travel_rate:4,original_payable_km:71.25,original_claim_amount:285,resulting_payable_km:111.25,resulting_claim_amount:445,recovery_reason:'Sourcing / Recruitment',approved_by:'Admin'};
test('F: overlay and monthly export deduplicate credits and exclude pending/rejected',()=>{
 const records=[credit,credit,{...credit,id:'pending',status:'pending'},{...credit,id:'rejected',status:'rejected'}];assert.equal(recoveryTotals(records).recovered_km,40);
 const original=structuredClone(attendance),rows=overlayRecoveryRows([attendance],records);assert.deepEqual(attendance,original);assert.equal(storedAttendancePayableKm(rows[0]),111.25);assert.equal(storedAttendancePetrolAmount(rows[0]),445);
 assert.equal(storedAttendancePayableKm(overlayRecoveryRows(rows,records)[0]),111.25);
 const csv=recoveryCsv([credit,{...credit,id:'pending',attendance_date:'2026-10-02',status:'pending',employee_name:' =HYPERLINK("bad")'}]);assert.match(csv,/' =HYPERLINK/);assert.match(csv,/"71.25","40","111.25","4","160","445"/);assert.match(csv,/"Pending"/);
});
test('no attendance creates an explicit financial report row, never fabricated attendance timestamps',()=>{
 const row=overlayRecoveryRows([], [credit])[0];assert.equal(row.recovery_only,true);assert.equal(row.id,null);assert.equal(row.login_time,undefined);assert.equal(row.logout_time,undefined);assert.equal(storedAttendancePayableKm(row),40);
 const dataset={period_summary:{canonical_payable_km:0,canonical_petrol_amount:0},daily_summary:[]};attachRangeRecovery(dataset,[credit]);assert.equal(dataset.period_summary.canonical_payable_km,40);assert.equal(dataset.daily_summary[0].attendance_id,null);
});
test('October dashboard and monthly calculated claim totals agree; settled Finance payable remains intact',()=>{
 const profiles=[{...employee,role:'FO',state:'TN',business:'HDFC',is_active:true,status:'active'}];
 const actor={employee_code:'ADMIN',role:'Admin',is_active:true,status:'active'};
 const projected=overlayRecoveryRows([attendance],[credit,credit,{...credit,id:'pending-2',status:'pending'}]);
 const filters={date_from:'2026-10-01',date_to:'2026-10-31',state:null,business:null,status:null};
 const summary=summarizeOperationsRows({attendances:projected,profiles,hierarchyRows:[],liveRows:[],actor,filters});assert.equal(summary.payable_km,111.25);assert.equal(summary.petrol_amount,445);assert.equal(summary.matching_attendance_count,1);
 const report=buildConsolidatedTravelClaimReportDataset({attendances:projected,profiles,hierarchyRows:[],liveRows:[],claims:[],settlements:[{id:'settled',profile_id:employee.id,employee_code:employee.employee_code,state:'TN',period_start:'2026-10-01',period_end:'2026-10-31',approved_payable_amount:1000}],actor,filters,generatedBy:actor,generatedAt:new Date('2026-11-01T00:00:00Z')});
 assert.equal(report.rows[0].total_km_travelled,111.25);assert.equal(report.rows[0].distance_reimbursement,445);assert.equal(report.rows[0].calculated_claim,445);assert.equal(report.rows[0].final_payable,1000);assert.equal(report.rows[0].recovery_settlement_review_required,true);
 assert.equal(report.rows[0].existing_payable_km,71.25);assert.equal(report.rows[0].approved_additional_km,40);assert.equal(report.rows[0].settled_amount,1000);assert.equal(report.rows[0].unsettled_approved_supplement,null);
 const timestamp='2026-10-24T10:00:00Z',settlement={id:'settled',profile_id:employee.id,employee_code:employee.employee_code,state:'TN',period_start:'2026-10-01',period_end:'2026-10-31',approved_payable_amount:1000,updated_at:timestamp};
 const knownCredit={...credit,before_state:{settlements:[{id:'settled',approved_payable_amount:1000,updated_at:timestamp}]}};
 const supplementReport=updated=>buildConsolidatedTravelClaimReportDataset({attendances:overlayRecoveryRows([attendance],[knownCredit]),profiles,hierarchyRows:[],liveRows:[],claims:[],settlements:[{...settlement,updated_at:updated}],actor,filters,generatedBy:actor,generatedAt:new Date('2026-11-01T00:00:00Z')});
 assert.equal(supplementReport(timestamp).rows[0].unsettled_approved_supplement,160);
 assert.equal(supplementReport('2026-10-24T11:00:00Z').rows[0].unsettled_approved_supplement,null);
 const hidden=summarizeOperationsRows({attendances:projected,profiles,hierarchyRows:[],liveRows:[],actor,filters:{...filters,state:'KL'}});assert.equal(hidden.payable_km,0);
});
const profile={id:'admin',role:'Admin',is_active:true,status:'active',employee_code:'ADMIN',web_access_enabled:true};
function journey(){return {employee_code:employee.employee_code,date:'2026-10-23',journey_start:'2026-10-23T11:41:33Z',journey_end:'2026-10-23T12:49:54Z',journey_type:'Official travel',reason:'Missing End Day',start_location:'Last site',destination:'Verified destination',intermediate_stops:[],evidence_refs:[],explanation:'Employee official journey explanation',travel_mode:'bike',requested_km:40,journey_total_km:40,idempotency_key:'stable_request_key_001'};}
test('submission validates required official journey evidence, October bounds and mode',()=>{
 assert.equal(validateRecoveryJourney(journey()).requested_km,40);
 for(const extra of [{date:'2026-11-01'},{journey_total_km:20},{travel_mode:'flight'},{explanation:''},{idempotency_key:'short'},{journey_end:'2026-10-23T10:00:00Z'}])assert.throws(()=>validateRecoveryJourney({...journey(),...extra}));
});
test('inactive gates and unauthorized users cannot reach persistence',async()=>{
 let writes=0;const client={rpc(){writes++;throw Error('Must not write');}};const service=createOctoberRecoveryService({environment:{}}),context={client,profile,authUser:{id:'admin-auth'}};
 await assert.rejects(service.submit(context,journey()),e=>e.code==='RECOVERY_REQUESTS_INACTIVE');await assert.rejects(service.decide(context,{action:'approve'}),e=>e.code==='RECOVERY_APPROVAL_INACTIVE');
 for(const role of ['FO','Finance','Management','Branch Head'])await assert.rejects(service.submit({...context,profile:{...profile,role}},journey()),e=>e.statusCode===403);
 assert.equal(writes,0);
});
test('HTTP authorization is checked before privileged client acquisition on all entry points',async()=>{
 let acquired=0;const app=express();app.use(express.json());app.use(createOctoberRecoveryRouter({requireAuth:(req,res,next)=>{req.profile={...profile,role:'FO'};req.authUser={id:'fo'};next();},getClient(){acquired++;throw Error('Forbidden');}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 try{for(const [method,path] of [['GET','/october-recovery'],['GET','/october-recovery.csv'],['POST','/october-recovery/evidence'],['POST','/october-recovery/requests'],['POST','/october-recovery/decision']])assert.equal((await fetch(`http://127.0.0.1:${server.address().port}${path}`,{method,...(method==='POST'?{headers:{'Content-Type':'application/json'},body:'{}'}:{})})).status,403);assert.equal(acquired,0);}finally{await new Promise(resolve=>server.close(resolve));}
});
