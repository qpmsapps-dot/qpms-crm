import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {reconcileSupportedKm} from '../services/foKmIncrementalReconciliationService.js';
import {processKmReconciliationJobs} from '../services/foKmReconciliationWorker.js';

const root=fileURLToPath(new URL('../../',import.meta.url));
const q=x=>"'"+String(x).replaceAll("'","''")+"'";
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
test('246 attendance-scoped authorization with real non-superuser PostgreSQL roles',{
 skip:process.env.RUN_KM246_POSTGRES_TESTS!=='true',timeout:240000,
},async t=>{
 let container,sequence=0;
 const run=(args,input)=>{const r=spawnSync('docker',args,{input,encoding:'utf8',timeout:45000,windowsHide:true});if(r.status!==0)throw Error((r.stderr||r.error?.message||'Docker failure').slice(0,2500));return r.stdout.trim();};
 const args=(user='postgres')=>['exec','-i',container,'psql','-X','-qAt','-U',user,'-d','test','-v','ON_ERROR_STOP=1'];
 const sql=s=>run(args(),s);
 const prefix=role=>`set role ${role};set request.jwt.claim.role=${q(role)};`;
 const service=(s,role='service_role')=>run(args('authenticator'),prefix(role)+s);
 const parallel=s=>new Promise(resolve=>{let stdout='',stderr='';const p=spawn('docker',args('authenticator'),{windowsHide:true});p.stdout.on('data',b=>stdout+=b);p.stderr.on('data',b=>stderr+=b);p.on('close',code=>resolve({code,stdout:stdout.trim(),stderr}));p.stdin.end(prefix('service_role')+s);});
 const read=p=>fs.readFileSync(root+p,'utf8').replace(/\r/g,'');
 const shutdown=()=>sql("update fo_km_scope_control set emergency_pause=true,release_until=null;update fo_km_canonical_policy set enabled=false,admin_enabled=false,worker_enabled=false;");
 const enable=()=>sql("update fo_km_scope_control set emergency_pause=false,release_until=clock_timestamp()+interval '20 minutes';update fo_km_canonical_policy set enabled=true,admin_enabled=false,worker_enabled=true,starts_at=clock_timestamp()-interval '1 minute',expires_at=clock_timestamp()+interval '20 minutes',date_from='2026-10-26',date_to='2026-10-26',maximum_attendance_km=100,maximum_attendance_amount=800;");
 const seed=(mode='bike',date='2026-10-26',source='manual_end_day')=>{
  const a={id:crypto.randomUUID(),profile:crypto.randomUUID(),code:'KM246_FO_'+(++sequence),mode,rate:mode==='car'?8:4};
  sql(`insert into profiles(id,auth_user_id,employee_code,full_name,role,is_active,status,web_access_enabled) values('${a.profile}','${a.profile}','${a.code}','Isolated FO','FO',true,'active',true);
   insert into fo_attendance(id,fo_user_id,employee_code,attendance_date,login_time,status,total_approved_km,eligible_km,total_route_km,petrol_amount,travel_mode,payable_km_allowed,rate_per_km,metadata) values('${a.id}','${a.code}','${a.code}','${date}','${date}T03:00Z','Active',0,0,0,0,${q(mode)},${['bike','car','own_vehicle'].includes(mode)},${a.rate},'{}');
   update fo_attendance set logout_time='${date}T15:00Z',status='Completed',metadata=jsonb_build_object('auto_ended',${source==='auto_end_day'}) where id='${a.id}';
   update fo_km_reconciliation_jobs set not_before=now()-interval '1 minute' where attendance_id='${a.id}';`);
  return a;
 };
 const fingerprint=a=>JSON.parse(sql(`select fo_km_attendance_evidence_v246('${a.id}');`));
 const plan=(a,km=6.25)=>({calculationVersion:'KM_ENGINE_V2',baselineKnown:true,snapshot:fingerprint(a).snapshot,inputDigest:hash(crypto.randomUUID()),additionalKm:km,additionalAmount:Number((km*a.rate).toFixed(2)),legs:[{leg_key:hash(a.id+':leg'),type:'last_checkout_to_end_day',evidence_status:'supported',from_time:'2026-10-26T10:00:00Z',to_time:'2026-10-26T11:00:00Z',source:'GPS_BASED',travel_mode:a.mode,rate_per_km:a.rate,baseline_km:0,payable:true,payable_km:km,new_eligible_km:km}]});
 const authorize=(a,p,maxKm=p.additionalKm,maxAmount=p.additionalAmount)=>{
  shutdown();const f=fingerprint(a),context=JSON.parse(sql(`select jsonb_build_object('a',to_jsonb(a),'j',to_jsonb(j),'v',to_jsonb(v)) from fo_attendance a join fo_km_reconciliation_jobs j on j.attendance_id=a.id join fo_km_job_provenance v on v.attendance_id=a.id where a.id='${a.id}';`));
  const ref='KM246_'+crypto.randomBytes(8).toString('hex').toUpperCase();
  const call=`select fo_authorize_attendance_km_v246('${ref}','${a.id}',${q(a.code)},${context.j.generation},${q(context.j.trigger_source)},${q(context.v.source_table)},${q(context.v.source_id)},${q(context.a.logout_time)},clock_timestamp()+interval '15 minutes',${maxKm},${maxAmount},${q(f.evidence_digest)},${q(JSON.stringify(p))}::jsonb);`;
  sql(call);return {ref,call,f};
 };
 const claim=()=>JSON.parse(service("select coalesce(rpc_claim_fo_policy_km_v1(),'null'::jsonb);"));
 const postSql=(a,p,j)=>`select rpc_reconcile_fo_policy_km_v1('${a.id}',${q(JSON.stringify(p))}::jsonb,${q(j.trigger_source)},null,${q(j.lease)});`;
 const post=(a,p,j)=>JSON.parse(service(postSql(a,p,j)));
 const finish=(a,j)=>service(`select rpc_finish_fo_km_reconciliation_v1('${a.id}',${q(j.lease)},true,null);`);
 const credits=a=>Number(sql(`select count(*) from fo_km_incremental_credits where attendance_id='${a.id}';`));
 const job=a=>JSON.parse(sql(`select to_jsonb(j) from fo_km_reconciliation_jobs j where attendance_id='${a.id}';`));
 const revoke=a=>sql(`update fo_km_attendance_authorizations set revoked_at=clock_timestamp() where attendance_id='${a.id}' and revoked_at is null;`);
 const check=(name,fn)=>t.test(name,fn);
 try{
  container=run(['run','-d','--name','km246-scope-'+crypto.randomBytes(4).toString('hex'),'--network','none','--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_HOST_AUTH_METHOD=trust','-e','POSTGRES_DB=test','postgres:17']);
  for(let i=0;i<40;i++){try{sql('select 1');break;}catch(e){if(i===39)throw e;await new Promise(r=>setTimeout(r,200));}}
  sql(read('supabase/tests/fixtures/239_production_financial_contract.sql'));
  sql(read('supabase/proposals/239_shared_km_incremental_reconciliation.sql'));
  sql(read('supabase/proposals/240_scoped_km_financial_authorization.sql'));
  sql(read('supabase/proposals/241_canonical_km_policy.sql'));
  const protectedState=()=>sql("select jsonb_agg(jsonb_build_array(proname,md5(prosrc),proacl) order by proname) from pg_proc where proname in('fo_reconcile_km_239_core','fo_km_scope_ledger_guard','fo_km_scope_financial_guard','trg_protect_fo_canonical_km_v2_financials','rpc_reconcile_fo_scoped_km_v1');");
  const before=protectedState();sql(read('supabase/migrations_2_0/246_fo_attendance_scoped_km_policy.sql'));
  await check('installation changes no existing financial trigger/core and grants nothing by default',()=>{
   assert.equal(protectedState(),before);assert.equal(sql('select count(*) from fo_km_attendance_authorizations;'),'0');
   assert.equal(sql('select enabled or worker_enabled or admin_enabled from fo_km_canonical_policy;'),'f');
   assert.equal(sql('select financial_writes_enabled from fo_km_financial_control;'),'f');
   assert.equal(service('select rpc_fo_km_attendance_authorization_version_v1();'),'246');
   assert.equal(service("select session_user||':'||current_user||':'||(select rolsuper::text from pg_roles where rolname=current_user);"),'authenticator:service_role:false');
   for(const role of ['anon','authenticated','service_role']){
    assert.throws(()=>service('select * from fo_km_attendance_authorizations;',role),/permission denied/);
    assert.throws(()=>service('select rpc_claim_fo_km_reconciliation_v1();',role),/permission denied/);
    assert.throws(()=>service("select fo_km_attendance_evidence_v246(null);",role),/permission denied/);
    assert.throws(()=>service("select fo_reconcile_policy_km_241_core(null,'{}','manual_end_day',null,null);",role),/permission denied/);
   }
   for(const role of ['anon','authenticated'])assert.throws(()=>service('select rpc_claim_fo_policy_km_v1();',role),/permission denied/);
  });
  await check('two different individual ceilings; unauthorized same-day jobs are never leased',()=>{
   const unauthorized=seed(),a=seed(),b=seed('car','2026-10-26','auto_end_day'),pa=plan(a),pb=plan(b,3);
   authorize(a,pa,7,28);authorize(b,pb,4,32);enable();
   const j1=claim(),first=j1.attendance_id===a.id?[a,pa]:[b,pb];
   assert.equal(post(...first,j1).additionalKm,first[1].additionalKm);finish(first[0],j1);
   const j2=claim(),second=j2.attendance_id===a.id?[a,pa]:[b,pb];assert.notEqual(j2.attendance_id,j1.attendance_id);
   assert.equal(post(...second,j2).additionalKm,second[1].additionalKm);finish(second[0],j2);
   assert.equal(claim(),null);assert.equal(job(unauthorized).attempts,0);assert.equal(job(unauthorized).lease,null);
  });
  await check('API roles cannot mint approval, alter caps or bypass the old private executor',()=>{
   const a=seed(),p=plan(a),auth=authorize(a,p);
   assert.throws(()=>service(auth.call),/permission denied/);
   assert.throws(()=>service(`update fo_km_attendance_authorizations set maximum_incremental_km=999 where reference='${auth.ref}';`),/permission denied/);
   assert.throws(()=>service(`set app.km_v2_authorized_financial_write='true';update fo_attendance set total_approved_km=999 where id='${a.id}';`),/km_scope_unrelated_financial_write_denied/);
   revoke(a);
  });
  await check('reopened, canceled, out-of-date and stale-generation attendance is excluded before claiming',()=>{
   for(const kind of ['reopened','canceled','date','generation']){
    const a=seed(),p=plan(a);authorize(a,p);
    if(kind==='reopened')sql(`update fo_attendance set logout_time=null,status='Active' where id='${a.id}';`);
    if(kind==='canceled')sql(`update fo_attendance set status='Canceled' where id='${a.id}';`);
    if(kind==='date')sql(`update fo_attendance set attendance_date='2026-10-25' where id='${a.id}';`);
    if(kind==='generation')sql(`update fo_km_reconciliation_jobs set generation=generation+1 where attendance_id='${a.id}';`);
    enable();assert.equal(claim(),null);assert.equal(job(a).attempts,0);revoke(a);
   }
  });
  await check('GPS changes after verification invalidate the authorization even without a generation change',()=>{
   const a=seed(),g=crypto.randomUUID();sql(`insert into fo_location_logs(id,attendance_id,employee_code,fo_user_id,latitude,longitude,accuracy,source,captured_at) values('${g}','${a.id}','${a.code}','${a.code}',12,75,5,'mobile','2026-10-26T10:30Z');`);
   const p=plan(a);authorize(a,p);sql(`update fo_location_logs set latitude=12.1 where id='${g}';`);enable();assert.equal(claim(),null);assert.equal(job(a).attempts,0);revoke(a);
  });
  await check('evidence and approved plan are checked again after leasing',()=>{
   const a=seed(),p=plan(a);authorize(a,p);enable();const j=claim();
   assert.throws(()=>post(a,{...p,additionalKm:7},j),/km246_plan_not_authorized/);
   sql(`update fo_attendance set metadata=metadata||'{"evidence_changed":true}' where id='${a.id}';`);
   assert.throws(()=>post(a,p,j),/km246_evidence_changed/);assert.equal(credits(a),0);revoke(a);
  });
  await check('simultaneous workers and duplicate financial retries credit once',async()=>{
   const a=seed(),p=plan(a);authorize(a,p);enable();
   const claims=await Promise.all([parallel("select coalesce(rpc_claim_fo_policy_km_v1(),'null'::jsonb);"),parallel("select coalesce(rpc_claim_fo_policy_km_v1(),'null'::jsonb);")]);
   assert(claims.every(r=>r.code===0),JSON.stringify(claims));const jobs=claims.map(r=>JSON.parse(r.stdout));assert.equal(jobs.filter(Boolean).length,1);
   const j=jobs.find(Boolean);assert.equal(j.attendance_id,a.id);
   const posts=await Promise.all([parallel(postSql(a,p,j)),parallel(postSql(a,p,j))]);assert(posts.every(r=>r.code===0),JSON.stringify(posts));
   assert.equal(posts.reduce((n,r)=>n+JSON.parse(r.stdout).additionalKm,0),6.25);assert.equal(credits(a),1);assert.equal(post(a,p,j).additionalKm,0);
   // Recovery from commit-before-finish: a new lease can confirm the same receipt.
   sql(`update fo_km_reconciliation_jobs set lease_until=now()-interval '1 second' where attendance_id='${a.id}';`);
   const retry=claim();assert.equal(retry.attendance_id,a.id);assert.equal(post(a,p,retry).additionalKm,0);finish(a,retry);
  });
  await check('expired/revoked scope and emergency shutdown never lease work',()=>{
   for(const kind of ['expired','revoked','emergency']){
    const a=seed(),p=plan(a),auth=authorize(a,p);
    if(kind==='expired')sql(`update fo_km_attendance_authorizations set starts_at=clock_timestamp()-interval '2 minutes',expires_at=clock_timestamp()-interval '1 minute' where reference='${auth.ref}';`);
    if(kind==='revoked')revoke(a);
    enable();if(kind==='emergency')sql('update fo_km_scope_control set emergency_pause=true;');
    if(kind==='emergency')assert.throws(()=>claim(),/km_policy_emergency_pause/);else assert.equal(claim(),null);
    assert.equal(job(a).attempts,0);revoke(a);
   }
  });
  await check('cumulative per-attendance caps roll the entire posting transaction back',()=>{
   const a=seed(),p=plan(a),auth=authorize(a,p,7,28);sql(`update fo_km_attendance_authorizations set maximum_incremental_amount=24 where reference='${auth.ref}';`);enable();const j=claim();
   assert.throws(()=>post(a,p,j),/km246_attendance_limit_or_expiry/);assert.equal(credits(a),0);
   assert.equal(Number(sql(`select total_approved_km from fo_attendance where id='${a.id}';`)),0);revoke(a);
  });
  await check('Train, Bus, Auto, Other and Unknown cannot become payable through a ceiling',()=>{
   for(const mode of ['train','bus','auto','other','unknown']){
    const a=seed(mode==='unknown'?'bike':mode),p=plan(a);p.legs[0].travel_mode=mode;authorize(a,p);enable();const j=claim();
    assert.throws(()=>post(a,p,j),/km_increment_evidence_invalid/);assert.equal(credits(a),0);revoke(a);
   }
  });
  await check('new individual caps count increments after prior receipts, with duplicate retry zero',()=>{
   const a=seed(),p=plan(a);authorize(a,p);enable();const first=claim();post(a,p,first);finish(a,first);revoke(a);
   const next=plan(a,2);next.legs[0].payable_km=8.25;
   sql(`update fo_km_reconciliation_jobs set state='deferred',not_before=now()-interval '1 second' where attendance_id='${a.id}';`);
   const approval=authorize(a,next);enable();const j=claim();assert.equal(post(a,next,j).additionalKm,2);assert.equal(post(a,next,j).additionalKm,0);finish(a,j);
   assert.equal(Number(sql(`select credited_km from fo_km_attendance_authorizations where reference='${approval.ref}';`)),2);
   assert.equal(Number(sql(`select total_approved_km from fo_attendance where id='${a.id}';`)),8.25);
  });
  await check('partial supported legs save without invented unresolved journeys',()=>{
   const a=seed(),p=plan(a);p.unresolved=[{type:'unresolved',new_eligible_km:0}];p.legs.push({leg_key:hash('unresolved'+a.id),new_eligible_km:0,evidence_status:'unresolved',source:'UNRESOLVED'});
   authorize(a,p);enable();const j=claim();assert.equal(post(a,p,j).additionalKm,6.25);assert.equal(credits(a),1);finish(a,j);
  });
  await check('settled claims stay byte-identical while approved increments become receipt-backed supplements',()=>{
   const a=seed(),settlement=crypto.randomUUID();sql(`insert into fo_monthly_travel_settlements(id,profile_id,employee_code,state,period_start,period_end,calculated_claim_amount,approved_payable_amount,adjustment_amount,adjustment_type,source_reference,approved_at) values('${settlement}','${a.profile}','${a.code}','TN','2026-10-01','2026-10-31',100,100,0,'none','isolated246',now());`);
   const before=sql(`select to_jsonb(s) from fo_monthly_travel_settlements s where id='${settlement}';`),p=plan(a);authorize(a,p);enable();const j=claim(),r=post(a,p,j);
   assert.equal(r.applied_to_attendance,false);assert.equal(post(a,p,j).additionalKm,0);finish(a,j);
   assert.equal(sql(`select to_jsonb(s) from fo_monthly_travel_settlements s where id='${settlement}';`),before);
   assert.equal(Number(sql(`select total_approved_km from fo_attendance where id='${a.id}';`)),0);
  });
  await check('employee identity and provenance changes are rejected before any lease',()=>{
   for(const kind of ['identity','fo_identity','provenance','inactive']){
    const a=seed(),p=plan(a);authorize(a,p);
    if(kind==='identity')sql(`update fo_attendance set employee_code='OTHER' where id='${a.id}';`);
    if(kind==='fo_identity')sql(`update fo_attendance set fo_user_id='OTHER' where id='${a.id}';`);
    if(kind==='provenance')sql(`update fo_km_job_provenance set source_id=gen_random_uuid() where attendance_id='${a.id}';`);
    if(kind==='inactive')sql(`update profiles set is_active=false where id='${a.profile}';`);
    enable();assert.equal(claim(),null);assert.equal(job(a).attempts,0);revoke(a);
   }
   const a=seed(),p=plan(a);sql(`update fo_km_job_provenance set source_id=gen_random_uuid() where attendance_id='${a.id}';`);
   assert.throws(()=>authorize(a,p),/km246_attendance_or_provenance_changed/);
  });
  await check('expiry and emergency shutdown after leasing still abort financial execution',()=>{
   for(const kind of ['expired','emergency']){
    const a=seed(),p=plan(a),auth=authorize(a,p);enable();const j=claim();
    if(kind==='expired')sql(`update fo_km_attendance_authorizations set starts_at=clock_timestamp()-interval '2 minutes',expires_at=clock_timestamp()-interval '1 minute' where reference='${auth.ref}';`);
    else sql('update fo_km_scope_control set emergency_pause=true;');
    assert.throws(()=>post(a,p,j),/km246_authorization_expired_or_stale|km_policy_emergency_pause/);assert.equal(credits(a),0);revoke(a);
   }
  });
  const supplement=a=>{
   const id=crypto.randomUUID();
   sql(`insert into fo_october_km_recoveries(id,employee_code,employee_name,attendance_date,attendance_id,journey_start,journey_end,journey_type,start_location,destination,intermediate_stops,recovery_reason,explanation,evidence_refs,requested_km,journey_total_km,travel_mode,travel_rate,approved_additional_km,additional_amount,verified_included_km,inclusion_resolution,status,submitted_by,approved_by,approved_at,before_state,request_key,request_payload,journey_fingerprint)
   values('${id}','${a.code}','Isolated FO','2026-10-26','${a.id}','2026-10-26T10:00Z','2026-10-26T11:00Z','last_checkout_to_end_day','Start','End','[]','GPS Failure','Existing immutable supplement fixture','[]',2,8.25,'bike',4,2,8,0,'Verified independently as additional travel','approved','${a.profile}','${a.profile}',now(),'{}',${q(hash(id))},'{}',${q(hash(id+':journey'))});`);
   return id;
  };
  await check('existing approved supplements are subtracted once and remain immutable',()=>{
   const a=seed(),id=supplement(a),before=sql(`select to_jsonb(r) from fo_october_km_recoveries r where id='${id}';`),p=plan(a);
   p.legs[0].payable_km=8.25;authorize(a,p);enable();const j=claim(),r=post(a,p,j);
   assert.equal(r.additionalKm,6.25);assert.equal(r.finalPayableKm,8.25);assert.equal(r.applied_to_attendance,false);assert.equal(post(a,p,j).additionalKm,0);finish(a,j);
   assert.equal(sql(`select to_jsonb(r) from fo_october_km_recoveries r where id='${id}';`),before);
  });
  await check('a new prior supplement after authorization invalidates the receipt baseline',()=>{
   const a=seed(),p=plan(a);authorize(a,p);supplement(a);enable();assert.equal(claim(),null);assert.equal(job(a).attempts,0);revoke(a);
  });
  if(process.env.KM_REAL_CASE_FIXTURE_FILE){
   const cases=JSON.parse(fs.readFileSync(process.env.KM_REAL_CASE_FIXTURE_FILE,'utf8')).cases;
   for(const actual of cases)await check('known '+actual.evidence.attendance.employee_code+' snapshot is calculated, individually bounded and idempotent locally',async()=>{
    const e=actual.evidence,a0=e.attendance,a={id:a0.id,profile:crypto.randomUUID(),code:a0.employee_code,mode:a0.travel_mode,rate:a0.rate_per_km};
    assert(['540a4b7f-96db-4c83-97a6-6a0e8e6ecf14','cb8c582e-76b4-423d-99f8-0b38ef6305c4'].includes(a.id));
    sql(`insert into profiles(id,auth_user_id,employee_code,full_name,role,is_active,status,web_access_enabled) values('${a.profile}','${a.profile}','${a.code}','Isolated recorded-evidence fixture','FO',true,'active',true);
     insert into fo_attendance(id,fo_user_id,employee_code,attendance_date,login_time,status,total_approved_km,eligible_km,total_route_km,petrol_amount,travel_mode,payable_km_allowed,rate_per_km,metadata) values('${a.id}','${a.code}','${a.code}',${q(a0.attendance_date)},${q(a0.login_time)},'Active',0,0,0,0,${q(a.mode)},true,${a.rate},'{}');`);
    const rows=e.originalRows;
    for(let i=0;i<rows.length;i+=100){const values=rows.slice(i,i+100).map(g=>`(${q(g.id)},'${a.id}','${a.code}','${a.code}',${Number(g.latitude)},${Number(g.longitude)},${g.accuracy==null?'null':Number(g.accuracy)},${q(g.source||'mobile')},${q(g.captured_at)})`);
     sql('insert into fo_location_logs(id,attendance_id,employee_code,fo_user_id,latitude,longitude,accuracy,source,captured_at) values '+values.join(',')+';');}
    for(const l of e.snapshots)sql(`insert into fo_travel_legs(id,attendance_id,employee_code,fo_user_id,travel_mode,payable_km_allowed,started_at,ended_at,status,rate_per_km,payable_km,calculated_km) values('${l.id}','${a.id}','${a.code}','${a.code}',${q(l.travel_mode)},${l.payable_km_allowed!==false},${q(l.started_at)},${l.ended_at?q(l.ended_at):'null'},${q(l.status)},${l.rate_per_km||0},${Number(l.payable_km||0)},0);`);
    sql(`update fo_attendance set logout_time=${q(a0.logout_time)},status='Completed' where id='${a.id}';update fo_km_reconciliation_jobs set not_before=now()-interval '1 minute' where attendance_id='${a.id}';`);
    for(const v of e.visits){
     const fields=['id','check_in_time','check_out_time','checkout_time','check_in_latitude','check_in_longitude','check_out_latitude','check_out_longitude','origin_lat','origin_lng','destination_lat','destination_lng','route_km','distance_source','google_route_polyline','petrol_eligible_after_checkout','metadata','status'];
     const record={...v,attendance_id:a.id,fo_user_id:a.code,employee_code:a.code};
     const columns=['attendance_id','fo_user_id','employee_code',...fields].filter(k=>record[k]!=null);
     sql('insert into fo_site_visits('+columns.join(',')+') values('+columns.map(k=>q(typeof record[k]==='object'?JSON.stringify(record[k]):record[k])).join(',')+');');
    }
    const environment={KM_SHARED_RECONCILIATION_ENABLED:'true',KM_INCREMENTAL_REPORTING_ENABLED:'true',KM_CANONICAL_POLICY_ENABLED:'true',KM_FINANCIAL_WRITES_MAINTENANCE:'true',KM_FINANCIAL_WRITES_EMERGENCY_PAUSE:'false',END_DAY_KM_AUTO_RECALC_ENABLED:'true'};
    const db={from(){throw Error('Recorded evidence only');},async rpc(name,args){
     if(name==='rpc_fo_km_reconciliation_state_v1')return {data:JSON.parse(service('select rpc_fo_km_reconciliation_state_v1('+q(args.p_attendance_id)+');'))};
     if(name==='rpc_fo_km_attendance_authorization_version_v1')return {data:Number(service('select rpc_fo_km_attendance_authorization_version_v1();'))};
     if(name==='rpc_claim_fo_policy_km_v1')return {data:claim()};
     if(name==='rpc_reconcile_fo_policy_km_v1')return {data:JSON.parse(service('select rpc_reconcile_fo_policy_km_v1('+q(args.p_attendance_id)+','+q(JSON.stringify(args.p_calculation))+'::jsonb,'+q(args.p_trigger)+',null,'+q(args.p_lease)+');'))};
     if(name==='rpc_finish_fo_km_reconciliation_v1')return {data:service('select rpc_finish_fo_km_reconciliation_v1('+q(args.p_attendance)+','+q(args.p_lease)+','+args.p_posted+','+(args.p_error?q(args.p_error):'null')+');')};
     throw Error('Unexpected RPC '+name);
    }};
    const preview=await reconcileSupportedKm(db,{attendance_id:a.id},{environment,evidence:e,persist:false,trigger:'manual_end_day',maxGoogleDirectionsCalls:0,enableGoogleDirections:false});
    const p=preview.authorization_calculation;assert(p.baselineKnown);assert(p.unresolved.length>0);assert(p.additionalKm>0);
    authorize(a,p);enable();
    const result=await processKmReconciliationJobs(db,{environment,limit:1,reconcile:(c,payload,options)=>reconcileSupportedKm(c,payload,{...options,evidence:e,enableGoogleDirections:false})});
    const r=result.results[0];assert.equal(r.attendance_id,a.id);assert.equal(r.financial_posted,true);assert.equal(r.additionalKm,p.additionalKm);assert.equal(r.additionalAmount,p.additionalAmount);
    assert.equal(credits(a),p.legs.filter(l=>l.new_eligible_km>0).length);assert.equal(job(a).state,'posted');
    // A committed receipt survives an interrupted finish and an exact retry.
    sql(`update fo_km_reconciliation_jobs set state='deferred',not_before=now()-interval '1 second' where attendance_id='${a.id}';`);
    const retry=claim();assert.equal(post(a,p,retry).additionalKm,0);finish(a,retry);
    t.diagnostic(a.code+' local snapshot: '+p.additionalKm+' KM / '+p.additionalAmount+'; unresolved journeys excluded');
   });
  }
 }finally{if(container)run(['rm','-f',container]);}
});
