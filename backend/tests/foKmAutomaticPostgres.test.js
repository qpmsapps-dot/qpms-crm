import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {isolatedKmPostgres} from './helpers/isolatedKmPostgres.js';
import {processKmReconciliationJobs} from '../services/foKmReconciliationWorker.js';
import {reconcileSupportedKm} from '../services/foKmIncrementalReconciliationService.js';
import {persistCanonicalKmV2} from '../services/foKmV2PersistenceService.js';

const root=fileURLToPath(new URL('../../',import.meta.url));
test('ordinary End Day survives the 21 October hold without manual scopes or general financial authority',{
 skip:process.env.RUN_KM_AUTOMATION_POSTGRES_TESTS!=='true',timeout:240000,
},async t=>{
 const db=isolatedKmPostgres();const {sql,json,client,q}=db;
 const oldFetch=globalThis.fetch,oldGoogle=process.env.ENABLE_GOOGLE_DIRECTIONS;
 const attendance=crypto.randomUUID(),profile=crypto.randomUUID(),history=crypto.randomUUID();
 const environment={KM_CANONICAL_AUTOMATION_ENABLED:'true',KM_CANONICAL_POLICY_ENABLED:'true',KM_SHARED_RECONCILIATION_ENABLED:'true',KM_INCREMENTAL_REPORTING_ENABLED:'true',END_DAY_KM_AUTO_RECALC_ENABLED:'true',KM_FINANCIAL_WRITES_EMERGENCY_PAUSE:'true',KM_FINANCIAL_WRITES_MAINTENANCE:'true'};
 const financial=()=>json(`select jsonb_build_object('a',(select jsonb_agg(jsonb_build_array(id,total_approved_km,eligible_km,total_route_km,petrol_amount) order by id) from fo_attendance),'credits',(select coalesce(jsonb_agg(to_jsonb(c) order by id),'[]') from fo_km_incremental_credits c),'settlements',(select coalesce(jsonb_agg(to_jsonb(s) order by id),'[]') from fo_monthly_travel_settlements s))`);
 let failed;
 const check=async(name,fn)=>{await t.test(name,async()=>{try{await fn();}catch(e){failed=e;throw e;}});if(failed)throw failed;};
 try{
 await db.ready();globalThis.fetch=async()=>{throw Error('Network forbidden in isolated ordinary KM test');};process.env.ENABLE_GOOGLE_DIRECTIONS='false';
 sql(fs.readFileSync(root+'supabase/tests/fixtures/239_production_financial_contract.sql','utf8'));
 sql(`insert into profiles(id,auth_user_id,employee_code,full_name,role,is_active,status) values('${profile}','${profile}','LOCAL_AUTO','Synthetic ordinary employee','FO',true,'Active');
 insert into fo_attendance(id,fo_user_id,employee_code,attendance_date,login_time,logout_time,status,total_approved_km,eligible_km,total_route_km,petrol_amount) values('${history}','LOCAL_HISTORY','LOCAL_HISTORY','2026-10-22','2026-10-22T03:00Z','2026-10-22T04:00Z','Completed',25,25,25,100);
 insert into fo_monthly_travel_settlements(profile_id,employee_code,state,period_start,period_end,calculated_claim_amount,approved_payable_amount,adjustment_amount,adjustment_type,source_reference,approved_at) values('${profile}','LOCAL_HISTORY','Tamil Nadu','2026-10-01','2026-10-31',100,100,0,'none','SYNTHETIC_APPROVED_HISTORY',now());`);
 for(const file of ['supabase/proposals/239_shared_km_incremental_reconciliation.sql','supabase/proposals/240_scoped_km_financial_authorization.sql','supabase/proposals/241_canonical_km_policy.sql','supabase/migrations_2_0/246_fo_attendance_scoped_km_policy.sql','supabase/migrations_2_0/247_fo_ordinary_km_automation.sql'])sql(fs.readFileSync(root+file,'utf8').replaceAll('\r',''));
 sql(`insert into fo_attendance(id,fo_user_id,employee_code,attendance_date,login_time,status,start_latitude,start_longitude,end_latitude,end_longitude,travel_mode,payable_km_allowed,rate_per_km) values('${attendance}','LOCAL_AUTO','LOCAL_AUTO','2026-10-26','2026-10-26T03:00:00.000567Z','Active',12,75,12,75.02,'bike',true,4);
 insert into fo_site_visits(id,attendance_id,fo_user_id,employee_code,check_in_time,check_out_time,check_in_latitude,check_in_longitude,check_out_latitude,check_out_longitude,status) values(gen_random_uuid(),'${attendance}','LOCAL_AUTO','LOCAL_AUTO','2026-10-26T03:20Z','2026-10-26T03:25Z',12,75.0066667,12,75.0083333,'Completed'),(gen_random_uuid(),'${attendance}','LOCAL_AUTO','LOCAL_AUTO','2026-10-26T03:40Z','2026-10-26T03:45Z',12,75.0133333,12,75.015,'Completed');
 insert into fo_location_logs(id,attendance_id,employee_code,fo_user_id,latitude,longitude,accuracy,captured_at,logged_at,source,is_mocked) select gen_random_uuid(),'${attendance}','LOCAL_AUTO','LOCAL_AUTO',12,75+n*0.02/60,5,'2026-10-26T03:00Z'::timestamptz+n*interval '1 minute','2026-10-26T03:00Z'::timestamptz+n*interval '1 minute','mobile',false from generate_series(0,60) n;`);
 const historyBefore=json(`select to_jsonb(a) from fo_attendance a where id='${history}'`);
 await check('actual End Day trigger creates current provenance; active day created no job',()=>{
  assert.equal(json(`select count(*) from fo_km_reconciliation_jobs where attendance_id='${attendance}'`),0);
  sql(`update fo_attendance set logout_time='2026-10-26T04:00:00.000765Z',status='Completed' where id='${attendance}'`);
  const j=json(`select to_jsonb(j) from fo_km_reconciliation_jobs j where attendance_id='${attendance}'`);assert.equal(j.generation,1);assert.equal(j.trigger_source,'manual_end_day');
  assert.equal(json(`select to_jsonb(source_id::text) from fo_km_job_provenance where attendance_id='${attendance}'`),attendance);
  sql(`update fo_km_reconciliation_jobs set not_before=now()-interval '1 second' where attendance_id='${attendance}'`);
 });
 await check('old 246 worker remains held; disabled ordinary control does not claim',async()=>{
  assert.equal((await processKmReconciliationJobs(client,{environment:{...environment,KM_CANONICAL_AUTOMATION_ENABLED:'false'}})).disabled,true);
  assert.equal((await processKmReconciliationJobs(client,{environment})).processed,0);assert.equal(json(`select attempts from fo_km_reconciliation_jobs where attendance_id='${attendance}'`),0);
 });
 await check('private authorization cannot be forged and anonymous callers cannot claim',()=>{
  assert.throws(()=>sql("update fo_km_automatic_control set enabled=true",true),/permission denied/);
  assert.throws(()=>sql("set role authenticated;select rpc_claim_fo_automatic_km_v1()"),/permission denied/);
  assert.equal(json('select count(*) from fo_km_attendance_authorizations'),0);
 });
 sql(`update fo_km_automatic_control set enabled=true,maximum_attendance_km=10,maximum_attendance_amount=40,canary=${q(JSON.stringify({[attendance]:{generation:1,maximum_km:10,maximum_amount:40}}))}::jsonb,canary_expires_at=clock_timestamp()+interval '10 minutes',reason='Isolated canary';`);
 await check('canary expiry independently prevents pickup without changing global holds',async()=>{
  sql("update fo_km_automatic_control set canary_expires_at=clock_timestamp()+interval '200 milliseconds'");
  await new Promise(r=>setTimeout(r,500));
  const claim=await client.rpc('rpc_claim_fo_automatic_km_v1');assert.equal(claim.error,null);assert.equal(claim.data,null);assert.equal(json(`select attempts from fo_km_reconciliation_jobs where attendance_id='${attendance}'`),0);
  sql("update fo_km_automatic_control set canary_expires_at=clock_timestamp()+interval '10 minutes'");
 });
 await check('transient failure is deferred with bounded backoff and no credit',async()=>{
  const before=financial();const r=await processKmReconciliationJobs(client,{environment,limit:1,reconcile:async()=>{throw Object.assign(Error('Transient test'),{code:'40001'});}});assert.equal(r.results[0].financial_posted,false);assert.deepEqual(financial(),before);
  const j=json(`select to_jsonb(j) from fo_km_reconciliation_jobs j where attendance_id='${attendance}'`);assert.equal(j.state,'deferred');assert.equal(j.last_error,'40001');assert.ok(Date.parse(j.not_before)>Date.now());
  sql(`update fo_km_reconciliation_jobs set not_before=now()-interval '1 second' where attendance_id='${attendance}'`);
 });
 let posted;
 await check('real canonical engine persists all three leg types under held general controls',async()=>{
  const r=await processKmReconciliationJobs(client,{environment,limit:2});assert.equal(r.processed,1);posted=r.results[0];assert.equal(posted.financial_posted,true,JSON.stringify(posted));assert.ok(posted.additionalKm>0);assert.equal(posted.additionalAmount,Math.round(posted.additionalKm*400)/100);
  const a=json(`select to_jsonb(a) from fo_attendance a where id='${attendance}'`);assert.equal(a.total_approved_km,posted.additionalKm);assert.equal(a.petrol_amount,posted.additionalAmount);
  const types=json(`select jsonb_agg(distinct evidence->>'type') from fo_km_incremental_credits where attendance_id='${attendance}'`);for(const type of ['start_to_first_checkin','site_checkout_to_next_checkin','last_checkout_to_end_day'])assert.ok(types.includes(type),JSON.stringify(types));
  assert.equal(json('select to_jsonb(emergency_pause) from fo_km_scope_control'),true);assert.equal(json('select to_jsonb(financial_writes_enabled) from fo_km_financial_control'),false);assert.equal(json('select to_jsonb(enabled) from fo_km_canonical_policy'),false);assert.equal(json('select count(*) from fo_km_attendance_authorizations'),0);
 });
 await check('repeated scheduler dispatch and approved historical records are unchanged',async()=>{
  const before=financial();assert.equal((await processKmReconciliationJobs(client,{environment})).processed,0);assert.deepEqual(financial(),before);assert.deepEqual(json(`select to_jsonb(a) from fo_attendance a where id='${history}'`),historyBefore);
 });
 await check('delayed GPS bumps generation, survives expired lease and adds zero on replay/recalculation',async()=>{
  const before=financial();const gps=crypto.randomUUID();sql(`insert into fo_location_logs(id,attendance_id,employee_code,fo_user_id,latitude,longitude,accuracy,captured_at,logged_at,source,is_mocked) values('${gps}','${attendance}','LOCAL_AUTO','LOCAL_AUTO',12,75.01,5,'2026-10-26T03:30Z','2026-10-26T03:30Z','mobile',false)`);
  assert.equal(json(`select generation from fo_km_reconciliation_jobs where attendance_id='${attendance}'`),2);
  assert.equal((await client.rpc('rpc_claim_fo_automatic_km_v1')).data,null,'Old canary generation must not claim new evidence');
  sql("update fo_km_automatic_control set canary=null,canary_expires_at=null,reason='Isolated permanent ordinary mode'");
  sql(`update fo_km_reconciliation_jobs set not_before=now()-interval '1 second' where attendance_id='${attendance}'`);
  const abandoned=await client.rpc('rpc_claim_fo_automatic_km_v1');assert.equal(abandoned.error,null);assert.ok(abandoned.data);
  sql(`update fo_km_reconciliation_jobs set lease_until=now()-interval '1 second' where attendance_id='${attendance}'`);
  const claim=await client.rpc('rpc_claim_fo_automatic_km_v1');assert.equal(claim.error,null);assert.ok(claim.data);assert.notEqual(claim.data.lease,abandoned.data.lease);
  const preview=await reconcileSupportedKm(client,{attendance_id:attendance},{environment,persist:false,trigger:'late_gps',maxGoogleDirectionsCalls:0});assert.equal(preview.additionalKm,0);
  const replay=await persistCanonicalKmV2(client,{attendanceId:attendance,calculation:posted,sourceEntryPoint:'late_gps',actorSource:claim.data.lease,automaticKm:true,environment});assert.equal(replay.additionalKm,0);assert.equal(replay.additionalAmount,0);assert.equal(replay.idempotent_replay,true);
  const r=await reconcileSupportedKm(client,{attendance_id:attendance},{environment,persist:true,trigger:'late_gps',actorSource:claim.data.lease,automaticKm:true,maxGoogleDirectionsCalls:0});assert.equal(r.additionalKm,0);assert.equal(r.financial_posted,false);
  await client.rpc('rpc_finish_fo_km_reconciliation_v1',{p_attendance:attendance,p_lease:claim.data.lease,p_posted:true,p_error:'unchanged'});assert.deepEqual(financial(),before);
 });
 await check('ordinary kill switch and manual legacy financial gate remain independently effective',async()=>{
  sql("update fo_km_automatic_control set enabled=false,reason='Isolated stop'");assert.equal((await client.rpc('rpc_claim_fo_automatic_km_v1')).data,null);
  const legacy=await client.rpc('rpc_claim_fo_policy_km_v1');assert.equal(legacy.error.code,'55000');
  assert.deepEqual(json(`select to_jsonb(a) from fo_attendance a where id='${history}'`),historyBefore);
 });
 }finally{globalThis.fetch=oldFetch;if(oldGoogle===undefined)delete process.env.ENABLE_GOOGLE_DIRECTIONS;else process.env.ENABLE_GOOGLE_DIRECTIONS=oldGoogle;db.close();}
});
