import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createKmReconciliationRouter } from '../routes/foKmReconciliationRoutes.js';

async function routeFixture(role, run, environment = {KM_SHARED_RECONCILIATION_ENABLED:'true',KM_INCREMENTAL_REPORTING_ENABLED:'true'}, reconcileOverride = null) {
 const app=express();app.use(express.json());const calls=[];calls.database=[];
 const builder={select(){return this;},eq(){return this;},gte(){return this;},lte(){return this;},order(){return this;},async range(){return {data:[{id:'attendance',attendance_date:'2026-10-16'}]};}};
 app.use('/km',createKmReconciliationRouter({environment,requireAuth(req,res,next){req.authUser={id:'trusted-admin'};req.profile={auth_user_id:'trusted-admin',employee_code:'ADMIN',role,is_active:true,status:'active',web_access_enabled:true};next();},getClient:()=>{calls.database.push('getClient');return {from:()=>{calls.database.push('from');return builder;}};},reconcile:async(client,payload,options)=>{calls.push({payload,options});if(reconcileOverride)return reconcileOverride(client,payload,options);return {date:'2026-10-16',status:'unchanged',financial_posted:false};}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{await run('http://127.0.0.1:'+server.address().port,calls);}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
}
test('real HTTP Admin route derives actor and attendance from trusted context, not request financial fields',async()=>routeFixture('Admin',async(base,calls)=>{
 const r=await fetch(base+'/km/reconcile-supported',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({employee_code:'FO1',from_date:'2026-10-16',to_date:'2026-10-16',p_admin:'forged',payable_km:900})});
 assert.equal(r.status,200);assert.equal(calls.length,1);assert.deepEqual(calls[0].payload,{attendance_id:'attendance'});assert.equal(calls[0].options.adminAuthorization.userId,'trusted-admin');assert.equal(calls[0].options.trigger,'admin_recalculation');
}));
test('FO cannot invoke Admin automatic credit route',async()=>routeFixture('FO',async(base,calls)=>{
 const r=await fetch(base+'/km/reconcile-supported',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({employee_code:'FO1',from_date:'2026-10-16',to_date:'2026-10-16'})});assert.equal(r.status,403);assert.equal(calls.length,0);assert.equal(calls.database.length,0);
}));
test('oversized date scope is rejected before calculation',async()=>routeFixture('Admin',async(base,calls)=>{
 const r=await fetch(base+'/km/reconcile-supported',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({employee_code:'FO1',from_date:'2026-09-01',to_date:'2026-10-16'})});assert.equal(r.status,400);assert.equal(calls.length,0);
}));

test('inactive or unset feature flags return safely before acquiring a database client', async () => {
 for(const environment of [{},{KM_SHARED_RECONCILIATION_ENABLED:'false',KM_INCREMENTAL_REPORTING_ENABLED:'true'},{KM_SHARED_RECONCILIATION_ENABLED:'true'},{KM_SHARED_RECONCILIATION_ENABLED:'true',KM_INCREMENTAL_REPORTING_ENABLED:'false'}])await routeFixture('Admin',async(base,calls)=>{
  const r=await fetch(base+'/km/reconcile-supported',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({employee_code:'FO1',from_date:'2026-10-16',to_date:'2026-10-16'})});
  assert.equal(r.status,503);assert.equal((await r.json()).code,'KM_SHARED_RECONCILIATION_INACTIVE');assert.equal(calls.length,0);assert.deepEqual(calls.database,[]);
 },environment);
});
test('authorization precedes inactive response and never acquires a protected client',async()=>routeFixture('FO',async(base,calls)=>{
 const r=await fetch(base+'/km/reconcile-supported',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});assert.equal(r.status,403);assert.deepEqual(calls.database,[]);assert.equal(calls.length,0);
},{}));

test('enabled HTTP route reports unavailable schema as deferred, never a successful credit',async()=>routeFixture('Admin',async(base,calls)=>{
 const r=await fetch(base+'/km/reconcile-supported',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({employee_code:'FO1',from_date:'2026-10-16',to_date:'2026-10-16'})});
 const body=await r.json();assert.equal(body.ok,false);assert.equal(body.results[0].status,'deferred');assert.equal(body.results[0].code,'KM_SHARED_SCHEMA_UNAVAILABLE');assert.equal(body.results[0].financial_posted,false);assert.equal(calls.length,1);
},{KM_SHARED_RECONCILIATION_ENABLED:'true',KM_INCREMENTAL_REPORTING_ENABLED:'true'},async()=>{throw Object.assign(new Error('Shared KM database functions are unavailable.'),{code:'KM_SHARED_SCHEMA_UNAVAILABLE',statusCode:503});}));

test('Admin dry_run uses the same reconciler without persistence while posting flags remain off',async()=>routeFixture('Admin',async(base,calls)=>{
 const body={employee_code:'FO1',from_date:'2026-10-16',to_date:'2026-10-16',dry_run:true,p_admin:'forged'};
 const r=await fetch(base+'/km/reconcile-supported',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 assert.equal(r.status,200);assert.equal((await r.json()).mode,'calculation_only');
 assert.equal(calls.length,1);assert.equal(calls[0].options.persist,false);assert.equal(calls[0].options.adminAuthorization.userId,'trusted-admin');
 const posting=await fetch(base+'/km/reconcile-supported',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...body,dry_run:false})});
 assert.equal(posting.status,503);assert.equal(calls.length,1);
},{KM_SHARED_RECONCILIATION_PREVIEW_ENABLED:'true',KM_FINANCIAL_WRITES_EMERGENCY_PAUSE:'true',KM_FINANCIAL_WRITES_MAINTENANCE:'true'}));

test('preview is inactive by default and unauthorized previews never access protected data',async()=>{
 for(const [role,environment,status] of [['Admin',{},503],['FO',{KM_SHARED_RECONCILIATION_PREVIEW_ENABLED:'true'},403]])await routeFixture(role,async(base,calls)=>{
  const r=await fetch(base+'/km/reconcile-supported',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({employee_code:'FO1',from_date:'2026-10-16',to_date:'2026-10-16',dry_run:true})});
  assert.equal(r.status,status);assert.deepEqual(calls.database,[]);assert.equal(calls.length,0);
 },environment);
});

test('ambiguous dry_run values are rejected, not silently treated as posting',async()=>routeFixture('Admin',async(base,calls)=>{
 for(const dry_run of ['true','false',0,null,{}]){
  const r=await fetch(base+'/km/reconcile-supported',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({employee_code:'FO1',from_date:'2026-10-16',to_date:'2026-10-16',dry_run})});
  assert.equal(r.status,400);assert.equal((await r.json()).code,'km_dry_run_invalid');
 }assert.equal(calls.length,0);assert.deepEqual(calls.database,[]);
}));

test('scoped route forwards only the authenticated actor and reference with exact selection',async()=>routeFixture('Admin',async(base,calls)=>{
 const body={employee_code:'FO1',from_date:'2026-10-16',to_date:'2026-10-16',attendance_id:'24000000-0000-4000-8000-000000000001',authorization_reference:'ISOLATED_REFERENCE',p_admin:'forged'};
 const r=await fetch(base+'/km/reconcile-supported',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});assert.equal(r.status,200);assert.equal(calls[0].options.scopedAuthorizationReference,'ISOLATED_REFERENCE');assert.equal(calls[0].options.adminAuthorization.userId,'trusted-admin');assert.equal(calls[0].options.persist,true);
 for(const change of [{attendance_id:null},{to_date:'2026-10-17'},{dry_run:true},{authorization_reference:'invalid'}]){const bad=await fetch(base+'/km/reconcile-supported',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...body,...change})});assert.equal(bad.status,400);}assert.equal(calls.length,1);
}));
