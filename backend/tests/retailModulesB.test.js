import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalActivityStore,cleaningReport,completedTrainingReport} from '../shared/retailModuleReports.js';
import {dailyTarget,summarizeAttendance} from '../shared/retailAttendance.js';
import {retailAccess} from '../services/relianceRetailManagementService.js';
import {attendanceAccess} from '../services/retailAttendanceService.js';
import {canAccessRoute} from '../../src/utils/authRoles.js';

test('existing Admin and QPMS Admin roles retain all Retail routes and Admin attendance writes; unrelated roles do not',()=>{
 for(const role of ['Admin','QPMS Admin']){
  const profile={id:'existing-admin-fixture',role,is_active:true,status:'Active'};
  for(const capability of ['dashboard','deepCleaning','training','cmpm','thermography','faultTracker'])assert.equal(retailAccess(profile)[capability],true);
  for(const route of ['/reliance-retail','/reliance-retail/attendance','/reliance-retail/deep-cleaning','/reliance-retail/training','/reliance-retail/cmpm','/reliance-retail/thermography','/fault-tracker'])assert.equal(canAccessRoute(profile,route),true);
  assert.deepEqual(attendanceAccess(profile,true),{admin:true,state:null});
  assert.throws(()=>attendanceAccess({...profile,is_active:false},true),e=>e.statusCode===403);
 }
 assert.throws(()=>attendanceAccess({id:'mis-fixture',role:'HK MIS',business:'Reliance Retail',state:'TN'},true),e=>e.statusCode===403);
 assert.equal(canAccessRoute({role:'FO',business:'Other'},'/reliance-retail/thermography'),false);
});
const stores=[{id:'tn',store_code:'T1',state:'TN',status:'Active'},{id:'py',store_code:'P1',state:'PY',status:'Active'},{id:'ap1',store_code:'A1',state:'AP-1',status:'Active'},{id:'ap2',store_code:'A2',state:'AP-2',status:'Active'}];
test('attendance retains decimal approved AOP, consolidates PY and keeps AP regions separate',()=>{
 const report=summarizeAttendance({stores,aop:stores.map(s=>({retail_store_id:s.id,hk_count:1.25,mepc_count:2.5,effective_from:'2026-10-01'})),attendance:[],cutoff:'2026-10-01',view:'daily'});
 assert.equal(report.states.find(s=>s.state==='TN').hk_aop,2.5);assert.deepEqual(report.states.map(s=>s.state),['AP-1','AP-2','TN']);assert.equal(report.total.mepc_target,10);
 assert.equal(dailyTarget(2.5,'2026-10-07','MEPC'),0);assert.equal(dailyTarget(1.25,'2026-10-07','HK'),1.25);
});
test('missing or overlapping AOP does not fabricate attendance targets or percentages',()=>{
 const r=summarizeAttendance({stores:[stores[0]],aop:[],attendance:[],cutoff:'2026-10-01'});assert.equal(r.total.hk_pct,null);assert.equal(r.total.complete,false);
});
test('canonical identity rejects duplicate codes and contradictory UUID/geography even for TN/PY reporting',()=>{
 assert.equal(canonicalActivityStore(stores,{store_code:' p1 '}),stores[1]);
 assert.equal(canonicalActivityStore([...stores,{...stores[1],id:'duplicate'}],{retail_store_id:'py',store_code:'P1'}),null);
 assert.equal(canonicalActivityStore(stores,{retail_store_id:'tn',store_code:'P1'}),null);
 assert.equal(canonicalActivityStore(stores,{store_code:'P1',state:'TN'}),null);
});
test('cleaning joins recorded completion and image counts, preserves Not Done and does not invent overdue failure',()=>{
 const snapshot={stores,to:'2026-10-31',schedules:[{id:'s1',retail_store_id:'py',scheduled_date:'2026-10-01',status:'Planned'},{id:'s2',retail_store_id:'tn',scheduled_date:'2026-10-02',status:'Not Done'},{id:'s3',retail_store_id:'tn',scheduled_date:'2026-10-03',status:'Scheduled'}],deep_cleaning:[{id:'d1',store_code:'P1',state:'PY',deep_cleaning_date:'2026-10-01',status:'submitted'}],images:[{submission_id:'d1',photo_type:'before',uploaded:true},{submission_id:'d1',photo_type:'after',uploaded:true}]};
 const r=cleaningReport(snapshot,{state:'TN'});assert.deepEqual(r.schedules.map(s=>s.display_status),['Completed','Not Completed','Scheduled']);assert.equal(r.schedules[2].overdue,true);assert.equal(r.submissions[0].before_count,1);assert.equal(r.totals.completed,1);assert.deepEqual(r.states,['TN']);
});
test('unavailable schedules stay unavailable; unmatched evidence never completes a store',()=>{
 const r=cleaningReport({stores,schedules:null,deep_cleaning:[{id:'bad',store_code:'unknown',status:'submitted'}]});assert.equal(r.totals,null);assert.equal(r.submissions.length,0);assert.equal(r.exceptions.length,1);
});
test('completed training counts unique canonical HK/MEPC sessions by state/store, without scheduled records',()=>{
 const session=(id,code,category,status='submitted')=>({id,store_code_snapshot:code,category:{code:category},status});
 const report=completedTrainingReport([session('a','P1','hk'),session('b','T1','technical_mep'),session('c','A1','hk'),session('draft','T1','hk','draft'),session('unknown','X','hk'),session('other','T1','other')],stores);
 assert.deepEqual(report.total,{hk:2,mepc:1});assert.deepEqual(report.states.find(s=>s.state==='TN'),{state:'TN',hk:1,mepc:1});assert.equal(report.exceptions.length,2);assert.equal(report.stores.find(s=>s.store_code==='P1').hk,1);
});
