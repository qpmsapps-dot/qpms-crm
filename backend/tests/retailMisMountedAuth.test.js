import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {once} from 'node:events';
import express from 'express';
import {retailMisApiAllowed} from '../shared/retailMisAccess.js';
import {createRelianceRetailManagementRouter} from '../routes/relianceRetailManagementRoutes.js';

// Exercise the actual auth middleware without importing server.js and starting
// its schedulers/listeners. Only Supabase identity/profile I/O is substituted.
const source=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
const start=source.indexOf('async function requireSupabaseJwt(');
const end=source.indexOf('\nfunction requireFoOperationsCommandCenter(',start);
assert.ok(start>=0&&end>start,'Existing JWT middleware boundaries required');
const middlewareSource=source.slice(start,end);

async function fixture({active=true}={}){
 const actor={id:'fixture-padma-profile',auth_user_id:'fixture-padma-auth',employee_code:'FIXTURE-OOS',role:'MIS_OOS',is_active:true,status:'Active',business:'Reliance Retail'};
 const calls=[],lookups=[],paths=[];
 const client={from:table=>({select:()=>({eq:(key,value)=>({maybeSingle:async()=>{lookups.push({table,key,value});return {data:actor};}})})}),rpc:async(name,args)=>{
  calls.push({name,args});
  if(name==='rpc_retail_mis_access')return {data:{profile_id:actor.id,active,role:'MIS_OOS',states:['TN']}};
  if(name==='rpc_retail_oos_register')return {data:{complete:true,rows:[],states:['TN'],twelve_stage_enabled:false}};
  if(name==='rpc_retail_oos12_capabilities')return {data:{database_writes_enabled:false,twelve_stage_enabled:false,actions:{}}};
  if(name==='rpc_retail_mis_report'&&args.p_state==='KA')return {error:{code:'42501',message:'Outside assigned state'}};
  if(name==='rpc_retail_mis_report')return {data:{rows:[],states:['TN']}};
  throw Error('Unexpected RPC: '+name);
 }};
 const requireAuth=vm.runInNewContext('('+middlewareSource+')',{
  console,getBearerToken:r=>String(r.headers.authorization||'').replace(/^Bearer /,''),
  supabaseAnon:{auth:{getUser:async token=>token==='fixture-valid'?{data:{user:{id:actor.auth_user_id}}}:{data:{user:null},error:{code:'invalid'}}}},
  requireServiceRoleSupabase:()=>client,assertServiceRoleAuthAdminAccess:async()=>{},
  retailMisApiAllowed:(profile,path)=>{paths.push(path);return retailMisApiAllowed(profile,path);},
  blockDemoReadOnlyMutation:()=>false,sanitizeSupabaseDiagnosticError:e=>({message:e.message,code:e.code}),serviceRoleConfigurationReason:()=> 'fixture'
 });
 const app=express();app.use(express.json());
 app.use('/api/reliance-retail',createRelianceRetailManagementRouter({requireAuth,getClient:()=>client}));
 app.use('/api/admin',(req,res,next)=>requireAuth(req,res,next),(req,res)=>res.json({unexpected:true}));
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');
 const base='http://127.0.0.1:'+server.address().port;
 return {actor,calls,lookups,paths,request:(path,token='fixture-valid')=>fetch(base+path,{headers:token?{Authorization:'Bearer '+token}:{}}),close:()=>new Promise(resolve=>server.close(resolve))};
}

test('mounted JWT middleware permits the canonical MIS workspace and preserves server-bound actor and closed gates',async()=>{
 const f=await fixture();try{
  for(const endpoint of ['/access','/oos/register','/oos/capabilities']){
   const response=await f.request('/api/reliance-retail/mis'+endpoint+'?p_actor=forged');
   assert.equal(response.status,200,endpoint+': '+await response.clone().text());
   const body=await response.json();assert.equal(body.ok,true);
   if(endpoint==='/access')assert.equal(body.result.profile_id,f.actor.id);
   if(endpoint==='/oos/capabilities')assert.equal(body.result.writes_enabled,false);
  }
  assert.ok(f.paths.every(path=>path.startsWith('/api/reliance-retail/mis/')));
  assert.ok(f.lookups.every(x=>x.table==='profiles'&&x.key==='auth_user_id'&&x.value===f.actor.auth_user_id));
  assert.ok(f.calls.every(c=>c.args.p_actor===f.actor.id));
  assert.equal(f.calls.find(c=>c.name==='rpc_retail_mis_access').args.p_auth,f.actor.auth_user_id);
  assert.equal((await f.request('/api/reliance-retail/mis/report/oos?state=TN')).status,200);
  assert.equal((await f.request('/api/reliance-retail/mis/report/oos?state=KA')).status,403);
  const before=f.calls.length;
  for(const path of ['/api/reliance-retail/operations/maintenance','/api/reliance-retail/mis/assignments','/api/reliance-retail/mis/report/stores','/api/reliance-retail/missing','/api/admin/users'])assert.equal((await f.request(path)).status,403,path);
  assert.equal(f.calls.filter(c=>c.name==='rpc_retail_mis_report').length,2);
  assert.ok(f.calls.slice(before).every(c=>c.name==='rpc_retail_mis_access'));
 }finally{await f.close();}
});

test('mounted workspace still rejects missing/invalid JWTs and inactive assignments before reading quotations',async()=>{
 const f=await fixture({active:false});try{
  assert.equal((await f.request('/api/reliance-retail/mis/access','')).status,401);
  assert.equal((await f.request('/api/reliance-retail/mis/access','expired')).status,401);
  assert.equal(f.calls.length,0);
  const response=await f.request('/api/reliance-retail/mis/access');assert.equal(response.status,403);
  assert.equal((await response.json()).message,'Active verified Retail MIS assignment required.');
  assert.deepEqual(f.calls.map(c=>c.name),['rpc_retail_mis_access']);
 }finally{await f.close();}
});
