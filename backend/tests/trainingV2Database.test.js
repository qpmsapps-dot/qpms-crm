// Synthetic loopback PostgreSQL only. No dotenv, server.js, hosted database or tokens.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {nativeThermographyPostgres} from './helpers/nativeThermographyPostgres.js';

test('Training V2 real PostgreSQL authorization, evidence, history and concurrency',{timeout:180000},async t=>{
 process.env.THERMOGRAPHY_NATIVE_OUTPUT_DIR=resolve('artifacts/training-v2-validation');
 const cluster=await nativeThermographyPostgres();
 const q=async(sql,args=[])=>{
  if(args.length && sql.includes(';')) {let result;for(const statement of sql.split(';').filter(v=>v.trim())){const selected=[];const text=statement.replace(/\$(\d+)/g,(_,n)=>{selected.push(args[Number(n)-1]);return String.fromCharCode(36)+selected.length;});result=await cluster.admin.query(text,selected);}return result;}
  return cluster.admin.query(sql,args);
 };
 const rpc=async(name,args=[],db=cluster.admin)=>(await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result;
 const read=p=>fs.readFileSync(new URL('../../'+p,import.meta.url),'utf8');
 const admin='d40c2b3f-87f1-4c34-8798-cf9b0d9ca784',adminAuth='79cd196c-c6f3-404a-b22a-d4683afefa3f';
 const fo=randomUUID(),mis=randomUUID(),om=randomUUID(),bh=randomUUID(),kam=randomUUID(),hkMis=randomUUID(),south=randomUUID(),store=randomUUID(),py=randomUUID(),foreign=randomUUID(),type=randomUUID(),hk=randomUUID(),mep=randomUUID(),att=randomUUID(),visit=randomUUID(),topic=randomUUID(),hkTopic=randomUUID(),moduleId=randomUUID();
 let mobile,web;
 try {
 await q(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;create schema qpms_training_reports;
 create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;create function auth.role() returns text language sql stable as $$select 'service_role'::text$$;
 create table profiles(id uuid primary key,auth_user_id uuid,employee_code text,username text,full_name text,display_name text,designation text,department text,role text,business text,state text,status text default 'Active',is_active boolean default true,mobile_access_enabled boolean default true,web_access_enabled boolean default true);
 create table access_clients(id uuid primary key,code text,name text,active boolean);
 create table access_roles(id uuid primary key,code text,active boolean);
 create table access_modules(id uuid primary key,code text,active boolean);
 create table access_user_assignments(id uuid primary key,auth_user_id uuid,profile_id uuid,client_id uuid,module_id uuid,role_id uuid,active boolean,verification_status text,effective_from timestamptz,effective_to timestamptz);
 create table access_user_scopes(id uuid default gen_random_uuid(),user_assignment_id uuid,scope_type text,scope_id uuid,scope_code text,scope_text text,allowed boolean default true,effective_from timestamptz,effective_to timestamptz);
 create table access_audit_logs(id uuid primary key default gen_random_uuid(),actor_user_id uuid,action text,target_type text,target_id uuid,before_state jsonb,after_state jsonb,metadata jsonb,created_at timestamptz default now());
 create table retail_mis_assignments(profile_id uuid,auth_user_id uuid,employee_code text,role text,states text[],active boolean);
 create table reliance_retail_store_master(id uuid primary key,store_code text,store_name text,state text,status text,zone_id uuid,metadata jsonb);
 create table store_master(id uuid primary key,store_code text,store_name text,state text,business text,client_name text,status text);
 create table fo_attendance(id uuid primary key,employee_code text,fo_user_id text,status text,logout_time timestamptz);
 create table fo_site_visits(id uuid primary key,attendance_id uuid,employee_code text,fo_user_id text,store_id uuid,retail_store_id uuid,check_in_time timestamptz,check_out_time timestamptz);
 create table fo_activity_submissions(id uuid primary key,fo_user_id text not null,employee_code text,attendance_id uuid,site_visit_id uuid,store_id uuid,retail_store_id uuid,store_code text,activity_type text,status text,remarks text,submitted_at timestamptz not null,local_id text,metadata jsonb not null default '{}',created_at timestamptz default now(),updated_at timestamptz default now());
 create table employee_hierarchy(employee_code text,manager_employee_code text,managers_manager_employee_code text,business_head_employee_code text,is_active boolean);
 create table reliance_retail_zones(id uuid primary key,state text,status text);create table reliance_retail_zone_fo_assignments(zone_id uuid,fo_profile_id uuid,status text,effective_from timestamptz,effective_to timestamptz);
 create table storage.buckets(id text primary key,public boolean);create table storage.objects(bucket_id text,name text,metadata jsonb);
 create function retail_oos_operator_allowed(uuid,text) returns boolean language sql as $$select false$$;create function retail_oos_state(text) returns text language sql as $$select $1$$;`);
 const foundation=read('supabase/migrations_2_0/115_reliance_training_foundation.sql');
 for(const table of ['training_categories','training_types','training_topics','training_sessions','training_session_topics','training_session_attendees','training_evidence','training_events']) {
  const sql=foundation.match(new RegExp('create table if not exists public\\.'+table+' \\([\\s\\S]*?\\n\\);'))?.[0];assert.ok(sql,table);await q(sql);
 }
 await q(`alter table training_sessions alter column store_id drop not null;alter table training_sessions add column retail_store_id uuid references reliance_retail_store_master(id),add column mobile_creation_key text;create unique index training_creation_identity on training_sessions(trainer_profile_id,mobile_creation_key);
 insert into storage.buckets values('training-evidence',false);insert into access_clients values('369d2d5f-396f-49f9-a47d-bfbc8f7cb922','reliance_retail','Reliance Retail',true);`);
 await q(read('backend/tests/fixtures/training_v2_installed_baseline.sql'));
 // Match the inspected production service-only RPC boundary; helpers retain their original ACL.
 await q(`DO $acl$ DECLARE p record;BEGIN FOR p IN SELECT oid::regprocedure signature,proname FROM pg_proc WHERE pronamespace='public'::regnamespace AND (proname LIKE '%training%' OR proname='retail_mis_allowed') LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',p.signature);
 IF p.proname<>'retail_mis_allowed' THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',p.signature);END IF;END LOOP;END $acl$;`);
 await q('insert into profiles(id,auth_user_id,employee_code,full_name,role,business,state) values($1,$2,\'QPMSADMIN\',\'Synthetic Admin\',\'Admin\',\'All Businesses\',\'TN\')',[admin,adminAuth]);
 await q("update profiles set business='All Businesses' where id=$1",[admin]);
 for(const [id,role,code] of [[fo,'FO','FO1'],[mis,'MIS_MEPC','MIS1'],[om,'Operations Manager','OM1'],[bh,'Branch Head','BH1'],[kam,'KAM','KAM1'],[hkMis,'MIS_HK','HKMIS1'],[south,'South Head','SOUTH1']])await q('insert into profiles(id,auth_user_id,employee_code,full_name,role,business,state) values($1,$2,$3,$3,$4,\'Reliance Retail\',\'TN\')',[id,randomUUID(),code,role]);
 for(let i=0;i<26;i++)await q("insert into profiles(id,auth_user_id,employee_code,full_name,role,business,state) values($1,$2,$3,$3,'FO','Reliance Retail','TN')",[randomUUID(),randomUUID(),'BACKFILL'+i]);
 await q("insert into training_categories(id,code,name,topic_evidence_policy,require_attendee) values($1,'hk','HK','required',false),($2,'technical_mep','MEPC','required',false);insert into training_types(id,code,name) values($3,'toolbox','Toolbox')",[hk,mep,type]);
 await q("insert into training_topics(id,category_id,code,module_name,topic_description) values($1,$2,'electrical_safety','Electrical Safety','Synthetic topic')",[topic,mep]);
 await q("insert into training_topics(id,category_id,code,module_name,topic_description) values($1,$2,'hk_topic','HK topic','Synthetic HK topic')",[hkTopic,hk]);
 for(const [id,state,code] of [[store,'TN','T1'],[py,'PY','P1'],[foreign,'KA','K1']])await q("insert into reliance_retail_store_master values($1,$2,$2,$3,'Active',null,'{}')",[id,code,state]);
 await q("insert into fo_attendance values($1,'FO1','FO1','Active',null);insert into fo_site_visits values($2,$1,'FO1','FO1',null,$3,now(),null)",[att,visit,store]);
 await q('alter table fo_attendance add column username text;alter table fo_site_visits add column checkout_time timestamptz');
 await q(`create trigger session_guard before insert or update on training_sessions for each row execute function training_session_write_guard();create trigger envelope_guard before insert or update on fo_activity_submissions for each row execute function training_legacy_write_guard();
 create trigger topic_guard before insert or update or delete on training_session_topics for each row execute function training_child_write_guard();create trigger evidence_guard before insert or update or delete on training_evidence for each row execute function training_child_write_guard();`);
 const oldDraft=await rpc('rpc_create_reliance_training_session_v4',[fo,att,visit,hk,type,'2026-01-01','Synthetic FO',store,'old-hk',null]);
 const historic=(await q('select to_jsonb(s) row from training_sessions s where id=$1',[oldDraft])).rows[0].row;
 let migration=read('supabase/migrations/20261126064945_reliance_training_v2_entitlements_web_contract.sql');
 await t.test('preflight drift fails atomically before schema/backfill changes',async()=>{
  await q("begin;alter function training_role_v4(text) set search_path=public");
  await assert.rejects(()=>q(migration),/baseline_drift/);await q('rollback');
  assert.equal((await q("select to_regclass('public.training_category_entitlements') name")).rows[0].name,null);
 });
 await q(migration);
 await t.test('backfill preserves 27 HK grants, history and no MEPC grants',async()=>{
  assert.equal((await q('select count(*)::int n from training_category_entitlements')).rows[0].n,27);
  assert.equal(await rpc('training_category_allowed_v4',[fo,hk]),true);assert.equal(await rpc('training_category_allowed_v4',[fo,mep]),false);
  const after=(await q('select to_jsonb(s) row from training_sessions s where id=$1',[oldDraft])).rows[0].row;
  for(const key of Object.keys(historic))assert.deepEqual(after[key],historic[key],key);
  assert.equal(after.completion_policy_version,1);
  assert.equal(after.submission_source,null,'historical source provenance is not invented');
 });
 const set=async(changes,db=cluster.admin)=>rpc('rpc_set_training_category_entitlements',[admin,fo,JSON.stringify(changes),'Synthetic approved allocation'],db);
 const rev=async code=>(await q('select e.revision from training_category_entitlements e join training_categories c on c.id=e.category_id where e.profile_id=$1 and c.code=$2',[fo,code])).rows[0]?.revision||0;
 await t.test('HK-only, both, MEPC-only, none; forged admin and stale revisions rejected',async()=>{
  await assert.rejects(()=>rpc('rpc_set_training_category_entitlements',[fo,fo,'[]','forged']),/admin_required/);
  await set([{code:'technical_mep',active:true,expected_revision:0}]);assert.equal(await rpc('training_category_allowed_v4',[fo,mep]),true);
  await set([{code:'hk',active:false,expected_revision:1}]);assert.equal(await rpc('training_category_allowed_v4',[fo,hk]),false);
  await assert.rejects(()=>set([{code:'hk',active:true,expected_revision:1}]),/revision_conflict/);
  await set([{code:'technical_mep',active:false,expected_revision:1}]);assert.equal(await rpc('training_category_allowed_v4',[fo,mep]),false);
  await set([{code:'hk',active:true,expected_revision:2},{code:'technical_mep',active:true,expected_revision:2}]);
 });
 const createMobile=key=>rpc('rpc_create_reliance_training_session_v4',[fo,att,visit,mep,type,'2026-01-01','Synthetic FO',store,key,null]);
 await t.test('effective validity, invalid targets and all-or-nothing revision/audit changes',async()=>{
  await set([{code:'technical_mep',active:true,expected_revision:await rev('technical_mep'),effective_from:'2099-01-01'}]);
  assert.equal(await rpc('training_category_allowed_v4',[fo,mep]),false);
  await set([{code:'technical_mep',active:true,expected_revision:await rev('technical_mep'),effective_from:'2020-01-01',effective_to:'2021-01-01'}]);
  assert.equal(await rpc('training_category_allowed_v4',[fo,mep]),false);
  const before=await rev('hk');await assert.rejects(()=>set([{code:'hk',active:false,expected_revision:before},{code:'technical_mep',active:true,expected_revision:0}]),/revision_conflict/);assert.equal(await rev('hk'),before);
  await assert.rejects(()=>rpc('rpc_set_training_category_entitlements',[admin,om,'[{"code":"technical_mep","active":true,"expected_revision":0}]','Not an FO']),/target_ineligible/);
  await set([{code:'technical_mep',active:true,expected_revision:await rev('technical_mep')}]);
 });
 await t.test('mobile retains attendance, store, ownership and idempotency checks',async()=>{
  mobile=await createMobile('mobile-1');assert.equal(await createMobile('mobile-1'),mobile);
  await assert.rejects(()=>rpc('rpc_create_reliance_training_session_v4',[fo,att,visit,mep,type,'2026-01-01','FO',foreign,'bad-store',null]),/store_scope/);
  await assert.rejects(()=>rpc('rpc_create_reliance_training_session_v4',[fo,null,null,mep,type,'2026-01-01','FO',store,'bad-context',null]));
  assert.equal((await q('select completion_policy_version from training_sessions where id=$1',[mobile])).rows[0].completion_policy_version,2);
 });
 async function assignment(id,role,states){const r=randomUUID(),a=randomUUID();await q('insert into access_roles values($1,$2,true)',[r,role]);await q("insert into access_user_assignments select $1,auth_user_id,id,'369d2d5f-396f-49f9-a47d-bfbc8f7cb922',$4,$2,true,'verified',now()-interval '1 day',null from profiles where id=$3",[a,r,id,moduleId]);for(const state of states)await q("insert into access_user_scopes(user_assignment_id,scope_type,scope_code) values($1,'state',$2)",[a,state]);return a;}
 await q("insert into access_modules values($1,'fo_operations',true)",[moduleId]);
 for(const [id,role,states] of [[om,'operations_manager',['TN']],[bh,'branch_head',['TN']],[kam,'kam',['TN']],[south,'gm',['TN','PY','KA']]])await assignment(id,role,states);
 for(const id of [mis,hkMis])await q("insert into retail_mis_assignments select id,auth_user_id,employee_code,role,array['TN','PY'],true from profiles where id=$1",[id]);
 const today=(await q("select (now() at time zone 'Asia/Kolkata')::date::text today_value")).rows[0].today_value;
 const createWeb=(actor=mis,key='web-1',date=today,target=store)=>rpc('rpc_create_reliance_training_web_v2',[actor,target,date,type,fo,key,null]);
 await t.test('web gate defaults closed; MEPC-MIS/OM only within explicit geographic scope',async()=>{
  await assert.rejects(()=>createWeb(),/release_disabled/);
  await q('update training_v2_private.release_policy set web_enabled=true'); // isolated fixture activation only
  web=await createWeb();assert.equal(await createWeb(),web);await createWeb(om,'om-1');
  for(const actor of [bh,kam,hkMis,fo])await assert.rejects(()=>createWeb(actor,'denied-'+actor),/scope_forbidden/);
  await assert.rejects(()=>createWeb(mis,'bad-state',today,foreign),/scope_forbidden/);
  await createWeb(mis,'py-1',today,py);await assert.rejects(()=>createWeb(om,'om-py',today,py),/scope_forbidden/);
  await assert.rejects(()=>createWeb(mis,'future','2099-01-01'),/date_not_allowed/);await assert.rejects(()=>createWeb(mis,'past','2020-01-01'),/date_not_allowed/);
  assert.equal((await q('select attendance_id,site_visit_id from training_sessions where id=$1',[web])).rows[0].attendance_id,null);
 });
 await t.test('store/zone intersection, business eligibility, AP umbrella and state aliases remain enforced',async()=>{
  const zone=randomUUID(),otherZone=randomUUID(),sameState=randomUUID();
  await q('update reliance_retail_store_master set zone_id=$2 where id=$1',[store,zone]);
  await q("insert into reliance_retail_store_master values($1,'T2','Other TN store','TN','Active',$2,'{}')",[sameState,otherZone]);
  await q("insert into access_user_scopes(user_assignment_id,scope_type,scope_id) select id,'zone',$2 from access_user_assignments where profile_id=$1",[om,zone]);
  assert.equal(await rpc('training_v2_web_allowed',[om,store]),true);assert.equal(await rpc('training_v2_web_allowed',[om,sameState]),false);
  await q("update profiles set business='Other' where id=$1",[mis]);assert.equal(await rpc('training_v2_web_allowed',[mis,store]),false);await q("update profiles set business='Reliance Retail' where id=$1",[mis]);
  await q("update profiles set state='KN' where id=$1",[fo]);assert.equal(await rpc('training_retail_store_allowed',[fo,foreign,mep]),true);
  await q("update profiles set state='AP' where id=$1",[fo]);await q("update reliance_retail_store_master set state='AP-1' where id=$1",[sameState]);assert.equal(await rpc('training_retail_store_allowed',[fo,sameState,mep]),true);
  await q("update profiles set state='TN' where id=$1",[fo]);
  await q("update profiles set business='Other' where id=$1",[fo]);assert.equal(await rpc('training_category_allowed_v4',[fo,mep]),false);
  await assignment(fo,'fo',['TN']);assert.equal(await rpc('training_category_allowed_v4',[fo,mep]),true);assert.equal(await rpc('training_retail_store_allowed',[fo,store,mep]),true);
  await q("update profiles set business='Reliance Retail' where id=$1",[fo]);
 });
 async function evidence(sid,actor,proof=true,selectedTopic=topic){const st=randomUUID();await q('insert into training_session_topics(id,training_session_id,topic_id,is_covered) values($1,$2,$3,true)',[st,sid,selectedTopic]);
  for(const kind of proof?['topic_photo','additional_document']:['topic_photo']){const id=randomUUID(),path=`training/${sid}/${id}/proof.png`;await q("insert into training_evidence(id,training_session_id,training_session_topic_id,evidence_type,storage_bucket,storage_path,file_name,mime_type,file_size,uploaded_by,metadata) values($1,$2,$3,$4,'training-evidence',$5,'proof.png','image/png',10,$6,$7)",[id,sid,kind==='topic_photo'?st:null,kind,path,actor,{upload_status:'uploaded',verified_sha256:'a'.repeat(64)}]);await q("insert into storage.objects values('training-evidence',$1,$2)",[path,{size:10,mimetype:'image/png'}]);}
 }
 await t.test('MEPC needs topic photo and verified completion proof; pending/object-only rejected',async()=>{
  await assert.rejects(()=>rpc('rpc_submit_reliance_training_session_v2',[mobile,fo]),/topic_required/);
  await evidence(mobile,fo,false);await assert.rejects(()=>rpc('rpc_submit_reliance_training_session_v2',[mobile,fo]),/completion_proof_required/);
  const st=(await q('select id from training_session_topics where training_session_id=$1',[mobile])).rows[0].id;
  const id=randomUUID(),path=`training/${mobile}/${id}/proof.png`;
  await q("insert into training_evidence(id,training_session_id,evidence_type,storage_bucket,storage_path,file_name,mime_type,file_size,uploaded_by,metadata) values($1,$2,'additional_document','training-evidence',$3,'proof.png','image/png',10,$4,'{\"upload_status\":\"pending\"}')",[id,mobile,path,fo]);await q("insert into storage.objects values('training-evidence',$1,'{\"size\":10,\"mimetype\":\"image/png\"}')",[path]);
  await assert.rejects(()=>rpc('rpc_submit_reliance_training_session_v2',[mobile,fo]),/upload_incomplete/);
  await q("update training_evidence set metadata='{\"upload_status\":\"uploaded\"}' where id=$1",[id]);await assert.rejects(()=>rpc('rpc_submit_reliance_training_session_v2',[mobile,fo]),/completion_proof_required/);
  await q('update training_evidence set metadata=$2 where id=$1',[id,{upload_status:'uploaded',verified_sha256:'b'.repeat(64)}]);
 });
 await t.test('revocation commits first: blocked submission rechecks after lock release',async()=>{
  const a=await cluster.connect(),b=await cluster.connect();await a.query('begin');await set([{code:'technical_mep',active:false,expected_revision:await rev('technical_mep')}],a);
  let finished=false;const pending=rpc('rpc_submit_reliance_training_session_v2',[mobile,fo],b).finally(()=>{finished=true;});await new Promise(r=>setTimeout(r,75));assert.equal(finished,false);await a.query('commit');await assert.rejects(()=>pending,/category_forbidden/);
  await set([{code:'technical_mep',active:true,expected_revision:await rev('technical_mep')}]);
 });
 await t.test('submission commits first: revoke waits; repeated submit returns same ID and no event duplication',async()=>{
  const a=await cluster.connect(),b=await cluster.connect();await a.query('begin');assert.equal(await rpc('rpc_submit_reliance_training_session_v2',[mobile,fo],a),mobile);
  let finished=false;const pending=set([{code:'technical_mep',active:false,expected_revision:await rev('technical_mep')}],b).finally(()=>{finished=true;});await new Promise(r=>setTimeout(r,75));assert.equal(finished,false);await a.query('commit');await pending;
  assert.equal(await rpc('rpc_submit_reliance_training_session_v2',[mobile,fo]),mobile);assert.equal((await q("select count(*)::int n from training_events where training_session_id=$1 and event_type='submitted'",[mobile])).rows[0].n,1);
  await assert.rejects(()=>q("update training_sessions set remarks='tamper' where id=$1",[mobile]),/category_forbidden|immutable/);
 });
 await t.test('existing HK draft submits without new proof policy; OM/KAM retain only authorized HK hierarchy reads',async()=>{
  await evidence(oldDraft,fo,false,hkTopic);await rpc('rpc_submit_reliance_training_session_v2',[oldDraft,fo]);
  assert.equal((await q('select completion_policy_version from training_sessions where id=$1',[oldDraft])).rows[0].completion_policy_version,1);
  await q("insert into employee_hierarchy values('FO1','OM1','KAM1',null,true)");
  for(const actor of [om,kam])assert.equal(await rpc('rpc_training_v2_read_allowed',[actor,oldDraft]),true);
  const legacyKam=randomUUID();await q("insert into profiles(id,auth_user_id,employee_code,full_name,role,business,state) values($1,$2,'LEGACY-KAM','Synthetic legacy KAM','KAM','Reliance Retail','TN')",[legacyKam,randomUUID()]);
  await q("update employee_hierarchy set business_head_employee_code='LEGACY-KAM' where employee_code='FO1'");
  assert.equal(await rpc('rpc_training_v2_read_allowed',[legacyKam,oldDraft]),true);
  assert.equal(await rpc('training_v2_web_allowed',[legacyKam,store]),false);
  await assert.rejects(()=>rpc('training_assert_draft_editor',[oldDraft,om]));
 });
 await t.test('web and mobile share report/detail/evidence scope; unique session counts',async()=>{
  await evidence(web,mis);await rpc('rpc_submit_reliance_training_session_v2',[web,mis]);
  for(const actor of [mis,om,bh,kam,south,admin])assert.equal(await rpc('rpc_training_v2_read_allowed',[actor,web]),true);
  assert.equal(await rpc('rpc_training_v2_read_allowed',[hkMis,web]),false);
  const auth=(await q('select auth_user_id from profiles where id=$1',[mis])).rows[0].auth_user_id;
  const report=await rpc('rpc_retail_mis_training_v4',[mis,auth,'technical_mep',today,today,null]);assert.equal(report.counts.completed_sessions,2);
  const eid=(await q('select id from training_evidence where training_session_id=$1 limit 1',[web])).rows[0].id;
  assert.ok(await rpc('rpc_retail_mis_training_evidence_v4',[mis,auth,'technical_mep',web,eid]));
  await q('update retail_mis_assignments set states=array[\'KA\'] where profile_id=$1',[mis]);assert.equal(await rpc('rpc_training_v2_read_allowed',[mis,web]),false);await assert.rejects(()=>rpc('rpc_retail_mis_training_evidence_v4',[mis,auth,'technical_mep',web,eid]));
 });
 await t.test('RLS/function ACLs deny direct browser writes; rollback disables gate without deleting history',async()=>{
  assert.equal((await q("select has_function_privilege('authenticated','rpc_set_training_category_entitlements(uuid,uuid,jsonb,text)','EXECUTE') allowed")).rows[0].allowed,false);
  await q('set role authenticated');await assert.rejects(()=>q('select * from training_category_entitlements'),/permission denied/);await q('reset role');
  await q(read('supabase/proposals/training_v2_phase2_rollback.sql'));
  assert.equal((await q('select web_enabled from training_v2_private.release_policy')).rows[0].web_enabled,false);
  assert.equal((await q('select count(*)::int n from training_sessions where id=any($1)',[[mobile,web]])).rows[0].n,2);
 });
 } finally {await cluster.close();}
});
