import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {createRelianceRetailManagementRouter} from '../routes/relianceRetailManagementRoutes.js';
async function request(path,{method='POST',role='Branch Head',active=true,states=['TN'],badIdentity=false}={}){
 const calls=[];
 const profile={id:'writer-profile',auth_user_id:'writer-auth',employee_code:'SYNTHETIC-WRITER',web_access_enabled:true,role,business:'Reliance Retail',is_active:true,status:'Active'};
 const client={rpc:async(name,args)=>{
  calls.push({name,args});
  if(name==='rpc_retail_mis_access')return {data:{active:false}};
  if(name==='rpc_retail_cleaning_writer_access_v2')return {data:{contract:'cleaning-schedule-writer.v1',role:'CLEANING_SCHEDULE_WRITER',active,states,modules:['cleaning']}};
  if(name==='rpc_retail_cleaning_plan_v1')return {data:{saved:true}};
  throw Error('Unexpected RPC '+name);
 }};
 const app=express();app.use(express.json());app.use('/api/reliance-retail',createRelianceRetailManagementRouter({getClient:()=>client,requireAuth:(req,res,next)=>{req.profile=profile;req.authUser={id:badIdentity?'forged':'writer-auth'};next();}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{const result=await fetch(`http://127.0.0.1:${server.address().port}/api/reliance-retail/mis${path}`,{method,headers:{'content-type':'application/json'},...(method==='GET'?{}:{body:JSON.stringify({schedule_id:'forged',actor:'forged',auth_user_id:'forged'})})});return {status:result.status,body:await result.json(),calls};}
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
