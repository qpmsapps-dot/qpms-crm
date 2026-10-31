import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync,spawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import * as XLSX from 'xlsx';

// No production connection. The owner export remains outside Git. Restore its
// actual relevant policies, constraints, helpers and Training guard into an
// isolated schema fixture. Auth functions/unexported dependencies are explicit
// fixtures, not an assertion of authenticated production acceptance.
test('owner-export security corrections: actual policies/guards, FO lifecycle, API-only writes and immutable evidence',{
 skip:process.env.RETAIL_PRODUCTION_SECURITY_POSTGRES!=='1',timeout:180000,
},async()=>{
 const bytes=fs.readFileSync(process.env.RETAIL_SECURITY_EXPORT),book=XLSX.read(bytes,{type:'buffer',raw:true});
 assert.equal(createHash('sha256').update(bytes).digest('hex'),'6336bc0a619edffad0b32e07c7350534f24898457978b83f2771dcf33b2b2c02','Review a changed export before replaying it');
 const sections=new Map(XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]]).map(r=>[Number(r.section_number),JSON.parse(r.result).data]));assert.equal(sections.size,8);
 const name='retail-production-policy-'+randomUUID().slice(0,8),docker=args=>execFileSync('docker',args,{encoding:'utf8',stdio:['pipe','pipe','pipe']});
 const sql=s=>execFileSync('docker',['exec','-i',name,'psql','-X','-U','postgres','-qAt','-v','ON_ERROR_STOP=1'],{input:s,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
 const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,q=s=>`'${String(s).replaceAll("'","''")}'`,ident=s=>'"'+s.replaceAll('"','""')+'"';
 const admin=id(1),fo=id(2),other=id(3),reviewer=id(4),store=id(10),proposal=id(11),source=id(20),batch=id(30),ticket=id(31),zone=id(40);
 const actor=(who,s,role='authenticated')=>sql(`set request.jwt.claim.sub='${who}';set request.jwt.claim.role='${role}';set role ${role};${s}`);
 const file=p=>fs.readFileSync(new URL('../../supabase/'+p,import.meta.url),'utf8');
 const tableFrom=(s,name)=>s.match(new RegExp(`create table if not exists public\\.${name}\\s*\\([\\s\\S]*?\\n\\);`,'i'))[0];
 docker(['run','--detach','--name',name,'--network','none','--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17']);
 try{
  for(let i=0;;i++){try{docker(['exec',name,'pg_isready','-U','postgres']);break;}catch{if(i>100)throw Error('Postgres unavailable');await new Promise(r=>setTimeout(r,100));}}
  sql(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
  grant usage on schema public,auth,storage to anon,authenticated,service_role;
  create table profiles(id uuid primary key,auth_user_id uuid,employee_code text,username text,business text,role text,status text,is_active boolean,state text);
  create table reliance_retail_store_master(id uuid primary key,store_code text,state text,status text);
  create table reliance_retail_zones(id uuid primary key,state text,status text);
  create table reliance_retail_zone_fo_assignments(id uuid primary key,zone_id uuid,fo_profile_id uuid,fo_employee_code text,effective_from timestamptz,effective_to timestamptz,status text);
  create table reliance_retail_store_zone_history(id uuid primary key,retail_store_id uuid,new_zone_id uuid,changed_at timestamptz);
  create table retail_unified_epoch(observed_at timestamptz,store_zones jsonb);
  create table retail_provisional_access(actor_id uuid,state text,permission text);
  create table retail_attendance_aop_versions(id uuid primary key);
  create table retail_provisional_rows(id uuid primary key,revision int,batch_id uuid);
  create table retail_provisional_files(id uuid primary key,withdrawn_at timestamptz);
  create table retail_provisional_proposals(id uuid primary key,row_id uuid,revision int,kind text,status text,target_store uuid,target_zone uuid,state text,baseline jsonb,changes jsonb,reason text,decision_reason text,proposed_by uuid,decided_by uuid);
  create table client_deep_cleaning_schedules(id uuid primary key default gen_random_uuid(),retail_store_id uuid,scheduled_date date,assigned_fo_profile_id uuid,status text default 'Planned',source_reference text,created_by_profile_id uuid,metadata jsonb not null default '{}',created_at timestamptz default now(),updated_at timestamptz default now(),completed_at timestamptz);
  create table reliance_retail_management_audit(id uuid primary key default gen_random_uuid(),action text,entity_type text,entity_id uuid,actor_profile_id uuid,before_state jsonb,after_state jsonb,created_at timestamptz default now());
  create table store_master(id uuid primary key,business text,client_name text);
  create table fo_site_visits(id uuid primary key,retail_store_id uuid,store_id uuid);
  create table training_sessions(id uuid primary key);
  create table storage.buckets(id text primary key,public boolean);
  create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner_id text,metadata jsonb,unique(bucket_id,name));
  create function storage.foldername(text) returns text[] language sql immutable as $$select (string_to_array($1,'/'))[1:array_length(string_to_array($1,'/'),1)-1]$$;
  create table hospital_ticket_attachments(storage_path text,ticket_id uuid,is_client_visible boolean);
  create table hospital_ticket_users(auth_user_id uuid,profile_type text,is_active boolean);
  create table site_assessments(id uuid,site_visit_id uuid);
  create function hospital_can_access_ticket(uuid) returns boolean language sql as $$select false$$;
  create function site_workflow_actor_can_edit(uuid) returns boolean language sql as $$select false$$;
  create function site_workflow_actor_can_view(uuid) returns boolean language sql as $$select false$$;
  create function is_not_demo_viewer_user() returns boolean language sql as $$select true$$;
  create function is_not_tender_demo_user() returns boolean language sql as $$select true$$;
  create function is_current_fo(text) returns boolean language sql security definer as $$select exists(select 1 from profiles where auth_user_id=auth.uid() and employee_code=$1 and is_active)$$;
  create function is_qpms_admin() returns boolean language sql security definer as $$select exists(select 1 from profiles where auth_user_id=auth.uid() and role in ('Admin','QPMSADMIN') and is_active)$$;
  create function fault_tracker_current_profile() returns profiles language sql security definer as $$select p from profiles p where p.auth_user_id=auth.uid() limit 1$$;
  create function fault_tracker_normalize_key(text) returns text language sql immutable as $$select regexp_replace(upper(btrim(coalesce($1,''))),'[^A-Z0-9]+','','g')$$;
  create function retail_store_import_admin(uuid) returns void language plpgsql as $$begin if not exists(select 1 from profiles where id=$1 and role in ('Admin','QPMSADMIN') and is_active) then raise exception 'Admin required';end if;end$$;
  create function set_updated_at() returns trigger language plpgsql as $$begin new.updated_at=now();return new;end$$;
  create function training_assert_active_context(uuid,uuid,uuid) returns void language plpgsql as $$begin return;end$$;
  create function reliance_retail_reject_immutable_audit_change() returns trigger language plpgsql as $$begin raise exception 'Audit immutable';end$$;`);
  const mobile=file('migrations_2_0/002_mobile_fo_tables.sql'),fault=file('migrations_2_0/018_fault_tracker_persistence.sql');
  sql(['fo_activity_submissions','fo_activity_uploads'].map(t=>tableFrom(mobile,t)).join('\n')+'\nalter table fo_activity_submissions add column retail_store_id uuid;');
  sql(['fault_tracker_import_batches','fault_tracker_tickets','fault_tracker_ticket_updates'].map(t=>tableFrom(fault,t)).join('\n'));
  // Replay the actual exported constraint definitions and names.
  for(const c of sections.get(7).constraints){if(!c.conname)continue;if(sql(`select exists(select 1 from pg_constraint where conrelid=${q(c.relation)}::regclass and conname=${q(c.conname)})`)==='f')sql(`alter table ${c.relation} add constraint ${ident(c.conname)} ${c.definition};`);}
  for(const f of sections.get(5))if(f.definition_for_private_review)sql(f.definition_for_private_review);
  for(const name of ['fault_tracker_state_code','fault_tracker_current_role_key','fault_tracker_current_state_code','fault_tracker_can_manage','fault_tracker_can_read_all','fault_tracker_can_access','training_legacy_write_guard']){
   const f=sections.get(6).find(f=>f.signature.startsWith(name+'('));assert.ok(f);sql(f.definition_for_private_review);
  }
  for(const t of sections.get(7).triggers)if(t.definition)sql(t.definition+';');
  // Replay the actual grants and policies, not repository assumptions.
  for(const a of sections.get(2)){if(!a.table_present)continue;sql(`alter table ${a.schema_name}.${a.table_name} enable row level security;`);const verbs=['SELECT','INSERT','UPDATE','DELETE'].filter(v=>a['table_'+v.toLowerCase()]);if(verbs.length)sql(`grant ${verbs.join(',')} on ${a.schema_name}.${a.table_name} to ${a.role_name};`);}
  for(const p of sections.get(4))sql(`create policy ${ident(p.policyname)} on ${p.schemaname}.${p.tablename} as ${p.permissive} for ${p.cmd} to ${p.roles.map(ident).join(',')}${p.qual?' using ('+p.qual+')':''}${p.with_check?' with check ('+p.with_check+')':''};`);
  // Unrelated policy dependencies are empty local fixtures, not production ACL changes.
  sql('grant select on site_assessments,hospital_ticket_attachments,hospital_ticket_users to authenticated;');
  sql(`insert into profiles values('${admin}','${admin}','QPMSADMIN','QPMSADMIN','Reliance Retail','QPMSADMIN','Active',true,'TN'),('${fo}','${fo}','FO1','FO1','Reliance Retail','FO','Active',true,'TN'),('${other}','${other}','FO2','FO2','Reliance Retail','FO','Active',true,'KA'),('${reviewer}','${reviewer}','REVIEW','REVIEW','Reliance Retail','Admin','Active',true,'TN');
  insert into reliance_retail_store_master values('${store}','T1','TN','Active');
  insert into reliance_retail_zones values('${zone}','TN','Active');insert into retail_unified_epoch values('2026-10-30','{"${store}":{"zone_id":"${zone}"}}');
  insert into reliance_retail_zone_fo_assignments values('${id(41)}','${zone}','${fo}','FO1','2026-10-30',null,'Active');
  insert into storage.buckets values('fo-activity-uploads',false),('profile-avatars',false);
  insert into fault_tracker_import_batches(id) values('${batch}');insert into fault_tracker_tickets(id,import_batch_id,ticket_no,store_code,stage,updated_at,raw_row) values('${ticket}','${batch}','TEST','T1','Fault Raised - Quote Yet to Submit','2026-10-01','{"original":true}');`);
  const fingerprints=()=>sql("select string_agg(md5(pg_get_triggerdef(oid)),',' order by tgname) from pg_trigger where not tgisinternal and tgname in ('trg_training_legacy_submission_write','trg_training_legacy_upload_write','trg_retail_management_audit_immutable','trg_fo_activity_submissions_updated_at')");
  const oldTriggers=fingerprints(),oldPolicies=sql("select md5(string_agg(row_to_json(p)::text,'' order by schemaname,tablename,policyname)) from pg_policies p");
  // Reproduce actual bypasses before installing the local corrections.
  actor(admin,`update fault_tracker_tickets set remarks='Browser bypass' where id='${ticket}';`);
  const original=sql('select md5(row_to_json(t)::text) from fault_tracker_tickets t');
  sql(file('proposals/retail_fault_api_only_writes.sql'));
  assert.equal(sql('select md5(row_to_json(t)::text) from fault_tracker_tickets t'),original);
  assert.throws(()=>actor(admin,`update fault_tracker_tickets set remarks='No audit' where id='${ticket}';`),e=>/permission denied/.test(String(e.stderr)));
  assert.throws(()=>actor(admin,`delete from fault_tracker_import_batches where id='${batch}';`),e=>/permission denied/.test(String(e.stderr)));
  assert.throws(()=>actor(admin,`insert into fault_tracker_ticket_updates(ticket_id) values('${ticket}');`),e=>/permission denied/.test(String(e.stderr)));
  assert.equal(actor(admin,'select count(*) from fault_tracker_tickets;'),'1');
  actor(fo,`insert into fo_activity_submissions(id,fo_user_id,employee_code,store_code,retail_store_id,activity_type,status,metadata) values('${source}','FO1','FO1','T1','${store}','deep_cleaning','submitted','{"activity_date":"2026-10-31","pending_images":true,"state":"TN"}');`);
  const path=kind=>`FO1/2026-10-31/deep_cleaning/${source}/${kind}.jpg`;
  actor(fo,`insert into storage.objects(bucket_id,name,metadata) values('fo-activity-uploads','${path('before')}','{"size":1}');`);
  assert.equal(actor(other,`select count(*) from storage.objects where name='${path('before')}';`),'1','Actual broad policy exposes other-owner evidence');
  const isolation=file('proposals/retail_legacy_cleaning_evidence_isolation.sql');
  const noCleaningResidue=()=>{
   assert.equal(sql("select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in ('retail_cleaning_object_access','retail_cleaning_has_stored_pair','retail_cleaning_legacy_guard','retail_cleaning_storage_guard')"),'0');
   assert.equal(sql("select count(*) from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'retail_cleaning_%'"),'0');
   assert.equal(sql("select count(*) from pg_trigger where not tgisinternal and tgname in ('trg_retail_cleaning_submission_guard','trg_retail_cleaning_upload_guard','trg_retail_cleaning_storage_guard')"),'0');
   assert.equal(fingerprints(),oldTriggers);
   assert.equal(sql("select md5(string_agg(row_to_json(p)::text,'' order by schemaname,tablename,policyname)) from pg_policies p"),oldPolicies);
  };
  // Existing CREATE + TRIGGER capabilities do not prove policy DDL authority.
  // This isolated role has no Supabase policy hook: actual CREATE POLICY must
  // fail, and every helper created earlier in that transaction must roll back.
  sql('create role delegated_candidate_no_policy_hook bypassrls;grant usage on schema auth,storage to delegated_candidate_no_policy_hook;grant create on schema public to delegated_candidate_no_policy_hook;grant select on all tables in schema public,storage to delegated_candidate_no_policy_hook;grant trigger on storage.objects to delegated_candidate_no_policy_hook;');
  assert.throws(()=>sql('set role delegated_candidate_no_policy_hook;'+isolation),e=>/must be owner of table objects/.test(String(e.stderr)));noCleaningResidue();
  // A later trigger DDL failure must also undo successful earlier policies and
  // public-table triggers. Fault ACL revokes were committed separately and stay.
  const lateFailure=isolation.replace('create trigger trg_retail_cleaning_storage_guard',()=>"do $$begin raise exception 'Simulated final trigger DDL denial';end;$$;\ncreate trigger trg_retail_cleaning_storage_guard");
  assert.throws(()=>sql(lateFailure),e=>/Simulated final trigger DDL denial/.test(String(e.stderr)));noCleaningResidue();
  assert.equal(sql("select has_table_privilege('authenticated','fault_tracker_tickets','UPDATE')"),'f');
  const beforeInstall=sql("select md5(string_agg(j,'' order by j)) from (select to_jsonb(t)::text j from fo_activity_submissions t union all select to_jsonb(t)::text from fo_activity_uploads t union all select to_jsonb(t)::text from storage.objects t) all_rows");
  sql(isolation);
  assert.equal(sql("select md5(string_agg(j,'' order by j)) from (select to_jsonb(t)::text j from fo_activity_submissions t union all select to_jsonb(t)::text from fo_activity_uploads t union all select to_jsonb(t)::text from storage.objects t) all_rows"),beforeInstall);
  assert.equal(actor(other,`select count(*) from storage.objects where name='${path('before')}';`),'0');
  assert.equal(actor(fo,`select count(*) from storage.objects where name='${path('before')}';`),'1');
  sql(`update profiles set role='Operations Manager' where id='${fo}';`);assert.equal(actor(fo,`select count(*) from storage.objects where name='${path('before')}';`),'1','Historical owner role must not remove own-record access');sql(`update profiles set role='FO' where id='${fo}';`);
  sql(`insert into profiles values('${id(66)}','${id(66)}','FO1','DUPLICATE','Reliance Retail','FO','Active',true,'TN');`);assert.equal(actor(fo,`select count(*) from storage.objects where name='${path('before')}';`),'0','Ambiguous active ownership fails closed');sql(`delete from profiles where id='${id(66)}';`);
  assert.equal(actor('',`select count(*) from storage.objects where name='${path('before')}';`,'anon'),'0');
  assert.equal(actor(other,`with changed as(update storage.objects set metadata='{"size":99}' where name='${path('before')}' returning 1)select count(*) from changed;`),'0');
  assert.equal(actor(other,`with changed as(delete from storage.objects where name='${path('before')}' returning 1)select count(*) from changed;`),'0');
  assert.throws(()=>actor(other,`insert into storage.objects(bucket_id,name,metadata) values('fo-activity-uploads','${path('forged')}','{"size":1}');`),e=>/Cleaning owner|row-level security/.test(String(e.stderr)));
  assert.throws(()=>actor(fo,`insert into storage.objects(bucket_id,name,metadata) values('fo-activity-uploads','FO1/2026-10-31/deep_cleaning/${source}/../escape.jpg','{"size":1}');`),e=>/Cleaning owner|row-level security/.test(String(e.stderr)));
  actor(fo,`insert into storage.objects(bucket_id,name,metadata) values('fo-activity-uploads','${path('after')}','{"size":1}');`);
  for(const kind of ['before','after'])actor(fo,`insert into fo_activity_uploads(submission_id,fo_user_id,employee_code,store_code,activity_type,upload_role,file_url,file_name,file_type,file_size) values('${source}','FO1','FO1','T1','deep_cleaning','deep_cleaning_${kind}','fo-activity-uploads/${path(kind)}','${kind}.jpg','image/jpeg',1);`);
  actor(fo,`update fo_activity_submissions set metadata=jsonb_set(metadata,'{pending_images}','false'),submitted_at=clock_timestamp() where id='${source}';`);
  assert.equal(actor(fo,`with changed as(update storage.objects set metadata='{"size":2}' where name='${path('before')}' returning 1)select count(*) from changed;`),'0');
  assert.equal(actor(fo,`with changed as(delete from storage.objects where name='${path('before')}' returning 1)select count(*) from changed;`),'0');
  assert.throws(()=>actor(fo,`update fo_activity_submissions set status='draft' where id='${source}';`),e=>/immutable/.test(String(e.stderr)));
  assert.throws(()=>actor(fo,`insert into fo_activity_uploads(submission_id,fo_user_id,employee_code,store_code,activity_type,file_url) values('${source}','FO1','FO1','T1','deep_cleaning','x');`),e=>/immutable/.test(String(e.stderr)));
  assert.throws(()=>actor(fo,`insert into storage.objects(bucket_id,name,metadata) values('fo-activity-uploads','${path('before')}','{"size":2}') on conflict(bucket_id,name) do update set metadata=excluded.metadata;`),e=>/immutable/.test(String(e.stderr)));
  assert.throws(()=>actor(fo,`update fo_activity_submissions set activity_type='training' where id='${source}';`),e=>/relabelled/.test(String(e.stderr)));
  // Other activities and legacy Training guards remain exactly as exported.
  actor(fo,"insert into storage.objects(bucket_id,name,metadata) values('fo-activity-uploads','FO1/2026-10-31/training/fixture/image.jpg','{}');");
  assert.equal(actor(other,"select count(*) from storage.objects where name like '%/training/%';"),'1','Unrelated legacy Training policy behavior retained');
  assert.throws(()=>actor(fo,`insert into fo_activity_submissions(fo_user_id,employee_code,activity_type,status,metadata) values('FO1','FO1','training','submitted','{}');`),e=>/training_legacy_read_only/.test(String(e.stderr)));
  actor(fo,`insert into fo_activity_submissions(fo_user_id,employee_code,activity_type,status,metadata) values('FO1','FO1','training','draft','{"training_schema":"structured_v1"}');`,'service_role');
  actor(fo,"insert into fo_activity_submissions(fo_user_id,employee_code,activity_type,status) values('FO1','FO1','other_activity','submitted');");
  assert.equal(fingerprints(),oldTriggers);
  assert.equal(sql("select md5(string_agg(row_to_json(p)::text,'' order by schemaname,tablename,policyname)) from pg_policies p where policyname not like 'retail_cleaning_%'"),oldPolicies);
  // The actual production apply function keeps APPROVED plus an audit receipt.
  sql(`insert into retail_provisional_proposals(id,kind,status,target_store,state,baseline,changes,reason,decision_reason,proposed_by,decided_by) select '${proposal}','DC_SCHEDULE','APPROVED','${store}','TN',jsonb_build_object('store',to_jsonb(s)),'{"scheduled_date":"2026-10-31"}','Genuine fixture','Independent fixture approval','${admin}','${reviewer}' from reliance_retail_store_master s;select rpc_retail_unified_apply('${admin}','${proposal}');`);
  const schedule=sql('select id from client_deep_cleaning_schedules');
  // Fixture source predates this newly applied schedule: rejection is mandatory.
  sql(file('proposals/retail_fault_tracker_updates.sql'));sql(file('proposals/retail_cleaning_fo_link.sql'));
  assert.throws(()=>sql(`select rpc_retail_cleaning_link_fo('${admin}','${schedule}','${source}');`),e=>/Verified submitted/.test(String(e.stderr)));
  assert.equal(sql("select status from client_deep_cleaning_schedules"),'Planned');
  const fresh=id(21),freshPath=kind=>`FO1/2026-10-31/deep_cleaning/${fresh}/${kind}.jpg`;
  actor(fo,`insert into fo_activity_submissions(id,fo_user_id,employee_code,store_code,retail_store_id,activity_type,status,metadata) values('${fresh}','FO1','FO1','T1','${store}','deep_cleaning','submitted','{"activity_date":"2026-10-31","pending_images":true,"state":"TN"}');`);
  assert.throws(()=>actor(fo,`update fo_activity_submissions set metadata=jsonb_set(metadata,'{pending_images}','false') where id='${fresh}';`),e=>/Stored before\/after/.test(String(e.stderr)));
  for(const kind of ['before','after']){
   actor(fo,`insert into storage.objects(bucket_id,name,metadata) values('fo-activity-uploads','${freshPath(kind)}','{"size":1}');`);
   actor(fo,`insert into fo_activity_uploads(submission_id,fo_user_id,employee_code,store_code,activity_type,upload_role,file_url,file_name,file_type,file_size) values('${fresh}','FO1','FO1','T1','deep_cleaning','deep_cleaning_${kind}','fo-activity-uploads/${freshPath(kind)}','${kind}.jpg','image/jpeg',1);`);
  }
  const concurrent=(input,onData=()=>{})=>new Promise((resolve,reject)=>{
   const child=spawn('docker',['exec','-i',name,'psql','-X','-U','postgres','-qAt','-v','ON_ERROR_STOP=1']);let output='',errors='';
   child.stdout.on('data',x=>{output+=x;onData(output);});child.stderr.on('data',x=>{errors+=x;});child.on('error',reject);child.on('close',code=>resolve({code,output,errors}));child.stdin.end(input);
  });
  let signal;const held=new Promise(resolve=>{signal=resolve;});
  const finalizing=concurrent(`set request.jwt.claim.sub='${fo}';set request.jwt.claim.role='authenticated';set role authenticated;begin;update fo_activity_submissions set metadata=jsonb_set(metadata,'{pending_images}','false'),submitted_at=clock_timestamp() where id='${fresh}';select 'FINALIZED_LOCK_HELD';select pg_sleep(2);commit;`,output=>{if(output.includes('FINALIZED_LOCK_HELD'))signal();});
  await Promise.race([held,finalizing.then(result=>{if(result.code!==0)throw Error(result.errors);})]);
  const attempted=concurrent(`set request.jwt.claim.sub='${fo}';set request.jwt.claim.role='authenticated';set role authenticated;update storage.objects set metadata='{"size":1,"tampered":true}' where name='${freshPath('before')}';`);
  const [finalized,blocked]=await Promise.all([finalizing,attempted]);assert.equal(finalized.code,0);assert.notEqual(blocked.code,0);assert.match(blocked.errors,/immutable/);
  assert.equal(sql(`select metadata ? 'tampered' from storage.objects where name='${freshPath('before')}'`),'f');
  const sourceDigest=sql(`select md5(row_to_json(s)::text) from fo_activity_submissions s where id='${fresh}'`);
  sql(`select rpc_retail_cleaning_link_fo('${admin}','${schedule}','${fresh}');select rpc_retail_cleaning_link_fo('${admin}','${schedule}','${fresh}');`);
  assert.equal(sql('select status from client_deep_cleaning_schedules'),'Completed');assert.equal(sql("select count(*) from reliance_retail_management_audit where action='VERIFIED_FO_CLEANING_LINK'"),'1');
  assert.equal(sql(`select md5(row_to_json(s)::text) from fo_activity_submissions s where id='${fresh}'`),sourceDigest);
  assert.throws(()=>sql(`select rpc_retail_cleaning_link_source('${other}','${schedule}');`),e=>/Outside schedule scope/.test(String(e.stderr)));
  actor(admin,`select rpc_retail_fault_update('${admin}','${ticket}','Work Completed - Documents Pending','Audited save','2026-10-01','${randomUUID()}');`,'service_role');
  actor(admin,`begin;insert into fault_tracker_import_batches(id) values('${id(99)}');insert into fault_tracker_tickets(import_batch_id,ticket_no,store_code) values('${id(99)}','IMPORT-REHEARSAL','T1');delete from fault_tracker_import_batches where id='${id(99)}';rollback;`,'service_role');
  assert.equal(sql('select count(*) from fault_tracker_ticket_updates'),'1');assert.equal(sql("select raw_row->>'original' from fault_tracker_tickets"),'true');
  // The corrections themselves do not modify source data; baseline behavior and
  // lifecycle mutations above are synthetic test operations only.
  assert.equal(fingerprints(),oldTriggers);
  sql(file('verification/retail_security_corrections_postinstall_read_only.sql'));
  sql('create role limited_storage_installer bypassrls;grant usage on schema storage to limited_storage_installer;grant select on storage.buckets to limited_storage_installer;');
  assert.throws(()=>sql('set role limited_storage_installer;'+file('proposals/retail_legacy_cleaning_evidence_isolation.sql')),e=>/Existing public CREATE privilege/.test(String(e.stderr)));
 }finally{docker(['rm','--force',name]);}
});
