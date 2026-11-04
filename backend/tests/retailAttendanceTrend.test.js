import test from 'node:test';
import assert from 'node:assert/strict';
import {retailAttendanceTrend} from '../shared/retailAttendanceTrend.js';

const stores=[{id:'s1',store_code:'T001',state:'TN',status:'Active'}];
const aop=[{retail_store_id:'s1',hk_count:2,mepc_count:1,effective_from:'2026-10-01',effective_to:null}];
test('verified day trend uses the existing daily target and arithmetic, missing upload is gap',()=>{
 const attendance=[
  {retail_store_id:'s1',attendance_date:'2026-10-01',class:'HK',credit:2},
  {retail_store_id:'s1',attendance_date:'2026-10-01',class:'MEPC',credit:1},
  {retail_store_id:'s1',attendance_date:'2026-10-03',class:'HK',credit:1},
  {retail_store_id:'s1',attendance_date:'2026-10-03',class:'MEPC',credit:1}
 ];
 const result=retailAttendanceTrend({stores,attendance,aop,cutoff:'2026-10-04'});
 assert.equal(result.length,4);
 assert.equal(result[0].overall_pct,100);
 assert.equal(result[0].total_actual,3);
 assert.equal(result[1].overall_pct,null,'missing upload does not become 0%');
 assert.equal(result[1].total_actual,null);
 assert.equal(result[1].has_attendance_upload,false);
 assert.ok(Math.abs(result[2].overall_pct-(2/3*100))<0.000001);
 assert.equal(result[3].complete,false);
});
test('partial store attendance and missing AOP never report a fake verified percentage',()=>{
 const first=retailAttendanceTrend({stores,attendance:[
 {retail_store_id:'s1',attendance_date:'2026-10-01',class:'HK',credit:1}],aop,cutoff:'2026-10-01'})[0];
 assert.equal(first.overall_pct,null);
 assert.equal(first.total_actual,1);
 assert.equal(first.complete,false);
 const other=retailAttendanceTrend({stores,attendance:[
 {retail_store_id:'s1',attendance_date:'2026-10-01',class:'HK',credit:1},
 {retail_store_id:'s1',attendance_date:'2026-10-01',class:'MEPC',credit:1}],aop:[],cutoff:'2026-10-01'})[0];
 assert.equal(other.overall_pct,null);
 assert.equal(other.total_target,null);
});
test('trend cannot include attendance rows from unauthorized stores',()=>{
 const onlyTn=retailAttendanceTrend({stores,
 attendance:[{retail_store_id:'s1',attendance_date:'2026-10-01',class:'HK',credit:2},
  {retail_store_id:'s1',attendance_date:'2026-10-01',class:'MEPC',credit:1}],
 aop,cutoff:'2026-10-01'});
 assert.equal(onlyTn[0].overall_pct,100);
});
