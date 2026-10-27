import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {isolatedKmPostgres} from './helpers/isolatedKmPostgres.js';
import {decideMissingKmReview} from '../foKmRecalculationService.js';
import {storedAttendancePayableKm,storedAttendancePetrolAmount} from '../services/operationsSummaryService.js';
const root=fileURLToPath(new URL('../../',import.meta.url));
test('guarded Missing KM approval adds only an exceptional increment under both global holds',{
 skip:process.env.RUN_KM_APPROVAL_POSTGRES_TESTS!=='true',timeout:240000,
},async t=>{
 const db=isolatedKmPostgres(),{sql,json,client,q}=db;
 const admin={auth_user_id:crypto.randomUUID(),employee_code:'LOCAL_ADMIN',full_name:'Synthetic Admin',role:'Admin'};
 const read=client.from.bind(client);
 // Actual local SQL adapter for nonfinancial review/visit updates. Financial
 // success is never mocked; it must pass the production RPCs and triggers.
 client.from=table=>{const query=read(table);query.update=update=>{assert.ok(['fo_missing_km_reviews','fo_site_visits'].includes(table));query.then=(resolve,reject)=>{
  try{const assignments=Object.entries(update).map(([k,v])=>{assert.match(k,/^[a-z_]+$/);return '"'+k+'"='+(v===null?'null':typeof v==='object'?q(JSON.stringify(v))+'::jsonb':q(v));});const rows=json(`with changed as(update public."${table}" set ${assignments.join(',')} where ${query.where.join(' and ')} returning *) select jsonb_agg(to_jsonb(changed)) from changed`,true);return Promise.resolve({data:query.one?rows?.[0]:rows,error:null}).then(resolve,reject);}catch(e){return Promise.reject(e).then(resolve,reject);}
 };return query;};return query;};
 const approve=(r,km=1,actor=admin)=>decideMissingKmReview(client,r.id,'approve',{approved_missing_km:km,remarks:'Verified synthetic exceptional journey'},actor);
 const snap=id=>json(`select jsonb_build_object('attendance',(select to_jsonb(a) from fo_attendance a where id='${id}'),'credits',(select coalesce(jsonb_agg(to_jsonb(c) order by id),'[]') from fo_km_incremental_credits c where attendance_id='${id}'))`);
 // These are synthetic supported canonical input plans, not production GPS
 // proof. The existing ordinary RPC/core really posts the 40-KM baseline.
 const fixture=async(included=0,mode='bike',partialOverlap=false)=>{
  const id=crypto.randomUUID(),visit=crypto.randomUUID(),review=crypto.randomUUID(),profile=crypto.randomUUID(),code='LOCAL_'+id.slice(0,8).toUpperCase(),rate=mode==='car'?8:4;
  sql(`insert into profiles(id,auth_user_id,employee_code,full_name,role,is_active,status) values('${profile}','${profile}','${code}','Synthetic FO','FO',true,'Active');
  insert into fo_attendance(id,fo_user_id,employee_code,attendance_date,login_time,status,travel_mode,rate_per_km,payable_km_allowed) values('${id}','${code}','${code}','2026-10-26','2026-10-26T03:00Z','Active','${mode}',${rate},true);
  insert into fo_site_visits(id,attendance_id,fo_user_id,employee_code,check_in_time,check_out_time,status) values('${visit}','${id}','${code}','${code}','2026-10-26T04:00:00.000567Z','2026-10-26T04:10:00.000765Z','Completed');
  update fo_attendance set logout_time='2026-10-26T05:00Z',status='Completed' where id='${id}';
  update fo_km_reconciliation_jobs set not_before=now()-interval '1 second' where attendance_id='${id}';`);
  const claim=await client.rpc('rpc_claim_fo_automatic_km_v1');assert.equal(claim.error,null);assert.equal(claim.data.attendance_id,id);
  const state=await client.rpc('rpc_fo_km_reconciliation_state_v1',{p_attendance_id:id});
  const leg=(km,from,to,key)=>({type:'synthetic_supported_window',from_time:from,to_time:to,source:'GPS_BASED',travel_mode:mode,rate_per_km:rate,leg_key:crypto.createHash('sha256').update(id+key).digest('hex'),payable_km:km,new_eligible_km:km,baseline_km:0,payable:true,evidence_status:'supported'});
  const plan={calculationVersion:'KM_ENGINE_V2',incrementalRecovery:true,baselineKnown:true,inputDigest:crypto.createHash('sha256').update(id).digest('hex'),snapshot:state.data.digest,legs:[leg(40-included,'2026-10-26T03:00Z','2026-10-26T03:50Z','base'),...(included?[leg(included,partialOverlap?'2026-10-26T03:59Z':'2026-10-26T04:00:00.000567Z',partialOverlap?'2026-10-26T04:05Z':'2026-10-26T04:10:00.000765Z','included')]:[])],unresolved:[]};
  const post=await client.rpc('rpc_reconcile_fo_automatic_km_v1',{p_attendance_id:id,p_calculation:plan,p_trigger:claim.data.trigger_source,p_admin:null,p_lease:claim.data.lease});assert.equal(post.error,null,JSON.stringify(post.error));assert.equal(post.data.additionalKm,40);
  await client.rpc('rpc_finish_fo_km_reconciliation_v1',{p_attendance:id,p_lease:claim.data.lease,p_posted:true,p_error:null});
  sql(`insert into fo_missing_km_reviews(id,attendance_id,site_visit_id,employee_code,review_type,window_start_time,window_end_time,rate_per_km,suggested_missing_km,suggested_amount,filtered_gps_km,metadata) values('${review}','${id}','${visit}','${code}','checkout_exception','2026-10-26T04:00:00Z','2026-10-26T04:10:00Z',${rate},1,${rate},1,'{"detected_missing_km":1,"already_included_km":0,"incremental_determination":"defensible"}');`);
  return {id:review,attendance:id,visit,profile,code};
 };
 const env={maintenance:process.env.KM_FINANCIAL_WRITES_MAINTENANCE,emergency:process.env.KM_FINANCIAL_WRITES_EMERGENCY_PAUSE};
 try{
  await db.ready();sql(fs.readFileSync(root+'supabase/tests/fixtures/239_production_financial_contract.sql','utf8'));
  for(const file of ['supabase/migrations_2_0/049_fo_missing_km_reviews.sql','supabase/proposals/239_shared_km_incremental_reconciliation.sql','supabase/proposals/240_scoped_km_financial_authorization.sql','supabase/proposals/241_canonical_km_policy.sql','supabase/migrations_2_0/246_fo_attendance_scoped_km_policy.sql','supabase/migrations_2_0/247_fo_ordinary_km_automation.sql','supabase/migrations_2_0/248_fo_guarded_missing_km_approval.sql'])sql(fs.readFileSync(root+file,'utf8').replaceAll('\r',''));
  sql('grant update(metadata,updated_at) on fo_site_visits to service_role');
  sql(`insert into profiles(id,auth_user_id,employee_code,full_name,role,is_active,status) values('${admin.auth_user_id}','${admin.auth_user_id}','LOCAL_ADMIN','Synthetic Admin','Admin',true,'Active');update fo_km_automatic_control set enabled=true,maximum_attendance_km=250,maximum_attendance_amount=2000,reason='Isolated ordinary mode';`);
  process.env.KM_FINANCIAL_WRITES_MAINTENANCE='true';process.env.KM_FINANCIAL_WRITES_EMERGENCY_PAUSE='true';
  const a=await fixture();let posted;
  await t.test('A: pending exceptional1 leaves saved normal40KM/160; dedicated control initially off',async()=>{
   const before=snap(a.attendance);assert.equal(before.attendance.total_approved_km,40);assert.equal(before.attendance.petrol_amount,160);
   await assert.rejects(approve(a),/km_missing_approval_paused/);assert.deepEqual(snap(a.attendance),before);
   assert.throws(()=>sql('update fo_km_missing_approval_control set enabled=true',true),/permission denied/);
   sql("update fo_km_missing_approval_control set enabled=true,reason='Isolated approved feature enable'");
  });
  await t.test('B/H: authorized1 saves41KM/164 and matches API/reporting helpers',async()=>{
   posted=await approve(a);assert.equal(posted.additionalKm,1);assert.equal(posted.additionalAmount,4);assert.ok(posted.receipt_id);
   const saved=snap(a.attendance).attendance;assert.equal(saved.total_approved_km,41);assert.equal(saved.eligible_km,41);assert.equal(saved.petrol_amount,164);assert.equal(storedAttendancePayableKm(saved),41);assert.equal(storedAttendancePetrolAmount(saved),164);assert.equal(posted.totals.total_approved_km,41);
   const receipt=json(`select to_jsonb(c) from fo_km_incremental_credits c where id='${posted.receipt_id}'`);assert.equal(receipt.actor,admin.auth_user_id);assert.equal(receipt.evidence.type,'checkout_exception_approval');assert.equal(receipt.amount,4);
  });
  await t.test('C: same approval replays immutable receipt with0KM/0; changed amount denied',async()=>{
   const before=snap(a.attendance);const r=await approve(a);assert.equal(r.additionalKm,0);assert.equal(r.additionalAmount,0);assert.equal(r.receipt_id,posted.receipt_id);assert.equal(r.no_change,true);assert.deepEqual(snap(a.attendance),before);
   await assert.rejects(approve(a,2),/Financial adjustments require a separate review/);
   assert.throws(()=>sql(`update fo_km_policy_executions set result='{}' where missing_review_id='${a.id}'`),/km_missing_receipt_immutable/);
   assert.throws(()=>sql(`update fo_missing_km_reviews set status='rejected' where id='${a.id}'`),/km_missing_decision_immutable/);
  });
  await t.test('D: the same journey already includes1KM; approval adds0 and preserves40',async()=>{
   const r=await fixture(1);const before=snap(r.attendance);const result=await approve(r);assert.equal(result.additionalKm,0);assert.ok(result.receipt_id);assert.equal(result.review.approved_missing_km,0);assert.deepEqual(snap(r.attendance),before);const retry=await approve(r);assert.equal(retry.additionalKm,0);assert.equal(retry.receipt_id,result.receipt_id);
  });
  await t.test('E: rejection preserves the normal40KM/160 under emergency hold',async()=>{
   const r=await fixture();const before=snap(r.attendance);const result=await decideMissingKmReview(client,r.id,'reject',{remarks:'Unsupported exceptional distance'},admin);assert.equal(result.review.status,'rejected');assert.equal(result.totals.total_approved_km,40);assert.deepEqual(snap(r.attendance),before);
  });
  await t.test('F: actual role, self, inactive and anonymous permissions are enforced',async()=>{
   const r=await fixture();const before=snap(r.attendance);
   await assert.rejects(approve(r,1,{...admin,role:'FO'}),e=>e.statusCode===403);
   const call={p_review_id:r.id,p_expected_review_updated_at:json(`select to_jsonb(updated_at) from fo_missing_km_reviews where id='${r.id}'`),p_admin_user_id:r.profile,p_approved_km:1,p_reason:'Self attempt'};
   assert.equal((await client.rpc('rpc_approve_fo_missing_km_v1',call)).error.code,'42501');
   sql(`update profiles set is_active=false where id='${admin.auth_user_id}'`);assert.equal((await client.rpc('rpc_approve_fo_missing_km_v1',{...call,p_admin_user_id:admin.auth_user_id})).error.code,'42501');sql(`update profiles set is_active=true where id='${admin.auth_user_id}'`);
   assert.throws(()=>sql(`set role authenticated;select rpc_approve_fo_missing_km_v1('${r.id}',now(),'${admin.auth_user_id}',1,'Forged')`),/permission denied/);assert.deepEqual(snap(r.attendance),before);
  });
  await t.test('G: a protected settlement remains byte-for-byte unchanged',async()=>{
   const r=await fixture();sql(`insert into fo_monthly_travel_settlements(profile_id,employee_code,state,period_start,period_end,calculated_claim_amount,approved_payable_amount,adjustment_amount,adjustment_type,source_reference,approved_at) values('${r.profile}','${r.code}','TN','2026-10-01','2026-10-31',160,160,0,'none','LOCAL_SETTLED',now())`);const before=snap(r.attendance),settlement=json(`select to_jsonb(s) from fo_monthly_travel_settlements s where employee_code='${r.code}'`);await assert.rejects(approve(r),/settled_or_corrected_protected/);assert.deepEqual(snap(r.attendance),before);assert.deepEqual(json(`select to_jsonb(s) from fo_monthly_travel_settlements s where employee_code='${r.code}'`),settlement);
  });
  await t.test('Admin, Super Admin and Developer use the correct existing Car8 rate',async()=>{
   for(const role of ['Super Admin','Developer']){const r=await fixture(0,'car');sql(`update profiles set role=${q(role)} where id='${admin.auth_user_id}'`);const result=await approve(r,1,{...admin,role});assert.equal(result.additionalAmount,8);assert.equal(result.totals.petrol_amount,328);}
   sql(`update profiles set role='Admin' where id='${admin.auth_user_id}'`);
  });
  await t.test('kill switch, unknown baseline, stale review, unsupported evidence and direct writes fail closed',async()=>{
   const r=await fixture();const before=snap(r.attendance);sql("update fo_km_missing_approval_control set enabled=false,reason='Isolated kill'");await assert.rejects(approve(r),/approval_paused/);sql("update fo_km_missing_approval_control set enabled=true,reason='Isolated resume'");
   await assert.rejects(approve(r,2),/above suggestion/);assert.deepEqual(snap(r.attendance),before);
   const raw=await client.rpc('rpc_approve_fo_missing_km_v1',{p_review_id:r.id,p_expected_review_updated_at:'2000-01-01',p_admin_user_id:admin.auth_user_id,p_approved_km:1,p_reason:'Stale'});assert.equal(raw.error.code,'40001');
   assert.throws(()=>sql(`update fo_attendance set total_approved_km=999 where id='${r.attendance}'`,true),/financial_write_not_authorized|baseline_protected|unrelated_financial_write_denied/);
   assert.equal(json('select to_jsonb(emergency_pause) from fo_km_scope_control'),true);assert.equal(json('select to_jsonb(financial_writes_enabled) from fo_km_financial_control'),false);assert.equal(json('select count(*) from fo_km_attendance_authorizations'),0);
  });
  await t.test('partial overlapping journeys, unsupported mode, NaN and a changed inclusion snapshot cannot credit',async()=>{
   const partial=await fixture(1,'bike',true),partialBefore=snap(partial.attendance);await assert.rejects(approve(partial),/partial_overlap_requires_review/);assert.deepEqual(snap(partial.attendance),partialBefore);
   const r=await fixture(1),before=snap(r.attendance);
   sql(`update fo_missing_km_reviews set window_start_time='2026-10-26T04:02Z' where id='${r.id}'`);await assert.rejects(approve(r),/evidence_binding_invalid/);
   sql(`update fo_missing_km_reviews set window_start_time='2026-10-26T04:00Z',rate_per_km=8 where id='${r.id}'`);await assert.rejects(approve(r),/rate_or_mode_requires_review/);
   sql(`update fo_missing_km_reviews set rate_per_km=4,metadata='{"detected_missing_km":1,"already_included_km":2}' where id='${r.id}'`);await assert.rejects(approve(r),/evidence_ceiling|inclusion_evidence_changed/);
   const raw=await client.rpc('rpc_approve_fo_missing_km_v1',{p_review_id:r.id,p_expected_review_updated_at:json(`select to_jsonb(updated_at) from fo_missing_km_reviews where id='${r.id}'`),p_admin_user_id:admin.auth_user_id,p_approved_km:'NaN',p_reason:'Invalid numeric'});assert.equal(raw.error.code,'22023');assert.deepEqual(snap(r.attendance),before);
  });
 }finally{for(const [key,value]of [['KM_FINANCIAL_WRITES_MAINTENANCE',env.maintenance],['KM_FINANCIAL_WRITES_EMERGENCY_PAUSE',env.emergency]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}db.close();}
});
