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
  const f=await thermoFixture({db:native.db}),a=await native.connect(true),b=await native.connect(true);
  const call=(session,action,data)=>session.query('select public.rpc_retail_thermography_reports($1,$2,$3::jsonb) result',[f.ids.mepc,action,JSON.stringify(data)]).then(r=>r.rows[0].result);
  // Hold the first transaction open, prove the second session is waiting for its
  // lock, then commit. This is real overlap rather than sequential Promise calls.
  const overlap=async(action1,data1,action2,data2)=>{
   await a.query('begin');let first,second;
   try{
    first=await call(a,action1,data1);let settled=false;
    const pending=call(b,action2,data2).then(value=>{settled=true;return {value};},error=>{settled=true;return {error};});
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
   const input={request_id:randomUUID(),store_id:f.ids.store,date:f.today,filename:'SYNTHETIC.xlsx',size:100,source_sha256:'a'.repeat(64)};
   const r=await overlap('prepare',input,'prepare',input);assert.ifError(r.error);assert.equal(r.first.id,r.value.id);original=r.first;
   assert.equal((await native.admin.query('select count(*)::int n from retail_thermography_report_versions')).rows[0].n,1);
  });
  await t.test('same finalization retry races once; immutable receipt and active version agree',async()=>{
   const input={request_id:original.operation_id,sha256:'a'.repeat(64),object_id:await f.object(original)};
   const r=await overlap('finalize',input,'finalize',input);assert.ifError(r.error);assert.deepEqual(r.first,r.value);record=await f.row(original.inspection_id);
  });
  await t.test('simultaneous rejected-report replacement prepares allocate unique version numbers',async()=>{
   await f.call(f.ids.mepc,'reject',{id:record.id,revision:record.revision,request_id:randomUUID()});record=await f.row(record.id);
   const input={id:record.id,revision:record.revision,store_id:f.ids.store,date:f.today,filename:'SYNTHETIC.xlsx',size:100,source_sha256:'a'.repeat(64)};
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
  console.log('Disposable native PostgreSQL evidence: '+native.runtime);
 }finally{await native.close();}
});
