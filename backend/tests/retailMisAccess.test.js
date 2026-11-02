import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {once} from 'node:events';
import {RETAIL_MIS_ROLES,RETAIL_MIS_MODULES,retailMisCan,retailMisScopeStates,assertScopedQuotation,verifyPadmaIdentity,PADMA_RETAIL_IDENTITY,retailMisApiAllowed} from '../shared/retailMisAccess.js';
import {createRetailMisRouter} from '../routes/retailMisRoutes.js';
import {canAccessRoute} from '../../src/utils/authRoles.js';
import {attendanceAccess} from '../services/retailAttendanceService.js';
import {signVerifiedFoCleaningSource} from '../services/retailCleaningFoLinkService.js';
test('MIS linked FO images verify private bucket, exact path and stored size before signing',async()=>{
 let signs=0,size=100,isPublic=false;
 const source={id:'fo:fixture',employee_code:'FO1',deep_cleaning_date:'2026-10-15',uploads:[{id:'image',storage_bucket:'fo-activity-uploads',file_url:'fo-activity-uploads/FO1/2026-10-15/deep_cleaning/fixture/before.jpg',file_type:'image/jpeg',file_size:100,upload_role:'deep_cleaning_before'}]};
 const client={storage:{getBucket:async()=>({data:{public:isPublic}}),from:()=>({list:async()=>({data:[{name:'before.jpg',metadata:{size}}]}),createSignedUrl:async(path,expires)=>{signs++;assert.equal(expires,120);return {data:{signedUrl:'synthetic-private-url'}};}})}};
 assert.equal((await signVerifiedFoCleaningSource(client,source,120)).length,1);assert.equal(signs,1);
 size=101;await assert.rejects(()=>signVerifiedFoCleaningSource(client,source,120),/size no longer matches/);assert.equal(signs,1);
 size=100;isPublic=true;await assert.rejects(()=>signVerifiedFoCleaningSource(client,source,120),/must be private/);assert.equal(signs,1);
 isPublic=false;await assert.rejects(()=>signVerifiedFoCleaningSource(client,{...source,uploads:[{...source.uploads[0],file_url:'fo-activity-uploads/another-user/before.jpg'}]},120),/outside/);assert.equal(signs,1);
});
const roles=Object.keys(RETAIL_MIS_ROLES),all=[...new Set(Object.values(RETAIL_MIS_MODULES).flat())];
for(const role of roles)test(role+' has exact module/navigation matrix and explicit geographic grants',()=>{
 const access={role,states:['TN','AP-1'],active:true},user={role,rawRole:role,business:'Reliance Retail'};
 for(const module of all){const allowed=RETAIL_MIS_MODULES[role].includes(module);assert.equal(retailMisCan(access,module,'TN'),allowed);assert.equal(canAccessRoute(user,'/reliance-retail/mis/'+module),allowed);assert.equal(retailMisCan(access,module,'PY'),allowed&&role==='CENTRAL_MIS');assert.equal(retailMisCan(access,module,'AP-2'),allowed&&role==='CENTRAL_MIS');}
 for(const path of ['/reliance-retail/store-master','/fault-tracker','/settings/retail-mis-access','/fo-activities','/approvals','/employees','/reliance-retail/oos'])assert.equal(canAccessRoute(user,path),false);
 for(const path of ['/api/fault-tracker/tickets','/api/fo/activities','/api/training/sessions','/api/admin/users','/api/reliance-retail/operations/maintenance','/api/reliance-retail/unified-master'])assert.equal(retailMisApiAllowed({role},path),false);
 for(const path of ['/api/reliance-retail/mis/access','/api/reliance-retail/mis/report/pest','/api/profile/me'])assert.equal(retailMisApiAllowed({role},path),true);
 assert.equal(retailMisCan({...access,active:false},RETAIL_MIS_MODULES[role][0],'TN'),false);
});
test('legacy MIS is never silently Central; AP is ambiguous; TN does not grant PY',()=>{
 assert.equal(retailMisCan({role:'MIS',active:true,states:['TN']},'dashboard','TN'),false);
 assert.throws(()=>retailMisScopeStates(['AP']));assert.throws(()=>retailMisScopeStates(['All States']));assert.deepEqual(retailMisScopeStates(['TN','KL','TN','KN']),['KA','KL','TN']);
 assert.throws(()=>attendanceAccess({role:'MIS_HK',id:'x',is_active:true}),/Outside/);
});
test('Padma migration identity requires all identifiers and active account, never display name',()=>{
 const fixture={id:PADMA_RETAIL_IDENTITY.profile_id,auth_user_id:PADMA_RETAIL_IDENTITY.auth_user_id,employee_code:PADMA_RETAIL_IDENTITY.employee_code,is_active:true,full_name:'Fixture only'};
 assert.equal(verifyPadmaIdentity(fixture),true);for(const k of ['id','auth_user_id','employee_code'])assert.equal(verifyPadmaIdentity({...fixture,[k]:'different',full_name:'Padma'}),false);assert.equal(verifyPadmaIdentity({...fixture,is_active:false}),false);
});
test('quotations reject entire cross-state file, foreign store, duplicate code and item mismatch',()=>{
 const access={role:'MIS_OOS',active:true,states:['TN','KL']},stores=[{id:'a',store_code:'S1',state:'TN',status:'Active'},{id:'b',store_code:'S2',state:'KL',status:'Active'},{id:'c',store_code:'S3',state:'PY',status:'Active'}];
 const group=id=>({store_ids:[id],items:[{store_id:id}]});assert.equal(assertScopedQuotation([group('a')],stores,access),'TN');
 assert.throws(()=>assertScopedQuotation([group('a'),group('b')],stores,access),/Cross-state/);assert.throws(()=>assertScopedQuotation([group('c')],stores,access),/Outside/);assert.throws(()=>assertScopedQuotation([group('a')],[...stores,{...stores[0],id:'dup'}],access),/Ambiguous/);assert.throws(()=>assertScopedQuotation([{store_ids:['a'],items:[{store_id:'b'}]}],stores,access),/mismatch/);
});
test('real HTTP router binds actors, denies self-assignment/admin escalation, keeps OOS closed and signs no denied evidence',async()=>{
 const calls=[],client={rpc:async(name,args)=>{calls.push({name,args});if(name==='rpc_retail_mis_access')return {data:{role:'MIS_HK',active:true,states:['TN']}};if(name==='rpc_retail_mis_report')return {data:{rows:[],stores:[]}};if(name==='rpc_retail_mis_evidence_object')return {error:{code:'42501',message:'Outside scope'}};return {data:[]};},storage:{from(){throw Error('Unauthorized evidence must not reach storage');}}};
 const app=express();app.use((req,res,next)=>{req.profile={id:'fixture-profile',auth_user_id:'fixture-auth',role:'MIS_HK',is_active:true};req.authUser={id:'fixture-auth'};next();});app.use('/api/reliance-retail/mis',createRetailMisRouter({getClient:()=>client,environment:{RETAIL_OOS_MUTATIONS_FROZEN:'false'}}));const server=app.listen(0,'127.0.0.1');await once(server,'listening');const url='http://127.0.0.1:'+server.address().port+'/api/reliance-retail/mis';
 try{
  assert.equal((await fetch(url+'/report/pest?actor=forged&state=TN')).status,200);assert.equal(calls.find(c=>c.name==='rpc_retail_mis_report').args.p_actor,'fixture-profile');
  assert.equal((await fetch(url+'/report/maintenance')).status,403);
  assert.equal((await fetch(url+'/assignments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role:'CENTRAL_MIS',profile_id:'fixture-profile'})})).status,403);
  assert.equal((await fetch(url+'/evidence/foreign')).status,403);
  assert.equal((await fetch(url+'/command/oos',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'RETIRE',data:{}})})).status,403);
 }finally{await new Promise(r=>server.close(r));}
});
