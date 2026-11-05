import test from 'node:test';
import assert from 'node:assert/strict';
import {auditCanonicalAttendanceRecovery,previewCanonicalAttendanceRecoveryPage} from '../services/retailStoreAttendanceRecovery.js';
const admin={id:'admin',role:'QPMSADMIN',is_active:true};
const headers=['EP No','EP Name','Site Code','Att. Date','Att. Status','Class'];
const row=(n,code='S1000',employee='E'+n)=>({source_row:n,employee_code:employee,employee_name:'Employee',store_code:code,attendance_date:'2026-10-01',original_status:'P',class:'House Keeping',raw_cells:[employee,'Employee',code,'2026-10-01','P','House Keeping']});
function fixture(rows=[row(2)],conflicts=[]){
 const source={headers,rows,rejected:rows.map(r=>({...r,reasons:['Unknown Reliance Retail Store Code']}))};
 const stores=Array.from({length:1001},(_,i)=>({id:'s'+i,store_code:'S'+i,state:i===1000?'KL':'TN'}));
 const ranges=[];let writes=0;
 const client={from(table){
  const q={select(){return q},eq(){return q},order(){return q},async single(){return {data:{id:'batch',kind:'attendance',status:'committed',checksum:'original-hash',raw_source:source}}},async maybeSingle(){return {data:null}},async range(a,b){ranges.push(a);return {data:stores.slice(a,b+1)}},insert(){writes++;throw Error('Unexpected write')},update(){writes++;throw Error('Unexpected write')}};
  assert.ok(['retail_attendance_uploads','reliance_retail_store_master'].includes(table));return q;
 },rpc(name){assert.equal(name,'rpc_retail_attendance_conflicts');return {async range(a,b){return {data:conflicts.slice(a,b+1)}}}}};
 return {client,source,ranges,get writes(){return writes}};
}
test('canonical audit pages all stores and returns full state totals',async()=>{
 const f=fixture();const audit=await auditCanonicalAttendanceRecovery(f.client,admin,{attendance_batch_id:'batch'});
 assert.deepEqual(f.ranges,[0,1000]);assert.equal(audit.matched_store_rows,1);assert.equal(audit.state_totals[0].eligible_rows,1);assert.equal(f.writes,0);
});
test('full-source duplicate employee days cannot become eligible on separate pages',async()=>{
 const rows=Array.from({length:501},(_,i)=>row(i+2));rows[500]=row(502,'S999','E2');
 const f=fixture(rows);const audit=await auditCanonicalAttendanceRecovery(f.client,admin,{attendance_batch_id:'batch'});
 assert.equal(audit.rows[0].validation_reasons.length,1);assert.equal(audit.state_totals.reduce((n,s)=>n+s.validation_rejected_rows,0),2);
});
test('existing employee days remain blocked and incomplete source fails closed',async()=>{
 const f=fixture([row(2)],[{employee_code:'E2',attendance_date:'2026-10-01'}]);
 const a=await auditCanonicalAttendanceRecovery(f.client,admin,{attendance_batch_id:'batch'});assert.equal(a.state_totals[0].conflicting_rows,1);
 f.source.rows.push(row(2));await assert.rejects(()=>auditCanonicalAttendanceRecovery(f.client,admin,{attendance_batch_id:'batch'}),/duplicate/);
});
test('canonical preview validates without saving a batch or exposing a commit key',async()=>{
 const f=fixture();const before=JSON.stringify(f.source);const out=await previewCanonicalAttendanceRecoveryPage(f.client,admin,{attendance_batch_id:'batch'});
 assert.equal(out.can_commit,false);assert.equal(out.preview.review_only,true);assert.equal(out.preview.id,undefined);assert.equal(out.preview.preview_key,undefined);assert.equal(f.writes,0);assert.equal(JSON.stringify(f.source),before);
});
test('non-admin is denied before any database access',async()=>{
 await assert.rejects(()=>auditCanonicalAttendanceRecovery({from(){throw Error('Unexpected database access')}},{id:'mis',role:'MIS',is_active:true},{}),e=>e.statusCode===403);
});

test('recovery preview preserves normalized identifiers and dates when raw Excel cells are numeric',async()=>{
 const r=row(2,'S1000','00042');r.raw_cells[0]=42;r.raw_cells[3]=45931;
 const f=fixture([r]);const out=await previewCanonicalAttendanceRecoveryPage(f.client,admin,{attendance_batch_id:'batch'});
 assert.equal(out.preview.preview[0].employee_code,'00042');assert.equal(out.preview.preview[0].attendance_date,'2026-10-01');
});
test('recovery rejects concurrent reviews and releases its slot after failure',async()=>{
 const f=fixture();let release;const ready=new Promise(resolve=>{release=resolve});
 const original=f.client.from;f.client.from=table=>{const q=original(table);if(table==='retail_attendance_uploads'){const single=q.single;q.single=async()=>{await ready;return single()}}return q};
 const pending=auditCanonicalAttendanceRecovery(f.client,admin,{attendance_batch_id:'batch'});
 await assert.rejects(()=>auditCanonicalAttendanceRecovery(f.client,admin,{attendance_batch_id:'batch'}),e=>e.statusCode===409);
 release();await pending;
 await assert.rejects(()=>auditCanonicalAttendanceRecovery(f.client,admin,{}),e=>e.statusCode===400);
 assert.equal((await auditCanonicalAttendanceRecovery(f.client,admin,{attendance_batch_id:'batch'})).matched_store_rows,1);
});
test('rejected records must reference the same retained source identity',async()=>{
 const f=fixture();f.source.rejected[0].store_code='OTHER';
 await assert.rejects(()=>auditCanonicalAttendanceRecovery(f.client,admin,{attendance_batch_id:'batch'}),/retained source/);
});

test('mounted recovery routes require administrator authorization and return review-only previews',async()=>{
 const {default:express}=await import('express');
 const {createRetailAttendanceRouter}=await import('../routes/retailAttendanceRoutes.js');
 const f=fixture(),app=express();app.use(express.json());
 app.use('/attendance',(req,res,next)=>{if(!req.get('x-test-session'))return res.sendStatus(401);req.profile=req.get('x-test-session')==='admin'?admin:{id:'kam',role:'KAM',business:'Reliance Retail',state:'TN',is_active:true};next()},createRetailAttendanceRouter({getClient:()=>f.client,environment:{RETAIL_ATTENDANCE_ENABLED:'true'}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 try{
  const base='http://127.0.0.1:'+server.address().port+'/attendance/recovery/canonical';
  assert.equal((await fetch(base+'/audit?attendance_batch_id=batch')).status,401);
  assert.equal((await fetch(base+'/audit?attendance_batch_id=batch',{headers:{'x-test-session':'kam'}})).status,403);
  const response=await fetch(base+'/preview',{method:'POST',headers:{'x-test-session':'admin','content-type':'application/json'},body:JSON.stringify({attendance_batch_id:'batch'})});
  assert.equal(response.status,200);const body=await response.json();assert.equal(body.recovery.can_commit,false);assert.equal(body.recovery.preview.preview_key,undefined);assert.equal(f.writes,0);
 }finally{await new Promise(resolve=>server.close(resolve))}
});
