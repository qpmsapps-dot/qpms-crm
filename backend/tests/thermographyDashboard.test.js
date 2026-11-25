import test from 'node:test';
import assert from 'node:assert/strict';
import {dashboardResult,thermoDashboard} from '../services/thermographyDashboard.js';
import {thermoServiceFixture} from './helpers/thermographyServiceFixture.js';
const row=(id,date,verified=false,state='TN')=>({id,scheduled_date:date,pdf_verified:verified,completed_on:verified?date:null,state,store_code:'00'+id,store_name:'Synthetic',retail_store_id:'store'+id});
const report={today:'2026-11-18',stores:[{id:'store1',state:'TN'},{id:'store2',state:'AP-1'},{id:'store3',state:'AP-2'}],scope_digest:'synthetic',can_upload:true};
test('current month uses IST server cutoff; full-month table, chart and monthly counts remain independent of custom KPI range',()=>{
 const rows=[row('1','2026-11-01'),row('2','2026-11-18',true),row('3','2026-11-19',true),row('4','2026-11-30',false,'AP-1')];
 const result=dashboardResult(rows,report,{month:'2026-11'});
 assert.deepEqual(result.summary,{scheduled:2,completed:1,percentage:50});assert.equal(result.rows.length,4);assert.deepEqual(result.monthly,{total:4,completed:2,scheduled:2});assert.deepEqual(result.chart,[{state:'TN',scheduled:2,completed:1}]);
 const custom=dashboardResult(rows,report,{month:'2026-11',kpi_from:'2026-11-10',kpi_to:'2026-11-30'});assert.equal(custom.summary.scheduled,1);assert.equal(custom.summary.completed,1);assert.equal(custom.rows.length,4);assert.equal(custom.kpi_to,'2026-11-18');
 const none=dashboardResult(rows,report,{month:'2026-11',kpi_from:'2026-11-19'});assert.equal(none.summary.scheduled,0);assert.equal(none.rows.length,4);
});
test('past/full month, future/zero, genuine zero, legacy exclusion, state/store/code/status filters and pagination',()=>{
 const past=dashboardResult([row('1','2026-10-31',true)],report,{month:'2026-10'});assert.equal(past.summary.percentage,100);
 const future=dashboardResult([row('1','2026-12-01',true)],report,{month:'2026-12'});assert.deepEqual(future.summary,{scheduled:0,completed:0,percentage:0});assert.equal(future.rows.length,1);
 const legacy={...row('1','2026-11-01'),status:'Client Approved',active_version_id:null};const rows=[legacy,row('2','2026-11-02',true,'AP-1'),row('3','2026-11-03',true,'AP-2')];
 assert.equal(dashboardResult(rows,report,{month:'2026-11'}).summary.completed,2);
 assert.equal(dashboardResult(rows,report,{month:'2026-11',state:'AP-1'}).summary.completed,1);
 assert.equal(dashboardResult(rows,report,{month:'2026-11',store:'store2'}).rows[0].id,'2');
 assert.equal(dashboardResult(rows,report,{month:'2026-11',q:'001',status:'Scheduled'}).rows[0].id,'1');
 assert.equal(dashboardResult(rows,report,{month:'2026-11',status:'Completed'}).rows.length,2);
 assert.equal(dashboardResult(rows,report,{month:'2026-11',page:1,limit:10}).rows.length,0);
 for(const filters of [{month:'bad'},{month:'2026-11',status:'Other'},{month:'2026-11',kpi_from:'2026-10-31'},{month:'2026-11',kpi_to:'2026-11-31'},{month:'2026-11',kpi_from:'2026-11-20',kpi_to:'2026-11-10'}])assert.throws(()=>dashboardResult(rows,report,filters));
});
test('actual SQL dashboard excludes other states and preserves future scheduled rows',async()=>{
 const h=await thermoServiceFixture();try{
  const month=h.today.slice(0,7);await h.schedule({date:month+'-28'});await h.schedule({store_id:h.ids.otherStore,date:month+'-29'});
  const result=await thermoDashboard(h.client,h.profile,{month});assert.equal(result.monthly.total,1);assert.equal(result.rows[0].state,'TN');assert.equal(result.rows[0].scheduled_date,month+'-28');
  assert.equal(result.summary.scheduled,h.today>=month+'-28'?1:0);
  await assert.rejects(thermoDashboard(h.client,h.profile,{month,state:'KA'}),e=>e.statusCode===403);
  await assert.rejects(thermoDashboard(h.client,h.profile,{month,store:h.ids.otherStore}),e=>e.statusCode===403);
 }finally{await h.db.close();}
});

test('early verified completion is independent of scheduled cutoff and future completion dates are excluded',()=>{
 const rows=[row('1','2026-11-01'),{...row('2','2026-11-30',true,'AP-1'),completed_on:'2026-11-17'},{...row('3','2026-11-14',true,'AP-2'),completed_on:'2026-11-20'}];
 const result=dashboardResult(rows,report,{month:'2026-11'});
 assert.deepEqual(result.summary,{scheduled:2,completed:1,percentage:50});
 assert.deepEqual(result.chart.find(s=>s.state==='AP-1'),{state:'AP-1',scheduled:0,completed:1});
 assert.equal(result.monthly.total,3);assert.equal(result.monthly.completed,2);
 assert.equal(dashboardResult(rows,report,{month:'2026-11',kpi_to:'2026-11-16'}).summary.completed,0);
});
test('actual SQL allows early PDF completion and preserves schedule and authorization',async()=>{
 const h=await thermoServiceFixture();try{
  const date=new Date(Date.parse(h.today+'T00:00:00Z')+86400000).toISOString().slice(0,10);
  const saved=await h.schedule({date});const list=await h.call(h.ids.mepc,'dashboard',{from:date,to:date});assert.equal(list.rows[0].can_upload,true);
  await assert.rejects(h.prepare({id:saved.id,revision:saved.revision},h.ids.other));
  const version=await h.prepare({id:saved.id,revision:saved.revision});await h.finalize(version);
  const result=await h.call(h.ids.mepc,'dashboard',{from:date,to:date});assert.equal(result.rows[0].pdf_verified,true);assert.equal(result.rows[0].scheduled_date,date);assert.equal(result.rows[0].completed_on,h.today);
 }finally{await h.db.close();}
});
