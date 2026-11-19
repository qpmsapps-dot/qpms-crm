// Native PostgreSQL 17, synthetic loopback database only. No dotenv or remote SDK.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {nativeThermographyPostgres} from './helpers/nativeThermographyPostgres.js';
import {verifySuperAdminImport} from './helpers/deepCleaningSuperAdminAssertions.js';
const baseline=readFileSync(new URL('./fixtures/cleaningPlanValidatorBaseline.sql',import.meta.url),'utf8').replaceAll('\r\n','\n');
const proposal=readFileSync(new URL('../../supabase/proposals/retail_cleaning_store_only_import_20261118.sql',import.meta.url),'utf8').replaceAll('\r\n','\n');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('reviewed FO-optional validator installs atomically, preserves supplied-FO checks and fails closed on drift',async()=>{
 const pg=await nativeThermographyPostgres();
 try {
  assert.equal(Math.floor(Number((await pg.db.query("select current_setting('server_version_num') version")).rows[0].version)/10000),17,'Native PostgreSQL 17 is mandatory');
  await pg.db.exec(`
   create schema qpms_cleaning_plan;
   create table public.reliance_retail_store_master(id uuid,store_code text,state text,status text);
   create table public.profiles(id uuid,employee_code text,is_active boolean,status text,auth_user_id uuid,role text,business text,state text);
   create table public.client_deep_cleaning_schedules(id uuid,retail_store_id uuid,scheduled_date date,assigned_fo_profile_id uuid,status text);
   create function qpms_cleaning_plan.state(p text) returns text language sql immutable as $$select upper(p)$$;
   create function public.retail_operations_today() returns date language sql as $$select date '2026-11-18'$$;
   -- Deliberately synthetic authorization oracle; live authorization is not replaced.
   create function public.retail_mis_cleaning_access(p_actor uuid,p_state text,p_action text) returns boolean language sql as $$select p_actor='${id(1)}'::uuid and p_state='TN' and p_action='edit'$$;
   create function public.retail_unified_access(p_actor uuid,p_state text,p_action text) returns boolean language sql as $$select p_actor='${id(12)}'::uuid and p_state='TN' and p_action in ('view','edit') or p_actor='${id(11)}'::uuid and p_state in ('TN','AP-1') and p_action='view'$$;
   create function public.retail_unified_owner(p_store uuid,p_at timestamptz) returns jsonb language sql as $$select jsonb_build_object('known',true,'fo_profile_id','${id(2)}')$$;
   insert into reliance_retail_store_master values('${id(3)}','0012','TN','Active'),('${id(4)}','AP-1','AP1','Active'),('${id(5)}','AP-2','AP2','Active');
   insert into profiles values('${id(2)}','FO1',true,'ACTIVE','${id(20)}','FO','Reliance Retail','TN'),('${id(6)}','OTHER',true,'ACTIVE','${id(21)}','FO','Reliance Retail','TN'),('${id(7)}','WRONGSTATE',true,'ACTIVE','${id(22)}','FO','Reliance Retail','AP1');
  `);
  await pg.db.exec(baseline);
  await pg.db.exec('revoke all on function qpms_cleaning_plan.validate_row(uuid,jsonb) from public');
  const installed=(await pg.db.query("select replace(pg_get_functiondef('qpms_cleaning_plan.validate_row(uuid,jsonb)'::regprocedure),E'\\r\\n',E'\\n') definition")).rows[0].definition;
  assert.equal(installed,baseline);
  const call=async(row,actor=id(1))=>(await pg.db.query('select qpms_cleaning_plan.validate_row($1,$2) value',[actor,row])).rows[0].value;
  const row={STATE:'TN',STORE_CODE:'0012',SCHEDULE_DATE:'2026-12-05'};
  await assert.rejects(call(row),/INVALID_OR_AMBIGUOUS_FO/);
  const before=(await pg.db.query("select proacl::text acl from pg_proc where oid='qpms_cleaning_plan.validate_row(uuid,jsonb)'::regprocedure")).rows[0].acl;
  await pg.db.exec(proposal);
  assert.equal((await call(row)).fo_profile_id,null);
  assert.equal((await call({...row,FO_EMPLOYEE_CODE:'  '})).fo_profile_id,null);
  assert.equal((await call({...row,FO_EMPLOYEE_CODE:'FO1'})).fo_profile_id,id(2));
  for(const [extra,error] of [[{FO_EMPLOYEE_CODE:'UNKNOWN'},/INVALID_OR_AMBIGUOUS_FO/],[{FO_EMPLOYEE_CODE:'OTHER'},/FO_ZONE_ASSIGNMENT_CONFLICT/],[{FO_EMPLOYEE_CODE:'WRONGSTATE'},/FO_STATE_CONFLICT/],[{SCHEDULE_DATE:'2026-12-32'},/out of range/],[{SCHEDULE_DATE:'2026-12-05x'},/INVALID_DATE/],[{STATE:'AP1'},/STATE_MISMATCH/],[{STORE_CODE:'unknown'},/UNKNOWN_OR_AMBIGUOUS_STORE_CODE/]])await assert.rejects(call({...row,...extra}),error);
  await assert.rejects(call(row,id(9)),/STATE_SCOPE_DENIED/);
  for(const state of ['AP1','AP2'])await assert.rejects(call({...row,STATE:state,STORE_CODE:state==='AP1'?'AP-1':'AP-2'}),/STATE_SCOPE_DENIED/);
  await pg.db.exec(proposal); // Exact installed replay is a no-op.
  assert.equal((await pg.db.query("select proacl::text acl from pg_proc where oid='qpms_cleaning_plan.validate_row(uuid,jsonb)'::regprocedure")).rows[0].acl,before);
  await pg.db.exec(`
   create role anon;create role authenticated;create role service_role;
   create schema qpms_release;create function qpms_release.assert_mutation() returns void language plpgsql as $$begin return;end$$;
   create schema storage;create table storage.objects(bucket_id text,name text,metadata jsonb);
   alter table client_deep_cleaning_schedules add column metadata jsonb not null default '{}',add column completed_at timestamptz,add column updated_at timestamptz;
   create table client_deep_cleaning_submissions(id uuid primary key,schedule_id uuid,retail_store_id uuid,store_code text,state text,status text,final_outcome text,metadata jsonb,submitted_at timestamptz,deep_cleaning_date date,submitted_by_user_id uuid);
   alter table client_deep_cleaning_submissions add column business text not null default 'Reliance Retail',add column submitted_by_employee_code text default 'FO1';
   create table client_deep_cleaning_uploads(submission_id uuid,upload_status text,uploaded_by_user_id uuid,storage_bucket text,storage_path text,file_size bigint,metadata jsonb,mime_type text,upload_type text);
   create table reliance_retail_management_audit(action text,entity_type text,entity_id uuid,actor_profile_id uuid,before_state jsonb,after_state jsonb);
   create function guard_cleaning_phase1b_submitted() returns trigger language plpgsql as $$begin
    if old.status='submitted' and old.metadata->>'contract_version'='cleaning-independent.phase1b.v1' then
     raise exception using errcode='40001',message='Submitted independent work is immutable';end if;return new;end$$;
   create trigger guard_cleaning_phase1b_submitted before update or delete on client_deep_cleaning_submissions for each row execute function guard_cleaning_phase1b_submitted();
   insert into client_deep_cleaning_schedules(id,retail_store_id,scheduled_date,status) values('${id(30)}','${id(3)}','2026-11-01','Planned');
  `);
  const matching=readFileSync(new URL('../../supabase/proposals/retail_cleaning_verified_matching_20261118.sql',import.meta.url),'utf8').replaceAll('\r\n','\n');
  await pg.db.exec(matching);await pg.db.exec(matching);
  assert.equal((await pg.db.query("select tgenabled from pg_trigger where tgname='z90_cleaning_verified_match_v2'")).rows[0].tgenabled,'D','Installation cannot alter completion behavior before matching readers deploy');
  assert.equal((await pg.db.query("select has_function_privilege('service_role','public.rpc_retail_cleaning_manual_link_v2(uuid,uuid,text,jsonb)','EXECUTE') allowed")).rows[0].allowed,false,'Manual completion is also staged until approval');
  const activation=readFileSync(new URL('../../supabase/proposals/retail_cleaning_v2_activate_20261118.sql',import.meta.url),'utf8').replaceAll('\r\n','\n');
  await pg.db.exec(activation);await pg.db.exec(matching);
  assert.equal((await pg.db.query("select tgenabled from pg_trigger where tgname='z90_cleaning_verified_match_v2'")).rows[0].tgenabled,'O','Exact installation replay preserves approved activation');
  const source=id(43),prefix=`deep-cleaning/reliance-retail/0012/${source}/`;
  await pg.db.query(`insert into client_deep_cleaning_submissions(id,schedule_id,retail_store_id,store_code,state,status,final_outcome,metadata,submitted_at,deep_cleaning_date,submitted_by_user_id) values($1,null,$2,'0012','TN','draft','Completed','{"contract_version":"cleaning-independent.phase1b.v1"}',now(),'2026-11-01',$3)`,[id(40),id(3),id(20)]);
  await pg.db.query("update client_deep_cleaning_submissions set status='submitted' where id=$1",[id(40)]);
  assert.equal((await pg.db.query('select status from client_deep_cleaning_schedules')).rows[0].status,'Planned','No evidence cannot complete a schedule');
  await assert.rejects(pg.db.query("update client_deep_cleaning_submissions set status='draft' where id=$1",[id(40)]),/immutable/);
  await pg.db.query(`insert into client_deep_cleaning_submissions(id,schedule_id,retail_store_id,store_code,state,status,final_outcome,metadata,submitted_at,deep_cleaning_date,submitted_by_user_id) values($1,null,$2,'0012','TN','draft','Completed','{"contract_version":"cleaning-independent.phase1b.v1"}',now(),'2026-11-01',$3)`,[source,id(3),id(20)]);
  // Synthetic storage metadata represents persisted objects, never live uploads.
  for(const type of ['before','after','document']){
   const path=prefix+type+'/synthetic.png';
   await pg.db.query(`insert into client_deep_cleaning_uploads values($1,'uploaded',$2,'client-deep-cleaning-uploads',$3,10,$4,'image/png',$5)`,[source,id(20),path,{contract_version:'cleaning-independent.phase1b.v1',pair_id:id(50),pair_order:1},type]);
   await pg.db.query(`insert into storage.objects values('client-deep-cleaning-uploads',$1,'{"size":10,"mimetype":"image/png"}')`,[path]);
  }
  await pg.db.query("update client_deep_cleaning_submissions set status='submitted' where id=$1",[source]);
  const linked=(await pg.db.query('select * from client_deep_cleaning_schedules')).rows[0];
  assert.equal(linked.status,'Completed');assert.equal(linked.metadata.verified_submission_id,source);
  assert.equal((await pg.db.query('select schedule_id from client_deep_cleaning_submissions')).rows[0].schedule_id,null,'Original independent submission stays unchanged');
  assert.equal((await pg.db.query('select count(*)::int n from reliance_retail_management_audit')).rows[0].n,1);
  await assert.rejects(pg.db.query("update client_deep_cleaning_submissions set status='submitted' where id=$1",[source]),/immutable/);
  assert.equal((await pg.db.query('select count(*)::int n from reliance_retail_management_audit')).rows[0].n,1,'Replay cannot count or audit twice');
  await pg.db.query("insert into client_deep_cleaning_schedules(id,retail_store_id,scheduled_date,status) values($1,$2,'2026-11-02','Planned')",[id(31),id(3)]);
  for(const candidate of [id(41),id(42)]){
   await pg.db.query(`insert into client_deep_cleaning_submissions(id,schedule_id,retail_store_id,store_code,state,status,final_outcome,metadata,submitted_at,deep_cleaning_date,submitted_by_user_id) values($1,null,$2,'0012','TN','draft','Completed','{"contract_version":"cleaning-independent.phase1b.v1"}',now(),'2026-11-02',$3)`,[candidate,id(3),id(20)]);
   for(const type of ['before','after','document']){
    const path=`deep-cleaning/reliance-retail/0012/${candidate}/${type}/synthetic.png`;
    await pg.db.query(`insert into client_deep_cleaning_uploads values($1,'uploaded',$2,'client-deep-cleaning-uploads',$3,10,$4,'image/png',$5)`,[candidate,id(20),path,{contract_version:'cleaning-independent.phase1b.v1',pair_id:id(51),pair_order:1},type]);
    await pg.db.query(`insert into storage.objects values('client-deep-cleaning-uploads',$1,'{"size":10,"mimetype":"image/png"}')`,[path]);
   }
  }
  const a=await pg.connect(),b=await pg.connect();
  await Promise.all([a.query("update client_deep_cleaning_submissions set status='submitted' where id=$1",[id(41)]),b.query("update client_deep_cleaning_submissions set status='submitted' where id=$1",[id(42)])]);
  assert.equal((await pg.db.query('select count(*)::int n from reliance_retail_management_audit')).rows[0].n,2,'Two sessions produce only one additional completion');
  assert.equal((await pg.db.query("select count(*)::int n from client_deep_cleaning_submissions where status='submitted'")).rows[0].n,4,'Independent reports are retained even when another report completed the schedule');
  await pg.db.query("insert into profiles values($1,'ADMIN',true,'ACTIVE',$2,'Admin','Reliance Retail','TN')",[id(12),id(120)]);
  const winner=(await pg.db.query('select metadata from client_deep_cleaning_schedules where id=$1',[id(31)])).rows[0].metadata.verified_submission_id;
  const manualSource=winner===id(41)?id(42):id(41);
  await pg.db.query("insert into client_deep_cleaning_schedules(id,retail_store_id,scheduled_date,status) values($1,$2,'2026-11-03','Planned'),($3,$2,'2026-11-04','Planned')",[id(32),id(3),id(33)]);
  const manual=(action,data,actor=id(12),auth=id(120))=>pg.db.query('select rpc_retail_cleaning_manual_link_v2($1,$2,$3,$4) result',[actor,auth,action,data]);
  const review={schedule_id:id(32),source_id:manualSource,revision:0,reason:'Verified historical visit evidence and both recorded original dates'};
  await assert.rejects(manual('preview',review,id(2),id(20)),/Admin required/);
  const preview=(await manual('preview',review)).rows[0].result;assert.equal(preview.exact_date,false);assert.equal(preview.actual_date,'2026-11-02');assert.equal(preview.scheduled_date,'2026-11-03');
  await assert.rejects(manual('link',review),/date exception required/);
  await assert.rejects(manual('link',{...review,allow_date_exception:true,reason:'short'}),/20-2000/);
  const concurrentManual=await Promise.all([a.query('select rpc_retail_cleaning_manual_link_v2($1,$2,$3,$4) result',[id(12),id(120),'link',{...review,allow_date_exception:true}]),b.query('select rpc_retail_cleaning_manual_link_v2($1,$2,$3,$4) result',[id(12),id(120),'link',{...review,allow_date_exception:true}])]);
  assert.deepEqual(concurrentManual.map(r=>r.rows[0].result.replayed).sort(),[false,true]);
  assert.equal((await pg.db.query("select count(*)::int n from reliance_retail_management_audit where action='CLEANING_VERIFIED_MANUAL_LINK'")).rows[0].n,1);
  await assert.rejects(manual('link',{...review,schedule_id:id(33),allow_date_exception:true}),/already linked/);
  await assert.rejects(manual('preview',{...review,source_id:id(40)}),/stored evidence required/);
  assert.equal((await pg.db.query('select deep_cleaning_date::text actual,schedule_id from client_deep_cleaning_submissions where id=$1',[manualSource])).rows[0].actual,'2026-11-02','Manual review preserves original actual date');
  assert.equal((await pg.db.query('select schedule_id from client_deep_cleaning_submissions where id=$1',[manualSource])).rows[0].schedule_id,null);
  await pg.db.exec(`
   alter table client_deep_cleaning_schedules alter column id set default gen_random_uuid(),
    add column not_done_reason text,add column source_type text,add column source_reference text,add column created_by_profile_id uuid,
    add unique(retail_store_id,scheduled_date);
   alter table reliance_retail_management_audit add column created_at timestamptz default now();
   insert into profiles values('${id(1)}','MIS',true,'ACTIVE','${id(10)}','CENTRAL_MIS','Reliance Retail','TN');
   create table qpms_release.test_admission(allowed boolean);insert into qpms_release.test_admission values(true);
   create or replace function qpms_release.assert_mutation() returns void language plpgsql as $$begin
    if not (select allowed from qpms_release.test_admission) then raise exception using errcode='55000',message='Synthetic mutation fence closed';end if;end$$;
  `);
  await pg.db.exec(readFileSync(new URL('./fixtures/cleaningPlanRpcBaseline.sql',import.meta.url),'utf8').replaceAll('\r\n','\n'));
  const command=(session,action,data,auth=id(10))=>session.query('select public.rpc_retail_cleaning_plan_v1($1,$2,$3,$4) result',[id(1),auth,action,data]);
  const payload={month:'2026-12',request_id:id(70),rows:[row]};
  assert.equal((await command(pg.admin,'preview',payload)).rows[0].result.valid,1);
  await assert.rejects(command(pg.admin,'import',{...payload,rows:[row,{...row,STORE_CODE:'UNKNOWN'}]}),/no rows imported/);
  assert.equal((await pg.db.query("select count(*)::int n from client_deep_cleaning_schedules where scheduled_date='2026-12-05'")).rows[0].n,0,'Whole workbook is atomic');
  await assert.rejects(command(pg.admin,'import',payload,id(99)),/Verified actor required/);
  const imports=await Promise.all([command(a,'import',payload),command(b,'import',payload)]);
  assert.deepEqual(imports.map(r=>r.rows[0].result.replayed).sort(),[false,true]);
  assert.equal((await pg.db.query("select count(*)::int n from client_deep_cleaning_schedules where scheduled_date='2026-12-05'")).rows[0].n,1);
  await assert.rejects(command(pg.admin,'import',{...payload,request_id:id(71)}),/no rows imported/);
  await assert.rejects(command(pg.admin,'import',{...payload,rows:[{...row,SCHEDULE_DATE:'2026-12-06'}]}),/identity reused/);
  const imported=imports[0].rows[0].result.receipts[0].schedule_id;
  const correction={schedule_id:imported,revision:0,operation:'reschedule',scheduled_date:'2026-12-06',reason:'Verified revised monthly plan'};
  await assert.rejects(command(pg.admin,'correct',{...correction,reason:'short'}),/8-2000/);
  await command(pg.admin,'correct',correction);
  await assert.rejects(command(pg.admin,'correct',correction),/Schedule changed/);
  await command(pg.admin,'correct',{...correction,operation:'reassign',revision:1,fo_employee_code:'FO1'});
  await assert.rejects(command(pg.admin,'correct',{...correction,operation:'reassign',revision:2,fo_employee_code:'WRONGSTATE'}),/FO_STATE_CONFLICT/);
  await command(pg.admin,'correct',{...correction,operation:'cancel',revision:2});
  await assert.rejects(command(pg.admin,'correct',{...correction,revision:3}),/terminal schedule/);
  const history=(await command(pg.admin,'history',{schedule_id:imported})).rows[0].result.history;
  assert.equal(history.filter(e=>e.action==='CLEANING_CORRECTION').length,3);
  const conflicting=await Promise.allSettled([command(a,'import',{...payload,request_id:id(73),rows:[{...row,SCHEDULE_DATE:'2026-12-07'}]}),command(b,'import',{...payload,request_id:id(74),rows:[{...row,SCHEDULE_DATE:'2026-12-07'}]})]);
  assert.equal(conflicting.filter(r=>r.status==='fulfilled').length,1);assert.equal(conflicting.filter(r=>r.status==='rejected').length,1);
  assert.equal((await pg.db.query("select count(*)::int n from client_deep_cleaning_schedules where scheduled_date='2026-12-07'")).rows[0].n,1);
  const many=[];
  for(let n=0;n<500;n++){const code='BULK'+n;await pg.db.query('insert into reliance_retail_store_master values($1,$2,\'TN\',\'Active\')',[id(1000+n),code]);many.push({...row,STORE_CODE:code});}
  const started=performance.now();
  assert.equal((await command(pg.admin,'preview',{month:'2026-12',rows:many})).rows[0].result.valid,500);
  const bulk=(await command(pg.admin,'import',{month:'2026-12',request_id:id(80),rows:many})).rows[0].result;
  assert.equal(bulk.receipts.length,500);console.log('Native PostgreSQL 17: 500-row preview + atomic import ms:',Math.round(performance.now()-started));
  await assert.rejects(command(pg.admin,'preview',{month:'2026-12',rows:[...many,many[0]]}),/1-500/);
  await pg.db.exec(`
   create table access_modules(id uuid primary key,code text,active boolean default true);
   create table access_roles(id uuid primary key default gen_random_uuid(),code text,name text,user_type text,module_id uuid,description text,active boolean default true);
   create table access_permissions(id uuid primary key default gen_random_uuid(),code text,name text,module_id uuid,action text,resource text,description text,active boolean default true);
   create table access_role_permissions(role_id uuid,permission_id uuid,allowed boolean);
   create table access_business_verticals(id uuid,active boolean default true);
   create table access_clients(id uuid,business_vertical_id uuid,active boolean default true,effective_from timestamptz default now()-interval '1 day',effective_to timestamptz);
   create table access_business_vertical_modules(business_vertical_id uuid,module_id uuid,enabled boolean default true,effective_from timestamptz default now()-interval '1 day',effective_to timestamptz);
   create table access_client_modules(client_id uuid,module_id uuid,enabled boolean default true,effective_from timestamptz default now()-interval '1 day',effective_to timestamptz);
   create table access_user_assignments(id uuid primary key,profile_id uuid,auth_user_id uuid,role_id uuid,module_id uuid,business_vertical_id uuid,client_id uuid,active boolean default true,verification_status text default 'verified',effective_from timestamptz default now()-interval '1 day',effective_to timestamptz,metadata jsonb default '{}');
   create table access_user_scopes(user_assignment_id uuid,scope_type text,scope_code text,scope_text text,allowed boolean default true,effective_from timestamptz default now()-interval '1 day',effective_to timestamptz);
   create or replace function retail_unified_access(p_actor uuid,p_state text,p_action text) returns boolean language sql as $$select p_actor='${id(11)}'::uuid and p_state in ('TN','AP-1') and p_action='view'$$;
   insert into access_modules values('${id(900)}','deep_cleaning',true);
   insert into access_permissions(id,code,module_id,action,resource) values('${id(901)}','deep_cleaning.view','${id(900)}','view','deep_cleaning');
   insert into access_business_verticals values('8bbf5511-1e15-4da4-895e-8546cd14a799',true);
   insert into access_clients(id,business_vertical_id) values('369d2d5f-396f-49f9-a47d-bfbc8f7cb922','8bbf5511-1e15-4da4-895e-8546cd14a799');
   insert into access_business_vertical_modules(business_vertical_id,module_id) values('8bbf5511-1e15-4da4-895e-8546cd14a799','${id(900)}');
   insert into access_client_modules(client_id,module_id) values('369d2d5f-396f-49f9-a47d-bfbc8f7cb922','${id(900)}');
   insert into profiles values('${id(11)}','STATE-WRITER',true,'ACTIVE','${id(110)}','Branch Head','Reliance Retail','TN');
   update reliance_retail_store_master set state='AP-1' where id='${id(4)}';
   update reliance_retail_store_master set state='AP-2' where id='${id(5)}';
  `);
  const writerSql=readFileSync(new URL('../../supabase/proposals/retail_cleaning_schedule_writer_20261118.sql',import.meta.url),'utf8').replaceAll('\r\n','\n');
  await pg.db.exec(writerSql);await pg.db.exec(writerSql);
  const permissions=(await pg.db.query("select permission.code from access_role_permissions rp join access_roles r on r.id=rp.role_id join access_permissions permission on permission.id=rp.permission_id where r.code='retail_deep_cleaning_schedule_writer'")).rows.map(r=>r.code);
  assert.deepEqual(permissions,['deep_cleaning.schedule.manage'],'The writer role grants no evidence, report export, submission, approval or other-module permission');
  const writerAccess=async()=>(await pg.db.query('select rpc_retail_cleaning_writer_access_v2($1,$2) result',[id(11),id(110)])).rows[0].result;
  assert.equal((await writerAccess()).active,false,'Creating the role grants nobody access');
  await pg.db.exec(`insert into access_user_assignments(id,profile_id,auth_user_id,role_id,module_id,business_vertical_id,client_id)
   select '${id(910)}','${id(11)}','${id(110)}',id,'${id(900)}','8bbf5511-1e15-4da4-895e-8546cd14a799','369d2d5f-396f-49f9-a47d-bfbc8f7cb922' from access_roles where code='retail_deep_cleaning_schedule_writer';
   insert into access_user_scopes(user_assignment_id,scope_type,scope_code) values('${id(910)}','state','TN');`);
  assert.equal((await writerAccess()).active,false,'An assignment without approval reference remains denied');
  await pg.db.exec(`update access_user_assignments set metadata='{"approval_reference":"SYNTHETIC-APPROVED"}'`);
  assert.deepEqual((await writerAccess()).states,['TN']);
  const writerCommand=(action,data)=>pg.db.query('select rpc_retail_cleaning_plan_v1($1,$2,$3,$4) result',[id(11),id(110),action,data]);
  const statePayload={month:'2026-12',request_id:id(920),rows:[{...row,SCHEDULE_DATE:'2026-12-08'}]};
  assert.equal((await writerCommand('import',statePayload)).rows[0].result.receipts.length,1);
  const stateBulk={month:'2026-12',request_id:id(921),rows:many.map(row=>({...row,SCHEDULE_DATE:'2026-12-09'}))};
  const stateStarted=performance.now();assert.equal((await writerCommand('preview',stateBulk)).rows[0].result.valid,500);
  assert.equal((await writerCommand('import',stateBulk)).rows[0].result.receipts.length,500);
  console.log('Native PostgreSQL 17: state-writer 500-row preview + import ms:',Math.round(performance.now()-stateStarted));
  const apRows=state=>[{STATE:state,STORE_CODE:state,SCHEDULE_DATE:'2026-12-08'}];
  assert.equal((await writerCommand('preview',{...statePayload,rows:apRows('AP-1')})).rows[0].result.invalid,1);
  await pg.db.exec(`insert into access_user_scopes(user_assignment_id,scope_type,scope_code) values('${id(910)}','state','AP-1'),('${id(910)}','state','AP-2');`);
  assert.deepEqual((await writerAccess()).states,['AP-1','TN'],'An AP-2 grant cannot bypass the existing hierarchy boundary');
  assert.equal((await writerCommand('preview',{...statePayload,rows:apRows('AP-1')})).rows[0].result.valid,1);
  assert.equal((await writerCommand('preview',{...statePayload,rows:apRows('AP-2')})).rows[0].result.invalid,1);
  await pg.db.exec(`update profiles set role='MIS_HK' where id='${id(11)}'`);
  assert.equal((await writerAccess()).active,false,'HK MIS never gains writes from this role');
  await pg.db.exec(`update profiles set role='Branch Head' where id='${id(11)}';update access_user_assignments set effective_to=now()-interval '1 second'`);
  assert.equal((await writerAccess()).active,false,'Expired assignments remain denied');
  await pg.db.exec(`update access_user_assignments set effective_to=null;update access_client_modules set enabled=false`);
  assert.equal((await writerAccess()).active,false,'Disabled client/module remains denied');
  await pg.db.exec('update access_client_modules set enabled=true');
  await pg.db.exec(`update access_user_assignments set client_id='${id(999)}'`);
  assert.equal((await writerAccess()).active,false,'Another business/client never grants Retail schedule access');
  await pg.db.exec("update access_user_assignments set client_id='369d2d5f-396f-49f9-a47d-bfbc8f7cb922'");
  await assert.rejects(writerCommand('approve',statePayload),/Unknown action/);
  assert.equal((await pg.db.query("select has_function_privilege('anon','public.rpc_retail_cleaning_writer_access_v2(uuid,uuid)','EXECUTE') allowed")).rows[0].allowed,false);
  await verifySuperAdminImport(pg);
  await pg.db.exec('update qpms_release.test_admission set allowed=false');
  await assert.rejects(command(pg.admin,'import',{...payload,request_id:id(72),rows:[{...row,SCHEDULE_DATE:'2026-12-06'}]}),/mutation fence closed/);
  const countBefore=(await pg.db.query('select count(*)::int n from client_deep_cleaning_submissions')).rows[0].n;
  await pg.db.exec(readFileSync(new URL('../../supabase/proposals/retail_cleaning_v2_recovery_20261118.sql',import.meta.url),'utf8').replaceAll('\r\n','\n'));
  assert.equal((await writerAccess()).active,false);
  assert.equal((await pg.db.query('select count(*)::int n from client_deep_cleaning_submissions')).rows[0].n,countBefore);
  assert.equal((await pg.db.query("select tgenabled from pg_trigger where tgname='z90_cleaning_verified_match_v2'")).rows[0].tgenabled,'D');
  assert.equal((await command(pg.admin,'preview',payload)).rows[0].result.valid,1,'Recovery preserves FO-less import validation for existing writers');
  await pg.db.exec(baseline.replace('Invalid row','Unreviewed row'));
  await assert.rejects(pg.db.exec(proposal),/validator drift/);
  await pg.db.exec('rollback');
 } finally {await pg.close();}
});
