import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {createServer} from 'node:net';
const root=fileURLToPath(new URL('../../',import.meta.url));
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
test('Deep Cleaning real PostgreSQL: geography, ownership, pending, completion, replay and evidence isolation',{timeout:180000},async t=>{
 const toolDir=process.env.RETAIL_MIS_PG_TOOLS;if(!toolDir){t.skip('Set RETAIL_MIS_PG_TOOLS to disposable PostgreSQL tools');return;}
 const {default:EmbeddedPostgres}=await import(pathToFileURL(path.join(toolDir,'node_modules/embedded-postgres/dist/index.js')).href);
 const {default:pg}=await import(pathToFileURL(path.join(toolDir,'node_modules/pg/lib/index.js')).href);
 // Ask the OS for an available port: hosted Windows runners reserve portions
 // of the ephemeral range, so a guessed fixed range is not portable.
 const reservation=createServer();await new Promise((resolve,reject)=>{reservation.once('error',reject);reservation.listen(0,'127.0.0.1',resolve);});const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
 const databaseDir=path.join(root,'tmp','cleaning-postgres-'+randomUUID());
 const cluster=new EmbeddedPostgres({databaseDir,user:'postgres',password:'local-only',port,persistent:true,initdbFlags:['--encoding=UTF8'],onLog:()=>{},onError:()=>{}});
 await cluster.initialise();const bin=path.join(toolDir,'node_modules/@embedded-postgres/windows-x64/native/bin');
 // pg_ctl uses PostgreSQL's restricted Windows token launcher. Direct
 // postgres.exe is rejected when a hosted runner has administrator privileges.
 const log=path.join(databaseDir,'startup.log'),control=path.join(bin,'pg_ctl.exe'),launcherLog=path.join(databaseDir,'launcher.log');
 // A regular file avoids inherited-pipe hangs from the detached Windows child.
 const launcherFd=fs.openSync(launcherLog,'w');
 try{execFileSync(control,['-D',databaseDir,'-l',log,'-o',`-p ${port} -h 127.0.0.1`,'-w','-t','30','start'],{windowsHide:true,stdio:['ignore',launcherFd,launcherFd],timeout:40000});}catch(error){
  const details=fs.readFileSync(launcherLog,'utf8');
  if(/restricted token: error code 87/.test(details)){
   // Nested local sandboxes already run with a restricted token and cannot
   // restrict it again. PostgreSQL itself still rejects administrator tokens.
   const fd=fs.openSync(log,'w');const direct=spawn(path.join(bin,'postgres.exe'),['-D',databaseDir,'-p',String(port),'-h','127.0.0.1'],{windowsHide:true,stdio:['ignore',fd,fd]});direct.on('error',e=>fs.appendFileSync(log,e.message));fs.closeSync(fd);
  }else throw Error('Disposable PostgreSQL startup failed: '+(fs.existsSync(log)?fs.readFileSync(log,'utf8').slice(-2000):details||error.message));
 }finally{fs.closeSync(launcherFd);}
 const config={host:'127.0.0.1',port,user:'postgres',password:'local-only',database:'postgres',connectionTimeoutMillis:500};
 let db,probeError='';for(let i=0;i<100;i++){const probe=new pg.Client(config);try{await probe.connect();db=probe;break;}catch(error){probeError=error.message;await probe.end();await new Promise(r=>setTimeout(r,100));}}
 if(!db){execFileSync(control,['-D',databaseDir,'-m','fast','-w','stop'],{windowsHide:true,stdio:'pipe',timeout:15000});throw Error('Disposable PostgreSQL connection failed: '+probeError);}
 const q=(s,a=[])=>db.query(s,a),one=async(s,a=[])=>(await q(s,a)).rows[0];
 const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
 const feed=async(actor,stores=null)=>(await one("select rpc_retail_cleaning_delivery_v1($1,$2,$3,current_date-30,current_date+30,null) result",[id(actor),id(actor+1000),stores])).result.rows;
 const command=async(actor,action,data)=>(await one('select rpc_retail_cleaning_submission_v1($1,$2,$3,$4) result',[id(actor),id(actor+1000),action,data])).result;
 try{
  await q(`create role anon;create role authenticated;create role service_role;create schema storage;
   create table profiles(id uuid primary key,auth_user_id uuid,employee_code text,role text,business text,state text,status text,is_active boolean);
   create table reliance_retail_store_master(id uuid primary key,store_code text unique,store_name text,state text,status text,city text,zone_id uuid,assigned_fo_profile_id uuid,latitude numeric,longitude numeric);
   create table client_deep_cleaning_schedules(id uuid primary key default gen_random_uuid(),retail_store_id uuid,scheduled_date date,assigned_fo_profile_id uuid,status text default 'Planned' check(status in ('Planned','Scheduled','Completed','Not Done','Cancelled')),not_done_reason text,completed_at timestamptz,metadata jsonb default '{}',updated_at timestamptz default now());
   create table client_deep_cleaning_submissions(id uuid primary key default gen_random_uuid(),business text,retail_store_id uuid,store_code text,store_name text,client_name text,state text,city text,deep_cleaning_date date,performed_by_type text,submitted_by_user_id uuid,submitted_by_employee_code text,remarks text,status text,submitted_at timestamptz,metadata jsonb default '{}');
   create table client_deep_cleaning_uploads(id uuid primary key default gen_random_uuid(),submission_id uuid,upload_type text,storage_bucket text,storage_path text,original_filename text,mime_type text,file_size bigint,sequence_no int,uploaded_by_user_id uuid,upload_status text,metadata jsonb default '{}');
   create table storage.objects(bucket_id text,name text,metadata jsonb,primary key(bucket_id,name));
   create table retail_unified_epoch(observed_at timestamptz,store_zones jsonb);
   create table reliance_retail_zone_fo_assignments(id uuid,zone_id uuid,fo_profile_id uuid,fo_employee_code text,effective_from timestamptz,effective_to timestamptz);
   create table reliance_retail_zones(id uuid primary key,zone_code text,zone_name text,state text,status text);
   create table reliance_retail_store_zone_history(id uuid,retail_store_id uuid,new_zone_id uuid,changed_at timestamptz);
   insert into retail_unified_epoch values(now()-interval '1 year','{}');`);
  await q(`alter table client_deep_cleaning_schedules add column source_type text,add column source_reference text,add column created_by_profile_id uuid,add unique(retail_store_id,scheduled_date);
   create table retail_provisional_access(actor_id uuid,state text,permission text);
   create table reliance_retail_management_audit(action text,entity_type text,entity_id uuid,actor_profile_id uuid,after_state jsonb);
   create function retail_operations_today() returns date language sql stable as $$select (now() at time zone 'Asia/Kolkata')::date$$;
   -- No legacy MIS grants in this fixture. Exercise the real existing Unified authorization below.
   create function retail_mis_cleaning_access(uuid,text,text) returns boolean language sql stable as $$select false$$;`);
  const unified=read('supabase/proposals/retail_unified_apply_and_record.sql').match(/create function public\.retail_unified_access\([\s\S]*?\$\$;/i)?.[0];assert.ok(unified);await q(unified);
  const owner=read('supabase/proposals/retail_unified_apply_and_record.sql').match(/create function public\.retail_unified_owner\([\s\S]*?\$\$;/i)?.[0];assert.ok(owner);await q(owner);
  const direct=read('supabase/proposals/retail_cleaning_admin_scope_fix_20261103.sql').match(/CREATE OR REPLACE FUNCTION[\s\S]*?\$function\$\s*;/i)?.[0];assert.ok(direct);await q(direct);
  const proposal=read('supabase/proposals/retail_cleaning_delivery_v1.sql');await assert.rejects(q(proposal),/Owner review/);await q('rollback');
  await q("set qpms.cleaning_delivery_reviewed='yes'");await q(proposal);
  // Synthetic fixtures; the ownership resolver itself is the existing implementation.
  const geos=['TN','TN','TN','TN','KA','KL','TG','AP-1','AP-2','AP'];
  for(let i=1;i<=10;i++)await q("insert into profiles values($1,$2,$3,'FO','Reliance Retail',$4,'Active',true)",[id(i),id(i+1000),'FO'+i,geos[i-1]]);
  await q("insert into profiles values($1,$2,'VIEWER','GM','IFMS','TN','Active',true)",[id(11),id(1011)]);
  for(let i=1;i<=11;i++){
   const state=i===11?'PY':geos[i-1],zone=i<=4?i:i===11?4:null;
   await q("insert into reliance_retail_store_master(id,store_code,store_name,state,status,city,zone_id,assigned_fo_profile_id) values($1,$2,$2,$3,'Active','City',$4,$5)",[id(100+i),'S'+i,state,zone?id(200+zone):null,i>=5&&i<=9?id(i):null]);
   await q("insert into client_deep_cleaning_schedules(id,retail_store_id,scheduled_date,metadata) values($1,$2,current_date,'{\"notes\":\"Instructions\"}')",[id(300+i),id(100+i)]);
   if(zone)await q("update retail_unified_epoch set store_zones=store_zones||jsonb_build_object($1::text,jsonb_build_object('zone_id',$2::text))",[id(100+i),id(200+zone)]);
  }
  for(let i=1;i<=4;i++){
   await q("insert into reliance_retail_zone_fo_assignments values($1,$2,$3,$4,now()-interval '1 day',null)",[id(400+i),id(200+i),id(i),'FO'+i]);
   await q("insert into reliance_retail_zones values($1,$2,$2,'TN','Active')",[id(200+i),'ZONE-'+i]);
  }
  await t.test('existing CRM save creates unassigned Planned work immediately; replay and duplicates are safe',async()=>{
   await q("insert into profiles values($1,$2,'EDITOR','HK MIS','Reliance Retail','KL','Active',true)",[id(20),id(1020)]);
   await q("insert into retail_provisional_access values($1,'KL','editor')",[id(20)]);
   await q("insert into reliance_retail_store_master(id,store_code,store_name,state,status) values($1,'KL-PENDING','Unmapped KL','KL','Active')",[id(112)]);
   const save=async(actor,request)=>(await one("select rpc_retail_cleaning_schedule_direct($1,$2,retail_operations_today(),$3,'Instructions') result",[id(actor),id(112),id(request)])).result;
   const first=await save(20,800);assert.equal(first.schedule.status,'Planned');assert.equal(first.schedule.assigned_fo_profile_id,null);assert.equal(first.replayed,false);
   const replay=await save(20,800);assert.equal(replay.schedule.id,first.schedule.id);assert.equal(replay.replayed,true);
   await assert.rejects(save(20,801),/already exists/);await assert.rejects(save(11,802),/editor scope/);await assert.rejects(save(6,803),/editor scope/);
   const viewed=(await feed(11,[id(112)]))[0];assert.equal(viewed.assignment_status,'Assignment Pending');assert.equal(viewed.status,'Planned');assert.equal((await feed(6)).some(r=>r.retail_store_id===id(112)),false);
  });
  await t.test('each TN zone is isolated; Zone4 includes geographic PY under reporting TN',async()=>{for(let i=1;i<=4;i++){const rows=await feed(i);assert.equal(rows.length,i===4?2:1);assert.ok(rows.every(r=>r.assigned_fo_profile_id===id(i)));assert.ok(rows.every(r=>r.permitted_actions.includes('execute')));}const py=(await feed(4)).find(r=>r.geographic_state==='PY');assert.equal(py.reporting_state,'TN');assert.equal(py.zone_id,id(204));assert.equal(py.zone.code,'ZONE-4');});
  await t.test('KA KL TG AP1 AP2 explicit assignment and cross-state denial',async()=>{for(let i=5;i<=9;i++){const rows=await feed(i);assert.equal(rows.length,1);assert.equal(rows[0].geographic_state,geos[i-1]);}assert.equal((await feed(10)).length,0);await q('update reliance_retail_store_master set assigned_fo_profile_id=$1 where id=$2',[id(5),id(106)]);assert.equal((await feed(5)).length,1);assert.equal((await feed(6)).length,0);await q('update reliance_retail_store_master set assigned_fo_profile_id=$1 where id=$2',[id(6),id(106)]);});
  await t.test('pending remains Planned; explicit viewers see unassigned; future effective assignment is excluded',async()=>{await q('update reliance_retail_store_master set assigned_fo_profile_id=null where id=$1',[id(105)]);assert.equal((await feed(5)).length,0);const row=(await feed(11,[id(105)]))[0];assert.equal(row.status,'Planned');assert.equal(row.assignment_status,'Assignment Pending');assert.deepEqual(row.permitted_actions,['view']);await q('update reliance_retail_store_master set assigned_fo_profile_id=$1 where id=$2',[id(5),id(105)]);assert.equal((await feed(5)).length,1);await q("update reliance_retail_zone_fo_assignments set effective_from=now()+interval '1 day' where zone_id=$1",[id(201)]);assert.equal((await feed(1)).length,0);await q("update reliance_retail_zone_fo_assignments set effective_from=now()-interval '1 day' where zone_id=$1",[id(201)]);});
  await t.test('view-only cannot begin, foreign identity/store/date denied, future/cancelled work not executable',async()=>{await assert.rejects(command(11,'begin',{schedule_id:id(301)}),/FO identity/);await assert.rejects(command(2,'begin',{schedule_id:id(301)}),/ownership/);await assert.rejects(command(1,'begin',{schedule_id:id(301),store_code:'FOREIGN'}),/mismatch/);await assert.rejects(q('select rpc_retail_cleaning_delivery_v1($1,$2,null,current_date,current_date,null)',[id(1),id(1002)]),/identity/);await q("update client_deep_cleaning_schedules set status='Cancelled' where id=$1",[id(302)]);assert.equal((await feed(2)).length,0);await assert.rejects(command(2,'begin',{schedule_id:id(302)}),/ownership/);await q("update client_deep_cleaning_schedules set status='Planned',scheduled_date=current_date+1 where id=$1",[id(302)]);assert.deepEqual((await feed(2))[0].permitted_actions,['view']);});
  let draft;
  await t.test('draft replay creates one linked record; changed date fails closed',async()=>{draft=await command(1,'begin',{schedule_id:id(301)});assert.equal((await command(1,'begin',{schedule_id:id(301)})).id,draft.id);assert.equal(draft.metadata.schedule_id,id(301));await q('update client_deep_cleaning_schedules set scheduled_date=current_date-1 where id=$1',[id(301)]);await assert.rejects(command(1,'validate',{submission_id:draft.id}),/changed/);await q('update client_deep_cleaning_schedules set scheduled_date=current_date where id=$1',[id(301)]);});
  await t.test('lost upload-intent responses and concurrent retries create exactly one owned pending row',async()=>{
   const payload={upload_type:'before',mime_type:'image/jpeg',file_size:100,original_filename:'photo.jpg',storage_path:`deep-cleaning/reliance-retail/S1/${draft.id}/${id(900)}.jpg`,pair_id:'pair-1',pair_order:1};
   const args=[id(1),id(1001),draft.id,id(900),payload],sql='select rpc_client_cleaning_upload_intent_v1($1,$2,$3,$4,$5) result';
   const other=new pg.Client(config);await other.connect();let results;try{results=await Promise.all([q(sql,args),other.query(sql,args)]);}finally{await other.end();}
   assert.equal(results[0].rows[0].result.id,results[1].rows[0].result.id);
   assert.equal((await one('select count(*)::int n from client_deep_cleaning_uploads where submission_id=$1',[draft.id])).n,1);
   await assert.rejects(q(sql,[id(2),id(1002),draft.id,id(900),payload]),/Owned draft/);
   await assert.rejects(q(sql,[...args.slice(0,4),{...payload,file_size:101}]),/another file/);
   await assert.rejects(q(sql,[...args.slice(0,4),{...payload,storage_path:payload.storage_path.replace('/S1/','/FOREIGN/')}]),/Invalid upload intent/);
   await assert.rejects(q(sql,[...args.slice(0,4),{...payload,file_size:5242881}]),/Invalid upload intent/);
   await assert.rejects(q(sql,[...args.slice(0,4),{...payload,mime_type:'application/pdf'}]),/Invalid upload intent/);
   await assert.rejects(command(1,'finalize',{submission_id:draft.id}),/Incomplete uploads/);
   await q('delete from client_deep_cleaning_uploads where submission_id=$1',[draft.id]);
  });
  await t.test('atomic completion requires owned physical before/after evidence and valid pairs',async()=>{await assert.rejects(command(1,'finalize',{submission_id:draft.id}),/Before and after/);for(const type of ['before','after']){await q("insert into client_deep_cleaning_uploads(submission_id,upload_type,storage_bucket,storage_path,file_size,uploaded_by_user_id,upload_status,metadata) values($1::uuid,$2::text,'client-deep-cleaning-uploads','deep-cleaning/reliance-retail/S1/'||$1::uuid::text||'/'||$2,100,$3,'uploaded','{\"pair_id\":\"pair1\"}')",[draft.id,type,id(1001)]);}await assert.rejects(command(1,'finalize',{submission_id:draft.id}),/storage mismatch/);await q("insert into storage.objects select storage_bucket,storage_path,'{\"size\":100}'::jsonb from client_deep_cleaning_uploads where submission_id=$1",[draft.id]);await q("update client_deep_cleaning_uploads set metadata='{}' where upload_type='after'");await assert.rejects(command(1,'finalize',{submission_id:draft.id}),/pairs required/);await q("update client_deep_cleaning_uploads set metadata='{\"pair_id\":\"pair1\"}'");});
  await t.test('two connections finalize/replay safely and history survives FO reassignment',async()=>{const other=new pg.Client(config);await other.connect();try{const args=[id(1),id(1001),'finalize',{submission_id:draft.id,outcome:'Completed'}];const results=await Promise.all([q('select rpc_retail_cleaning_submission_v1($1,$2,$3,$4) result',args),other.query('select rpc_retail_cleaning_submission_v1($1,$2,$3,$4) result',args)]);assert.equal(results[0].rows[0].result.id,results[1].rows[0].result.id);}finally{await other.end();}await q('update reliance_retail_zone_fo_assignments set fo_profile_id=$1 where zone_id=$2',[id(2),id(201)]);assert.equal((await feed(1)).find(r=>r.id===id(301)).executor_profile_id,id(1));assert.ok(!(await feed(2)).some(r=>r.id===id(301)));await assert.rejects(command(2,'finalize',{submission_id:draft.id}),/Owned schedule/);await assert.rejects(command(1,'finalize',{submission_id:draft.id,outcome:'Not Done',not_done_reason:'Changed'}),/outcome already fixed/);assert.equal((await one('select count(*)::int n from client_deep_cleaning_submissions where schedule_id=$1',[id(301)])).n,1);});
  await t.test('Not Done preserves Planned until reason is provided; no fake photos',async()=>{const d=await command(3,'begin',{schedule_id:id(303)});await assert.rejects(command(3,'finalize',{submission_id:d.id,outcome:'Not Done'}),/reason required/);assert.equal((await feed(3))[0].status,'Planned');await command(3,'finalize',{submission_id:d.id,outcome:'Not Done',not_done_reason:'Store closed'});assert.equal((await feed(3))[0].status,'Not Done');});
  await t.test('reassignment preserves unfinished evidence and allows a new executor-owned draft',async()=>{
   const original=await command(5,'begin',{schedule_id:id(305)});
   await q("insert into profiles values($1,$2,'NEW-KA','FO','Reliance Retail','KA','Active',true)",[id(12),id(1012)]);
   await q('update reliance_retail_store_master set assigned_fo_profile_id=$1 where id=$2',[id(12),id(105)]);
   assert.equal((await feed(5)).length,0);assert.equal((await feed(12)).length,1);
   await assert.rejects(command(5,'validate',{submission_id:original.id}),/ownership/);
   const next=await command(12,'begin',{schedule_id:id(305)});assert.notEqual(next.id,original.id);
   await command(12,'finalize',{submission_id:next.id,outcome:'Not Done',not_done_reason:'No access'});
   const records=(await q('select id,status,submitted_by_user_id from client_deep_cleaning_submissions where schedule_id=$1',[id(305)])).rows;
   assert.equal(records.length,2);assert.equal(records.find(r=>r.id===original.id).status,'draft');assert.equal(records.find(r=>r.id===next.id).submitted_by_user_id,id(1012));
  });
  await t.test('RPC and helper are inaccessible to browser database roles',async()=>{for(const role of ['anon','authenticated']){assert.equal((await one("select has_function_privilege($1,'rpc_retail_cleaning_delivery_v1(uuid,uuid,uuid[],date,date,uuid)','execute') allowed",[role])).allowed,false);assert.equal((await one("select has_function_privilege($1,'retail_cleaning_executor_v1(uuid)','execute') allowed",[role])).allowed,false);}assert.equal((await one("select has_function_privilege('service_role','rpc_retail_cleaning_submission_v1(uuid,uuid,text,jsonb)','execute') allowed")).allowed,true);});
  await t.test('upload-intent RPC is private to the backend service role',async()=>{for(const role of ['anon','authenticated'])assert.equal((await one("select has_function_privilege($1,'rpc_client_cleaning_upload_intent_v1(uuid,uuid,uuid,uuid,jsonb)','execute') allowed",[role])).allowed,false);});
 }finally{await db.end();execFileSync(control,['-D',databaseDir,'-m','fast','-w','stop'],{windowsHide:true,stdio:'pipe',timeout:15000});}
});
