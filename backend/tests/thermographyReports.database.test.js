import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {thermoFixture} from './helpers/thermographyFixture.js';

test('install preserves legacy duplicate schedules and every original field; new duplicate inserts remain denied',async()=>{
 let before;const legacyStore=randomUUID(),legacyActor=randomUUID();
 const columns='id,retail_store_id,store_code,state,scheduled_date,status,revision,created_by,created_at,schedule_request_id';
 const f=await thermoFixture({beforeReports:async db=>{
  await db.query("insert into profiles(id,is_active,status) values($1,true,'Active')",[legacyActor]);
  await db.query("insert into reliance_retail_store_master(id,store_code,store_name,state) values($1,'LEGACY01','SYNTHETIC legacy','TN')",[legacyStore]);
  for(let i=0;i<2;i++)await db.query("insert into retail_thermography_inspections(retail_store_id,store_code,state,scheduled_date,created_by,schedule_request_id) values($1,'LEGACY01','TN','2020-01-01',$2,$3)",[legacyStore,legacyActor,randomUUID()]);
  before=(await db.query('select '+columns+' from retail_thermography_inspections order by id')).rows;
 }});try{
  assert.deepEqual((await f.db.query('select '+columns+' from retail_thermography_inspections order by id')).rows,before);
  await assert.rejects(f.call(f.ids.admin,'schedule',{store_id:legacyStore,date:'2020-01-01',request_id:randomUUID()}),/already scheduled/);
  await f.db.query('update retail_thermography_inspections set scheduled_date=scheduled_date where id=$1',[before[0].id]);
  assert.equal((await f.db.query('select count(*)::int n from retail_thermography_inspections')).rows[0].n,2);
 }finally{await f.db.close();}
});

test('actual additive SQL: first upload, repeated rework, version history and idempotent approval without extra evidence',async()=>{
 const f=await thermoFixture();try{
  const v1=await f.prepare({filename:'a.pdf'});assert.equal((await f.row(v1.inspection_id)).status,'Scheduled');
  const original=await f.call(f.ids.mepc,'prepare',{id:v1.inspection_id,revision:1,request_id:v1.operation_id,store_id:f.ids.store,date:f.today,filename:'a.pdf',size:100,source_sha256:'a'.repeat(64)});assert.equal(original.id,v1.id);
  await assert.rejects(f.call(f.ids.mepc,'finalize',{request_id:v1.operation_id,sha256:'a'.repeat(64),object_id:randomUUID()}),/Stored validated/);
  await f.finalize(v1);
  let r=await f.row(v1.inspection_id);assert.equal(r.status,'Completed');assert.equal(r.report_review_state,'awaiting');
  for(let cycle=1;cycle<=2;cycle++){
   await f.call(f.ids.mepc,'reject',{id:r.id,revision:r.revision,request_id:randomUUID(),reason:cycle===1?'': 'Optional correction note'});
   r=await f.row(r.id);assert.equal(r.report_review_state,'rework');assert.equal(r.report_rework_count,cycle);
   const next=await f.prepare({id:r.id,revision:r.revision,filename:'SYNTHETIC.pdf'});
   assert.equal((await f.row(r.id)).active_report_version_id,cycle===1?v1.id:r.active_report_version_id);
   await f.finalize(next);r=await f.row(r.id);assert.equal(r.active_report_version_id,next.id);assert.equal(r.approved_at,null);
  }
  const data={id:r.id,revision:r.revision,request_id:randomUUID()};const approved=await f.call(f.ids.mepc,'approve',data);assert.deepEqual(await f.call(f.ids.mepc,'approve',data),approved);
  r=await f.row(r.id);assert.equal(r.status,'Client Approved');
  await assert.rejects(f.prepare({id:r.id,revision:r.revision}),/scheduled record|rejected/);
  const history=await f.call(f.ids.mepc,'history',{id:r.id});assert.equal(history.versions.filter(v=>v.state==='uploaded').length,3);assert.equal(history.versions.filter(v=>v.active).length,1);
  assert.deepEqual(history.versions.map(v=>v.review_status),['approved','rejected','rejected']);
  await assert.rejects(f.call(f.ids.mepc,'reopen',{id:r.id,revision:r.revision,request_id:randomUUID(),reason:'Correction'}),/Super Admin/);
  await f.call(f.ids.admin,'reopen',{id:r.id,revision:r.revision,request_id:randomUUID(),reason:'Authorized correction'});
  r=await f.row(r.id);assert.equal(r.report_review_state,'rework');assert.equal(r.approved_at,null);
  const correction=await f.prepare({id:r.id,revision:r.revision});await f.finalize(correction);r=await f.row(r.id);assert.equal(r.approved_by,null);assert.equal(r.report_review_state,'awaiting');
  const audit=await f.call(f.ids.mepc,'history',{id:r.id,limit:2,page:1});assert.equal(audit.versions.length,2);assert.equal(audit.versions_total,4);assert.ok(audit.events_total>2);
 }finally{await f.db.close();}
});

test('actual SQL: state/role boundaries, concurrency revisions, safe failed replacement, delete/restore and original status history',async()=>{
 const f=await thermoFixture();try{
  await assert.rejects(f.prepare({store_id:f.ids.otherStore}),/assigned MEPC/);
  await assert.rejects(f.prepare({},f.ids.hk),/authorized Thermography/);
  await assert.rejects(f.prepare({},f.ids.admin),/assigned MEPC/);
  const v=await f.prepare();await f.finalize(v);let r=await f.row(v.inspection_id);
  await assert.rejects(f.call(f.ids.other,'version',{id:r.id}),/authorized state/);
  await assert.rejects(f.call(f.ids.central,'approve',{id:r.id,revision:r.revision,request_id:randomUUID()}),/MEPC MIS/);
  await f.call(f.ids.mepc,'reject',{id:r.id,revision:r.revision,request_id:randomUUID()});r=await f.row(r.id);
  const a=await f.prepare({id:r.id,revision:r.revision}),b=await f.prepare({id:r.id,revision:r.revision});
  await assert.rejects(f.call(f.ids.mepc,'finalize',{request_id:a.operation_id,sha256:'b'.repeat(64),object_id:randomUUID()}),/Stored validated/);
  assert.equal((await f.row(r.id)).active_report_version_id,v.id);
  await f.finalize(a);await f.object(b);
  await assert.rejects(f.call(f.ids.mepc,'finalize',{request_id:b.operation_id,sha256:'b'.repeat(64),object_id:(await f.db.query('select id from storage.objects where name=$1',[b.object_path])).rows[0].id}),/Report changed/);
  r=await f.row(r.id);
  await assert.rejects(f.call(f.ids.other,'delete',{id:r.id,revision:r.revision,request_id:randomUUID()}),/authorized state/);
  await assert.rejects(f.db.query('delete from storage.objects where name=$1',[v.object_path]),/immutable/);
  const deletion={id:r.id,revision:r.revision,request_id:randomUUID()},deletedReceipt=await f.call(f.ids.mepc,'delete',deletion);assert.deepEqual(await f.call(f.ids.mepc,'delete',deletion),deletedReceipt);r=await f.row(r.id);
  const range={from:r.scheduled_date,to:r.scheduled_date};const list=await f.call(f.ids.mepc,'list',range);assert.equal(list.total,0);assert.equal(list.counts.active_reports,0);
  assert.equal((await f.db.query("select prosrc from pg_proc where oid='public.rpc_retail_mis_report(uuid,text,date,date,text)'::regprocedure")).rows[0].prosrc,f.originalMisReport,'Shared reporting SQL is unchanged');
  const deletedView=await f.call(f.ids.admin,'list',{...range,deleted:true});assert.equal(deletedView.total,1);assert.equal(deletedView.counts.awaiting,0);assert.equal(deletedView.counts.approved,0);assert.equal(deletedView.counts.active_reports,0);
  await assert.rejects(f.call(f.ids.mepc,'restore',{id:r.id,revision:r.revision,request_id:randomUUID(),reason:'Restore'}),/Report is deleted/);
  await f.call(f.ids.admin,'restore',{id:r.id,revision:r.revision,request_id:randomUUID(),reason:'Authorized restore'});assert.equal((await f.row(r.id)).active_report_version_id,a.id);
  const history=await f.call(f.ids.mepc,'history',{id:r.id});assert.ok(history.events.some(e=>e.action==='DELETE'));assert.ok(history.events.some(e=>e.action==='RESTORE'));
  assert.equal((await f.db.query('select count(*)::int n from retail_thermography_report_versions where inspection_id=$1',[r.id])).rows[0].n,3);
 }finally{await f.db.close();}
});

test('actual SQL: scheduling, legacy records, private ACL, unchanged unrelated bucket and bounded abandoned cleanup',async()=>{
 const f=await thermoFixture();try{
  const schedule={store_id:f.ids.store,date:f.today,request_id:randomUUID()};const saved=await f.schedule(schedule);assert.deepEqual(await f.call(f.ids.admin,'schedule',schedule),saved);
  const legacy=await f.row(saved.id);assert.equal(legacy.report_managed,false);
  // Legacy Operations recognizes Admin, while the new correction lane uses Super Admin.
  await f.db.query(`update profiles set role='Admin' where id=$1`,[f.ids.admin]);
  await f.db.query(`select rpc_retail_thermography_command($1,'Completed',null,$2,null,1,$3)`,[f.ids.admin,saved.id,randomUUID()]);
  await f.db.query(`update profiles set role='Super Admin' where id=$1`,[f.ids.admin]);
  const list=await f.call(f.ids.admin,'list',{from:f.today,to:f.today});assert.match(list.rows[0].display_status,/legacy/);assert.equal(list.counts.active_reports,0);
  await assert.rejects(f.call(f.ids.mepc,'approve',{id:saved.id,revision:2,request_id:randomUUID()}),/unavailable/);
  const v=await f.prepare();await f.object(v);
  await f.db.transaction(async tx=>{await tx.query(`select set_config('myqpms.thermography_report_contract','reports.v1',true)`);await tx.query(`update retail_thermography_report_versions set prepared_at=clock_timestamp()-interval '25 hours' where id=$1`,[v.id]);});
  await f.call(f.ids.admin,'cleanup_abandon',{version_id:v.id});await f.db.query('delete from storage.objects where name=$1',[v.object_path]);await f.call(f.ids.admin,'cleanup_done',{version_id:v.id});
  await f.db.query(`insert into storage.objects(bucket_id,name,metadata) values('unrelated-bucket','untouched','{}')`);
  assert.equal((await f.db.query(`select count(*)::int n from storage.objects where bucket_id='unrelated-bucket'`)).rows[0].n,1);
  assert.equal((await f.db.query(`select has_table_privilege('authenticated','retail_thermography_report_versions','select') allowed`)).rows[0].allowed,false);
  assert.equal((await f.db.query(`select has_function_privilege('authenticated','rpc_retail_thermography_reports(uuid,text,jsonb)','execute') allowed`)).rows[0].allowed,false);
  const privatePending=await f.prepare();await f.object(privatePending);
  await f.db.exec(`grant usage on schema storage to authenticated,anon;grant select on storage.objects to authenticated,anon;create policy synthetic_existing_read on storage.objects for select to authenticated,anon using(true);`);
  for(const role of ['authenticated','anon']){await f.db.exec('set role '+role);assert.equal((await f.db.query(`select count(*)::int n from storage.objects where bucket_id='unrelated-bucket'`)).rows[0].n,1);assert.equal((await f.db.query(`select count(*)::int n from storage.objects where bucket_id='retail-thermography-reports'`)).rows[0].n,0);await f.db.exec('reset role');}
 }finally{await f.db.close();}
});

test('scheduled-date cohorts preserve the complete month and shared MIS functions byte-for-byte',async()=>{
 const f=await thermoFixture();try{
  const old=await f.schedule({date:'2020-01-01'}),v=await f.prepare({id:old.id,revision:1});await f.finalize(v);
  assert.equal((await f.call(f.ids.mepc,'list',{from:'2020-01-01',to:'2020-01-31'})).rows[0].pdf_verified,true);
  assert.equal((await f.call(f.ids.mepc,'list',{from:f.today,to:f.today})).total,0,'Completion date never moves a schedule to another month');
  assert.equal((await f.db.query("select prosrc from pg_proc where oid='public.rpc_retail_mis_report(uuid,text,date,date,text)'::regprocedure")).rows[0].prosrc,f.originalMisReport);
  await f.db.query("update profiles set business='Other' where id=$1",[f.ids.mepc]);await assert.rejects(f.call(f.ids.mepc,'list',{from:f.today,to:f.today}),/authorized Thermography/);
 }finally{await f.db.close();}
});
