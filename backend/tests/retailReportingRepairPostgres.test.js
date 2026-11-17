import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {nativeRetailReportingPostgres} from './helpers/nativeRetailReportingPostgres.js';

const root=new URL('../../',import.meta.url),read=p=>readFileSync(new URL(p,root),'utf8');
test('actual repair SQL preserves full snapshot bytes/totals and state boundaries while module reads exclude unrelated payloads',{
 skip:process.env.RUN_RETAIL_REPORTING_POSTGRES_TESTS!=='true',timeout:120000,
},async t=>{
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
  const actors=[randomUUID(),randomUUID(),randomUUID(),randomUUID()],batch=randomUUID();
  for(const state of ['TN','AP-1','AP-2'])await db.query("insert into retail_provisional_access values($1,$2,'viewer')",[actors[0],state]);
  await db.query("insert into retail_provisional_access values($1,'TN','viewer'),($2,'AP-1','viewer')",[actors[1],actors[2]]);
  await db.query("insert into retail_provisional_access values($1,'AP-2','viewer')",[actors[3]]);
  await db.query("insert into retail_provisional_files values($1,1,'SYNTHETIC.xlsx','synthetic',null)",[batch]);
  async function seed(stores,imports,cleaning,training){
   await db.query(`truncate reliance_retail_store_master,retail_employee_daily_attendance,retail_attendance_aop_versions,
    client_deep_cleaning_submissions,client_deep_cleaning_uploads,client_deep_cleaning_schedules,training_sessions,retail_provisional_rows`);
   await db.query(`insert into reliance_retail_store_master select gen_random_uuid(),'SYNTHETIC-'||i,'Synthetic Store',case i%3 when 0 then 'TN' when 1 then 'AP-1' else 'AP-2' end from generate_series(1,$1::int) i`,[stores]);
   await db.query(`
   insert into retail_employee_daily_attendance select s.id,date '2026-11-01'+(i%17),'HK',1,null from generate_series(1,35) i cross join reliance_retail_store_master s;
   insert into retail_attendance_aop_versions select gen_random_uuid(),id,'2026-11-01',null,null,2,0 from reliance_retail_store_master;
   insert into client_deep_cleaning_submissions select gen_random_uuid(),id,store_code,'Reliance Retail','2026-11-09','submitted','2026-11-09','2026-11-09' from reliance_retail_store_master order by store_code limit ${cleaning};
   insert into client_deep_cleaning_uploads select gen_random_uuid(),d.id,'before','uploaded' from client_deep_cleaning_submissions d cross join generate_series(1,4);
   insert into client_deep_cleaning_schedules select gen_random_uuid(),retail_store_id,deep_cleaning_date,'Completed' from client_deep_cleaning_submissions;
   insert into training_sessions select gen_random_uuid(),id,store_code,'Reliance Retail','2026-11-09','2026-11-09','2026-11-09' from reliance_retail_store_master order by store_code limit ${training};`);
   await db.query("insert into retail_provisional_rows select gen_random_uuid(),$1,case i%3 when 0 then 'TN' when 1 then 'AP-1' else 'AP-2' end,i from generate_series(1,$2::int) i",[batch,imports]);
  }
  // Exact semantic comparison must not depend on the known-slow original scaling.
  await seed(12,36,6,3);
  const canonical=value=>Array.isArray(value)?value.map(canonical).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
  const snapshot=async actor=>(await db.query("select rpc_retail_unified_snapshot($1,'2026-11-01','2026-11-17') result",[actor])).rows[0].result;
  const before=[];for(const actor of actors)before.push(await snapshot(actor));
  assert.equal(before[0].attendance.length,420);assert.equal(before[0].deep_cleaning.length,6);
  assert.equal(before[0].images.length,24);assert.equal(before[0].training.length,3);
  await db.query(read('supabase/proposals/20261117_retail_reporting_repair_REVIEW.sql'));
  await t.test('small representative fixture preserves exact full results, report totals and separate TN/AP-1/AP-2 grants',async()=>{
  for(let i=0;i<actors.length;i++)assert.deepEqual(canonical(await snapshot(actors[i])),canonical(before[i]));
  for(let i=0;i<actors.length;i++){
   const report=(await db.query("select rpc_retail_reporting_snapshot($1,'2026-11-01','2026-11-17','dashboard') result",[actors[i]])).rows[0].result;
   assert.deepEqual(canonical(report.stores),canonical(before[i].stores.map(s=>{const row={...s};delete row.ownership;delete row.observed_zone_id;return row;})));
   assert.deepEqual(canonical(report.attendance),canonical(before[i].attendance.map(s=>{const row={...s};delete row.ownership;return row;})));
   assert.deepEqual(canonical(report.deep_cleaning),canonical(before[i].deep_cleaning));
   assert.deepEqual(canonical(report.images),canonical(before[i].images));
   assert.deepEqual(canonical(report.aop),canonical(before[i].aop));
   assert.deepEqual(canonical(report.schedules),canonical(before[i].schedules));
   assert.ok(!Object.hasOwn(report,'files')&&!Object.hasOwn(report,'proposals')&&!Object.hasOwn(report,'training'));
   if(i>0){assert.equal(report.stores.length,4);assert.ok(report.stores.every(s=>s.state===['TN','AP-1','AP-2'][i-1]));}
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
  for(let i=1;i<actors.length;i++)for(const foreign of ['TN','AP-1','AP-2'].filter(s=>s!==['TN','AP-1','AP-2'][i-1]))
   assert.equal((await db.query("select retail_unified_access($1,$2,'view') allowed",[actors[i],foreign])).rows[0].allowed,false);
  await db.query('set role service_role');
  assert.equal((await db.query("select jsonb_array_length(rpc_retail_reporting_snapshot($1,'2026-11-01','2026-11-17','dashboard')->'stores') n",[actors[1]])).rows[0].n,4);
  await db.query('reset role');
  });
  await t.test('full-size repaired queries meet a strict 5000ms limit and retain exact counts',async()=>{
   await seed(996,1708,18,11);
   await db.query('analyze');
   // Per-query server and client-observed limits; setup/default timeout stays 8s.
   const limitMs=5000,timings=[];
   await db.query("set statement_timeout='5s'");
   const measured=async(name,sql,args)=>{
    const started=performance.now(),result=(await db.query(sql,args)).rows[0].result,ms=performance.now()-started;
    timings.push({query:name,elapsed_ms:Math.round(ms),limit_ms:limitMs});
    assert.ok(ms<limitMs,`${name}: ${ms.toFixed(1)}ms exceeds ${limitMs}ms`);return result;
   };
   try{
    const full=await measured('repaired full Store Master snapshot',"select rpc_retail_unified_snapshot($1,'2026-11-01','2026-11-17') result",[actors[0]]);
    assert.equal(full.stores.length,996);assert.equal(full.attendance.length,34860);assert.equal(full.rows.length,1708);
    assert.equal(full.deep_cleaning.length,18);assert.equal(full.images.length,72);assert.equal(full.training.length,11);
    assert.equal(full.attendance.reduce((n,r)=>n+Number(r.credit),0),34860);
    for(const module of ['dashboard','cleaning','training']){
     const report=await measured('repaired '+module,"select rpc_retail_reporting_snapshot($1,'2026-11-01','2026-11-17',$2) result",[actors[0],module]);
     assert.equal(report.stores.length,996);
     assert.equal(report.attendance.length,module==='dashboard'?34860:0);
     assert.equal(report.deep_cleaning.length,module==='training'?0:18);
     assert.equal(report.images.length,module==='training'?0:72);
     assert.ok(!Object.hasOwn(report,'rows')&&!Object.hasOwn(report,'files')&&!Object.hasOwn(report,'proposals'));
    }
    for(let i=1;i<actors.length;i++){
     const report=await measured('repaired scoped '+['TN','AP-1','AP-2'][i-1],"select rpc_retail_reporting_snapshot($1,'2026-11-01','2026-11-17','dashboard') result",[actors[i]]);
     assert.equal(report.stores.length,332);assert.equal(report.attendance.length,11620);
     assert.ok(report.stores.every(s=>s.state===['TN','AP-1','AP-2'][i-1]));
    }
    console.log('Synthetic full-size PostgreSQL timings: '+JSON.stringify(timings));
   }finally{await db.query("set statement_timeout='8s'");}
  });
 }finally{await native.close();}
});
