import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import XLSX from 'xlsx';
import {createRelianceRetailManagementRouter} from '../routes/relianceRetailManagementRoutes.js';
async function request(path,{method='POST',role='Branch Head',active=true,states=['TN'],badIdentity=false,adminAccess=false,profileActive=true,preview=false,initialAdmin=false,dbError=null}={}){
 const calls=[];
 const profile={id:'writer-profile',auth_user_id:'writer-auth',employee_code:'SYNTHETIC-WRITER',web_access_enabled:true,role,business:'Reliance Retail',is_active:profileActive,status:'Active'};
 if(initialAdmin)Object.assign(profile,{id:'d40c2b3f-87f1-4c34-8798-cf9b0d9ca784',auth_user_id:'79cd196c-c6f3-404a-b22a-d4683afefa3f',employee_code:'QPMSADMIN'});
 const client={rpc:async(name,args)=>{
  calls.push({name,args});
  if(name==='rpc_retail_cleaning_schedule_admin_access_v1')return {data:adminAccess};
  if(name==='rpc_retail_mis_access')return {data:{active:false}};
  if(name==='rpc_retail_cleaning_writer_access_v2')return {data:{contract:'cleaning-schedule-writer.v1',role:'CLEANING_SCHEDULE_WRITER',active,states,modules:['cleaning']}};
  if(name==='rpc_retail_cleaning_plan_v1')return dbError?{error:dbError}:{data:{saved:true}};
  throw Error('Unexpected RPC '+name);
 }};
 const app=express();app.use(express.json());app.use('/api/reliance-retail',createRelianceRetailManagementRouter({getClient:()=>client,requireAuth:(req,res,next)=>{req.profile=profile;req.authUser={id:badIdentity?'forged':profile.auth_user_id};next();}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['STATE','STORE_CODE','SCHEDULE_DATE'],['AP-1','0012','2026-11-28']]),'November');
 try{const result=await fetch(`http://127.0.0.1:${server.address().port}/api/reliance-retail/mis${path}`,{method,headers:{'content-type':preview?'application/octet-stream':'application/json',...(preview?{'x-file-name':'November.xlsx'}:{})},...(method==='GET'?{}:{body:preview?XLSX.write(book,{type:'buffer',bookType:'xlsx'}):JSON.stringify({schedule_id:'forged',actor:'forged',auth_user_id:'forged'})})});return {status:result.status,body:await result.json(),calls};}
 finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
}
for(const path of ['/cleaning/plans/import','/cleaning/plans/real-schedule/correct'])test('explicit state writer reaches only the scoped plan RPC '+path,async()=>{
 const r=await request(path);assert.equal(r.status,200);
 const access=r.calls.find(c=>c.name==='rpc_retail_cleaning_writer_access_v2');assert.equal(access.args.p_actor,'writer-profile');assert.equal(access.args.p_auth,'writer-auth');
 const call=r.calls.find(c=>c.name==='rpc_retail_cleaning_plan_v1');assert.equal(call.args.p_actor,'writer-profile');assert.equal(call.args.p_auth,'writer-auth');
 if(path.endsWith('/correct'))assert.equal(call.args.p_data.schedule_id,'real-schedule');
});
for(const path of ['/cleaning/schedule','/command/cleaning','/command/training-hk','/command/thermography','/evidence/prepare'])test('schedule writer cannot enter other mutation paths '+path,async()=>{
 const r=await request(path);assert.equal(r.status,403);assert.deepEqual(r.calls.map(c=>c.name),['rpc_retail_mis_access']);
});
test('HK MIS never falls back to a schedule writer grant',async()=>{const r=await request('/cleaning/plans/import',{role:'MIS_HK'});assert.equal(r.status,403);assert.deepEqual(r.calls.map(c=>c.name),['rpc_retail_mis_access']);});
test('missing, expired or invalid scope remains denied without a plan command',async()=>{
 for(const options of [{active:false,states:[]},{states:['ALL']}]){const r=await request('/cleaning/plans/import',options);assert.ok([403,503].includes(r.status));assert.equal(r.calls.some(c=>c.name==='rpc_retail_cleaning_plan_v1'),false);}
});
test('writer access is not evaluated for forged session identity',async()=>{const r=await request('/cleaning/plans/import',{badIdentity:true});assert.equal(r.status,401);assert.equal(r.calls.length,0);});

for(const role of ['SUPER_ADMIN','Super Admin','superadmin'])test('verified monthly Super Admin capability is visible without an MIS assignment '+role,async()=>{
 const r=await request('/access',{method:'GET',role,adminAccess:true});assert.equal(r.status,200);assert.equal(r.body.result.cleaning_schedule_admin,true);assert.equal(r.body.result.role,role);assert.deepEqual(r.calls.map(c=>c.name),['rpc_retail_cleaning_schedule_admin_access_v1']);
});
test('existing QPMSADMIN retains training read access alongside monthly import capability',async()=>{
 const r=await request('/access',{method:'GET',role:'Admin',initialAdmin:true,adminAccess:true});assert.equal(r.status,200);assert.equal(r.body.result.cleaning_schedule_admin,true);assert.equal(r.body.result.read_only,true);assert.deepEqual(r.body.result.modules,['training-hk','training-mepc']);
});
for(const path of ['/cleaning/plans/preview?month=2026-11','/cleaning/plans/import'])test('Super Admin uses authenticated identity and the existing plan RPC '+path,async()=>{
 const r=await request(path,{role:'SUPER_ADMIN',adminAccess:true,preview:path.includes('preview')});assert.equal(r.status,200);assert.equal(r.calls.some(c=>c.name==='rpc_retail_mis_access'||c.name==='rpc_retail_cleaning_writer_access_v2'),false);
 const c=r.calls.find(c=>c.name==='rpc_retail_cleaning_plan_v1');assert.equal(c.args.p_actor,'writer-profile');assert.equal(c.args.p_auth,'writer-auth');if(path.includes('preview')){assert.equal(c.args.p_data.month,'2026-11');assert.equal(c.args.p_data.rows[0].STORE_CODE,'0012');}
});
for(const path of ['/command/cleaning','/command/training-hk','/cleaning/plans/a/correct'])test('Super Admin capability does not authorize other operations '+path,async()=>{
 const r=await request(path,{role:'SUPER_ADMIN',adminAccess:true,active:false});assert.equal(r.status,403);assert.equal(r.calls.some(c=>c.name==='rpc_retail_cleaning_schedule_admin_access_v1'),false);
});
test('unverified, inactive and database-denied Super Admin capabilities fail closed',async()=>{
 for(const options of [{badIdentity:true},{profileActive:false,active:false},{adminAccess:false,active:false}]){const r=await request('/cleaning/plans/import',{role:'SUPER_ADMIN',...options});assert.ok([401,403].includes(r.status));assert.equal(r.calls.some(c=>c.name==='rpc_retail_cleaning_plan_v1'),false);}
 const r=await request('/cleaning/plans/import',{role:'SUPER_ADMIN',adminAccess:true,dbError:{code:'42501',message:'Database state scope denied'}});assert.equal(r.status,403);
});
