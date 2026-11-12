// Synthetic delayed reads only. No Supabase SDK, .env or production requests.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import express from 'express';
import * as candidate from '../services/retailModuleReportService.js';
import {createRelianceRetailManagementRouter} from '../routes/relianceRetailManagementRoutes.js';
const original=execFileSync('git',['-c','safe.directory='+process.cwd().replaceAll('\\','/'),'show','314c60074ba4d51bb27cf764b1dbc8b12f833ee0:backend/services/retailModuleReportService.js'],{encoding:'utf8',windowsHide:true})
 .replace(/from '(\.[^']+)'/g,(_s,p)=>`from '${pathToFileURL(resolve('backend/services',p)).href}'`);
const baseline=await import('data:text/javascript;base64,'+Buffer.from(original).toString('base64'));
const admin={id:'actor',role:'Admin',is_active:true,employee_code:'ADMIN'};
const range={from:'2026-10-01',to:'2026-10-31'};
const timings=[];
function fixture(delay=0){
 const schedule=i=>({id:'plan-'+i,retail_store_id:'s',store_code:'T1',state:'TN',scheduled_date:'2026-10-01',status:'Scheduled',metadata:{retail_fo_completion:{source_id:'source-'+i}}});
 const snap={stores:[{id:'s',store_code:'T1',store_name:'Synthetic',state:'TN'}],attendance:[],aop:[],images:[],
  deep_cleaning:[{id:'d',retail_store_id:'s',store_code:'T1',state:'TN',status:'submitted',deep_cleaning_date:'2026-10-01'}],schedules:Array.from({length:8},(_,i)=>schedule(i))};
 const metrics={links:0,storage:0,active:0,maxActive:0};
 const pause=async()=>{metrics.active++;metrics.maxActive=Math.max(metrics.maxActive,metrics.active);await new Promise(r=>setTimeout(r,delay));metrics.active--;};
 const uploads=Array.from({length:8},(_,i)=>({id:'u'+i,submission_id:'d',upload_status:'uploaded',upload_type:i%2?'after':'before',storage_bucket:'client-deep-cleaning-uploads',storage_path:`deep-cleaning/reliance-retail/T1/d/${i%2?'after':'before'}/p${i}.jpg`,original_filename:`p${i}.jpg`,mime_type:'image/jpeg',file_size:3}));
 const tables={profiles:[{id:'fo',employee_code:'FO1',role:'FO',is_active:true,business:'Reliance Retail',state:'TN'}],employee_hierarchy:[],fo_activity_submissions:[],training_sessions:[],training_categories:[],retail_ifms_historical_summary:[],client_deep_cleaning_uploads:uploads};
 const client={rpc:async(name,p)=>{await pause();if(name==='rpc_retail_unified_snapshot')return {data:structuredClone(snap)};
  if(name==='rpc_retail_cleaning_link_source'){metrics.links++;const i=Number(p.p_schedule.split('-')[1]);return {data:{id:'fo:source-'+i,source_kind:'verified_fo_link',schedule_id:p.p_schedule,retail_store_id:'s',store_code:'T1',state:'TN',employee_code:'SYNTHETIC',deep_cleaning_date:'2026-10-01',status:'submitted',uploads:[]}};}
  if(name==='rpc_retail_operations_snapshot')return {data:{stores:snap.stores,calls:[],thermography:[],aop:[]}};
  throw Error('Unexpected RPC '+name);},
  from(table){let rows=tables[table]||[],first=0,last=Infinity;const q={select(){return q;},eq(k,v){rows=rows.filter(r=>r[k]===v);return q;},in(k,v){rows=rows.filter(r=>v.includes(r[k]));return q;},gte(k,v){rows=rows.filter(r=>r[k]>=v);return q;},lte(k,v){rows=rows.filter(r=>r[k]<=v);return q;},order(){return q;},limit(n){last=n-1;return q;},range(a,b){first=a;last=b;return q;},then(ok,bad){return pause().then(()=>({data:rows.slice(first,last+1)})).then(ok,bad);}};return q;},
  storage:{getBucket:async()=>({data:{public:false}}),from(bucket){return {list:async(_dir,{search})=>{metrics.storage++;await pause();return {data:[{name:search,metadata:{size:3,mimetype:'image/jpeg'}}]};},createSignedUrl:async(p,ttl)=>{metrics.storage++;assert.equal(ttl,600);await pause();return {data:{signedUrl:'https://example.test/private-read/'+p.split('/').at(-1)}};}};}},
 };
 return {client,metrics,snap,uploads};
}
for(const [name,method,args] of [
 ['cleaning','retailCleaningReport',[range]],['evidence','retailCleaningEvidence',['d',range]],['dashboard','retailModuleDashboard',[range]],
])test(`bounded ${name} reads preserve results; measured synthetic latency`,async()=>{
 const before=fixture(20),after=fixture(20);
 let started=performance.now();const old=await baseline[method](before.client,admin,...args);const beforeMs=performance.now()-started;
 started=performance.now();const current=await candidate[method](after.client,admin,...args);const afterMs=performance.now()-started;
 if(name==='dashboard'){delete old.updated_at;delete current.updated_at;}
 assert.deepEqual(current,old);
 if(name!=='dashboard')assert.ok(afterMs<beforeMs*.8,`${beforeMs} -> ${afterMs}`);
 assert.ok(after.metrics.maxActive<=4);
 if(name==='evidence'){assert.equal(before.metrics.links,8);assert.equal(after.metrics.links,0);}
 timings.push({name,before_ms:Math.round(beforeMs),after_ms:Math.round(afterMs),before_link_reads:before.metrics.links,after_link_reads:after.metrics.links,max_concurrency:after.metrics.maxActive,errors:0,classification:'Synthetic 20ms reads, not production SQL timings'});
 writeFileSync('artifacts/retail-report-performance-20261112/timings.json',JSON.stringify(timings,null,2));
});
test('evidence resolves only the selected linked completion and checks filtered scope before signing',async()=>{
 const f=fixture();const result=await candidate.retailCleaningEvidence(f.client,admin,'fo:source-3',range);
 assert.deepEqual(result,[]);assert.equal(f.metrics.links,1);
 const denied=fixture();await assert.rejects(candidate.retailCleaningEvidence(denied.client,admin,'fo:source-3',{...range,state:'KA'}),e=>e.statusCode===403);
 assert.equal(denied.metrics.links,0);assert.equal(denied.metrics.storage,0);
});
test('each read rechecks current authorized scope and sees mutations without a stale report cache',async()=>{
 const f=fixture();await candidate.retailCleaningEvidence(f.client,admin,'d',range);const signed=f.metrics.storage;
 f.snap.stores=[];
 await assert.rejects(candidate.retailCleaningEvidence(f.client,admin,'d',range),e=>e.statusCode===403);
 assert.equal(f.metrics.storage,signed);
 const fresh=fixture();fresh.snap.deep_cleaning[0].status='draft';
 assert.equal((await candidate.retailCleaningReport(fresh.client,admin,range)).submissions[0].status,'draft');
 fresh.snap.deep_cleaning[0].status='submitted';
 assert.equal((await candidate.retailCleaningReport(fresh.client,admin,range)).submissions[0].status,'submitted');
});
test('the same scoped optimization preserves the backend release reporting reducer semantics',async()=>{
 const gitArgs=['-c','safe.directory='+process.cwd().replaceAll('\\','/')];
 const reducer=execFileSync('git',[...gitArgs,'show','a011020a:backend/shared/retailModuleReports.js'],{encoding:'utf8',windowsHide:true})
  .replace(/from '(\.[^']+)'/g,(_s,p)=>`from '${pathToFileURL(resolve('backend/shared',p)).href}'`);
 const reducerUrl='data:text/javascript;base64,'+Buffer.from(reducer).toString('base64');
 const build=async code=>import('data:text/javascript;base64,'+Buffer.from(code.replace(pathToFileURL(resolve('backend/shared/retailModuleReports.js')).href,reducerUrl)).toString('base64'));
 const before=await build(original);
 const after=await build(readFileSync('backend/services/retailModuleReportService.js','utf8').replace(/from '(\.[^']+)'/g,(_s,p)=>`from '${pathToFileURL(resolve('backend/services',p)).href}'`));
 for(const [method,args] of [['retailCleaningReport',[range]],['retailCleaningEvidence',['d',range]],['retailModuleDashboard',[range]]]){
  const old=await before[method](fixture().client,admin,...args),current=await after[method](fixture().client,admin,...args);
  if(method==='retailModuleDashboard'){delete old.updated_at;delete current.updated_at;}
  assert.deepEqual(current,old);
 }
});
test('snapshot timeout SQLSTATE and operation survive to sanitized correlated HTTP diagnostics',async()=>{
 const logs=[],old=console.error;console.error=(...args)=>logs.push(args);
 const app=express();app.use(createRelianceRetailManagementRouter({requireAuth(req,_res,next){req.profile=admin;next();},getClient:()=>({rpc:async()=>({error:{code:'57014',message:'PRIVATE_CREDENTIAL_AND_PATH',details:'private object path'}})})}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{
  const r=await fetch(`http://127.0.0.1:${server.address().port}/module-reports/deep-cleaning?from=2026-10-01&to=2026-10-31`);
  assert.equal(r.status,500);const id=r.headers.get('x-report-request-id');assert.match(id,/^[a-f0-9-]{36}$/);
  assert.equal(logs[0][1].sqlstate,'57014');assert.equal(logs[0][1].operation,'rpc_retail_unified_snapshot');assert.equal(logs[0][1].request_id,id);
  assert.ok(Number.isFinite(logs[0][1].duration_ms));assert.ok(!JSON.stringify(logs).includes('PRIVATE_CREDENTIAL'));
  assert.ok(!JSON.stringify(await r.json()).includes('private object'));
 }finally{console.error=old;await new Promise(r=>server.close(r));}
});
