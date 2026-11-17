import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {nativeRetailReportingPostgres} from './helpers/nativeRetailReportingPostgres.js';

const root=new URL('../../',import.meta.url),read=p=>readFileSync(new URL(p,root),'utf8');
test('actual repair SQL preserves full snapshot bytes/totals and state boundaries while module reads exclude unrelated payloads',{
 skip:process.env.RUN_RETAIL_REPORTING_POSTGRES_TESTS!=='true',timeout:120000,
},async()=>{
 const native=await nativeRetailReportingPostgres(),db=native.admin;
 try{
  await db.query(`create role anon;create role authenticated;create role service_role;
   create table profiles(id uuid,employee_code text,full_name text,mobile text,role text,business text,state text,is_active boolean,status text);
   create table reliance_retail_store_master(id uuid primary key,store_code text,store_name text,state text);
   create table retail_provisional_access(actor_id uuid,state text,permission text);
   create table retail_unified_epoch(observed_at timestamptz,store_zones jsonb);
   insert into retail_unified_epoch values('2026-01-01','{}');
   create table retail_provisional_rows(id uuid,batch_id uuid,source_state text,source_row int);
   create table retail_provisional_files(id uuid,version int,filename text,sha256 text,withdrawn_at timestamptz);
   create table retail_provisional_proposals(id uuid,row_id uuid,state text,created_at timestamptz);
   create table reliance_retail_zones(id uuid,state text,zone_name text);
   create table reliance_retail_zone_fo_assignments(id uuid,zone_id uuid);
   create table reliance_retail_store_zone_history(id uuid,retail_store_id uuid,changed_at timestamptz);
   create table retail_employee_daily_attendance(retail_store_id uuid,attendance_date date,class text,credit numeric,superseded_at timestamptz);
   create table retail_attendance_aop_versions(id uuid,retail_store_id uuid,effective_from date,effective_to date,superseded_at timestamptz,hk_count numeric,mepc_count numeric);
   create table client_deep_cleaning_submissions(id uuid,retail_store_id uuid,store_code text,business text,deep_cleaning_date date,status text,submitted_at timestamptz,created_at timestamptz);
   create table client_deep_cleaning_uploads(id uuid,submission_id uuid,upload_type text,upload_status text);
   create index on client_deep_cleaning_uploads(submission_id);
   create table client_deep_cleaning_schedules(id uuid,retail_store_id uuid,scheduled_date date,status text);
   create table training_sessions(id uuid,retail_store_id uuid,store_code_snapshot text,business_name_snapshot text,training_date date,submitted_at timestamptz,created_at timestamptz);
   create table reliance_retail_management_audit(id uuid,action text,after_state jsonb,created_at timestamptz);
   create function retail_unified_access(uuid,text,text) returns boolean language sql stable as $$select exists(select 1 from retail_provisional_access where actor_id=$1 and ($2 is null or state=$2))$$;
   create function retail_unified_owner(uuid,timestamptz) returns jsonb language sql stable as $$select '{"known":false,"reason":"SYNTHETIC historical ownership"}'::jsonb$$;`);
  await db.query(JSON.parse(read('backend/tests/fixtures/retailReportingSnapshotBaseline.json')).definition);
  const actors=[randomUUID(),randomUUID(),randomUUID()],batch=randomUUID();
  for(const state of ['TN','AP-1','AP-2'])await db.query("insert into retail_provisional_access values($1,$2,'viewer')",[actors[0],state]);
  await db.query("insert into retail_provisional_access values($1,'TN','viewer'),($2,'AP-1','viewer')",[actors[1],actors[2]]);
  await db.query("insert into retail_provisional_files values($1,1,'SYNTHETIC.xlsx','synthetic',null)",[batch]);
  await db.query(`insert into reliance_retail_store_master select gen_random_uuid(),'SYNTHETIC-'||i,'Synthetic Store',case i%3 when 0 then 'TN' when 1 then 'AP-1' else 'AP-2' end from generate_series(1,996) i;
   insert into retail_employee_daily_attendance select s.id,date '2026-11-01'+(i%17),'HK',1,null from generate_series(1,35) i cross join reliance_retail_store_master s;
   insert into retail_attendance_aop_versions select gen_random_uuid(),id,'2026-11-01',null,null,2,0 from reliance_retail_store_master;
   insert into client_deep_cleaning_submissions select gen_random_uuid(),id,store_code,'Reliance Retail','2026-11-09','submitted','2026-11-09','2026-11-09' from reliance_retail_store_master order by store_code limit 18;
   insert into client_deep_cleaning_uploads select gen_random_uuid(),d.id,'before','uploaded' from client_deep_cleaning_submissions d cross join generate_series(1,4);
   insert into client_deep_cleaning_schedules select gen_random_uuid(),retail_store_id,deep_cleaning_date,'Completed' from client_deep_cleaning_submissions;
   insert into training_sessions select gen_random_uuid(),id,store_code,'Reliance Retail','2026-11-09','2026-11-09','2026-11-09' from reliance_retail_store_master order by store_code limit 11;`);
  await db.query("insert into retail_provisional_rows select gen_random_uuid(),$1,case i%3 when 0 then 'TN' when 1 then 'AP-1' else 'AP-2' end,i from generate_series(1,1708) i",[batch]);
  const canonical=value=>Array.isArray(value)?value.map(canonical).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
  const snapshot=async actor=>(await db.query("select rpc_retail_unified_snapshot($1,'2026-11-01','2026-11-17') result",[actor])).rows[0].result;
  const before=await Promise.all(actors.map(snapshot));
  await db.query(read('supabase/proposals/20261117_retail_reporting_repair_REVIEW.sql'));
  for(let i=0;i<actors.length;i++)assert.deepEqual(canonical(await snapshot(actors[i])),canonical(before[i]));
  for(let i=0;i<actors.length;i++){
   const report=(await db.query("select rpc_retail_reporting_snapshot($1,'2026-11-01','2026-11-17','dashboard') result",[actors[i]])).rows[0].result;
   assert.deepEqual(canonical(report.stores),canonical(before[i].stores.map(s=>{const row={...s};delete row.ownership;delete row.observed_zone_id;return row;})));
   assert.equal(report.attendance.length,before[i].attendance.length);
   assert.equal(report.deep_cleaning.length,before[i].deep_cleaning.length);
   assert.equal(report.images.length,before[i].images.length);
   assert.ok(!Object.hasOwn(report,'files')&&!Object.hasOwn(report,'proposals')&&!Object.hasOwn(report,'training'));
   if(i===2)assert.ok(report.stores.every(s=>s.state==='AP-1'));
  }
  const narrow=(await db.query("select rpc_retail_reporting_snapshot($1,'2026-11-01','2026-11-17','training') result",[actors[0]])).rows[0].result;
  assert.equal(narrow.attendance.length,0);assert.equal(narrow.deep_cleaning.length,0);
  await assert.rejects(()=>db.query("select rpc_retail_reporting_snapshot($1,'2026-11-01','2026-11-17','dashboard')",[randomUUID()]),e=>e.code==='42501');
  await assert.rejects(()=>db.query("select rpc_retail_reporting_snapshot($1,'2026-11-01','2026-11-17','unknown')",[actors[0]]),e=>e.code==='22023');
  for(const role of ['anon','authenticated']){
   await db.query('set role '+role);
   await assert.rejects(()=>db.query("select rpc_retail_reporting_snapshot($1,'2026-11-01','2026-11-17','dashboard')",[actors[0]]),e=>e.code==='42501');
   await db.query('reset role');
  }
  console.log('Synthetic PostgreSQL correctness: 996 stores, 34860 attendance rows, 1708 import rows, 18 cleaning reports, 72 uploads; unchanged full snapshots and AP state separation.');
 }finally{await native.close();}
});
