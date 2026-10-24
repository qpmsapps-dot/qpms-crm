import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {canAccessRoute,retailWebAccess} from '../src/utils/authRoles.js';
import {assertRetailAccess,listRetailDeepCleaningRecords,retailAccess,syncFoZones} from '../backend/services/relianceRetailManagementService.js';
import {createRequire} from 'node:module';
const express=createRequire(new URL('../backend/package.json',import.meta.url))('express');
import {createRelianceRetailManagementRouter} from '../backend/routes/relianceRetailManagementRoutes.js';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('Retail role access separates HK, technical and KAM and denies other businesses',()=>{
 const hk={role:'MIS',designation:'HK MIS',business:'Reliance Retail'},technical={role:'MIS',designation:'Technical MIS',business:'Reliance Retail'},kam={role:'KAM',business:'Reliance Retail'};
 for(const p of [hk,technical,kam])assert.equal(retailWebAccess(p).dashboard,true);
 assert.equal(canAccessRoute(hk,'/reliance-retail/store-master'),true);
 assert.equal(canAccessRoute(hk,'/reliance-retail/fault-tracker'),false);
 assert.equal(canAccessRoute(technical,'/reliance-retail/fault-tracker'),true);
 assert.equal(canAccessRoute(technical,'/reliance-retail/store-master'),false);
 assert.equal(canAccessRoute(kam,'/reliance-retail/thermography'),true);
 assert.equal(canAccessRoute({...hk,business:'Other'},'/reliance-retail'),false);
 assert.equal(canAccessRoute({role:'DEMO_VIEWER'},'/reliance-retail'),false);
});
test('Retail routes resolve real pages and explicit unfinished pages while preserving KM',()=>{
 const s=read('src/routes/AppRoutes.jsx');for(const name of ['RetailDashboard','RetailAttendance','RetailTraining','RetailStoreMaster','RetailScopedFaultTracker','RetailScopedDeepCleaning'])assert.match(s,new RegExp('element: <'+name));
 for(const name of ['CMPM','Thermography'])assert.match(s,new RegExp('RetailComingSoon title="'+name+'"'));
 assert.match(s,/m-here-attendance.*Navigate to="\/reliance-retail\/attendance"/);
 assert.match(s,/path: 'fo-activities'/);
 assert.match(read('src/pages/reliance-retail/RetailComingSoon.jsx'),/Under Development/);
});
test('Retail navigation is gated without unrelated route additions',()=>{
 const s=read('src/components/Sidebar.jsx');assert.match(s,/retailWebAccess\(user\)\.dashboard/);assert.match(s,/title: 'Reliance Retail'/);assert.doesNotMatch(s,/momNavGroup/);
 assert.doesNotMatch(read('src/routes/AppRoutes.jsx'),/BusinessMomPage|RolesPermissions/);
});
test('Backend Retail mount is authenticated; attendance remains feature-gated',()=>{
 assert.match(read('backend/server.js'),/createRelianceRetailManagementRouter\(\{ requireAuth: requireSupabaseJwt, getClient: requireServiceRoleSupabase \}\)/);
 assert.match(read('backend/routes/relianceRetailManagementRoutes.js'),/router.use\(requireAuth\)/);
 assert.match(read('backend/routes/retailAttendanceRoutes.js'),/RETAIL_ATTENDANCE_ENABLED !== 'true'/);
});
test('Retail backend rejects other businesses before querying and preserves atomic zone RPC errors',async()=>{
 let queried=false;
 await assert.rejects(()=>listRetailDeepCleaningRecords({from(){queried=true;}},{id:'other',business:'DME',designation:'HK MIS'}),e=>e.statusCode===403);
 assert.equal(queried,false);
 assert.throws(()=>assertRetailAccess({id:'other',business:'DME',designation:'HK MIS'},'stores'));
 assert.equal(retailAccess({id:'hk',business:'Reliance Retail',designation:'HK MIS'}).stores,true);
 const calls=[];await assert.rejects(()=>syncFoZones({rpc:async(name,args)=>{calls.push({name,args});return {error:{code:'40001',message:'retry'}};}},{id:'hk',business:'Reliance Retail',designation:'HK MIS'},'fo',['z','z']),e=>e.code==='40001');
 assert.equal(calls[0].name,'rpc_sync_reliance_retail_fo_zones');assert.deepEqual(calls[0].args.p_zone_ids,['z']);
});
test('Auth projection retains Retail responsibility fields without changing token lifecycle',()=>{
 const s=read('src/context/AuthContext.jsx');for(const field of ['business','designation','department'])assert.match(s,new RegExp(field+': profile\\?\\.'+field));
});
test('Mounted Retail router requires authentication and denies unrelated business database access',async()=>{
 const app=express();let queries=0;app.use('/api/reliance-retail',createRelianceRetailManagementRouter({requireAuth(req,res,next){if(req.get('x-test-role')!=='other')return res.status(401).json({ok:false});req.profile={id:'other',designation:'HK MIS',business:'DME'};next();},getClient(){queries++;throw Error('Unexpected database access');}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 try{const url='http://127.0.0.1:'+server.address().port+'/api/reliance-retail';assert.equal((await fetch(url+'/access')).status,401);const access=await fetch(url+'/access',{headers:{'x-test-role':'other'}});assert.equal((await access.json()).access.allowed,false);assert.equal((await fetch(url+'/attendance/summary',{headers:{'x-test-role':'other'}})).status,503);assert.equal(queries,0);}finally{await new Promise(resolve=>server.close(resolve));}
});
