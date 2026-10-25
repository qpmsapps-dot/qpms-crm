import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {spawnSync,spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {loadApprovedOctoberRecoveries,attachRangeRecovery,recoveryCsv} from '../services/foOctoberRecoveryReportingService.js';
const root=fileURLToPath(new URL('../../',import.meta.url));
const q=x=>"'"+String(x).replaceAll("'","''")+"'";
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
test('241 canonical policy, real financial triggers and non-superuser requests',{skip:process.env.RUN_KM241_POSTGRES_TESTS!=='true',timeout:240000},async t=>{
 const out=root+'artifacts/km-final-canonical-release-20261025/';fs.mkdirSync(out,{recursive:true});let container;const checks=[];
 const run=(args,input)=>{const r=spawnSync('docker',args,{input,encoding:'utf8',timeout:45000,windowsHide:true});if(r.status!==0)throw Error((r.stderr||r.error?.message||'docker failed').slice(0,3000));return r.stdout.trim();};
 const args=(db='test',user='postgres')=>['exec','-i',container,'psql','-X','-qAt','-U',user,'-d',db,'-v','ON_ERROR_STOP=1'];
 const sql=(s,db='test')=>run(args(db),s);
 const prefix=role=>`set role ${role};set request.jwt.claim.role=${q(role)};`;
 const service=(s,role='service_role')=>run(args('test','authenticator'),prefix(role)+s);
 const parallel=s=>new Promise(resolve=>{let stdout='',stderr='';const p=spawn('docker',args('test','authenticator'),{windowsHide:true});p.stdout.on('data',b=>stdout+=b);p.stderr.on('data',b=>stderr+=b);p.on('close',code=>resolve({code,stdout:stdout.trim(),stderr}));p.stdin.end(prefix('service_role')+s);});
 const read=p=>fs.readFileSync(root+p,'utf8');const proposal=read('supabase/proposals/241_canonical_km_policy.sql'),rollback=read('supabase/proposals/241_canonical_km_policy_rollback.sql');
 const admin=crypto.randomUUID();let seq=0;
 const check=(name,fn)=>t.test(name,async()=>{await fn();checks.push(name);});
 const seed=(mode='bike',source='manual_end_day')=>{
  const id=crypto.randomUUID(),profile=crypto.randomUUID(),code='KM241_FO_'+(++seq);
  sql(`insert into profiles(id,auth_user_id,employee_code,full_name,role,is_active,status,web_access_enabled) values('${profile}','${profile}','${code}','Isolated FO','FO',true,'active',true);
  insert into fo_attendance(id,fo_user_id,employee_code,attendance_date,login_time,status,total_approved_km,eligible_km,total_route_km,petrol_amount,travel_mode,payable_km_allowed,rate_per_km,metadata) values('${id}','${code}','${code}','2026-10-23','2026-10-23T03:00Z','Active',0,0,0,0,${mode==='unknown'?'null':q(mode)},${['bike','own_vehicle','car'].includes(mode)},${mode==='car'?8:4},'{}');
  update fo_attendance set logout_time='2026-10-23T15:00Z',status='Completed',metadata=jsonb_build_object('auto_ended',${source==='auto_end_day'}) where id='${id}';`);
  return {id,profile,code,mode,rate:mode==='car'?8:4};
 };
 const plan=(a,over={})=>({calculationVersion:'KM_ENGINE_V2',baselineKnown:true,snapshot:JSON.parse(service(`select rpc_fo_km_reconciliation_state_v1('${a.id}');`)).digest,inputDigest:hash(crypto.randomUUID()),legs:[{leg_key:hash(a.id+':leg'),type:'last_checkout_to_end_day',evidence_status:'supported',from_time:'2026-10-23T10:00:00Z',to_time:'2026-10-23T11:00:00Z',source:'GPS_BASED',travel_mode:a.mode,rate_per_km:a.rate,baseline_km:0,payable:true,payable_km:6.25,new_eligible_km:6.25,...over}]});
 const call=(a,p,source='admin_recalculation',actor=admin,lease=null)=>`select rpc_reconcile_fo_policy_km_v1('${a.id}',${q(JSON.stringify(p))}::jsonb,${q(source)},${actor?q(actor):'null'},${lease?q(lease):'null'});`;
 const credits=a=>Number(sql(`select count(*) from fo_km_incremental_credits where attendance_id='${a.id}';`));
 const fingerprint=db=>sql(`select jsonb_build_object('functions',(select jsonb_agg(jsonb_build_array(proname,pg_get_function_identity_arguments(oid),pg_get_functiondef(oid),proacl) order by proname,pg_get_function_identity_arguments(oid)) from pg_proc where pronamespace='public'::regnamespace),'tables',(select jsonb_agg(jsonb_build_array(relname,relacl,relrowsecurity) order by relname) from pg_class where relnamespace='public'::regnamespace and relkind='r'),'constraints',(select jsonb_agg(jsonb_build_array(conrelid::regclass::text,conname,pg_get_constraintdef(oid)) order by conrelid::regclass::text,conname) from pg_constraint where connamespace='public'::regnamespace),'indexes',(select jsonb_agg(to_jsonb(i) order by indexname) from pg_indexes i where schemaname='public'),'triggers',(select jsonb_agg(pg_get_triggerdef(oid) order by tgrelid::regclass::text,tgname) from pg_trigger where not tgisinternal),'history',(select jsonb_agg(to_jsonb(h) order by version) from supabase_migrations.schema_migrations h),'controls',(select jsonb_agg(to_jsonb(c)) from fo_km_scope_control c))::text;`,db);
 const enable=()=>sql("update fo_km_scope_control set emergency_pause=false,release_until=clock_timestamp()+interval '1 hour';update fo_km_canonical_policy set enabled=true,admin_enabled=true,worker_enabled=true,starts_at=clock_timestamp()-interval '1 minute',expires_at=clock_timestamp()+interval '30 minutes',date_from='2026-10-01',date_to='2026-10-31',maximum_attendance_km=100,maximum_attendance_amount=800;");
 const claim=a=>{sql(`update fo_km_reconciliation_jobs set not_before=now()+interval '1 day' where attendance_id<>'${a.id}';update fo_km_reconciliation_jobs set not_before=now()-interval '1 minute' where attendance_id='${a.id}';`);return JSON.parse(service('select rpc_claim_fo_policy_km_v1();'));};
 try{
  container=run(['run','-d','--name','km241-policy-'+crypto.randomBytes(4).toString('hex'),'--network','none','--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_HOST_AUTH_METHOD=trust','-e','POSTGRES_DB=test','postgres:17']);
  for(let i=0;i<40;i++){try{sql('select 1');break;}catch(e){if(i===39)throw e;await new Promise(r=>setTimeout(r,200));}}
  sql(read('supabase/tests/fixtures/239_production_financial_contract.sql'));sql(read('supabase/proposals/239_shared_km_incremental_reconciliation.sql'));sql(read('supabase/proposals/240_scoped_km_financial_authorization.sql'));
  sql(`insert into profiles(id,auth_user_id,employee_code,full_name,role,is_active,status,web_access_enabled) values('${admin}','${admin}','KM241_ADMIN','Isolated Admin','Admin',true,'active',true);create database rollback_fixture with template test;`);
  const baseline=fingerprint('rollback_fixture');sql('create database failed_fixture with template rollback_fixture;');sql(proposal);
  await check('non-superuser execution and private RLS/ACLs',()=>{
   assert.equal(service("select session_user||':'||current_user||':'||(select rolsuper::text from pg_roles where rolname=current_user);"),'authenticator:service_role:false');
   for(const table of ['fo_km_canonical_policy','fo_km_job_provenance','fo_km_policy_executions','fo_km_policy_audit'])for(const role of ['anon','authenticated','service_role'])assert.throws(()=>service(`select * from ${table};`,role),/permission denied/);
   assert.throws(()=>service('select fo_km_require_canonical_policy(\'manual_end_day\');'),/permission denied/);
   for(const role of ['anon','authenticated'])assert.throws(()=>service('select rpc_claim_fo_policy_km_v1();',role),/permission denied/);
  });
  await check('installed policy default and emergency stop deny without queue mutations',()=>{const before=sql('select count(*) from fo_km_reconciliation_jobs;');assert.throws(()=>service('select rpc_claim_fo_policy_km_v1();'),/km_policy_emergency_pause/);assert.equal(sql('select count(*) from fo_km_reconciliation_jobs;'),before);});
  enable();
  await check('authenticated Admin posts canonical 6.25 only with global gate still closed',()=>{const a=seed(),p=plan(a);const r=JSON.parse(service(call(a,p)));assert.equal(r.additionalKm,6.25);assert.equal(r.additionalAmount,25);assert.equal(sql(`select total_approved_km::float||':'||petrol_amount::float from fo_attendance where id='${a.id}';`),'6.25:25');assert.equal(sql('select financial_writes_enabled from fo_km_financial_control;'),'f');});
  await check('exact retry and concurrent Admin/worker requests cannot double-credit',async()=>{
   const a=seed(),p=plan(a),job=claim(a);assert.equal(job.attendance_id,a.id);const results=await Promise.all([parallel(call(a,p)),parallel(call(a,p,'manual_end_day',null,job.lease))]);
   assert(results.every(r=>r.code===0),JSON.stringify(results));assert.equal(results.map(r=>JSON.parse(r.stdout)).reduce((n,r)=>n+r.additionalKm,0),6.25);assert.equal(credits(a),1);assert.equal(JSON.parse(service(call(a,p))).additionalKm,0);
   service(`select rpc_finish_fo_km_reconciliation_v1('${a.id}','${job.lease}',true,null);`);
  });
  await check('manual and midnight closure create trusted provenance and use same core',()=>{
   for(const source of ['manual_end_day','auto_end_day']){const a=seed('bike',source),p=plan(a),j=claim(a);assert.equal(j.attendance_id,a.id);assert.equal(j.trigger_source,source);assert.equal(JSON.parse(service(call(a,p,source,null,j.lease))).additionalKm,6.25);service(`select rpc_finish_fo_km_reconciliation_v1('${a.id}','${j.lease}',true,null);`);}
  });
  await check('arbitrary queue rows, forged GUCs, wrong Admin and spoofed leases fail',()=>{
   const a=seed(),p=plan(a);assert.throws(()=>service(call(a,p,'admin_recalculation',a.profile)),/recovery_admin_required/);
   assert.throws(()=>service(call(a,p,'manual_end_day',null,crypto.randomUUID())),/km_policy_verified_lease_required/);
   sql(`delete from fo_km_job_provenance where attendance_id='${a.id}';update fo_km_reconciliation_jobs set state='processing',lease='${admin}',lease_until=now()+interval '1 hour',claimed_generation=generation where attendance_id='${a.id}';`);
   assert.throws(()=>service(call(a,p,'manual_end_day',null,admin)),/km_policy_verified_lease_required/);
   assert.throws(()=>service(`set app.km_v2_authorized_financial_write='true';update fo_attendance set total_approved_km=999,petrol_amount=3996 where id='${a.id}';`),/km_scope_unrelated_financial_write_denied/);assert.equal(credits(a),0);
  });
  await check('out-of-period, disabled, expired and revoked policy deny',()=>{
   const a=seed(),p=plan(a);for(const change of ["date_to='2026-10-22'","enabled=false","expires_at=clock_timestamp()-interval '1 second'"]){sql('update fo_km_canonical_policy set '+change+';');assert.throws(()=>service(call(a,p)),/km_policy_date_denied|km_canonical_policy_inactive/);enable();}assert.equal(credits(a),0);
  });
  await check('policy caps roll back receipts, attendance and execution audit atomically',()=>{
   const a=seed(),p=plan(a);sql('update fo_km_canonical_policy set maximum_attendance_km=5;');assert.throws(()=>service(call(a,p)),/km_policy_limit_exceeded/);assert.equal(credits(a),0);assert.equal(sql(`select count(*) from fo_km_policy_executions where attendance_id='${a.id}';`),'0');enable();
  });
  await check('non-payable transport denied and recorded Car segment overrides day Bike',()=>{
   for(const mode of ['bike','own_vehicle','car','train','bus','auto','other','unknown']){const a=seed(mode==='unknown'?'bike':mode),p=plan(a,mode==='unknown'?{travel_mode:'unknown'}:{});if(['bike','own_vehicle','car'].includes(mode))assert.equal(JSON.parse(service(call(a,p))).additionalAmount,6.25*a.rate);else{assert.throws(()=>service(call(a,p)),/km_increment_evidence_invalid/);assert.equal(credits(a),0);}}
   const a=seed(),id=crypto.randomUUID();sql(`insert into fo_travel_legs(id,attendance_id,employee_code,fo_user_id,travel_mode,payable_km_allowed,started_at,ended_at,status,rate_per_km,payable_km,calculated_km) values('${id}','${a.id}','${a.code}','${a.code}','car',true,'2026-10-23T10:00Z','2026-10-23T11:00Z','completed',8,0,0);`);
   const p=plan(a,{persisted_travel_leg_id:id,travel_mode:'car',rate_per_km:8});assert.equal(JSON.parse(service(call(a,p))).additionalAmount,50);
  });
  await check('settled claims unchanged, immutable supplement counted once',()=>{
   const a=seed();sql(`insert into fo_monthly_travel_settlements(profile_id,employee_code,state,period_start,period_end,calculated_claim_amount,approved_payable_amount,adjustment_amount,adjustment_type,source_reference,approved_at) values('${a.profile}','${a.code}','Kerala','2026-10-01','2026-10-31',0,0,0,'none','isolated241',now());`);const p=plan(a),before=sql(`select to_jsonb(s) from fo_monthly_travel_settlements s where employee_code='${a.code}';`);
   const r=JSON.parse(service(call(a,p)));assert.equal(r.applied_to_attendance,false);assert.equal(sql(`select total_approved_km::float||':'||petrol_amount::float from fo_attendance where id='${a.id}';`),'0:0');assert.equal(sql(`select to_jsonb(s) from fo_monthly_travel_settlements s where employee_code='${a.code}';`),before);assert.equal(JSON.parse(service(call(a,p))).additionalKm,0);assert.equal(credits(a),1);
  });
  await check('late genuine GPS produces generation; newer evidence invalidates claimed lease',()=>{
   const a=seed();sql(`update fo_attendance set login_time=now()-interval '2 hours',logout_time=now()-interval '1 hour' where id='${a.id}';insert into fo_location_logs(id,attendance_id,employee_code,fo_user_id,latitude,longitude,accuracy,source,captured_at) values(gen_random_uuid(),'${a.id}','${a.code}','${a.code}',12,75,5,'mobile',now()-interval '90 minutes');`);
   const j=claim(a);assert.equal(j.trigger_source,'late_gps');const p=plan(a,{from_time:new Date(Date.now()-100*60000).toISOString(),to_time:new Date(Date.now()-70*60000).toISOString()});
   sql(`insert into fo_location_logs(id,attendance_id,employee_code,fo_user_id,latitude,longitude,accuracy,source,captured_at) values(gen_random_uuid(),'${a.id}','${a.code}','${a.code}',12.01,75,5,'mobile',now()-interval '80 minutes');`);
   assert.throws(()=>service(call(a,p,'late_gps',null,j.lease)),/km_policy_verified_lease_required/);assert.equal(credits(a),0);
  });
  await check('installed 240 exact-scope authorization remains compatible',()=>{
   const a=seed(),p=plan(a),ref='EXISTING_240_'+crypto.randomBytes(5).toString('hex').toUpperCase();
   sql(`insert into fo_km_scope_authorizations(reference,attendance_id,employee_code,attendance_date,admin_auth_user_id,starts_at,expires_at,maximum_km,maximum_amount,input_digest,snapshot_digest,approved_calculation) values('${ref}','${a.id}','${a.code}','2026-10-23','${admin}',now()-interval '1 minute',now()+interval '10 minutes',6.25,25,'${p.inputDigest}','${p.snapshot}',${q(JSON.stringify(p))});`);
   const r=JSON.parse(service(`select rpc_reconcile_fo_scoped_km_v1('${a.id}',${q(JSON.stringify(p))},'${admin}','${ref}');`));assert.equal(r.additionalKm,6.25);assert.equal(credits(a),1);
  });
  await check('real post-settlement receipt reaches monthly reporting and CSV exactly once',async()=>{
   const raw=JSON.parse(sql("select jsonb_agg(to_jsonb(c)) from fo_km_incremental_credits c where not applied_to_attendance;"));assert.equal(raw.length,1);
   const builder={select(){return this;},in(){return this;},gte(){return this;},lte(){return this;},order(){return this;},async range(){return {data:raw};}};
   const rows=await loadApprovedOctoberRecoveries({from:()=>builder},[raw[0].employee_code],'2026-10-01','2026-10-31',{KM_INCREMENTAL_REPORTING_ENABLED:'true'});
   const result=attachRangeRecovery({period_summary:{canonical_payable_km:0,canonical_petrol_amount:0},daily_summary:[]},[...rows,...rows]);assert.equal(result.period_summary.canonical_payable_km,6.25);assert.equal(result.period_summary.canonical_petrol_amount,25);assert.equal(recoveryCsv([...rows,...rows]).split('\r\n').length,2);
  });
  await check('emergency pause is unconditional even if ordinary global gate is open',()=>{
   const a=seed(),p=plan(a);sql('update fo_km_scope_control set emergency_pause=true;update fo_km_financial_control set financial_writes_enabled=true;');assert.throws(()=>service(call(a,p)),/km_policy_emergency_pause/);assert.throws(()=>service('select rpc_claim_fo_policy_km_v1();'),/km_policy_emergency_pause/);assert.equal(credits(a),0);sql('update fo_km_financial_control set financial_writes_enabled=false;');
  });
  await check('two complete install/rollback rehearsals restore exact schema/ACL fingerprints',()=>{
   for(let i=0;i<2;i++){sql(proposal,'rollback_fixture');sql(rollback,'rollback_fixture');assert.equal(fingerprint('rollback_fixture'),baseline);}fs.writeFileSync(out+'ROLLBACK-EVIDENCE.json',JSON.stringify({status:'PASS',cycles:2,baselineSha256:hash(baseline)},null,2));
  });
  await check('failed installation is atomic; rollback refuses to erase used policy history',()=>{
   const broken=proposal.replace(/commit;\s*$/,"do $$begin raise exception 'isolated241_abort';end $$;commit;");assert.throws(()=>sql(broken,'failed_fixture'),/isolated241_abort/);assert.equal(fingerprint('failed_fixture'),baseline);assert.throws(()=>sql(rollback),/km241_rollback_preserve_history/);
  });
  fs.writeFileSync(out+'POSTGRES-RESULTS.json',JSON.stringify({status:'PASS',checks,proposalSha256:hash(proposal),rollbackSha256:hash(rollback),productionConnections:0},null,2));
 }finally{if(container)run(['rm','-f',container]);}
});
