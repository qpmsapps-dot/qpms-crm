import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {isolatedKmPostgres} from './helpers/isolatedKmPostgres.js';
import {processKmReconciliationJobs} from '../services/foKmReconciliationWorker.js';
import {reconcileSupportedKm} from '../services/foKmIncrementalReconciliationService.js';
import {storedAttendancePayableKm,storedAttendancePetrolAmount} from '../services/operationsSummaryService.js';

const root=fileURLToPath(new URL('../../',import.meta.url));
test('ordinary site arrivals persist verified closed journeys before End Day without Admin approval',{
 skip:process.env.RUN_KM_AUTOMATION_POSTGRES_TESTS!=='true',timeout:300000,
},async t=>{
 const db=isolatedKmPostgres();const {sql,json}=db;
 const oldFetch=globalThis.fetch,oldGoogle=process.env.ENABLE_GOOGLE_DIRECTIONS;
 const environment={KM_CANONICAL_AUTOMATION_ENABLED:'true',KM_CANONICAL_POLICY_ENABLED:'true',KM_SHARED_RECONCILIATION_ENABLED:'true',KM_INCREMENTAL_REPORTING_ENABLED:'true',END_DAY_KM_AUTO_RECALC_ENABLED:'true',KM_FINANCIAL_WRITES_EMERGENCY_PAUSE:'true',KM_FINANCIAL_WRITES_MAINTENANCE:'true'};
 const state=id=>json(`select jsonb_build_object('attendance',to_jsonb(a),'credits',(select coalesce(jsonb_agg(to_jsonb(c) order by id),'[]') from fo_km_incremental_credits c where attendance_id=a.id),'job',(select to_jsonb(j) from fo_km_reconciliation_jobs j where attendance_id=a.id)) from fo_attendance a where id='${id}'`);
 const due=id=>sql(`update fo_km_reconciliation_jobs set not_before=clock_timestamp()-interval '1 second' where attendance_id='${id}'`);
 const dispatch=async id=>{due(id);const r=await processKmReconciliationJobs(db.client,{environment,limit:1});assert.equal(r.processed,1,JSON.stringify(r));assert.equal(r.results[0].attendance_id,id);return r.results[0];};
 const fixture=(code,mode='bike',allowed=true)=>{
  const id=crypto.randomUUID(),profile=crypto.randomUUID();
  sql(`insert into profiles(id,auth_user_id,employee_code,full_name,role,is_active,status) values('${profile}','${profile}','${code}','Synthetic live journey','FO',true,'Active');
  insert into fo_attendance(id,fo_user_id,employee_code,attendance_date,login_time,status,start_latitude,start_longitude,end_latitude,end_longitude,travel_mode,payable_km_allowed,rate_per_km) values('${id}','${code}','${code}','2026-10-26','2026-10-26T03:00:00.000567Z','Active',12,75,12,75.02,'${mode}',${allowed},${mode==='car'?8:4});
  insert into fo_location_logs(id,attendance_id,employee_code,fo_user_id,latitude,longitude,accuracy,captured_at,logged_at,source,is_mocked) select gen_random_uuid(),'${id}','${code}','${code}',12,75+n*0.02/60,5,'2026-10-26T03:00Z'::timestamptz+n*interval '1 minute','2026-10-26T03:00Z'::timestamptz+n*interval '1 minute','mobile',false from generate_series(0,60) n;`);
  return {id,code,profile};
 };
 const arrival=(a,minute,lng,route=null)=>{
  const id=crypto.randomUUID();sql(`insert into fo_site_visits(id,attendance_id,fo_user_id,employee_code,check_in_time,check_in_latitude,check_in_longitude,status,route_km) values('${id}','${a.id}','${a.code}','${a.code}','2026-10-26T03:${minute}:00.000432Z',12,${lng},'Checked In',${route==null?'null':route})`);return id;
 };
 const checkout=(visit,minute,lng,eligible=true)=>sql(`update fo_site_visits set check_out_time='2026-10-26T03:${minute}:00.000654Z',check_out_latitude=12,check_out_longitude=${lng},status='Completed',petrol_eligible_after_checkout=${eligible} where id='${visit}'`);
 const end=a=>sql(`update fo_attendance set logout_time='2026-10-26T04:00:00.000765Z',status='Completed' where id='${a.id}'`);
 let failure;
 const check=async(name,fn)=>{await t.test(name,async()=>{try{await fn();}catch(e){failure=e;throw e;}});if(failure)throw failure;};
 try{
  await db.ready();globalThis.fetch=async()=>{throw Error('External network forbidden in isolated live journey test');};process.env.ENABLE_GOOGLE_DIRECTIONS='false';
  sql(fs.readFileSync(root+'supabase/tests/fixtures/239_production_financial_contract.sql','utf8'));
  for(const file of ['supabase/migrations_2_0/049_fo_missing_km_reviews.sql','supabase/proposals/239_shared_km_incremental_reconciliation.sql','supabase/proposals/240_scoped_km_financial_authorization.sql','supabase/proposals/241_canonical_km_policy.sql','supabase/migrations_2_0/246_fo_attendance_scoped_km_policy.sql','supabase/migrations_2_0/247_fo_ordinary_km_automation.sql','supabase/migrations_2_0/248_fo_guarded_missing_km_approval.sql'])sql(fs.readFileSync(root+file,'utf8').replaceAll('\r',''));
  // Install the existing legacy visit trigger omitted by the minimal 239
  // fixture, so positive old-client route metadata exercises the real 249 guard.
  const oldVisit=fs.readFileSync(root+'supabase/migrations_2_0/003_km_recalculation.sql','utf8').replaceAll('\r','');
  const oldV2=fs.readFileSync(root+'supabase/migrations_2_0/200_fo_canonical_km_engine_v2_reconciliation.sql','utf8').replaceAll('\r','');
  sql(oldV2.match(/create or replace function public\.refresh_fo_attendance_payable_route_km\([\s\S]*?\$function\$;/i)[0]);
  sql(oldVisit.match(/create or replace function public\.trg_refresh_fo_attendance_payable_route_km\(\)[\s\S]*?\$\$;/i)[0]);
  sql('create trigger trg_fo_site_visits_payable_route_km after insert or delete or update of route_km,attendance_id on fo_site_visits for each row execute function trg_refresh_fo_attendance_payable_route_km()');
  sql(fs.readFileSync(root+'supabase/migrations_2_0/249_fo_live_journey_km.sql','utf8').replaceAll('\r',''));
  sql(fs.readFileSync(root+'supabase/migrations_2_0/250_fo_active_mode_receipt_compatibility.sql','utf8').replaceAll('\r',''));
  sql(fs.readFileSync(root+'supabase/migrations_2_0/251_fo_final_leg_reconciliation.sql','utf8').replaceAll('\r',''));
  const history=crypto.randomUUID();
  // Historical values are fixture input established before this acceptance run,
  // never inserted as expected results for an attendance under test.
  sql(`insert into fo_attendance(id,fo_user_id,employee_code,attendance_date,login_time,logout_time,status,total_approved_km,eligible_km,total_route_km,petrol_amount) values('${history}','LOCAL_HISTORY','LOCAL_HISTORY','2026-10-22','2026-10-22T03:00Z','2026-10-22T04:00Z','Completed',0,0,0,0)`);
  const historyBefore=state(history);
  sql("update fo_km_automatic_control set enabled=true,maximum_attendance_km=250,maximum_attendance_amount=2000,reason='Isolated live journey acceptance'");
  const bike=fixture('LOCAL_LIVE_BIKE');let first,second,beforeEnd;
  await check('live control installs disabled and service role cannot release it',async()=>{
   assert.equal(json('select to_jsonb(live_site_enabled) from fo_km_automatic_control'),false);
   first=arrival(bike,'20',75.0066667,999);due(bike.id);assert.equal((await processKmReconciliationJobs(db.client,{environment,limit:1})).processed,0);
   assert.equal(state(bike.id).attendance.total_approved_km,0);
   assert.throws(()=>sql('update fo_km_automatic_control set live_site_enabled=true',true),/permission denied/);
   sql("update fo_km_automatic_control set live_site_enabled=true,reason='Isolated live journey enable'");
   // Untrusted route metadata is not a GPS calculation input or payable proof.
   // Remove that deliberately invalid old-client value before the positive GPS case.
   sql(`update fo_site_visits set route_km=null where id='${first}'`);
  });
  await check('first arrival enqueues and real worker posts only supported start journey while attendance is active',async()=>{
   const initial=state(bike.id);assert.equal(initial.attendance.logout_time,null);assert.equal(initial.attendance.total_approved_km,0);assert.equal(initial.job.trigger_source,'site_visit');
   const r=await dispatch(bike.id);assert.equal(r.financial_posted,true,JSON.stringify(r));assert.ok(r.additionalKm>0&&r.additionalKm<10);assert.equal(r.additionalAmount,Math.round(r.additionalKm*400)/100);
   const s=state(bike.id);assert.equal(s.attendance.logout_time,null);assert.equal(s.attendance.total_approved_km,r.additionalKm);assert.equal(s.attendance.petrol_amount,r.additionalAmount);assert.equal(storedAttendancePayableKm(s.attendance),r.additionalKm);assert.equal(storedAttendancePetrolAmount(s.attendance),r.additionalAmount);assert.ok(s.credits.length>0);assert.deepEqual([...new Set(s.credits.map(c=>c.evidence.type))],['start_to_first_checkin']);
   assert.equal(json('select count(*) from fo_km_attendance_authorizations'),0);assert.equal(json('select count(*) from fo_missing_km_reviews'),0);
  });
  await check('active leg validator rejects missing type, shortened unrecorded windows and forged mode segments',()=>{
   const before=state(bike.id),leg=before.credits[0].evidence;
   const accepts=value=>json(`select to_jsonb(fo_km_live_leg_v249(a,${db.q(JSON.stringify(value))}::jsonb)) from fo_attendance a where id='${bike.id}'`);
   assert.equal(accepts(leg),true);
   assert.equal(accepts({...leg,type:null}),false);
   assert.equal(accepts({...leg,from_time:'2026-10-26T03:01Z',to_time:'2026-10-26T03:19Z',mode_segment:false}),false);
   assert.equal(accepts({...leg,from_time:'2026-10-26T03:01Z',to_time:'2026-10-26T03:19Z',mode_segment:true,persisted_travel_leg_id:null}),false);
   assert.deepEqual(state(bike.id),before);
  });
  await check('delayed GPS for closed first journey enqueues once and real retry adds zero',async()=>{
   const before=state(bike.id);sql(`insert into fo_location_logs(id,attendance_id,employee_code,fo_user_id,latitude,longitude,accuracy,captured_at,logged_at,source,is_mocked) values(gen_random_uuid(),'${bike.id}','${bike.code}','${bike.code}',12,75.0033333,5,'2026-10-26T03:10Z','2026-10-26T03:10Z','mobile',false)`);
   assert.ok(state(bike.id).job.generation>before.job.generation);const r=await dispatch(bike.id);assert.equal(r.additionalKm,0);assert.equal(r.additionalAmount,0);assert.deepEqual(state(bike.id).credits,before.credits);
  });
  await check('second check-in increases saved cumulative KM only by verified inter-site travel',async()=>{
   checkout(first,'25',75.0083333);const before=state(bike.id);second=arrival(bike,'40',75.0133333);const r=await dispatch(bike.id);assert.equal(r.financial_posted,true,JSON.stringify(r));assert.ok(r.additionalKm>0);const s=state(bike.id);assert.equal(s.attendance.total_approved_km,Math.round((before.attendance.total_approved_km+r.additionalKm)*100)/100);assert.equal(s.attendance.petrol_amount,Math.round(s.attendance.total_approved_km*400)/100);assert.ok(s.credits.some(c=>c.evidence.type==='site_checkout_to_next_checkin'));assert.ok(!s.credits.some(c=>c.evidence.type==='last_checkout_to_end_day'));beforeEnd=s;
  });
  await check('ongoing GPS beyond latest arrival does not constantly enqueue active unclosed travel',()=>{
   const before=state(bike.id);sql(`insert into fo_location_logs(id,attendance_id,employee_code,fo_user_id,latitude,longitude,accuracy,captured_at,logged_at,source,is_mocked) values(gen_random_uuid(),'${bike.id}','${bike.code}','${bike.code}',12,75.014,5,'2026-10-26T03:42Z','2026-10-26T03:42Z','mobile',false)`);const after=state(bike.id);assert.equal(after.job.generation,before.job.generation);assert.deepEqual(after.credits,before.credits);
  });
  await check('ongoing GPS does not invalidate a claimed closed-window reconciliation digest',async()=>{
   const before=state(bike.id);sql(`insert into fo_location_logs(id,attendance_id,employee_code,fo_user_id,latitude,longitude,accuracy,captured_at,logged_at,source,is_mocked) values(gen_random_uuid(),'${bike.id}','${bike.code}','${bike.code}',12,75.01,5,'2026-10-26T03:30Z','2026-10-26T03:30Z','mobile',false)`);due(bike.id);
   const claim=await db.client.rpc('rpc_claim_fo_automatic_km_v1');assert.equal(claim.error,null);assert.ok(claim.data,JSON.stringify(claim));
   sql(`insert into fo_location_logs(id,attendance_id,employee_code,fo_user_id,latitude,longitude,accuracy,captured_at,logged_at,source,is_mocked) values(gen_random_uuid(),'${bike.id}','${bike.code}','${bike.code}',12,75.0143333,5,'2026-10-26T03:43Z','2026-10-26T03:43Z','mobile',false)`);
   sql(`update fo_attendance set actual_travel_km=12.34,actual_travel_updated_at=clock_timestamp(),updated_at=clock_timestamp(),metadata=metadata||jsonb_build_object('gps_trigger_role','service_role','gps_trigger_calculation_version','GPS_AUDIT') where id='${bike.id}'`);
   assert.equal(state(bike.id).job.generation,claim.data.generation);
   assert.equal(json(`select to_jsonb(fo_km_attendance_evidence_v246('${bike.id}')->>'evidence_digest')`),claim.data.claimed_evidence_digest);
   const r=await reconcileSupportedKm(db.client,{attendance_id:bike.id},{environment,trigger:claim.data.trigger_source,actorSource:claim.data.lease,automaticKm:true,persist:true,maxGoogleDirectionsCalls:0});assert.equal(r.additionalKm,0);assert.equal(r.financial_posted,false);assert.deepEqual(state(bike.id).credits,before.credits);
   const finish=await db.client.rpc('rpc_finish_fo_km_reconciliation_v1',{p_attendance:bike.id,p_lease:claim.data.lease,p_posted:true,p_error:r.status});assert.equal(finish.error,null);
  });
  await check('End Day adds only remaining supported return journey and preserves earlier receipts',async()=>{
   checkout(second,'45',75.015);end(bike);const r=await dispatch(bike.id);assert.equal(r.financial_posted,true,JSON.stringify(r));assert.ok(r.additionalKm>0);const s=state(bike.id);assert.equal(s.attendance.total_approved_km,Math.round((beforeEnd.attendance.total_approved_km+r.additionalKm)*100)/100);for(const c of beforeEnd.credits)assert.deepEqual(s.credits.find(x=>x.id===c.id),c);for(const type of ['start_to_first_checkin','site_checkout_to_next_checkin','last_checkout_to_end_day'])assert.ok(s.credits.some(c=>c.evidence.type===type));
  });
  await check('existing car rate remains eight per KM for real active journey persistence',async()=>{
   const car=fixture('LOCAL_LIVE_CAR','car');arrival(car,'20',75.0066667);const r=await dispatch(car.id);assert.equal(r.financial_posted,true,JSON.stringify(r));assert.ok(r.additionalKm>0);assert.equal(r.additionalAmount,Math.round(r.additionalKm*800)/100);assert.equal(state(car.id).attendance.petrol_amount,r.additionalAmount);
  });
  await check('explicit nonpayable train journey is not credited',async()=>{
   const train=fixture('LOCAL_LIVE_TRAIN','train',false);arrival(train,'20',75.0066667);const r=await dispatch(train.id);assert.equal(r.financial_posted,false);assert.equal(state(train.id).attendance.total_approved_km,0);assert.equal(state(train.id).credits.length,0);
  });
  await check('Bike Train Bike mode windows retain nonpayable train exclusion and existing Bike rate',async()=>{
   const mixed=fixture('LOCAL_LIVE_MIXED');
   sql(`insert into fo_travel_legs(id,attendance_id,employee_code,fo_user_id,travel_mode,payable_km_allowed,started_at,ended_at,start_lat,start_lng,end_lat,end_lng,status,rate_per_km) values
   (gen_random_uuid(),'${mixed.id}','${mixed.code}','${mixed.code}','bike',true,'2026-10-26T03:00:00.000567Z','2026-10-26T03:06Z',12,75,12,75.002,'completed',4),
   (gen_random_uuid(),'${mixed.id}','${mixed.code}','${mixed.code}','train',false,'2026-10-26T03:06Z','2026-10-26T03:13Z',12,75.002,12,75.0043333,'completed',0),
   (gen_random_uuid(),'${mixed.id}','${mixed.code}','${mixed.code}','bike',true,'2026-10-26T03:13Z','2026-10-26T03:20:00.000432Z',12,75.0043333,12,75.0066667,'completed',4);
   insert into fo_location_logs(id,attendance_id,employee_code,fo_user_id,latitude,longitude,accuracy,captured_at,logged_at,source,is_mocked) select gen_random_uuid(),'${mixed.id}','${mixed.code}','${mixed.code}',12,75+n*0.02/240,5,'2026-10-26T03:00Z'::timestamptz+n*interval '15 seconds','2026-10-26T03:00Z'::timestamptz+n*interval '15 seconds','mobile',false from generate_series(0,80) n;`);
   arrival(mixed,'20',75.0066667);const r=await dispatch(mixed.id);assert.equal(r.financial_posted,true,JSON.stringify(r));assert.ok(r.additionalKm>0);assert.equal(r.additionalAmount,Math.round(r.additionalKm*400)/100);
   const s=state(mixed.id);assert.ok(s.credits.length>=2);assert.ok(s.credits.every(c=>c.evidence.travel_mode==='bike'));assert.ok(r.unresolved.some(l=>l.travel_mode==='train'&&l.payable_km_allowed===false));
  });
  await check('stationary zero GPS is retained as unresolved evidence rather than invented payable KM',async()=>{
   const zero=fixture('LOCAL_LIVE_ZERO');sql(`update fo_location_logs set longitude=75 where attendance_id='${zero.id}'`);arrival(zero,'20',75,0);const r=await dispatch(zero.id);assert.equal(r.financial_posted,false);assert.equal(r.additionalKm,0);assert.ok(r.unresolved.length>0);assert.equal(state(zero.id).attendance.total_approved_km,0);assert.equal(state(zero.id).credits.length,0);
  });
  await check('unresolved checkout eligibility excludes inter-site KM without blocking independent start journey',async()=>{
   const review=fixture('LOCAL_LIVE_REVIEW');const a=arrival(review,'20',75.0066667);const start=await dispatch(review.id);assert.equal(start.financial_posted,true,JSON.stringify(start));const before=state(review.id);checkout(a,'25',75.0083333,false);arrival(review,'40',75.0133333);const r=await dispatch(review.id);assert.equal(r.additionalKm,0);assert.equal(r.financial_posted,false);assert.deepEqual(state(review.id).credits,before.credits);assert.ok(r.unresolved.some(l=>(l.review_flags||[]).includes('CHECKOUT_ELIGIBILITY_REVIEW_REQUIRED')));
  });
  await check('authenticated owner can switch modes after live payment without repricing or losing receipts',async()=>{
   const change=fixture('LOCAL_LIVE_CHANGE');const visit=arrival(change,'20',75.0066667);await dispatch(change.id);const before=state(change.id);
   sql('grant select,update on fo_attendance to authenticated');
   sql("create policy test_live_owner_mode on fo_attendance for all to authenticated using(exists(select 1 from profiles p where p.auth_user_id=auth.uid() and p.employee_code=fo_attendance.employee_code)) with check(exists(select 1 from profiles p where p.auth_user_id=auth.uid() and p.employee_code=fo_attendance.employee_code))");
   const mode=(value,allowed,actor=change.profile)=>sql(`set role authenticated;set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='${actor}';update fo_attendance set travel_mode='${value}',rate_per_km=4,payable_km_allowed=${allowed},metadata=jsonb_build_object('previous_travel_mode',travel_mode,'travel_mode_changed_at',clock_timestamp()) where id='${change.id}'`);
   mode('train',false,crypto.randomUUID());assert.equal(state(change.id).attendance.travel_mode,'bike');mode('train',false);assert.equal(state(change.id).attendance.travel_mode,'train');assert.equal(state(change.id).attendance.total_approved_km,before.attendance.total_approved_km);assert.equal(state(change.id).attendance.metadata.shared_km_last_receipt,before.attendance.metadata.shared_km_last_receipt);mode('bike',true);
   sql(`insert into fo_travel_legs(id,attendance_id,employee_code,fo_user_id,travel_mode,payable_km_allowed,started_at,ended_at,start_lat,start_lng,end_lat,end_lng,status,rate_per_km) values(gen_random_uuid(),'${change.id}','${change.code}','${change.code}','bike',true,'2026-10-26T03:00:00.000567Z','2026-10-26T03:20:00.000432Z',12,75,12,75.0066667,'completed',4),(gen_random_uuid(),'${change.id}','${change.code}','${change.code}','bike',true,'2026-10-26T03:25:00.000654Z','2026-10-26T03:40:00.000432Z',12,75.0083333,12,75.0133333,'completed',4)`);
   checkout(visit,'25',75.0083333);arrival(change,'40',75.0133333);const next=await dispatch(change.id);assert.equal(next.financial_posted,true,JSON.stringify(next));assert.ok(next.additionalKm>0);const after=state(change.id);for(const c of before.credits)assert.deepEqual(after.credits.find(x=>x.id===c.id),c);assert.equal(after.credits.filter(c=>c.evidence.type==='start_to_first_checkin').length,before.credits.length);
   assert.throws(()=>sql(`update fo_attendance set travel_mode='car',rate_per_km=8 where id='${change.id}'`,true),/identity_mode_protected/);
   end(change);assert.throws(()=>mode('train',false),/identity_mode_protected/);
  });
  await check('live kill switch blocks active pickup while existing normal End Day still processes',async()=>{
   sql("update fo_km_automatic_control set live_site_enabled=false,reason='Isolated live journey stop'");const off=fixture('LOCAL_LIVE_OFF');arrival(off,'20',75.0066667);due(off.id);assert.equal((await processKmReconciliationJobs(db.client,{environment,limit:1})).processed,0);assert.equal(state(off.id).attendance.total_approved_km,0);end(off);const r=await dispatch(off.id);assert.equal(r.financial_posted,true,JSON.stringify(r));assert.ok(state(off.id).attendance.total_approved_km>0);
  });
  await check('bounded historical reconciliation posts only the final return, protects prior journeys and replays zero',async()=>{
   const old=fixture('LOCAL_HISTORICAL_FINAL');const visit=arrival(old,'20',75.0066667);checkout(visit,'25',75.0083333);end(old);
   sql("update fo_km_automatic_control set effective_from='2026-10-27',reason='Isolated effective date boundary'");due(old.id);assert.equal((await processKmReconciliationJobs(db.client,{environment,limit:1})).processed,0);
   assert.throws(()=>sql(`select fo_queue_final_leg_reconciliation_v251(array['${old.id}']::uuid[],'Unauthorized')`,true),/permission denied/);
   sql(`select fo_queue_final_leg_reconciliation_v251(array['${old.id}']::uuid[],'Isolated supported historical final return')`);const r=await dispatch(old.id);assert.equal(r.financial_posted,true,JSON.stringify(r));assert.ok(r.additionalKm>0);let s=state(old.id);assert.ok(s.credits.every(c=>c.evidence.type==='last_checkout_to_end_day'));assert.equal(s.attendance.metadata.shared_km_final_leg.financial_receipt_id,s.credits[0].id);
   const before=s.credits;sql(`select fo_queue_final_leg_reconciliation_v251(array['${old.id}']::uuid[],'Isolated zero-addition verification')`);const retry=await dispatch(old.id);assert.equal(retry.additionalKm,0);assert.deepEqual(state(old.id).credits,before);assert.equal(state(old.id).attendance.metadata.shared_km_final_leg.last_reconciliation_additional_km,0);assert.equal(state(old.id).attendance.metadata.final_return_leg_km,r.additionalKm);
   assert.throws(()=>sql(`select fo_queue_final_leg_reconciliation_v251(array['${history}']::uuid[],'Protected unmatched identity')`),/ineligible/);
  });
  await check('sparse final GPS uses actual provider response through real guarded persistence and outage retries',async()=>{
   const oldKey=process.env.GOOGLE_MAPS_API_KEY;const oldGoogleEnabled=process.env.ENABLE_GOOGLE_DIRECTIONS;
   try{process.env.ENABLE_GOOGLE_DIRECTIONS='true';process.env.GOOGLE_MAPS_API_KEY='isolated-provider-fixture';
    const routed=fixture('LOCAL_SPARSE_FINAL');const visit=arrival(routed,'20',75.0066667);checkout(visit,'25',75.0083333);end(routed);sql(`delete from fo_location_logs where attendance_id='${routed.id}';update fo_attendance set metadata=metadata||'{"end_location_accuracy":5,"end_location_captured_at":"2026-10-26T04:00Z"}' where id='${routed.id}';select fo_queue_final_leg_reconciliation_v251(array['${routed.id}']::uuid[],'Isolated sparse final recovery')`);due(routed.id);
    globalThis.fetch=async()=>({ok:false,status:503,statusText:'Fixture outage'});
    const env={...environment,END_DAY_KM_AUTO_RECALC_MAX_GOOGLE_DIRECTIONS_CALLS:'4'};const failed=await processKmReconciliationJobs(db.client,{environment:env,limit:1});assert.equal(failed.results[0].financial_posted,false);assert.equal(state(routed.id).job.state,'deferred');assert.equal(state(routed.id).credits.length,0);
    let providerCalls=0,providerDistance=1800;globalThis.fetch=async url=>{assert.equal(new URL(url).hostname,'maps.googleapis.com');providerCalls++;return{ok:true,status:200,json:async()=>({status:'OK',routes:[{legs:[{distance:{value:providerDistance},duration:{value:300}}]}]})};};due(routed.id);
    const success=await processKmReconciliationJobs(db.client,{environment:env,limit:1});assert.equal(success.results[0].financial_posted,true,JSON.stringify(success));assert.equal(success.results[0].additionalKm,1.8);assert.equal(success.results[0].additionalAmount,7.2);assert.ok(providerCalls>0);assert.equal(state(routed.id).attendance.metadata.shared_km_final_leg.source,'GOOGLE_ROUTE_FALLBACK');const credits=state(routed.id).credits;providerDistance=1910;
    sql(`select fo_queue_final_leg_reconciliation_v251(array['${routed.id}']::uuid[],'Sparse final zero addition retry')`);due(routed.id);const retry=await processKmReconciliationJobs(db.client,{environment:env,limit:1});assert.equal(retry.results[0].additionalKm,0);assert.deepEqual(state(routed.id).credits,credits);
   }finally{globalThis.fetch=async()=>{throw Error('External network forbidden');};process.env.ENABLE_GOOGLE_DIRECTIONS=oldGoogleEnabled;if(oldKey===undefined)delete process.env.GOOGLE_MAPS_API_KEY;else process.env.GOOGLE_MAPS_API_KEY=oldKey;}
  });
  await check('emergency/general controls, manual approval separation and historical values remain unchanged',()=>{
   assert.equal(json('select to_jsonb(emergency_pause) from fo_km_scope_control'),true);assert.equal(json('select to_jsonb(financial_writes_enabled) from fo_km_financial_control'),false);assert.equal(json('select to_jsonb(enabled) from fo_km_canonical_policy'),false);assert.equal(json('select to_jsonb(enabled) from fo_km_missing_approval_control'),false);assert.equal(json('select count(*) from fo_km_attendance_authorizations'),0);assert.deepEqual(state(history),historyBefore);
  });
 }finally{globalThis.fetch=oldFetch;if(oldGoogle===undefined)delete process.env.ENABLE_GOOGLE_DIRECTIONS;else process.env.ENABLE_GOOGLE_DIRECTIONS=oldGoogle;db.close();}
});
