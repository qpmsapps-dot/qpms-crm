import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync,spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {verifiedWeeklyCompletions,RETAIL_FAULT_STAGES} from '../shared/retailFaultWorkflow.js';
import {updateRetailFault} from '../services/retailFaultUpdateService.js';
import {signLinkedFoCleaningEvidence} from '../services/retailCleaningFoLinkService.js';
import {cleaningReport} from '../shared/retailModuleReports.js';

test('a verified legacy completion updates only its explicitly linked schedule, never another same-store/date schedule',()=>{
 const store={id:'s',store_code:'T1',state:'TN'};
 const result=cleaningReport({stores:[store],to:'2026-10-31',images:[],schedules:['chosen','other'].map(id=>({id,retail_store_id:'s',scheduled_date:'2026-10-31',status:'Planned'})),deep_cleaning:[{id:'fo:source',retail_store_id:'s',store_code:'T1',state:'TN',deep_cleaning_date:'2026-10-31',status:'submitted',source_kind:'verified_fo_link',schedule_id:'chosen'}]});
 assert.deepEqual(result.schedules.map(s=>[s.id,s.display_status,s.submission_ids]),[['chosen','Completed',['fo:source']],['other','Scheduled',[]]]);
 assert.equal(result.totals.completed,1);
});

test('weekly counts require available saved evidence, use India Monday boundaries, deduplicate tickets and ignore imports/future events',()=>{
 const now=new Date('2026-10-31T12:00:00Z'),event=date=>({update_type:'WORK_COMPLETED',created_at:date,metadata:{retail_workflow_version:1}});
 assert.equal(verifiedWeeklyCompletions([{id:'unknown'}],now),null);
 assert.equal(verifiedWeeklyCompletions([{verifiedUpdates:[]}],now),0);
 assert.equal(verifiedWeeklyCompletions([{verifiedUpdates:[event('2026-10-25T18:29:59Z')]},{verifiedUpdates:[event('2026-10-25T18:30:00Z'),event('2026-10-26T10:00:00Z')]},{verifiedUpdates:[event('2026-11-01T10:00:00Z')]}],now),1);
 assert.equal(verifiedWeeklyCompletions([{verifiedUpdates:[{...event(now.toISOString()),metadata:{}}]}],now),0);
});
test('ticket mutations require existing manager authority before any database call',async()=>{
 await assert.rejects(()=>updateRetailFault({rpc(){throw Error('Must not call');}},{id:'mis'},'ticket',{}, {isAdmin:false}),e=>e.statusCode===403);
});

test('persistent update checks eligible scope and binds the actor to the authenticated profile',async()=>{
 const commands=[],profile={id:'real-admin',is_active:true},authorization={readAll:true,isAdmin:true,stateCode:v=>v};
 const tables={fault_tracker_import_batches:[{id:'batch'}],reliance_retail_store_master:[{id:'store',store_code:'T1',state:'TN',status:'Active'}],fault_tracker_tickets:[{id:'ticket',import_batch_id:'batch',store_code:'T1',is_active:true},{id:'excluded',import_batch_id:'batch',store_code:'OTHER',is_active:true}]};
 const client={rpc:async(name,args)=>{if(name==='rpc_retail_fault_update_capability')return {data:false};commands.push(args);return {data:{saved:true}};},from(table){let rows=tables[table]||[],start=0,end=Infinity;const q={select(){return q;},eq(k,v){rows=rows.filter(r=>r[k]===v);return q;},order(){return q;},limit(n){end=n-1;return q;},range(a,b){start=a;end=b;return q;},then(resolve,reject){return Promise.resolve({data:rows.slice(start,end+1)}).then(resolve,reject);}};return q;}};
 const input={stage:RETAIL_FAULT_STAGES[5],remarks:'Verified fixture',expected_updated_at:'2026-10-01T00:00:00Z',request_id:randomUUID(),p_actor:'forged'};
 await assert.rejects(()=>updateRetailFault(client,profile,'excluded',input,authorization),e=>e.statusCode===404);assert.equal(commands.length,0);
 assert.equal((await updateRetailFault(client,profile,'ticket',input,authorization)).saved,true);assert.equal(commands[0].p_actor,'real-admin');
});
test('linked before/after evidence refuses unauthorized scope, public buckets and tampered paths before signing',async()=>{
 const profile={id:'viewer'},source={id:'fo:source',employee_code:'FO1',deep_cleaning_date:'2026-10-31',uploads:[{id:'u',storage_bucket:'fo-activity-uploads',file_url:'fo-activity-uploads/FO1/2026-10-31/deep_cleaning/OTHER/x.jpg',file_type:'image/jpeg',file_size:1}]};let signed=0;
 const client={rpc:async()=>({data:source}),storage:{getBucket:async()=>({data:{public:false}}),from(){signed++;throw Error('Must not sign');}}};
 await assert.rejects(()=>signLinkedFoCleaningEvidence({...client,rpc:async()=>({error:{code:'42501'}})},profile,'outside'),e=>e.statusCode===403);
 await assert.rejects(()=>signLinkedFoCleaningEvidence({...client,storage:{...client.storage,getBucket:async()=>({data:{public:true}})}},profile,'schedule'),e=>e.statusCode===503);
 await assert.rejects(()=>signLinkedFoCleaningEvidence(client,profile,'schedule'),e=>e.statusCode===409);assert.equal(signed,0);
 source.uploads=[{id:'before',upload_role:'deep_cleaning_before',storage_bucket:'fo-activity-uploads',file_url:'fo-activity-uploads/FO1/2026-10-31/deep_cleaning/source/before.jpg',file_name:'before.jpg',file_type:'image/jpeg',file_size:1}];
 const valid={...client,storage:{getBucket:client.storage.getBucket,from(){return {list:async()=>({data:[{name:'before.jpg',metadata:{size:1}}]}),createSignedUrl:async(path,ttl)=>{assert.equal(ttl,600);assert.match(path,/\/source\/before.jpg$/);return {data:{signedUrl:'https://example.test/private-fixture'}};}};}}};
 assert.equal((await signLinkedFoCleaningEvidence(valid,profile,'schedule'))[0].type,'before');
});

test('isolated PostgreSQL persists ticket+audit atomically and links only explicitly verified approved FO work',{skip:process.env.RETAIL_WORKFLOW_GAPS_POSTGRES!=='1',timeout:150000},async()=>{
 const container='qpms-workflow-gaps-'+randomUUID().slice(0,8),docker=args=>execFileSync('docker',args,{encoding:'utf8',stdio:['pipe','pipe','pipe']});
 const sql=text=>execFileSync('docker',['exec','-i',container,'psql','-U','postgres','-qAt','-v','ON_ERROR_STOP=1'],{input:text,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim(),q=v=>`'${String(v).replaceAll("'","''")}'`,id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
 const admin=id(1),fo=id(2),mis=id(3),store=id(10),ticket=id(20),plan=id(30),proposal=id(31),submission=id(40);
 docker(['run','--detach','--name',container,'--network','none','--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17']);
 try{
  for(let i=0;;i++){try{docker(['exec',container,'pg_isready','-U','postgres']);break;}catch{if(i>80)throw Error('Postgres unavailable');await new Promise(r=>setTimeout(r,100));}}
  sql(`create role anon;create role authenticated;create role service_role;
  create table profiles(id uuid primary key,auth_user_id uuid,employee_code text,role text,is_active boolean,status text,state text);
  create table reliance_retail_store_master(id uuid primary key,store_code text,state text,status text,owner_id uuid);
  create table retail_attendance_aop_versions(id uuid primary key);
  create table fault_tracker_import_batches(id uuid primary key);
  create table fault_tracker_tickets(id uuid primary key,import_batch_id uuid,store_code text,is_active boolean,stage text,stage_group text,remarks text,raw_row jsonb,metadata jsonb default '{}',updated_at timestamptz default now());
  create table fault_tracker_ticket_updates(id uuid primary key default gen_random_uuid(),ticket_id uuid,updated_by_auth_user_id uuid,updated_by_employee_code text,update_type text,previous_stage text,new_stage text,remarks text,metadata jsonb,created_at timestamptz default now());
  create table client_deep_cleaning_schedules(id uuid primary key,retail_store_id uuid,scheduled_date date,assigned_fo_profile_id uuid,status text check(status in ('Planned','Completed','Not Done','Cancelled')),source_reference text unique,metadata jsonb not null default '{}',completed_at timestamptz,updated_at timestamptz default now(),created_at timestamptz,unique(retail_store_id,scheduled_date));
  create table retail_provisional_proposals(id uuid,kind text,status text check(status in ('PENDING','APPROVED','REJECTED')),target_store uuid,decided_by uuid,proposed_by uuid);
  create table fo_activity_submissions(id uuid primary key,employee_code text,activity_type text,status text,store_code text,metadata jsonb,submitted_at timestamptz);
  create table fo_activity_uploads(id uuid primary key default gen_random_uuid(),submission_id uuid,employee_code text,activity_type text,store_code text,uploaded_at timestamptz,storage_bucket text,upload_role text,file_type text,file_size integer,file_url text,file_name text);
  create table reliance_retail_management_audit(action text,entity_type text,entity_id uuid,actor_profile_id uuid,before_state jsonb,after_state jsonb);
  create schema storage;create table storage.objects(bucket_id text,name text);
  create table storage.buckets(id text primary key,public boolean);insert into storage.buckets values('fo-activity-uploads',false);
  create function retail_unified_access(actor uuid,statecode text,action text) returns boolean language sql as $$select exists(select 1 from profiles p where p.id=actor and p.is_active and (p.role='Admin' or p.state=statecode))$$;
  create function retail_unified_owner(store uuid,at_time timestamptz) returns jsonb language sql as $$select jsonb_build_object('known',true,'fo_profile_id',owner_id) from reliance_retail_store_master where id=store$$;
  insert into profiles values('${admin}','${id(101)}','ADMIN','Admin',true,'Active','TN'),('${fo}','${id(102)}','FO1','FO',true,'Active','TN'),('${mis}','${id(103)}','MIS','MIS',true,'Active','KA');
  insert into reliance_retail_store_master values('${store}','T1','TN','Active','${fo}');
  insert into fault_tracker_tickets(id,store_code,is_active,stage,raw_row,updated_at) values('${ticket}','T1',true,${q(RETAIL_FAULT_STAGES[0])},'{"source":"unchanged"}','2026-10-01');`);
  sql(fs.readFileSync(new URL('../../supabase/verification/retail_workflow_updates_preinstall.sql',import.meta.url),'utf8'));
  sql(fs.readFileSync(new URL('../../supabase/proposals/retail_fault_tracker_updates.sql',import.meta.url),'utf8'));
  const request=randomUUID(),update=(actor=admin,stage=RETAIL_FAULT_STAGES[5],expected='2026-10-01',req=request)=>`select rpc_retail_fault_update('${actor}','${ticket}',${q(stage)},'Genuine work record',${q(expected)},'${req}');`;
  assert.throws(()=>sql(update(mis)),e=>/manager required/.test(String(e.stderr)));
  sql(update());sql(update());assert.equal(sql('select count(*) from fault_tracker_ticket_updates'),'1');assert.equal(sql('select update_type from fault_tracker_ticket_updates'),'WORK_COMPLETED');
  assert.equal(sql('select raw_row->>\'source\' from fault_tracker_tickets'),'unchanged');
  assert.equal(sql('select stage_group from fault_tracker_tickets'),'Completed');
  assert.throws(()=>sql(update(admin,RETAIL_FAULT_STAGES[6],'2026-10-01',request)),e=>/different command/.test(String(e.stderr)));
  assert.throws(()=>sql(update(admin,RETAIL_FAULT_STAGES[6],'2026-10-01',randomUUID())),e=>/Ticket changed/.test(String(e.stderr)));
  const version=sql('select updated_at from fault_tracker_tickets');
  sql(`create function test_ticket_failure() returns trigger language plpgsql as $$begin raise exception 'Simulated write failure';end;$$;create trigger test_ticket_failure before update on fault_tracker_tickets for each row execute function test_ticket_failure();`);
  assert.throws(()=>sql(update(admin,RETAIL_FAULT_STAGES[6],version,randomUUID())),e=>/Simulated write failure/.test(String(e.stderr)));
  assert.equal(sql('select count(*) from fault_tracker_ticket_updates'),'1','Failed ticket write must roll back its audit insert');
  sql('drop trigger test_ticket_failure on fault_tracker_tickets;');
  assert.equal(sql("select has_function_privilege('authenticated','rpc_retail_fault_update(uuid,uuid,text,text,timestamptz,uuid)','EXECUTE')"),'f');
  sql(`insert into retail_provisional_proposals values('${proposal}','DC_SCHEDULE','APPROVED','${store}','${id(104)}','${admin}');
  insert into client_deep_cleaning_schedules(id,retail_store_id,scheduled_date,status,source_reference,created_at) values('${plan}','${store}','2026-10-31','Planned','${proposal}','2026-10-30');
  insert into fo_activity_submissions values('${submission}','FO1','deep_cleaning','submitted','T1','{"pending_images":false,"activity_date":"2026-10-31","state":"TN"}','2026-10-31 00:00Z');`);
  for(const kind of ['before','after']){const path=`FO1/2026-10-31/deep_cleaning/${submission}/${kind}.jpg`;sql(`insert into fo_activity_uploads(submission_id,employee_code,activity_type,store_code,uploaded_at,storage_bucket,upload_role,file_type,file_size,file_url,file_name) values('${submission}','FO1','deep_cleaning','T1',now(),'fo-activity-uploads','deep_cleaning_${kind}','image/jpeg',1,'fo-activity-uploads/${path}','${kind}.jpg');insert into storage.objects values('fo-activity-uploads','${path}');`);}
  sql(fs.readFileSync(new URL('../../supabase/proposals/retail_cleaning_fo_link.sql',import.meta.url),'utf8'));
  const link=(actor=admin)=>`select rpc_retail_cleaning_link_fo('${actor}','${plan}','${submission}');`;
  assert.throws(()=>sql(link(mis)),e=>/Admin required/.test(String(e.stderr)));
  assert.throws(()=>sql(link()),e=>/Independently approved/.test(String(e.stderr)));
  sql(`insert into reliance_retail_management_audit(action,entity_type,entity_id,actor_profile_id,after_state) values('UNIFIED_APPLY','proposal','${proposal}','${admin}','{"proposal_id":"${proposal}","kind":"DC_SCHEDULE","store_id":"${store}","changes":{"scheduled_date":"2026-10-31"}}');`);
  sql("update reliance_retail_management_audit set after_state=jsonb_set(after_state,'{changes,scheduled_date}','\"2026-10-30\"');");assert.throws(()=>sql(link()),e=>/Independently approved/.test(String(e.stderr)));sql("update reliance_retail_management_audit set after_state=jsonb_set(after_state,'{changes,scheduled_date}','\"2026-10-31\"');");
  sql(`update profiles set role=null where id='${admin}';`);assert.throws(()=>sql(link()),e=>/Admin required/.test(String(e.stderr)));
  sql(`update profiles set role='QPMSADMIN' where id='${admin}';`);
  sql(`update storage.buckets set public=true;`);assert.throws(()=>sql(link()),e=>/Private legacy FO/.test(String(e.stderr)));sql('update storage.buckets set public=false;');
  sql(`update retail_provisional_proposals set decided_by=proposed_by;`);assert.throws(()=>sql(link()),e=>/Independently approved/.test(String(e.stderr)));sql(`update retail_provisional_proposals set decided_by='${id(104)}';`);
  sql(`update fo_activity_submissions set store_code=null;`);assert.throws(()=>sql(link()),e=>/Verified submitted/.test(String(e.stderr)));sql("update fo_activity_submissions set store_code='T1';");
  sql(`update client_deep_cleaning_schedules set assigned_fo_profile_id='${mis}';`);assert.throws(()=>sql(link()),e=>/FO ownership/.test(String(e.stderr)));sql('update client_deep_cleaning_schedules set assigned_fo_profile_id=null;');
  sql(`update fo_activity_submissions set metadata=jsonb_set(metadata,'{pending_images}','true');`);assert.throws(()=>sql(link()),e=>/Verified submitted/.test(String(e.stderr)));assert.equal(sql("select metadata ? 'retail_fo_completion' from client_deep_cleaning_schedules"),'f');
  sql(`update fo_activity_submissions set metadata=jsonb_set(metadata,'{pending_images}','false'),submitted_at='2026-10-29';`);assert.throws(()=>sql(link()),e=>/Verified submitted/.test(String(e.stderr)));
  sql(`update fo_activity_submissions set submitted_at='2026-10-31 00:00Z';delete from storage.objects where name like '%after.jpg';`);assert.throws(()=>sql(link()),e=>/before and after/.test(String(e.stderr)));
  sql(`insert into storage.objects values('fo-activity-uploads','FO1/2026-10-31/deep_cleaning/${submission}/after.jpg');`);
  const before=sql('select md5(row_to_json(f)::text) from fo_activity_submissions f');sql(link());sql(link());assert.equal(sql('select status from client_deep_cleaning_schedules'),'Completed');assert.equal(sql("select count(*) from reliance_retail_management_audit where action='VERIFIED_FO_CLEANING_LINK'"),'1');assert.equal(sql('select md5(row_to_json(f)::text) from fo_activity_submissions f'),before);
  assert.throws(()=>sql(`select rpc_retail_cleaning_link_source('${mis}','${plan}');`),e=>/Outside schedule scope/.test(String(e.stderr)));
  assert.equal(sql("select has_function_privilege('authenticated','rpc_retail_cleaning_link_fo(uuid,uuid,uuid)','EXECUTE')"),'f');
  for(const signature of ['rpc_retail_cleaning_link_fo(uuid,uuid,uuid)','rpc_retail_cleaning_link_source(uuid,uuid)','rpc_retail_fault_update(uuid,uuid,text,text,timestamptz,uuid)','rpc_retail_fault_update_capability()']){
   for(const role of ['anon','authenticated'])assert.equal(sql(`select has_function_privilege('${role}','${signature}','EXECUTE')`),'f');
   assert.equal(sql(`select has_function_privilege('service_role','${signature}','EXECUTE')`),'t');
   assert.equal(sql(`select prosecdef and proconfig @> array['search_path=pg_catalog, public'] from pg_proc where oid='${signature}'::regprocedure`),'t');
  }
  sql(fs.readFileSync(new URL('../../supabase/verification/retail_workflow_updates_postinstall.sql',import.meta.url),'utf8'));
  assert.throws(()=>sql('set role authenticated;'+link()),e=>/permission denied/.test(String(e.stderr)));
  sql('set role service_role;'+link());
  sql('create role unintended_rpc_reader;grant execute on function rpc_retail_cleaning_link_source(uuid,uuid) to unintended_rpc_reader;');
  assert.throws(()=>sql(fs.readFileSync(new URL('../../supabase/verification/retail_workflow_updates_postinstall.sql',import.meta.url),'utf8')),e=>/Unexpected RPC execution grantee/.test(String(e.stderr)));
  sql('revoke execute on function rpc_retail_cleaning_link_source(uuid,uuid) from unintended_rpc_reader;');
  const concurrent=text=>new Promise((resolve,reject)=>{
   const child=spawn('docker',['exec','-i',container,'psql','-U','postgres','-qAt','-v','ON_ERROR_STOP=1']);let output='',errors='';
   child.stdout.on('data',x=>{output+=x;});child.stderr.on('data',x=>{errors+=x;});child.on('error',reject);child.on('close',code=>resolve({code,output,errors}));child.stdin.end(text);
  });
  const current=sql('select updated_at from fault_tracker_tickets'),beforeHistory=Number(sql('select count(*) from fault_tracker_ticket_updates'));
  const race=await Promise.all([concurrent(update(admin,RETAIL_FAULT_STAGES[6],current,randomUUID())),concurrent(update(admin,RETAIL_FAULT_STAGES[6],current,randomUUID()))]);
  assert.equal(race.filter(r=>r.code===0).length,1);assert.match(race.find(r=>r.code!==0).errors,/Ticket changed/);assert.equal(Number(sql('select count(*) from fault_tracker_ticket_updates')),beforeHistory+1);
  const replay=await Promise.all([concurrent(link()),concurrent(link())]);assert.ok(replay.every(r=>r.code===0));assert.equal(sql("select count(*) from reliance_retail_management_audit where action='VERIFIED_FO_CLEANING_LINK'"),'1');
  // Targeted new conditional security patch: preserve reads/import service and
  // refuse inherited writes rather than silently weakening an unrelated role.
  sql('grant select,insert,update,delete on fault_tracker_import_batches,fault_tracker_tickets,fault_tracker_ticket_updates to service_role,authenticated,anon;grant update(remarks) on fault_tracker_tickets to authenticated;create role legacy_fault_writer;grant update on fault_tracker_tickets to legacy_fault_writer;grant legacy_fault_writer to authenticated;');
  const securityPatch=fs.readFileSync(new URL('../../supabase/proposals/retail_fault_api_only_writes.sql',import.meta.url),'utf8');
  assert.throws(()=>sql(securityPatch),e=>/Inherited\/owner direct-write privilege remains/.test(String(e.stderr)));
  assert.equal(sql("select has_table_privilege('authenticated','fault_tracker_ticket_updates','UPDATE')"),'t','Failed patch rolls back earlier revokes');
  sql('revoke legacy_fault_writer from authenticated;');
  const preserved=sql('select md5(row_to_json(t)::text) from fault_tracker_tickets t');sql(securityPatch);
  assert.equal(sql('select md5(row_to_json(t)::text) from fault_tracker_tickets t'),preserved);
  for(const table of ['fault_tracker_import_batches','fault_tracker_tickets','fault_tracker_ticket_updates']){
   assert.equal(sql(`select has_table_privilege('authenticated','${table}','SELECT')`),'t');
   for(const role of ['anon','authenticated'])assert.equal(sql(`select has_table_privilege('${role}','${table}','INSERT,UPDATE,DELETE') or has_any_column_privilege('${role}','${table}','INSERT,UPDATE')`),'f');
   for(const verb of ['SELECT','INSERT','UPDATE','DELETE'])assert.equal(sql(`select has_table_privilege('service_role','${table}','${verb}')`),'t');
  }
  assert.throws(()=>sql("set role authenticated;update fault_tracker_tickets set remarks='forbidden' where false;"),e=>/permission denied/.test(String(e.stderr)));
  assert.equal(sql('set role service_role;select rpc_retail_fault_update_capability();'),'t');
  sql(fs.readFileSync(new URL('../../supabase/verification/retail_production_security_gate.sql',import.meta.url),'utf8'));
 }finally{docker(['rm','--force',container]);}
});
