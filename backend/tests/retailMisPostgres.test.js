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
 async function denied(s,args=[],pattern=/scope|state|permission|assignment|access|identity|module|review|immutable|activation|denied|unavailable|cross|changed|explicit|admin|forward|financial/i){await assert.rejects(q(s,args),pattern);}
 async function command(actor,module,action,data){return (await one('select rpc_retail_mis_command($1,$2,$3,$4) result',[actor,module,action,data])).result;}
 async function report(actor,module,state=null){return (await one("select rpc_retail_mis_report($1,$2,'2026-10-01','2026-10-31',$3) result",[actor,module,state])).result;}
 try{
  await q(read('backend/tests/fixtures/retailMisBaseline.sql'));
  // Replay the reviewed installed ownership resolver, not an always-allow mock.
  const ownerDefinition=read('supabase/proposals/retail_unified_apply_and_record.sql').match(/create function public\.retail_unified_owner\([\s\S]*?\$\$;/i)?.[0];assert.ok(ownerDefinition);await q(ownerDefinition);
  const unifiedDefinition=read('supabase/proposals/retail_unified_apply_and_record.sql').match(/create function public\.retail_unified_access\([\s\S]*?\$\$;/i)?.[0];await q(unifiedDefinition.replace('create function','create or replace function'));await q('revoke all on function retail_unified_access(uuid,text,text) from public,anon,authenticated,service_role');
  for(const [file,name] of [['supabase/migrations_2_0/227_reliance_training_fo_workflow.sql','training_legacy_write_guard'],['supabase/proposals/retail_legacy_cleaning_evidence_isolation.sql','retail_cleaning_storage_guard']]){const definition=read(file).match(new RegExp('create (?:or replace )?function public\\.'+name+'\\([\\s\\S]*?\\$\\$;','i'))?.[0];assert.ok(definition);await q(definition);await q('revoke all on function '+name+'() from public,anon,authenticated,service_role');}
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
  if(process.env.RETAIL_MIS_POSTINSTALL_ONLY==='1'){
   await q("insert into storage.buckets(id,name,public) values('fo-activity-uploads','fo-activity-uploads',false),('training-evidence','training-evidence',false),('client-deep-cleaning-uploads','client-deep-cleaning-uploads',false)");
   const verify=read('supabase/verification/retail_mis_postinstall_read_only.sql');await q(verify);
   async function rejectsMutation(change,restore,pattern){await q(change);await assert.rejects(q(verify),pattern);await q('rollback');await q(restore);await q(verify);}
   await rejectsMutation('alter function training_legacy_write_guard() rename to postinstall_hidden_guard','alter function postinstall_hidden_guard() rename to training_legacy_write_guard',/Existing protected workflow missing/);
   const original=(await one("select pg_get_functiondef('retail_cleaning_storage_guard()'::regprocedure) definition")).definition;
   await rejectsMutation(original.replace('declare item jsonb','-- intentional local drift\ndeclare item jsonb'),original,/Existing protected workflow fingerprint drift/);
   await rejectsMutation('grant execute on function rpc_retail_mis_access(uuid,uuid) to public','revoke execute on function rpc_retail_mis_access(uuid,uuid) from public',/MIS routine ACL failed/);
   await rejectsMutation('grant select on retail_mis_records to public','revoke select on retail_mis_records from public',/Protected table PUBLIC/);
   await rejectsMutation('grant select(module) on retail_mis_records to authenticated','revoke select(module) on retail_mis_records from authenticated',/Protected table PUBLIC/);
   await rejectsMutation('alter table retail_service_orders disable trigger retail_mis_retired_order_guard','alter table retail_service_orders enable trigger retail_mis_retired_order_guard',/trigger missing/);
   await rejectsMutation('alter policy retail_mis_private_read on storage.objects using(true)',"alter policy retail_mis_private_read on storage.objects using(bucket_id<>'retail-mis-evidence')",/policy missing/);
   await rejectsMutation('alter table retail_mis_controls alter column oos_writes_enabled set default true','alter table retail_mis_controls alter column oos_writes_enabled set default false',/false default/);
   await rejectsMutation('grant execute on function rpc_retail_service_import(uuid,text,text,text,jsonb) to public','revoke execute on function rpc_retail_service_import(uuid,text,text,text,jsonb) from public',/Existing OOS routine ACL drift/);
   await rejectsMutation('alter table retail_mis_evidence disable row level security','alter table retail_mis_evidence enable row level security',/Protected table RLS/);
   const sentinel=id(999);
   await rejectsMutation(`insert into profiles(id,auth_user_id,employee_code,role) values('${sentinel}','${sentinel}','LOCAL_ASSIGNMENT_SENTINEL','FO');insert into retail_mis_assignments(profile_id,auth_user_id,employee_code,role,states,previous_profile,changed_by) values('${sentinel}','${sentinel}','LOCAL_ASSIGNMENT_SENTINEL','MIS_HK',array['TN'],'{}','${sentinel}')`,`delete from retail_mis_assignments where profile_id='${sentinel}';delete from profiles where id='${sentinel}'`,/zero MIS assignments/);
   console.log('Targeted postinstall passed: exact fingerprints, PUBLIC/column grants, policies, triggers, closed default and zero assignments; negative injections rejected.');return;
  }
  assert.equal((await one("select convalidated from pg_constraint where conrelid='profiles'::regclass and conname='profiles_role_check'")).convalidated,roleConstraintBefore.find(c=>c.conname==='profiles_role_check').convalidated);
  assert.deepEqual((await q("select proname,md5(prosrc) body from pg_proc where proname in ('rpc_retail_fault_update','rpc_retail_cleaning_link_fo','rpc_retail_cleaning_link_source','rpc_retail_service_command','rpc_retail_maintenance_complete','rpc_retail_thermography_command') order by proname")).rows,originalWorkflows);
  await q('insert into auth.users values($1,$2)',[adminAuth,'unchanged-admin']);
  await q("insert into profiles(id,auth_user_id,employee_code,full_name,role,business) values($1,$2,'QPMSADMIN','Fixture Admin','Admin','All Businesses')",[admin,adminAuth]);
  if(process.env.RETAIL_OOS_EXTENSION_REGRESSION==='1'){await q('alter table profiles add column web_access_enabled boolean default true');await q(read('supabase/migrations/20261102123000_retail_oos_superadmin_operator.sql'));}
  if(process.env.RETAIL_OOS_TRAINING_TEST==='1'){
   await q('alter table profiles add column web_access_enabled boolean default true');
   const before=(await one('select to_jsonb(p) profile from profiles p where id=$1',[admin])).profile;
   await q(read('supabase/migrations/20261102123000_retail_oos_superadmin_operator.sql'));
   await q(read('supabase/verification/retail_oos_operator_postinstall_read_only.sql'));
   if(process.env.RETAIL_OOS_REGISTER_TEST==='1'){
    const registerMigration=read('supabase/migrations/20261102133951_retail_oos_register_ageing_v2_disabled.sql');
    await assert.rejects(q(registerMigration.replace(/commit;\s*$/i,'select missing_register_rollback_fixture();commit;')),/missing_register_rollback_fixture/);await q('rollback');
    assert.equal((await one("select to_regclass('public.retail_oos_workflow_catalog') name")).name,null);
    await q(registerMigration);await q(read('supabase/verification/retail_oos_register_postinstall_read_only.sql'));
    await denied('select rpc_retail_oos_register($1)',[admin]);
    assert.equal((await one('select enabled from retail_oos_workflow_catalog where version=2')).enabled,false);
    assert.equal((await one('select jsonb_array_length(stages) n from retail_oos_workflow_catalog')).n,12);
   }
   assert.equal((await one('select count(*)::int n from retail_oos_operator_access')).n,0);
   await denied("select rpc_retail_oos_capabilities($1)",[admin]);
   await q("select rpc_retail_oos_operator_grant($1,true,array['TN'],'Approved synthetic access grant',0)",[admin]);
   assert.deepEqual((await one('select to_jsonb(p) profile from profiles p where id=$1',[admin])).profile,before);
   const access=(await one('select rpc_retail_mis_access($1,$2) result',[admin,adminAuth])).result;assert.equal(access.operator,true);assert.equal(access.role,'MIS_OOS');assert.deepEqual(access.states,['TN']);
   assert.equal((await one("select retail_mis_allowed($1,'oos','TN') allowed",[admin])).allowed,true);
   for(const module of ['stores','attendance-hk','fault','dashboard'])assert.equal((await one('select retail_mis_allowed($1,$2,null) allowed',[admin,module])).allowed,false);
   assert.equal((await one("select retail_mis_allowed($1,'oos','PY') allowed",[admin])).allowed,false);
   await q('insert into auth.users values($1,$2)',[id(999),'synthetic-generic-admin']);await q("insert into profiles(id,auth_user_id,employee_code,role,business) values($1,$1,'GENERIC_ADMIN','Admin','All Businesses')",[id(999)]);
   await denied("select rpc_retail_oos_operator_grant($1,true,array['TN'],'Generic Admin must fail',0)",[id(999)]);
   assert.deepEqual((await one('select rpc_retail_mis_access($1,$2) result',[admin,id(999)])).result,{});
   await denied("select rpc_retail_mis_command($1,'oos','RETIRE','{}')",[admin]);
   assert.equal((await one("select retail_mis_oos_access($1,'TN','review') allowed",[admin])).allowed,false);
   assert.equal((await one('select count(*)::int n from retail_mis_assignments')).n,0);
   assert.equal((await one("select count(*)::int n from retail_mis_audit where action='OOS_OPERATOR_ACCESS'")).n,1);
   await q("insert into reliance_retail_store_master(id,store_code,store_name,state) values($1,'TRAIN_TN','Training TN','TN'),($2,'TRAIN_PY','Training PY','PY')",[id(20),id(21)]);
   await denied('select rpc_retail_mis_oos_import($1,$2,$3,$4,$5)',[admin,'0'.repeat(64),'fixture.xlsx','',JSON.stringify([])],/OOS writes unavailable/);
   await q('update retail_mis_controls set oos_writes_enabled=true'); // Isolated database only.
   const {createHash}=await import('node:crypto');
   const upload=async(source,revision,store=id(20))=>q('select rpc_retail_mis_oos_import($1,$2,$3,$4,$5)',[admin,createHash('sha256').update(source).digest('hex'),'fixture.xlsx',Buffer.from(source).toString('base64'),JSON.stringify([{quotation_number:store===id(20)?'TRAINING_FIXTURE':'CROSS_STATE',store_ids:[store],items:[{store_id:store,description:source,quantity:2,unit_rate:10}],expected_revision:revision}])]);
   await upload('original',0);await upload('rework',1);await upload('rework',1);
   const order=await one("select * from retail_service_orders where reference='TRAINING_FIXTURE'");assert.equal(order.revision,2);assert.equal(order.rework_count,1);assert.equal(order.details.items.length,1);
   assert.equal((await report(admin,'oos')).rows.length,1);assert.equal((await report(admin,'oos')).rows[0].store_codes[0],'TRAIN_TN');
   const actions=(await one('select rpc_retail_oos_capabilities($1) result',[admin])).result.actions[order.id];assert.deepEqual(actions,['PO_RECORDED','RETIRE']);
   await denied('select rpc_retail_mis_oos_history($1,$2)',[id(999),order.id]);await assert.rejects(upload('cross-state',0,id(21)),/scope|state|assignment/i);
   await command(admin,'oos','PO_RECORDED',{order_id:order.id,revision:2,request_id:id(410),fields:{po_number:'TRAIN_PO',po_date:'2026-11-02'}});
   assert.deepEqual((await one('select rpc_retail_oos_capabilities($1) result',[admin])).result.actions[order.id],[]);
   if(process.env.RETAIL_OOS_REGISTER_TEST==='1'){
    const getRegister=async actor=>(await one('select rpc_retail_oos_register($1) result',[actor])).result;
    const register=await getRegister(admin);assert.equal(register.complete,true);assert.equal(register.rows.length,1);assert.equal(register.twelve_stage_enabled,false);
    const row=register.rows[0];assert.equal(row.mapped_stores[0].store_name,'Training TN');assert.equal(row.original_po_date,'2026-11-02');assert.equal(row.history.length,3);assert.equal(row.original_items[0].description,'original');assert.equal(row.details.items[0].description,'rework');
    assert.ok(row.status_entered_at);assert.ok(!JSON.stringify(register).includes('original_base64'));assert.deepEqual(register.states,['TN']);
    await denied('select rpc_retail_oos_register($1)',[id(999)]);
    const snapshot=await q("select proname,md5(prosrc) digest from pg_proc where proname in ('retail_mis_service_command','rpc_retail_mis_oos_import') order by proname");
    const {createHash}=await import('node:crypto');
    const originalBytes=Buffer.from('original-date-source'),reworkBytes=Buffer.from('revision-date-source');
    const dateUpload=(bytes,revision,date,amount)=>q('select rpc_retail_mis_oos_import($1,$2,$3,$4,$5)',[admin,createHash('sha256').update(bytes).digest('hex'),'dates.xlsx',bytes.toString('base64'),JSON.stringify([{quotation_number:'DATES',store_ids:[id(20)],items:[{store_id:id(20),description:'Date fixture',quantity:1,unit_rate:amount,total_amount:amount,quotation_header:{quotation_date:date,totals:{total_amount:amount}}}],expected_revision:revision}])]);
    await dateUpload(originalBytes,0,'2026-10-01',50);await dateUpload(reworkBytes,1,'2026-11-01',99);
    const dated=(await getRegister(admin)).rows.find(r=>r.reference==='DATES');assert.equal(dated.original_items[0].quotation_header.quotation_date,'2026-10-01');assert.equal(dated.original_items[0].total_amount,50);assert.equal(dated.details.items[0].total_amount,99);
    const created=dated.history.find(e=>e.action==='CREATE_OOS');assert.equal(dated.status_entered_at,created.created_at);assert.equal(dated.history.length,2);
    await q('set role authenticated');await denied('select rpc_retail_oos_register($1)',[admin],/permission/);await denied('select * from retail_oos_workflow_catalog',[],/permission/);await q('reset role');
    await assert.rejects(q('update retail_oos_workflow_catalog set enabled=true'),/immutable|check constraint/i);
    await assert.rejects(q('delete from retail_oos_workflow_catalog'),/immutable/i);
    assert.deepEqual((await q("select proname,md5(prosrc) digest from pg_proc where proname in ('retail_mis_service_command','rpc_retail_mis_oos_import') order by proname")).rows,snapshot.rows);
    console.log('Read register checks passed: disabled catalog, scoped originals/current data, canonical names, PO dates, immutable status time, source-byte exclusion, direct-API denial and unchanged mutation RPCs.');
   }
   if(process.env.RETAIL_OOS12_TEST==='1'){
    const {runOos12Checks}=await import('./helpers/retailOos12Checks.js');await runOos12Checks({q,one,id,admin,read,pg,port,t});
   }
   await denied('select rpc_retail_mis_command($1,$2,$3,$4)',[admin,'oos','COMMERCIALLY_CONFIRMED',{order_id:order.id,revision:3,request_id:id(411),fields:{confirmation_ref:'SELF'}}]);
   await q('set role authenticated');await denied('select * from retail_oos_operator_access',[],/permission/);await denied("select rpc_retail_oos_operator_grant($1,true,array['TN'],'Direct escalation',1)",[admin],/permission/);await q('reset role');
   await q('update retail_mis_controls set oos_writes_enabled=false');
   await q("select rpc_retail_oos_operator_grant($1,false,array['TN'],'Revoke synthetic access',1)",[admin]);
   await denied('select rpc_retail_oos_capabilities($1)',[admin]);
   assert.deepEqual((await one('select to_jsonb(p) profile from profiles p where id=$1',[admin])).profile,before);
   console.log('OOS operator isolated checks passed: no seeded grant, exact identity, audit, role preservation, state/module denial, closed gate and revocation.');return;
  }
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
  await denied('select rpc_retail_mis_oos_import($1,$2,$3,$4,$5)',[actors.oos,'0'.repeat(64),'blocked.xlsx','',JSON.stringify([])],/OOS writes unavailable/);
  await q('update retail_mis_controls set oos_writes_enabled=true'); // isolated fixture activation only
  const importQuote=async(hash,source,description,revision,actor=actors.oos)=>q('select rpc_retail_mis_oos_import($1,$2,$3,$4,$5)',[actor,hash,'fixture.xlsx',Buffer.from(source).toString('base64'),JSON.stringify([{quotation_number:'IMPORT_FIXTURE',store_ids:[id(20)],items:[{store_id:id(20),description,quantity:1,unit_rate:10}],expected_revision:revision}])]);
  const {createHash}=await import('node:crypto'),hash=s=>createHash('sha256').update(s).digest('hex');
  await importQuote(hash('first'),'first','Original',0);
  const imported=await one("select id,revision from retail_service_orders where reference='IMPORT_FIXTURE'");
  await importQuote(hash('second'),'second','Revised',1);
  await command(actors.oos,'oos','PO_RECORDED',{order_id:imported.id,revision:2,request_id:id(400),fields:{po_number:'FIXTURE_PO',po_date:'2026-10-15'}});
  await importQuote(hash('first'),'first','Original',1);
  await assert.rejects(importQuote(hash('advanced'),'advanced','Unreviewed advanced change',3),/independent authorized reviewer/);
  const revised=await one('select status,rework_count,details,revision from retail_service_orders where id=$1',[imported.id]);
  assert.equal(revised.status,'PO_RECORDED');assert.equal(revised.rework_count,1);assert.equal(revised.details.po_number,'FIXTURE_PO');assert.equal(revised.details.items[0].description,'Revised');
  await assert.rejects(importQuote(hash('stale'),'stale','Stale',2),/changed after preview/);
  const events=(await one('select rpc_retail_mis_oos_history($1,$2) events',[actors.oos,imported.id])).events;
  assert.equal(events.length,3);assert.ok(events.every(e=>!JSON.stringify(e).includes('original_base64')));
  const originalEvent=events.find(e=>e.action==='CREATE_OOS');assert.equal((await one('select rpc_retail_mis_oos_attachment($1,$2) result',[actors.oos,originalEvent.id])).result.original_base64,Buffer.from('first').toString('base64'));
  await denied('select rpc_retail_mis_oos_history($1,$2)',[actors.hk,imported.id]);await denied('select rpc_retail_mis_oos_attachment($1,$2)',[actors.mep,originalEvent.id]);
  await q("insert into retail_provisional_access values($1,'TN','reviewer')",[actors.central]);
  await importQuote(hash('reviewed-advanced'),'reviewed-advanced','Independently revised',3,actors.central);
  assert.equal((await one('select rework_count from retail_service_orders where id=$1',[imported.id])).rework_count,2);
  await denied('select rpc_retail_mis_command($1,$2,$3,$4)',[actors.oos,'oos','COMMERCIALLY_CONFIRMED',{order_id:imported.id,revision:4,request_id:id(401),fields:{confirmation_ref:'SELF'}}]);
  await denied('select rpc_retail_mis_command($1,$2,$3,$4)',[actors.central,'oos','COMMERCIALLY_CONFIRMED',{order_id:imported.id,revision:4,request_id:id(402),fields:{confirmation_ref:'REWORK_AUTHOR_SELF'}}]);
  await assign(actors.legacy,'MIS_OOS',['TN']);await q("insert into retail_provisional_access values($1,'TN','reviewer')",[actors.legacy]);
  for(const [action,revision,fields,actor] of [['COMMERCIALLY_CONFIRMED',4,{confirmation_ref:'INDEPENDENT'},actors.legacy],['FUND_RECORDED',5,{fund_ref:'FUND_REFERENCE_ONLY'},actors.legacy],['PAYMENT_RECORDED',6,{payment_ref:'PAYMENT_REFERENCE_ONLY'},actors.legacy],['DELIVERED',7,{delivery_ref:'DELIVERY',delivery_date:today},actors.oos]])await command(actor,'oos',action,{order_id:imported.id,revision,request_id:id(401+revision),fields});
  assert.equal((await one('select status from retail_service_orders where id=$1',[imported.id])).status,'DELIVERED');
  await denied('select rpc_retail_mis_command($1,$2,$3,$4)',[actors.oos,'oos','PO_RECORDED',{order_id:imported.id,revision:8,request_id:id(410),fields:{po_number:'BACKWARD',po_date:today}}]);
  await q("insert into reliance_retail_store_master(id,store_code,store_name,state) values($1,' s0 ','Duplicate fixture','PY')",[id(299)]);
  await denied('select retail_mis_service_command($1,$2,$3,null,null,$4)',[actors.oos,id(298),'CREATE_OOS',{reference:'AMBIGUOUS',store_ids:[id(20)]}],/Ambiguous canonical Store Code/);
  await q('delete from reliance_retail_store_master where id=$1',[id(299)]);
  await command(actors.oos,'oos','RETIRE',{order_id:id(50),revision:1,reason:'Cancelled quotation',request_id:id(60)});
  assert.equal((await one('select count(*)::int n from retail_service_orders')).n,2);assert.equal((await one('select count(*)::int n from retail_mis_oos_retirements')).n,1);
  assert.equal((await one('select rpc_retail_mis_oos_history($1,$2) history',[actors.oos,id(50)])).history.at(-1).action,'RETIRED');
  await denied("update retail_service_orders set details='{}' where id=$1",[id(50)]);
  await denied('select rpc_retail_mis_command($1,$2,$3,$4)',[actors.oos,'oos','PO_RECORDED',{order_id:id(50),revision:1,request_id:id(61),fields:{po_number:'P1',po_date:'2026-10-15'}}]);
  await q("insert into retail_service_orders(id,kind,reference,state,store_ids,status,details,created_by) values($1,'OOS','UNSAFE','TN',$2,'QUOTED','{}',$3)",[id(51),[id(20),id(21)],actors.oos]);assert.equal((await report(actors.oos,'oos')).rows.length,2);
  await q("insert into retail_service_events(order_id,request_id,actor_id,action,before_value,after_value,evidence) values($1,$2,$3,'CREATE_OOS',null,'{}',$4)",[id(51),id(411),actors.oos,{file_sha256:hash('first'),original_base64:Buffer.from('first').toString('base64')}]);
  await denied('select rpc_retail_mis_oos_attachment($1,$2)',[actors.oos,originalEvent.id],/Shared workbook/);
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
  // The release postinstall intentionally rejects populated assignment fixtures.
  let postinstall=read('supabase/verification/retail_mis_postinstall_read_only.sql');if(process.env.RETAIL_OOS_EXTENSION_REGRESSION==='1'){const extension=read('supabase/migrations/20261102123000_retail_oos_superadmin_operator.sql');for(const [name,old] of [['retail_mis_allowed','76d9993da440c19b5e15f2b3fc3bfa3b'],['rpc_retail_mis_access','839b5f5685879b947eba345105bf8909']]){const body=extension.match(new RegExp('create or replace function public\\.'+name+'\\([^]*?as \\$\\$([^]*?)\\$\\$;'))?.[1];assert.ok(body);const {createHash}=await import('node:crypto');postinstall=postinstall.replace(old,createHash('md5').update(body.replaceAll('\r\n','\n')).digest('hex'));}}await assert.rejects(q(postinstall),/zero MIS assignments|Existing evidence bucket/);await q('rollback');
  await q('grant execute on function rpc_retail_mis_access(uuid,uuid) to authenticated');await assert.rejects(q(postinstall),/MIS routine ACL failed/);await q('rollback');await q('revoke execute on function rpc_retail_mis_access(uuid,uuid) from authenticated');
  await assert.rejects(q(postinstall),/zero MIS assignments|Existing evidence bucket/);await q('rollback');await q(read('supabase/verification/retail_mis_padma_preflight_read_only.sql'));
  console.log('Real PostgreSQL assertions passed: role/state isolation, identity preservation, direct-API/RLS denial, evidence lifecycle, OOS freeze/retirement.');
 }catch(error){console.error('Local PostgreSQL verification failed:',error.message,error.where||'',error.detail||'');throw error;}finally{await db.end();execFileSync(path.join(toolDir,'node_modules/@embedded-postgres/windows-x64/native/bin/pg_ctl.exe'),['-D',databaseDir,'-m','fast','-w','stop'],{stdio:'pipe',timeout:15000});cluster.process=undefined;}
});
