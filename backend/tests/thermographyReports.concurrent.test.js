import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {thermoFixture} from './helpers/thermographyFixture.js';
import {nativeThermographyPostgres} from './helpers/nativeThermographyPostgres.js';

test('native PostgreSQL multi-session Thermography replacements, approval races and retry receipts',{
 skip:process.env.RUN_THERMOGRAPHY_NATIVE_POSTGRES_TESTS!=='true',timeout:120000,
},async t=>{
 const native=await nativeThermographyPostgres();
 try{
  const version=Number((await native.admin.query('show server_version_num')).rows[0].server_version_num);assert.ok(version>=170000&&version<180000,'Native PostgreSQL 17 is mandatory');
  const f=await thermoFixture({db:native.db,businessDate:'2026-11-18'}),a=await native.connect(true),b=await native.connect(true);
  const call=(session,action,data,rpc='reports')=>session.query('select public.rpc_retail_thermography_'+rpc+'($1,$2,$3::jsonb) result',[f.ids.mepc,action,JSON.stringify(data)]).then(r=>r.rows[0].result);
  // Hold the first transaction open, prove the second session is waiting for its
  // lock, then commit. This is real overlap rather than sequential Promise calls.
  const overlap=async(action1,data1,action2,data2,rpc='reports')=>{
   await a.query('begin');let first,second;
   try{
    first=await call(a,action1,data1,rpc);let settled=false;
    const pending=call(b,action2,data2,rpc).then(value=>{settled=true;return {value};},error=>{settled=true;return {error};});
    for(let i=0;i<50;i++){
     const waiting=(await native.admin.query("select wait_event_type from pg_stat_activity where pid=$1",[b.processID])).rows[0];
     if(waiting?.wait_event_type==='Lock')break;
     if(i===49)assert.fail('Second session never overlapped on a PostgreSQL lock');
     await new Promise(r=>setTimeout(r,10));
    }
    assert.equal(settled,false);await a.query('commit');second=await pending;
   }finally{await a.query('rollback');}
   return {first,...second};
  };
  let original,record;
  await t.test('same upload request racing across sessions creates exactly one inspection/version',async()=>{
   const scheduled=await f.schedule();const input={id:scheduled.id,revision:1,request_id:randomUUID(),store_id:f.ids.store,date:f.today,filename:'SYNTHETIC.pdf',size:100,source_sha256:'a'.repeat(64)};
   const r=await overlap('prepare',input,'prepare',input);assert.ifError(r.error);assert.equal(r.first.id,r.value.id);original=r.first;
   assert.equal((await native.admin.query('select count(*)::int n from retail_thermography_report_versions')).rows[0].n,1);
  });
  await t.test('same finalization retry races once; immutable receipt and active version agree',async()=>{
   const input={request_id:original.operation_id,sha256:'a'.repeat(64),object_id:await f.object(original)};
   const r=await overlap('finalize',input,'finalize',input);assert.ifError(r.error);assert.deepEqual(r.first,r.value);record=await f.row(original.inspection_id);
  });
  await t.test('simultaneous rejected-report replacement prepares allocate unique version numbers',async()=>{
   await f.call(f.ids.mepc,'reject',{id:record.id,revision:record.revision,request_id:randomUUID()});record=await f.row(record.id);
   const input={id:record.id,revision:record.revision,store_id:f.ids.store,date:f.today,filename:'SYNTHETIC.pdf',size:100,source_sha256:'a'.repeat(64)};
   const r=await overlap('prepare',{...input,request_id:randomUUID()},'prepare',{...input,request_id:randomUUID()});assert.ifError(r.error);
   assert.notEqual(r.first.version_number,r.value.version_number);
   const first={request_id:r.first.operation_id,sha256:'a'.repeat(64),object_id:await f.object(r.first)},second={request_id:r.value.operation_id,sha256:'a'.repeat(64),object_id:await f.object(r.value)};
   const finalized=await overlap('finalize',first,'finalize',second);assert.equal(finalized.error?.code,'40001');
   record=await f.row(record.id);assert.equal(record.active_report_version_id,r.first.id);assert.equal(record.report_review_state,'awaiting');assert.equal(record.approved_at,null);
   assert.equal((await native.admin.query("select count(*)::int n from retail_thermography_report_versions where inspection_id=$1 and state='uploaded'",[record.id])).rows[0].n,2);
  });
  await t.test('racing approval versus rejection never loses a revision or leaves stale approval',async()=>{
   const input={id:record.id,revision:record.revision};
   const r=await overlap('approve',{...input,request_id:randomUUID()},'reject',{...input,request_id:randomUUID()});assert.equal(r.error?.code,'40001');
   record=await f.row(record.id);assert.equal(record.status,'Client Approved');assert.equal(record.report_review_state,'approved');
   assert.equal((await native.admin.query('select review_status from retail_thermography_report_versions where id=$1',[record.active_report_version_id])).rows[0].review_status,'approved');
  });
  await t.test('identical approval replay is idempotent; reverse race rejection wins without approval',async()=>{
   await f.call(f.ids.admin,'reopen',{id:record.id,revision:record.revision,request_id:randomUUID(),reason:'Synthetic authorized correction'});record=await f.row(record.id);
   const v=await f.prepare({id:record.id,revision:record.revision});await f.finalize(v);record=await f.row(record.id);
   const data={id:record.id,revision:record.revision,request_id:randomUUID()};const replay=await overlap('approve',data,'approve',data);assert.ifError(replay.error);assert.deepEqual(replay.first,replay.value);
   record=await f.row(record.id);await f.call(f.ids.admin,'reopen',{id:record.id,revision:record.revision,request_id:randomUUID(),reason:'Synthetic second correction'});record=await f.row(record.id);
   const next=await f.prepare({id:record.id,revision:record.revision});await f.finalize(next);record=await f.row(record.id);
   const base={id:record.id,revision:record.revision};const r=await overlap('reject',{...base,request_id:randomUUID()},'approve',{...base,request_id:randomUUID()});assert.equal(r.error?.code,'40001');
   record=await f.row(record.id);assert.equal(record.report_review_state,'rework');assert.equal(record.approved_at,null);assert.equal(record.approved_by,null);
  });
  await t.test('replacement finalization racing an approval of the prior revision cannot approve revised bytes',async()=>{
   const v=await f.prepare({id:record.id,revision:record.revision});const revision=record.revision;
   const r=await overlap('finalize',{request_id:v.operation_id,sha256:'a'.repeat(64),object_id:await f.object(v)},'approve',{id:record.id,revision,request_id:randomUUID()});
   assert.equal(r.error?.code,'40001');record=await f.row(record.id);assert.equal(record.active_report_version_id,v.id);assert.equal(record.report_review_state,'awaiting');assert.equal(record.approved_at,null);
   assert.equal((await native.admin.query('select review_status from retail_thermography_report_versions where id=$1',[v.id])).rows[0].review_status,'awaiting');
  });
  await t.test('concurrent bulk import retries create one receipt; competing new imports fail stale preview without duplicates',async()=>{
   const month=f.today.slice(0,7);let data={month,filename:'SYNTHETIC.xlsx',sha256:'a'.repeat(64),rows:[{row:2,store_code:'0012',scheduled_date:month+'-26'}],reason:'Synthetic concurrency test'};
   const preview=await call(a,'preview',data,'schedule');data={...data,preview_digest:preview.preview_digest,request_id:randomUUID()};
   const replay=await overlap('import',data,'import',data,'schedule');assert.ifError(replay.error);assert.deepEqual(replay.first,replay.value);assert.equal(replay.first.count,1);
   data={...data,rows:[{row:2,store_code:'0012',scheduled_date:month+'-27'}]};data.preview_digest=(await call(a,'preview',data,'schedule')).preview_digest;
   const race=await overlap('import',{...data,request_id:randomUUID()},'import',{...data,request_id:randomUUID()},'schedule');assert.equal(race.error?.code,'40001');
   assert.equal((await native.admin.query('select count(*)::int n from retail_thermography_schedule_imports')).rows[0].n,2);
   assert.equal((await native.admin.query('select count(*)::int n from retail_thermography_inspections where retail_store_id=$1 and scheduled_date=$2',[f.ids.store,month+'-27'])).rows[0].n,1);
  });
  await t.test('996-store monthly schedule stays within strict 4-second dashboard limit on native PostgreSQL 17',async()=>{
   await native.admin.query("insert into reliance_retail_store_master(id,store_code,store_name,state) select gen_random_uuid(),'PERF'||lpad(n::text,4,'0'),'SYNTHETIC performance store '||n,'TN' from generate_series(1,996) n");
   const month=f.today.slice(0,7),rows=Array.from({length:996},(_,i)=>({row:i+2,store_code:'PERF'+String(i+1).padStart(4,'0'),scheduled_date:month+'-28'}));
   let data={month,rows,filename:'SYNTHETIC-996.xlsx',sha256:'b'.repeat(64),reason:'Synthetic full-size performance validation'};
   const preview=await call(a,'preview',data,'schedule');assert.equal(preview.valid,996);data={...data,request_id:randomUUID(),preview_digest:preview.preview_digest};const imported=await call(a,'import',data,'schedule');assert.equal(imported.count,996);
   const started=performance.now(),result=await call(a,'dashboard',{from:month+'-01',to:month+'-28'}),elapsed=performance.now()-started;
   assert.equal(result.total,999);assert.equal(result.rows.length,999);assert.ok(elapsed<4000,'Monthly dashboard exceeded strict 4000 ms limit: '+elapsed.toFixed(1));
   console.log('Native PostgreSQL 17 / 996-store import: '+imported.count+' rows; full monthly dashboard '+elapsed.toFixed(1)+' ms (limit 4000 ms; statement timeout 8000 ms)');
  });
  console.log('Disposable native PostgreSQL evidence: '+native.runtime);
 }finally{await native.close();}
});
