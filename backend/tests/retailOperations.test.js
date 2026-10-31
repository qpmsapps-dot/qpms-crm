import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {randomUUID} from 'node:crypto';
import {maintenanceWindow,maintenanceReport,thermographyReport} from '../shared/retailOperations.js';
import {retailOperationsReport,completeRetailMaintenance,commandRetailThermography} from '../services/retailOperationsService.js';
import {createRetailOperationsRouter} from '../routes/retailOperationsRoutes.js';
import {canAccessRoute} from '../../src/utils/authRoles.js';
import {retailModuleDashboard} from '../services/retailModuleReportService.js';

const store=randomUUID(),actor=randomUUID(),admin={id:actor,role:'Admin',is_active:true,status:'Active'};
const source={today:'2026-10-31',stores:[{id:store,store_code:'S1',store_name:'Source store',state:'PY',status:'Active',can_save:true},{id:'other',store_code:'S2',state:'KA',status:'Active'}],calls:[],thermography:[],events:[]};
test('CM PM windows include exact boundaries and calendar month ends',()=>{
 assert.equal(maintenanceWindow('2026-10','CM','2026-10-15').open,true);
 assert.equal(maintenanceWindow('2026-10','CM','2026-10-16').open,false);
 assert.equal(maintenanceWindow('2026-10','PM','2026-10-15').open,false);
 assert.equal(maintenanceWindow('2026-10','PM','2026-10-16').open,true);
 assert.equal(maintenanceWindow('2028-02','PM','2028-02-29').end,'2028-02-29');
 assert.equal(maintenanceWindow('2027-02','PM','2027-02-28').end,'2027-02-28');
 assert.equal(maintenanceWindow('2026-10','PM','2026-11-01').open,false);
});
test('actual store denominators, unique completions, state filters and TN/PY reporting reconcile',()=>{
 const data={...source,calls:[{id:'done',retail_store_id:store,kind:'CM',completed_on:'2026-10-10'}]};
 const report=maintenanceReport(data,'2026-10');
 assert.equal(report.modules.cm.rows.length,6);
 assert.deepEqual(report.modules.cm.total,{eligible:2,completed:1,remaining:1});
 assert.deepEqual(report.modules.pm.total,{eligible:2,completed:0,remaining:2});
 assert.equal(report.modules.cm.rows.find(r=>r.state==='TN').completed,1);
 assert.equal(report.modules.cm.rows.some(r=>r.state==='PY'),false);
 assert.equal(maintenanceReport(data,'2026-10',{state:'TN'}).modules.cm.stores.length,1);
 assert.equal(maintenanceReport({...source,stores:[]},'2026-10').modules.pm.total.eligible,0);
});
test('Thermography keeps three statuses, overdue subset and late approval history distinct',()=>{
 const data={...source,thermography:[{id:'1',retail_store_id:store,status:'Scheduled'},{id:'2',retail_store_id:store,status:'Completed',approval_due_on:'2026-10-31'},{id:'3',retail_store_id:store,status:'Completed',approval_due_on:'2026-10-30'},{id:'4',retail_store_id:store,status:'Client Approved',approved_late:true}]};
 const report=thermographyReport(data,'2026-10');
 assert.deepEqual(report.total,{scheduled:1,awaiting:2,approved:1,overdue:1,approved_late:1});
 assert.equal(report.states.length,6);
 assert.equal(report.rows[3].approval_overdue,false);
 assert.equal(thermographyReport(data,'2026-10',{state:'KN'}).rows.length,0);
});
test('services preserve backend actor authority, active role guards and unavailable infrastructure',async()=>{
 const calls=[],client={rpc:async(name,args)=>{calls.push({name,args});return {data:source};}};
 await completeRetailMaintenance(client,admin,{p_actor:'spoof',kind:'PM',store_id:store,month:'2026-10',request_id:randomUUID()});
 assert.equal(calls[0].args.p_actor,actor);assert.equal(Object.hasOwn(calls[0].args,'p_today'),false);
 await commandRetailThermography(client,admin,{status:'Scheduled',store_id:store,scheduled_date:'2026-10-31',request_id:randomUUID()});
 assert.equal(calls[1].args.p_actor,actor);
 await assert.rejects(()=>retailOperationsReport(client,{...admin,is_active:false},'maintenance'),e=>e.statusCode===403);
 await assert.rejects(()=>retailOperationsReport(client,{...admin,role:'FO'},'maintenance'),e=>e.statusCode===403);
 await assert.rejects(()=>retailOperationsReport(client,admin,'maintenance',{store:'outside'}),e=>e.statusCode===403);
 await assert.rejects(()=>retailOperationsReport({rpc:async()=>({error:{code:'PGRST202'}})},admin,'maintenance'),e=>e.statusCode===503);
 await assert.rejects(()=>completeRetailMaintenance(client,admin,{kind:'PM',store_id:'bad',month:'2026-10',request_id:'bad'}),e=>e.statusCode===400);
});
test('MIS navigation does not grant other-business or FO operational access',()=>{
 for(const role of ['HK MIS','Technical MIS','MIS','KAM'])for(const path of ['cmpm','thermography'])assert.equal(canAccessRoute({role,business:'Reliance Retail'},`/reliance-retail/${path}`),true);
 for(const user of [{role:'MIS',business:'Other'},{role:'FO',business:'Reliance Retail'},null])assert.equal(canAccessRoute(user,'/reliance-retail/cmpm'),false);
});
test('operations HTTP routes reject missing authentication and do not accept forged actor IDs',async()=>{
 const calls=[],app=express();
 app.use('/operations',(req,res,next)=>{if(req.get('authorization')!=='Bearer local-fixture')return res.status(401).json({});req.profile=admin;next();},createRetailOperationsRouter({getClient:()=>({rpc:async(name,args)=>{calls.push({name,args});return {data:source};}})}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{const base=`http://127.0.0.1:${server.address().port}/operations`;
  assert.equal((await fetch(base+'/maintenance')).status,401);
  const response=await fetch(base+'/maintenance',{method:'POST',headers:{authorization:'Bearer local-fixture','content-type':'application/json'},body:JSON.stringify({p_actor:randomUUID(),kind:'PM',store_id:store,month:'2026-10',request_id:randomUUID()})});
  assert.equal(response.status,200);assert.equal(calls[0].args.p_actor,actor);
  assert.equal((await fetch(base+'/maintenance',{method:'DELETE',headers:{authorization:'Bearer local-fixture'}})).status,404);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('Dashboard reads actual operation source and does not substitute training topics for calls or inspections',async()=>{
 const client={rpc:async name=>name==='rpc_retail_operations_snapshot'?{data:{...source,calls:[{retail_store_id:store,kind:'PM',completed_on:'2026-10-31'}]}}:{data:{stores:source.stores,attendance:[],aop:[],schedules:[],deep_cleaning:[],images:[]}},from(){throw Error('Training unavailable in this fixture');}};
 const report=await retailModuleDashboard(client,admin,{from:'2026-10-01',to:'2026-10-31'});
 assert.equal(report.modules.pm.status,'ready');assert.equal(report.modules.pm.total.completed,1);assert.equal(report.modules.cm.total.completed,0);assert.equal(report.modules.thermography.rows.reduce((n,r)=>n+r.scheduled,0),0);
});
