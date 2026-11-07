import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import express from 'express';
import fs from 'node:fs';
import {INITIAL_RETAIL_ADMIN,isInitialRetailAdmin,requireInitialRetailAdmin,createInitialRetailWriteGate} from '../services/retailInitialAdminAccess.js';
import {createRelianceRetailManagementRouter} from '../routes/relianceRetailManagementRoutes.js';
const qpms={id:INITIAL_RETAIL_ADMIN.profileId,auth_user_id:INITIAL_RETAIL_ADMIN.authUserId,employee_code:'QPMSADMIN',role:'Admin',is_active:true,status:'Active',business:'Reliance Retail',state:'TN'};
const other={...qpms,id:randomUUID(),auth_user_id:randomUUID(),employee_code:'OTHER_ADMIN'};
// Synthetic HTTP authentication fixtures only: no real sessions or database writes.
function auth(req,res,next){const token=req.get('authorization');const p=token==='Bearer fixture-qpms'?qpms:token==='Bearer fixture-other'?other:token==='Bearer fixture-fo'?{...other,role:'FO'}:null;if(!p)return res.status(401).json({});req.profile=p;req.authUser={id:p.auth_user_id};next();}
async function running(app,fn){const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));try{await fn(`http://127.0.0.1:${server.address().port}`);}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}}
test('identity restriction requires the exact active profile/auth linkage; role, employee code or supplied actor alone never grants writes',()=>{
 assert.equal(isInitialRetailAdmin(qpms,{id:qpms.auth_user_id}),true);
 for(const change of [{id:other.id},{auth_user_id:other.auth_user_id},{employee_code:'OTHER_ADMIN'},{role:'FO'},{is_active:false},{status:'Disabled'}])assert.equal(isInitialRetailAdmin({...qpms,...change},{id:qpms.auth_user_id}),false);
 assert.equal(isInitialRetailAdmin(qpms,{id:other.auth_user_id}),false);
});
test('HTTP gate denies other users before operational writes, binds Fault PATCH, and preserves unrelated reads/FO/Training/OOS paths',async()=>{
 const calls=[],client={rpc:async(name,args)=>{calls.push({name,args});return {data:{proposals:[{id:'plan',kind:'DC_SCHEDULE'}]}};}};
 const app=express();app.use(express.json());app.use(auth);
 app.patch('/api/fault-tracker/tickets/:id',requireInitialRetailAdmin,(req,res)=>res.json({actor:req.profile.id}));
 app.use('/api/reliance-retail',createInitialRetailWriteGate({getClient:()=>client}),(req,res)=>res.json({passed:true}));
 const paths=['/operations/maintenance','/OPERATIONS/THERMOGRAPHY/','/attendance/preview','/attendance/commit','/module-reports/deep-cleaning/plan/link-fo','/deep-cleaning/schedules','/unified-master/propose'];
 await running(app,async base=>{
  for(const path of paths){const url=base+'/api/reliance-retail'+path,body=JSON.stringify({kind:'DC_SCHEDULE',p_actor:qpms.id,profile:qpms,auth_user_id:qpms.auth_user_id});
   assert.equal((await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body})).status,401);
   for(const token of ['fixture-other','fixture-fo'])assert.equal((await fetch(url,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body})).status,403,path);
   assert.equal((await fetch(url,{method:'POST',headers:{authorization:'Bearer fixture-qpms','content-type':'application/json'},body})).status,200,path);
  }
  assert.equal(calls.length,0);
  assert.equal((await fetch(base+'/api/fault-tracker/tickets/plan',{method:'PATCH',headers:{authorization:'Bearer fixture-other'}})).status,403);
  const accepted=await fetch(base+'/api/fault-tracker/tickets/plan',{method:'PATCH',headers:{authorization:'Bearer fixture-qpms'}});assert.equal(accepted.status,200);assert.equal((await accepted.json()).actor,qpms.id);
  for(const path of ['/fo-self/complete','/service-trackers/command','/unified-master/saved-review/aop-apply','/unified-master/decide'])assert.equal((await fetch(base+'/api/reliance-retail'+path,{method:'POST',headers:{authorization:'Bearer fixture-other'}})).status,200,'Existing downstream authorization remains responsible for '+path);
  assert.equal((await fetch(base+'/api/reliance-retail/module-reports/deep-cleaning',{headers:{authorization:'Bearer fixture-other'}})).status,200);
 });
 const serverSource=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');assert.match(serverSource,/app\.patch\('\/api\/fault-tracker\/tickets\/:id',requireSupabaseJwt,requireFaultTrackerManage,requireInitialRetailAdmin,/);
});
test('real Retail router applies the identity gate before RPC, keeps actor binding and exposes a read-only acceptance flag',async()=>{
 const calls=[],store=randomUUID(),source=randomUUID(),client={rpc:async(name,args)=>{calls.push({name,args});return {data:{id:'fo:'+source,saved:true}};}};
 const app=express();app.use(express.json());app.use('/retail',createRelianceRetailManagementRouter({requireAuth:auth,getClient:()=>client}));
 await running(app,async base=>{
  const payload={status:'Scheduled',store_id:store,scheduled_date:'2026-10-31',request_id:randomUUID(),source_id:source,p_actor:other.id};
  for(const route of ['/operations/thermography','/module-reports/deep-cleaning/plan/link-fo']){
   assert.equal((await fetch(base+'/retail'+route,{method:'POST',headers:{authorization:'Bearer fixture-other','content-type':'application/json'},body:JSON.stringify(payload)})).status,403);assert.equal(calls.length,0);
   const response=await fetch(base+'/retail'+route,{method:'POST',headers:{authorization:'Bearer fixture-qpms','content-type':'application/json'},body:JSON.stringify(payload)});
   if(route.includes('/deep-cleaning/')){assert.equal(response.status,503);assert.equal((await response.json()).code,'evidence_compatibility_maintenance');assert.equal(calls.length,0);}
   else{assert.equal(response.status,200);assert.equal(calls.at(-1).args.p_actor,qpms.id);}calls.length=0;
  }
  for(const [token,expected] of [['fixture-qpms',true],['fixture-other',false]]){const r=await fetch(base+'/retail/access',{headers:{authorization:'Bearer '+token}});assert.equal(r.status,200);assert.equal((await r.json()).initial_admin_writes,expected);}
 });
});
test('Cleaning apply uses the stored proposal kind; unknown classification fails closed; independent review and non-cleaning apply gates remain',async()=>{
 let kind='DC_SCHEDULE';const calls=[],client={rpc:async(name,args)=>{calls.push({name,args});return {data:name==='rpc_retail_unified_snapshot'?{proposals:[{id:'plan',kind}]}:{saved:true}};}};
 const app=express();app.use(express.json());app.use('/retail',createRelianceRetailManagementRouter({requireAuth:auth,getClient:()=>client}));
 const previousGate=process.env.RETAIL_STORE_IMPORT_WRITES_ENABLED;
 try{await running(app,async base=>{
  const request=path=>fetch(base+'/retail/unified-master/'+path,{method:'POST',headers:{authorization:'Bearer fixture-other','content-type':'application/json'},body:JSON.stringify({proposal_id:'plan',kind:'HK',p_actor:qpms.id,approve:true,reason:'Existing independent decision'})});
  assert.equal((await request('apply')).status,403);assert.deepEqual(calls.map(c=>c.name),['rpc_retail_unified_snapshot']);calls.length=0;
  kind=null;assert.equal((await request('apply')).status,503);assert.equal(calls.some(c=>c.name==='rpc_retail_unified_apply'),false);calls.length=0;
  kind='HK';process.env.RETAIL_STORE_IMPORT_WRITES_ENABLED='false';assert.equal((await request('apply')).status,409);assert.equal(calls.some(c=>c.name==='rpc_retail_unified_apply'),false);calls.length=0;
  // Isolated fixture switch only: no real write gate/configuration is changed.
  process.env.RETAIL_STORE_IMPORT_WRITES_ENABLED='true';assert.equal((await request('apply')).status,200);assert.deepEqual(calls.map(c=>c.name),['rpc_retail_unified_snapshot','rpc_retail_unified_snapshot','rpc_retail_unified_apply']);assert.ok(calls.every(call=>call.args.p_actor===other.id));calls.length=0;
  assert.equal((await request('decide')).status,200);assert.deepEqual(calls.map(c=>c.name),['rpc_retail_unified_snapshot','rpc_retail_unified_decide']);assert.ok(calls.every(call=>call.args.p_actor===other.id));calls.length=0;
  // The compatibility boundary blocks even the initial admin for Cleaning.
  kind='DC_SCHEDULE';for(const path of ['apply','decide']){
   const response=await fetch(base+'/retail/unified-master/'+path,{method:'POST',headers:{authorization:'Bearer fixture-qpms','content-type':'application/json'},body:JSON.stringify({proposal_id:'plan',kind:'HK',approve:true})});
   assert.equal(response.status,503);assert.equal((await response.json()).code,'evidence_compatibility_maintenance');
   assert.deepEqual(calls.map(call=>call.name),['rpc_retail_unified_snapshot']);assert.equal(calls[0].args.p_actor,qpms.id);calls.length=0;
  }
 });}finally{if(previousGate===undefined)delete process.env.RETAIL_STORE_IMPORT_WRITES_ENABLED;else process.env.RETAIL_STORE_IMPORT_WRITES_ENABLED=previousGate;}
});
