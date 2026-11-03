import test from 'node:test';import assert from 'node:assert/strict';import express from 'express';import {once} from 'node:events';
import {createRetailMisRouter} from '../routes/retailMisRoutes.js';
test('OOS-MIS uses verified profile/auth and assigned scope; no other module access is implied',async()=>{
 const calls=[],client={rpc:async(name,args)=>{calls.push({name,args});return {data:name==='rpc_retail_mis_access'?{active:true,role:'MIS_OOS',states:['TN']}:{ok:true}};}};
 const app=express();app.use((r,s,n)=>{r.profile={id:'server-profile',auth_user_id:'server-auth',role:'MIS_OOS',business:'Reliance Retail'};r.authUser={id:'server-auth'};n();});
 app.use('/mis',createRetailMisRouter({getClient:()=>client,environment:{RETAIL_OOS_MUTATIONS_FROZEN:'false',RETAIL_MIS_OOS_WRITES_ENABLED:'true'}}));const server=app.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port+'/mis';
 try{
  assert.equal((await fetch(base+'/access')).status,200);assert.deepEqual(calls.find(c=>c.name==='rpc_retail_mis_access').args,{p_actor:'server-profile',p_auth:'server-auth'});
  assert.equal((await fetch(base+'/report/stores')).status,403);
  const data={order_id:'order',revision:2,request_id:'request',fields:{confirmation_ref:'C'},evidence_ids:['evidence'],reason:'Independent confirmation',p_actor:'forged'};
  assert.equal((await fetch(base+'/command/oos',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'OOS12_PO_RECEIVED',data,p_actor:'forged'})})).status,200);
  const cmd=calls.at(-1);assert.equal(cmd.name,'rpc_retail_oos12_transition');assert.equal(cmd.args.p_actor,'server-profile');assert.equal(cmd.args.p_action,'OOS12_PO_RECEIVED');assert.deepEqual(cmd.args.p_evidence,['evidence']);
 }finally{await new Promise(r=>server.close(r));}
});
test('all OOS12 mutation endpoints preserve the global freeze and environment opt-in',async()=>{
 for(const environment of [{},{RETAIL_OOS_MUTATIONS_FROZEN:'true',RETAIL_MIS_OOS_WRITES_ENABLED:'true'},{RETAIL_OOS_MUTATIONS_FROZEN:'false'}]){
  const calls=[],client={rpc:async(name,args)=>{calls.push({name,args});return {data:{active:true,role:'MIS_OOS',states:['TN']}};},storage:{from(){throw Error('No signing behind closed environment gates');}}};
  const app=express();app.use((r,s,n)=>{r.profile={id:'p',auth_user_id:'a',role:'Admin'};r.authUser={id:'a'};n();});app.use('/mis',createRetailMisRouter({getClient:()=>client,environment}));const server=app.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port+'/mis';
  try{for(const path of ['/oos/evidence/prepare','/oos/evidence/finalize','/command/oos'])assert.equal((await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'OOS12_PO_RECEIVED',data:{}})})).status,503);assert.equal(calls.filter(c=>c.name!=='rpc_retail_mis_access').length,0);}finally{await new Promise(r=>server.close(r));}
 }
});
