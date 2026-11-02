import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
import {RETAIL_MIS_MODULES} from '../shared/retailMisAccess.js';
const root=fileURLToPath(new URL('../../',import.meta.url));
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
test('Retail MIS real PostgreSQL: identity, grants, module/state isolation, evidence, OOS retirement and preservation',{timeout:180000},async t=>{
 const toolDir=process.env.RETAIL_MIS_PG_TOOLS;if(!toolDir){t.skip('Set RETAIL_MIS_PG_TOOLS to isolated embedded-postgres + pg installation');return;}
 const {default:EmbeddedPostgres}=await import(pathToFileURL(path.join(toolDir,'node_modules/embedded-postgres/dist/index.js')).href);
 const {default:pg}=await import(pathToFileURL(path.join(toolDir,'node_modules/pg/lib/index.js')).href);
 const port=57400+Math.floor(Math.random()*500),databaseDir=path.resolve(root,'../../tmp/retail-mis-postgres-'+randomUUID());
 const cluster=new EmbeddedPostgres({databaseDir,user:'postgres',password:'local-test-only',port,persistent:true,initdbFlags:['--encoding=UTF8'],postgresFlags:['-h','127.0.0.1'],onLog:()=>{},onError:()=>{}});
 await cluster.initialise();
 const bin=path.join(toolDir,'node_modules/@embedded-postgres/windows-x64/native/bin');
 // Start native PostgreSQL directly: the wrapper chmod/log-language handshake
 // is unreliable when another Windows test has the shared binary open.
 const server=spawn(path.join(bin,'postgres.exe'),['-D',databaseDir,'-p',String(port),'-h','127.0.0.1'],{windowsHide:true,stdio:['ignore','ignore','pipe']});let startupError='';server.stderr.on('data',b=>{startupError+=b.toString();});
 // Probe readiness instead of depending on the Windows localized log text.
 let db;for(let i=0;i<100;i++){const probe=new pg.Client({host:'127.0.0.1',port,user:'postgres',password:'local-test-only',database:'postgres',connectionTimeoutMillis:500});try{await probe.connect();db=probe;break;}catch{await probe.end();await new Promise(r=>setTimeout(r,100));}}
 if(!db){if(server.exitCode===null)execFileSync(path.join(bin,'pg_ctl.exe'),['-D',databaseDir,'-m','fast','-w','stop'],{stdio:'pipe',timeout:15000});throw Error('Isolated PostgreSQL did not become ready: '+startupError.slice(-1000));}
 const q=(s,args=[])=>db.query(s,args),one=async(s,args=[])=>(await q(s,args)).rows[0];
 const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
 const admin='d40c2b3f-87f1-4c34-8798-cf9b0d9ca784',adminAuth='79cd196c-c6f3-404a-b22a-d4683afefa3f';
 const actors={hk:id(1),mep:id(2),oos:id(3),central:id(4),legacy:id(5)};
 async function denied(s,args=[],pattern=/scope|state|permission|assignment|identity|module|review|immutable|activation|denied|unavailable|cross|changed|explicit|admin|forward|financial/i){await assert.rejects(q(s,args),pattern);}
 async function command(actor,module,action,data){return (await one('select rpc_retail_mis_command($1,$2,$3,$4) result',[actor,module,action,data])).result;}
 async function report(actor,module,state=null){return (await one("select rpc_retail_mis_report($1,$2,'2026-10-01','2026-10-31',$3) result",[actor,module,state])).result;}
 try{
  await q(read('backend/tests/fixtures/retailMisBaseline.sql'));
  // Replay the reviewed installed ownership resolver, not an always-allow mock.
  const ownerDefinition=read('supabase/proposals/retail_unified_apply_and_record.sql').match(/create function public\.retail_unified_owner\([\s\S]*?\$\$;/i)?.[0];assert.ok(ownerDefinition);await q(ownerDefinition);
  await q(read('supabase/migrations_2_0/232_reliance_retail_uploaded_attendance.sql'));
  await q('alter table retail_attendance_aop_versions add column aop_class text');
  await q(read('supabase/proposals/retail_service_trackers.sql'));
  await q(read('supabase/proposals/retail_operations_workflows.sql'));
  await q(read('supabase/proposals/retail_fault_tracker_updates.sql'));await q(read('supabase/proposals/retail_cleaning_fo_link.sql'));
  const originalWorkflows=(await q("select proname,md5(prosrc) body from pg_proc where proname in ('rpc_retail_fault_update','rpc_retail_cleaning_link_fo','rpc_retail_cleaning_link_source','rpc_retail_service_command','rpc_retail_maintenance_complete','rpc_retail_thermography_command') order by proname")).rows;
  await q('alter table profiles enable row level security;grant select,insert,update,delete on profiles to authenticated;create policy synthetic_profiles_broad on profiles for all to authenticated using(true) with check(true)');
  await q("do $$declare t text;begin foreach t in array array['fault_tracker_import_batches','fault_tracker_tickets','fault_tracker_ticket_updates','fo_activity_submissions','fo_activity_uploads'] loop execute format('alter table public.%I enable row level security',t);execute format('grant select,insert,update,delete on public.%I to authenticated',t);execute format('create policy synthetic_broad_policy on public.%I for all to authenticated using(true) with check(true)',t);end loop;end;$$");
  const migration=read('supabase/migrations/20261102071258_retail_mis_four_roles.sql');
  const roleConstraintBefore=(await q("select conname,convalidated,pg_get_constraintdef(oid) definition from pg_constraint where conrelid='profiles'::regclass and contype='c' order by conname")).rows;
  await assert.rejects(q(migration.replace(/commit;\s*$/i,"select missing_mis_rollback_fixture();\ncommit;")),/missing_mis_rollback_fixture/);await q('rollback');
  assert.equal((await one("select to_regclass('public.retail_mis_assignments') name")).name,null);
  assert.equal((await one("select count(*)::int n from storage.buckets where id='retail-mis-evidence'")).n,0);
  assert.deepEqual((await q("select conname,convalidated,pg_get_constraintdef(oid) definition from pg_constraint where conrelid='profiles'::regclass and contype='c' order by conname")).rows,roleConstraintBefore);
  await q(migration);
  assert.equal((await one("select convalidated from pg_constraint where conrelid='profiles'::regclass and conname='profiles_role_check'")).convalidated,roleConstraintBefore.find(c=>c.conname==='profiles_role_check').convalidated);
  assert.deepEqual((await q("select proname,md5(prosrc) body from pg_proc where proname in ('rpc_retail_fault_update','rpc_retail_cleaning_link_fo','rpc_retail_cleaning_link_source','rpc_retail_service_command','rpc_retail_maintenance_complete','rpc_retail_thermography_command') order by proname")).rows,originalWorkflows);
  await q('insert into auth.users values($1,$2)',[adminAuth,'unchanged-admin']);
  await q("insert into profiles(id,auth_user_id,employee_code,full_name,role,business) values($1,$2,'QPMSADMIN','Fixture Admin','Admin','All Businesses')",[admin,adminAuth]);
  for(const [name,actor] of Object.entries(actors)){await q('insert into auth.users values($1,$2)',[actor,'unchanged-'+name]);await q("insert into profiles(id,auth_user_id,employee_code,full_name,role,business) values($1,$1,$2,$2,'Business Development Head','Reliance Retail')",[actor,name]);}
  const assign=async(actor,role,states,expected=0)=>q('select rpc_retail_mis_assign($1,$2,$2,$3,$4,$5,$6,$7)',[admin,actor,Object.entries(actors).find(([,a])=>a===actor)[0],role,states,'Verified fixture assignment',expected]);
  await assign(actors.hk,'MIS_HK',['TN','KL']);await assign(actors.mep,'MIS_MEPC',['AP-1']);await assign(actors.oos,'MIS_OOS',['TN']);await assign(actors.central,'CENTRAL_MIS',[]);
  for(const [i,state] of ['TN','PY','KL','KA','AP-1','AP-2','TG'].entries())await q('insert into reliance_retail_store_master(id,store_code,store_name,state) values($1,$2,$2,$3)',[id(20+i),'S'+i,state]);
  // Exact production identifiers are used ONLY as inert fixtures in this local DB.
  const padma='83231458-af73-435a-abda-48bec9f29e5e',padmaAuth='e843bc42-5f61-474d-8eca-1cf8d01ce2c1';
  await q('insert into auth.users values($1,$2)',[padmaAuth,'fixture-password-unchanged']);await q("insert into profiles(id,auth_user_id,employee_code,full_name,role,business,designation) values($1,$2,'QPMSAP2519','Isolated Padma fixture','Business Development Head','All Businesses','MIS')",[padma,padmaAuth]);
  const padmaScript=read('supabase/proposals/retail_mis_padma_assignment.sql');
  await q('update profiles set designation=null where id=$1',[padma]);await assert.rejects(q(padmaScript),/Padma identity or baseline differs/);await q('rollback');
  assert.equal((await one('select count(*)::int n from retail_mis_assignments where profile_id=$1',[padma])).n,0);
  await q("update profiles set designation='MIS',employee_code='WRONG_ACCOUNT' where id=$1",[padma]);await assert.rejects(q(padmaScript),/Padma identity or baseline differs/);await q('rollback');
  await q("update profiles set employee_code='QPMSAP2519' where id=$1",[padma]);
  await q(padmaScript);await q(padmaScript);
  assert.equal((await one('select role from profiles where id=$1',[padma])).role,'CENTRAL_MIS');assert.equal((await one('select encrypted_password from auth.users where id=$1',[padmaAuth])).encrypted_password,'fixture-password-unchanged');assert.equal((await report(padma,'stores')).rows.length,7);
  assert.deepEqual((await report(actors.hk,'stores')).rows.map(s=>s.state).sort(),['KL','TN']);assert.equal((await report(actors.central,'stores')).rows.length,7);
  for(const [actor,role] of [[actors.hk,'MIS_HK'],[actors.mep,'MIS_MEPC'],[actors.oos,'MIS_OOS'],[actors.central,'CENTRAL_MIS']])for(const module of RETAIL_MIS_MODULES.CENTRAL_MIS){if(RETAIL_MIS_MODULES[role].includes(module))assert.equal((await report(actor,module)).complete,true);else await denied('select rpc_retail_mis_report($1,$2,current_date,current_date,null)',[actor,module]);}
  await q("insert into training_categories values($1,'hk')",[id(140)]);
  await q("insert into training_sessions values($1,$2,'S0','TN','reliance_retail','2026-10-15',$3,'submitted'),($4,$2,'S1','TN','reliance_retail','2026-10-15',$3,'submitted')",[id(141),id(20),id(140),id(142)]);
  assert.equal((await report(actors.hk,'training-hk')).rows.length,1);assert.equal((await report(actors.central,'training-hk')).rows.length,1);
  for(const module of ['oos','fault','maintenance','thermography','attendance-mepc','training-mepc'])await denied('select rpc_retail_mis_report($1,$2,current_date,current_date,null)',[actors.hk,module]);
  for(const module of ['stores','dashboard','attendance-hk','pest','cleaning','fault'])await denied('select rpc_retail_mis_report($1,$2,current_date,current_date,null)',[actors.oos,module]);
  await denied("select rpc_retail_mis_report($1,'stores',current_date,current_date,'PY')",[actors.hk]);await denied("select rpc_retail_mis_report($1,'stores',current_date,current_date,'AP-2')",[actors.mep]);
  await denied('select rpc_retail_mis_assign($1,$2,$2,$3,$4,$5,$6,0)',[actors.central,actors.legacy,'legacy','CENTRAL_MIS',[],'Forbidden grant']);
  await denied('select rpc_retail_mis_assign($1,$2,$2,$3,$4,$5,$6,0)',[admin,actors.legacy,'legacy','MIS_HK',['AP'],'Ambiguous AP rejected']);
  await denied('select rpc_retail_mis_assign($1,$2,$3,$4,$5,$6,$7,0)',[admin,actors.legacy,actors.hk,'legacy','CENTRAL_MIS',[],'Wrong auth identity']);
  const today=(await one('select retail_operations_today()::text today')).today,month=today.slice(0,7)+'-01',kind=Number(today.slice(8))<=15?'CM':'PM';
  await command(actors.mep,'maintenance','COMPLETE',{store_id:id(24),kind,month,request_id:id(100)});
  assert.equal((await one('select count(*)::int n from retail_maintenance_calls')).n,1);
  await denied('select rpc_retail_mis_command($1,$2,$3,$4)',[actors.mep,'maintenance','COMPLETE',{store_id:id(25),kind,month,request_id:id(101)}]);
  const inspection=await command(actors.mep,'thermography','Scheduled',{store_id:id(24),scheduled_date:today,request_id:id(102)});
  await denied('select rpc_retail_mis_command($1,$2,$3,$4)',[actors.hk,'thermography','Completed',{id:inspection.id,revision:1,request_id:id(103)}]);
  await command(actors.mep,'thermography','Completed',{id:inspection.id,revision:1,request_id:id(104)});
  const payload=[{employee_code:'FIXTURE_EMPLOYEE',employee_name:'Fixture employee',retail_store_id:id(20),store_code:'S0',attendance_date:'2026-10-15',class:'HK',original_status:'P',credit:1,source_row:2}];
  await q("insert into retail_attendance_uploads(id,kind,filename,checksum,uploaded_by,total_rows,valid_rows,rejected_rows,validation_summary,payload,expected_ids) values($1,'attendance','local.xlsx','local-hash',$2,1,1,0,$3,$4,'[]')",[id(110),actors.hk,{preview_key:'local-preview'},JSON.stringify(payload)]);
  await q('select rpc_retail_mis_attendance_commit($1,$2,false,null,$3)',[id(110),actors.hk,'local-preview']);
  assert.equal((await one('select count(*)::int n from retail_employee_daily_attendance')).n,1);
  await denied('select rpc_commit_retail_attendance_upload($1,$2,false,null,$3)',[id(110),actors.hk,'local-preview'],/authorization/i);
  await q("insert into retail_attendance_uploads(id,kind,filename,checksum,uploaded_by,total_rows,valid_rows,rejected_rows,validation_summary,payload,expected_ids) values($1,'attendance','bad.xlsx','bad-hash',$2,1,1,0,$3,$4,'[]')",[id(111),actors.hk,{preview_key:'bad-preview'},JSON.stringify([{...payload[0],class:'MEPC',employee_code:'BAD_CLASS'}])]);
  await denied('select rpc_retail_mis_attendance_commit($1,$2,false,null,$3)',[id(111),actors.hk,'bad-preview']);assert.equal((await one('select count(*)::int n from retail_employee_daily_attendance')).n,1);
  const storeProposal=await command(actors.hk,'stores','PROPOSE',{store_code:'S0',store_name:'Reviewed fixture name',city:'Fixture city',reason:'Reviewed source correction'});
  await q("insert into reliance_retail_store_master(id,store_code,store_name,state) values($1,' s0 ','Duplicate fixture','PY')",[id(299)]);
  await denied('select rpc_retail_mis_command($1,$2,$3,$4)',[actors.central,'stores','PROPOSE',{store_code:'S0',store_name:'Ambiguous',reason:'Must reject ambiguity'}]);
  await denied("select rpc_retail_mis_report($1,'attendance-hk','2026-10-01','2026-10-31',null)",[actors.hk],/Ambiguous canonical Store Code/);
  await denied('select rpc_retail_mis_command($1,$2,$3,$4)',[actors.central,'maintenance','COMPLETE',{store_id:id(20),kind,month,request_id:id(297)}]);
  await q('delete from reliance_retail_store_master where id=$1',[id(299)]);
  await q('insert into retail_unified_epoch values($1,$2)',['2026-10-01',{[id(20)]:{zone_id:id(309)}}]);
  await q("insert into reliance_retail_zone_fo_assignments values($1,$2,$3,'legacy','2026-10-01',null)",[id(308),id(309),actors.legacy]);
  await q("insert into storage.buckets(id,name,public) values('fo-activity-uploads','fo-activity-uploads',false)");
  await q("insert into retail_provisional_proposals values($1,'DC_SCHEDULE','APPROVED',$2,$3,$4)",[id(310),id(20),actors.legacy,admin]);
  await q("insert into reliance_retail_management_audit(action,entity_type,entity_id,after_state) values('UNIFIED_APPLY','proposal',$1,$2)",[id(310),{proposal_id:id(310),kind:'DC_SCHEDULE',store_id:id(20),changes:{scheduled_date:'2026-10-15'}}]);
  await q("insert into client_deep_cleaning_schedules(id,retail_store_id,scheduled_date,assigned_fo_profile_id,source_reference,created_at) values($1,$2,'2026-10-15',$3,$4,'2026-10-01')",[id(311),id(20),actors.legacy,id(310)]);
  await q("insert into fo_activity_submissions values($1,'legacy','S0','deep_cleaning','submitted','2026-10-15T10:00Z',$2,$3)",[id(312),{pending_images:false,activity_date:'2026-10-15',state:'TN'},id(20)]);
  for(const [n,kind] of [[313,'before'],[314,'after']]){
   const object=`legacy/2026-10-15/deep_cleaning/${id(312)}/${kind}.jpg`;
   await q("insert into storage.objects(bucket_id,name) values('fo-activity-uploads',$1)",[object]);
   await q("insert into fo_activity_uploads values($1,$2,'legacy','S0','deep_cleaning',now(),'fo-activity-uploads',$3,'image/jpeg',100,$4,$5)",[id(n),id(312),'deep_cleaning_'+kind,'fo-activity-uploads/'+object,kind+'.jpg']);
  }
  const originalSource=(await one('select md5(to_jsonb(f)::text) hash from fo_activity_submissions f where id=$1',[id(312)])).hash;
  await denied('select retail_mis_cleaning_link_fo($1,$2,$3)',[actors.mep,id(311),id(312)]);
  await q('select retail_mis_cleaning_link_fo($1,$2,$3)',[actors.hk,id(311),id(312)]);
  assert.equal((await one('select md5(to_jsonb(f)::text) hash from fo_activity_submissions f where id=$1',[id(312)])).hash,originalSource);
  assert.equal((await one('select rpc_retail_mis_linked_evidence($1,$2) source',[actors.hk,id(311)])).source.uploads.length,2);
  await denied('select rpc_retail_mis_linked_evidence($1,$2)',[actors.mep,id(311)]);
  await denied('select rpc_retail_mis_store_review($1,$2,true,$3)',[actors.hk,storeProposal.proposal_id,'Self approve denied']);
  await q('select rpc_retail_mis_store_review($1,$2,true,$3)',[admin,storeProposal.proposal_id,'Independent fixture approval']);assert.equal((await one('select store_name from reliance_retail_store_master where id=$1',[id(20)])).store_name,'Reviewed fixture name');
  const record=await command(actors.hk,'pest','CREATE',{store_code:'S0',activity_date:'2026-10-15',remarks:'Pest control treatment'});assert.equal(record.status,'draft');
  await denied('select rpc_retail_mis_command($1,$2,$3,$4)',[actors.hk,'pest','CREATE',{store_code:'S1',state:'TN',activity_date:'2026-10-15'}]);
  const e=(await one("select rpc_retail_mis_evidence_prepare($1,'pest',$2,'image/jpeg',100) result",[actors.hk,record.id])).result;
  await q('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)',[e.bucket,e.path,{size:100,mimetype:'image/jpeg'}]);
  await q('select rpc_retail_mis_evidence_finalize($1,$2)',[actors.hk,e.id]);
  await denied('select rpc_retail_mis_evidence_object($1,$2,false)',[actors.mep,e.id]);
  await q("select set_config('request.jwt.claim.sub',$1,false)",[actors.hk]);await q('set role authenticated');assert.equal((await one('select count(*)::int n from storage.objects')).n,0);await denied('select * from retail_mis_assignments');await denied('select rpc_retail_mis_access($1,$1)',[actors.hk]);await q('reset role');
  await q("insert into fault_tracker_tickets(id,store_code) values($1,'S0')",[id(120)]);await q("select set_config('request.jwt.claim.sub',$1,false)",[actors.hk]);await q('set role authenticated');assert.equal((await one('select count(*)::int n from fault_tracker_tickets')).n,0);await denied("insert into fault_tracker_tickets(id,store_code) values($1,'S1')",[id(121)],/row-level security/i);await q('reset role');
  await q('set role authenticated');assert.equal((await one('select count(*)::int n from profiles')).n,1);const escalation=await q("update profiles set role='Admin' where id=$1 returning id",[actors.hk]);assert.equal(escalation.rowCount,0);await denied("insert into profiles(id,auth_user_id,employee_code,role) values($1,$2,'ESCALATE','Admin')",[id(130),id(130)],/row-level security/i);await q('reset role');assert.equal((await one('select role from profiles where id=$1',[actors.hk])).role,'MIS_HK');
  await q("insert into storage.buckets(id,name,public) values('training-evidence','training-evidence',false)");await q("insert into storage.objects(bucket_id,name) values('training-evidence','unrelated-object')");await q("select set_config('request.jwt.claim.sub',$1,false)",[actors.hk]);await q('set role authenticated');assert.equal((await one("select count(*)::int n from storage.objects where bucket_id='training-evidence'")).n,0);await q('reset role');await q("select set_config('request.jwt.claim.sub',$1,false)",[actors.legacy]);await q('set role authenticated');assert.equal((await one("select count(*)::int n from storage.objects where bucket_id='training-evidence'")).n,1);await q('reset role');
  await denied('update storage.objects set metadata=$1 where name=$2',[{size:101,mimetype:'image/jpeg'},e.path]);
  await command(actors.hk,'pest','SUBMIT',{id:record.id,revision:1});await denied("select rpc_retail_mis_evidence_prepare($1,'pest',$2,'image/jpeg',100)",[actors.hk,record.id]);
  await denied('update retail_mis_audit set reason=$1',['tamper']);
  await q("insert into retail_service_orders(id,kind,reference,state,store_ids,status,details,created_by) values($1,'OOS','SAFE','TN',$2,'QUOTED','{}',$3)",[id(50),[id(20)],actors.oos]);
  assert.equal((await report(actors.oos,'oos')).stores.length,0);assert.equal((await report(actors.oos,'oos')).rows.length,1);assert.equal((await report(actors.oos,'oos')).rows[0].store_codes_by_id[id(20)],'S0');
  await denied('select rpc_retail_mis_command($1,$2,$3,$4)',[actors.oos,'oos','RETIRE',{order_id:id(50),revision:1,reason:'Cancelled quotation',request_id:id(60)}]);
  await q('update retail_mis_controls set oos_writes_enabled=true'); // isolated fixture activation only
  await q("insert into reliance_retail_store_master(id,store_code,store_name,state) values($1,' s0 ','Duplicate fixture','PY')",[id(299)]);
  await denied('select retail_mis_service_command($1,$2,$3,null,null,$4)',[actors.oos,id(298),'CREATE_OOS',{reference:'AMBIGUOUS',store_ids:[id(20)]}],/Ambiguous canonical Store Code/);
  await q('delete from reliance_retail_store_master where id=$1',[id(299)]);
  await command(actors.oos,'oos','RETIRE',{order_id:id(50),revision:1,reason:'Cancelled quotation',request_id:id(60)});
  assert.equal((await one('select count(*)::int n from retail_service_orders')).n,1);assert.equal((await one('select count(*)::int n from retail_mis_oos_retirements')).n,1);
  await denied("update retail_service_orders set details='{}' where id=$1",[id(50)]);
  await denied('select rpc_retail_mis_command($1,$2,$3,$4)',[actors.oos,'oos','PO_RECORDED',{order_id:id(50),revision:1,request_id:id(61),fields:{po_number:'P1',po_date:'2026-10-15'}}]);
  await q("insert into retail_service_orders(id,kind,reference,state,store_ids,status,details,created_by) values($1,'OOS','UNSAFE','TN',$2,'QUOTED','{}',$3)",[id(51),[id(20),id(21)],actors.oos]);assert.equal((await report(actors.oos,'oos')).rows.length,1);
  await denied('select rpc_retail_mis_command($1,$2,$3,$4)',[actors.oos,'oos','RETIRE',{order_id:id(51),revision:1,reason:'Invalid cross state',request_id:id(62)}]);
  await q("insert into retail_service_orders(id,kind,reference,state,store_ids,status,details,created_by) values($1,'OOS','REVIEW','TN',$2,'PO_RECORDED','{}',$3)",[id(52),[id(20)],actors.oos]);
  await denied('select rpc_retail_mis_command($1,$2,$3,$4)',[actors.oos,'oos','COMMERCIALLY_CONFIRMED',{order_id:id(52),revision:1,request_id:id(63),fields:{confirmation_ref:'fixture'}}]);
  await q("insert into retail_provisional_access values($1,'TN','reviewer')",[actors.oos]);
  await denied('select rpc_retail_mis_command($1,$2,$3,$4)',[actors.oos,'oos','COMMERCIALLY_CONFIRMED',{order_id:id(52),revision:1,request_id:id(64),fields:{confirmation_ref:'fixture'}}]);
  await q("insert into retail_provisional_access values($1,'TN','reviewer')",[actors.central]);await command(actors.central,'oos','COMMERCIALLY_CONFIRMED',{order_id:id(52),revision:1,request_id:id(65),fields:{confirmation_ref:'fixture-independent'}});
  await denied('select rpc_retail_mis_command($1,$2,$3,$4)',[actors.central,'oos','DELIVERED',{order_id:id(52),revision:2,request_id:id(66),fields:{delivery_ref:'out-of-order',delivery_date:today}}]);
  await denied('select rpc_retail_mis_command($1,$2,$3,$4)',[actors.oos,'oos','RETIRE',{order_id:id(52),revision:2,request_id:id(67),reason:'Financial reference retained'}]);
  assert.equal((await one('select encrypted_password from auth.users where id=$1',[actors.hk])).encrypted_password,'unchanged-hk');
  const other=new pg.Client({host:'127.0.0.1',port,user:'postgres',password:'local-test-only',database:'postgres'});await other.connect();try{
   const args=[admin,actors.hk,'hk','MIS_HK',['TN','KL'],'Concurrent assignment fixture',1];
   const changes=await Promise.allSettled([q('select rpc_retail_mis_assign($1,$2,$2,$3,$4,$5,$6,$7)',args),other.query('select rpc_retail_mis_assign($1,$2,$2,$3,$4,$5,$6,$7)',args)]);
   assert.equal(changes.filter(x=>x.status==='fulfilled').length,1);assert.equal(changes.filter(x=>x.status==='rejected'&&x.reason.code==='40001').length,1);
  }finally{await other.end();}
  await assign(actors.hk,null,[],2);await denied("select rpc_retail_mis_report($1,'pest',current_date,current_date,null)",[actors.hk]);assert.equal((await one('select role from profiles where id=$1',[actors.hk])).role,'Business Development Head');
  assert.equal((await one('select public.retail_unified_access($1,null,$2) allowed',[admin,'edit'])).allowed,true);
  assert.equal((await one("select name from access_roles where code='mis'")).name,'MIS');
  await q('update retail_mis_controls set oos_writes_enabled=false');
  const postinstall=read('supabase/verification/retail_mis_postinstall_read_only.sql');await q(postinstall);
  await q('grant execute on function rpc_retail_mis_access(uuid,uuid) to authenticated');await assert.rejects(q(postinstall),/MIS routine ACL failed/);await q('rollback');await q('revoke execute on function rpc_retail_mis_access(uuid,uuid) from authenticated');
  await q(postinstall);await q(read('supabase/verification/retail_mis_padma_preflight_read_only.sql'));
  console.log('Real PostgreSQL assertions passed: role/state isolation, identity preservation, direct-API/RLS denial, evidence lifecycle, OOS freeze/retirement.');
 }catch(error){console.error('Local PostgreSQL verification failed:',error.message,error.where||'',error.detail||'');throw error;}finally{await db.end();execFileSync(path.join(toolDir,'node_modules/@embedded-postgres/windows-x64/native/bin/pg_ctl.exe'),['-D',databaseDir,'-m','fast','-w','stop'],{stdio:'pipe',timeout:15000});cluster.process=undefined;}
});
