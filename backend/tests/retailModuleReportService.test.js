import test from 'node:test';
import assert from 'node:assert/strict';
import {retailCleaningReport,retailCleaningEvidence,retailCompletedTraining,retailModuleDashboard,moduleReportRange} from '../services/retailModuleReportService.js';
import {RELIANCE_TRAINING_CLIENT_ID} from '../services/trainingAccessService.js';
import express from 'express';
import http from 'node:http';
import {createRelianceRetailManagementRouter} from '../routes/relianceRetailManagementRoutes.js';
const admin={id:'actor',role:'Admin',is_active:true};
const snapshot={stores:[{id:'s',store_code:'T1',state:'TN'}],deep_cleaning:[{id:'d',retail_store_id:'s',status:'submitted',deep_cleaning_date:'2026-10-01'}],schedules:[],images:[]};
const range={from:'2026-10-01',to:'2026-10-31'};
test('module reports enforce capability and actor-specific database scope without writes',async()=>{
 let called=0;const client={rpc:async(name,args)=>{called++;assert.equal(name,'rpc_retail_unified_snapshot');assert.equal(args.p_actor,'actor');return {data:snapshot};}};
 const report=await retailCleaningReport(client,admin,range);assert.equal(report.submissions.length,1);
 await assert.rejects(()=>retailCleaningReport(client,{id:'other',role:'FO'},range),e=>e.statusCode===403);assert.equal(called,1);
 await assert.rejects(()=>retailCleaningReport(client,{...admin,is_active:false},range),e=>e.statusCode===403);
});
test('missing existing reporting infrastructure is unavailable rather than false zero; invalid ranges fail early',async()=>{
 await assert.rejects(()=>retailCleaningReport({rpc:async()=>({error:{code:'PGRST202'}})},admin,range),e=>e.statusCode===503);
 assert.throws(()=>moduleReportRange({from:'invalid'}),e=>e.statusCode===400);assert.throws(()=>moduleReportRange({from:'2024-01-01',to:'2026-10-31'}),e=>e.statusCode===400);
});
test('evidence outside authorized snapshot cannot access storage or database uploads',async()=>{
 const client={rpc:async()=>({data:snapshot}),from(){throw Error('Must not load unauthorized evidence');}};
 await assert.rejects(()=>retailCleaningEvidence(client,admin,'outside',range),e=>e.statusCode===403);
});
test('evidence signing rechecks submission, uploaded status and fixed private bucket',async()=>{
 const calls=[];const client={rpc:async()=>({data:snapshot}),from(table){assert.equal(table,'client_deep_cleaning_uploads');const q={select(){return q},eq(k,v){calls.push([k,v]);return q},order(){return q},limit:async()=>({data:[{id:'good',submission_id:'d',upload_type:'before',storage_bucket:'client-deep-cleaning-uploads',storage_path:'deep-cleaning/reliance-retail/T1/d/before/photo.jpg',mime_type:'image/jpeg'},{id:'wrong-bucket',storage_bucket:'other',storage_path:'secret',mime_type:'image/jpeg'}]})};return q;},storage:{from(bucket){assert.equal(bucket,'client-deep-cleaning-uploads');return {list:async()=>({data:[{name:'photo.jpg'}]}),createSignedUrl:async(path,ttl)=>{assert.equal(path,'deep-cleaning/reliance-retail/T1/d/before/photo.jpg');assert.equal(ttl,600);return {data:{signedUrl:'https://example.test/temporary'}};}};}}};
 const urls=await retailCleaningEvidence(client,admin,'d',range);assert.equal(urls.length,1);assert.deepEqual(calls,[['submission_id','d'],['upload_status','uploaded']]);assert.equal(urls[0].storage_path,undefined);
});
test('tampered evidence paths cannot sign another submission object',async()=>{
 let signed=false;const client={rpc:async()=>({data:snapshot}),from(){const q={select(){return q},eq(){return q},order(){return q},limit:async()=>({data:[{storage_bucket:'client-deep-cleaning-uploads',storage_path:'deep-cleaning/reliance-retail/T1/other/before/photo.jpg',mime_type:'image/jpeg'}]})};return q;},storage:{from(){signed=true;throw Error('Must not sign');}}};
 await assert.rejects(()=>retailCleaningEvidence(client,admin,'d',range),e=>e.statusCode===409);assert.equal(signed,false);
});

function trainingFixture(count=501){
 const calls=[],tables={profiles:[{id:'fo',employee_code:'FO1',role:'FO',is_active:true,business:'Reliance Retail',state:'TN'}],employee_hierarchy:[],fo_activity_submissions:[],training_sessions:[],training_categories:[{id:'hk',code:'hk'},{id:'mep',code:'technical_mep'}]};
 for(let i=0;i<count;i++){const id='training-'+i;tables.fo_activity_submissions.push({id,activity_type:'training',employee_code:'FO1'});tables.training_sessions.push({id,retail_store_id:'s',store_code_snapshot:'T1',state_snapshot:'TN',training_date:'2026-10-01',status:'submitted',category_id:i%2?'mep':'hk',access_client_id:RELIANCE_TRAINING_CLIENT_ID,access_client_code:'reliance_retail'});}
 const client={rpc:async(name,args)=>{calls.push({name,args});return {data:{...snapshot,attendance:[],aop:[]}};},from(table){let rows=[...(tables[table]||[])];let first=0,last=Infinity;const q={select(){return q},eq(k,v){rows=rows.filter(r=>r[k]===v);return q},in(k,vs){rows=rows.filter(r=>vs.includes(r[k]));return q},gte(k,v){rows=rows.filter(r=>r[k]>=v);return q},lte(k,v){rows=rows.filter(r=>r[k]<=v);return q},order(){return q},limit(n){last=n-1;return q},range(a,b){first=a;last=b;calls.push({table,first:a,last:b});return q},then(resolve,reject){return Promise.resolve({data:rows.slice(first,last+1)}).then(resolve,reject)}};return q;}};
 return {client,calls,tables};
}
test('completed Training totals read beyond 200 rows in bounded batches and retain existing hierarchy envelope/client guards',async()=>{
 const {client,calls,tables}=trainingFixture();
 tables.training_sessions.push({...tables.training_sessions[0],id:'outside-envelope'});
 tables.training_sessions[0].access_client_code='other';
 const result=await retailCompletedTraining(client,{...admin,employee_code:'ADMIN'},range);
 assert.equal(result.complete,true);assert.equal(result.rows.length,500);assert.deepEqual(result.total,{hk:250,mepc:250});
 assert.equal(calls.filter(c=>c.table==='training_sessions').length,3);assert.ok(calls.filter(c=>c.table==='training_sessions').every(c=>c.last-c.first<200));
});
test('dashboard uses scoped actual data and keeps absent CM/PM/Thermography sources unavailable',async()=>{
 const {client}=trainingFixture(2),r=await retailModuleDashboard(client,{...admin,employee_code:'ADMIN'},range);
 assert.equal(r.modules.technical.rows[0].completed,1);assert.equal(r.modules.soft.rows[0].completed,1);assert.equal(r.modules.cleaning.status,'ready');assert.equal(r.modules.attendance.rows[0].overall_pct,null);
 for(const key of ['cm','pm','thermography']){assert.equal(r.modules[key].status,'unavailable');assert.equal(r.modules[key].rows,undefined);}
 assert.deepEqual(r.stores.map(s=>s.store_code),['T1']);
});
test('new Retail report HTTP routes require authentication and capability before reading any source',async()=>{
 let reads=0;const app=express();app.use('/retail',createRelianceRetailManagementRouter({requireAuth(req,res,next){if(req.get('authorization')!=='Bearer local-fixture')return res.status(401).json({ok:false});req.profile={id:'outside',role:'HK MIS',business:'Other',is_active:true};next();},getClient:()=>({rpc(){reads++;throw Error('Must not query');},from(){reads++;throw Error('Must not query');}})}));
 const server=http.createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{const base='http://127.0.0.1:'+server.address().port+'/retail/module-reports/';for(const path of ['dashboard','training','deep-cleaning','deep-cleaning/outside/evidence']){assert.equal((await fetch(base+path)).status,401);assert.equal((await fetch(base+path,{headers:{authorization:'Bearer local-fixture'}})).status,403);}assert.equal(reads,0);}
 finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
