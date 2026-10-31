import test from 'node:test';
import assert from 'node:assert/strict';
import {retailAttendanceReport} from '../services/retailAttendanceService.js';
import {indiaToday} from '../shared/retailAttendance.js';

const admin={id:'admin',role:'Admin',status:'Active',is_active:true};
const stores=Array.from({length:851},(_,i)=>({id:`store-${i}`,store_code:`CODE${i}`,store_name:`Store ${i}`,state:i===850?'KA':'TN',status:'Active'}));
function fixture({empty=false}={}) {
  const batches=[],rpcCalls=[];
  const client={
    from(table) {
      if(table==='reliance_retail_store_master')return {
        select(){return this;},order(){return this;},
        async range(from,to){return {data:stores.slice(from,to+1)};},
      };
      assert.equal(table,'retail_employee_daily_attendance');
      let ids;
      return {
        select(){return this;},
        in(column,values){assert.equal(column,'retail_store_id');assert.ok(values.length>0&&values.length<=100);ids=values;batches.push(values);return this;},
        is(column,value){assert.equal(column,'superseded_at');assert.equal(value,null);return this;},
        order(column,options){assert.equal(column,'attendance_date');assert.equal(options.ascending,false);return this;},
        async limit(n){assert.equal(n,1);return {data:empty?[]:[{attendance_date:ids.includes('store-850')?'2026-10-30':'2026-10-29'}]};},
      };
    },
    async rpc(name,args){assert.equal(name,'rpc_retail_attendance_report_source');rpcCalls.push(args);return {data:{attendance:[],aop:[],latest_date:null}};},
  };
  return {client,batches,rpcCalls};
}
test('default Attendance cutoff batches all 851 stores and uses the latest date across every batch',async()=>{
  const f=fixture(),report=await retailAttendanceReport(f.client,admin);
  assert.equal(report.cutoff,'2026-10-30');
  assert.equal(f.batches.length,9);
  assert.deepEqual(f.batches.flat(),stores.map(s=>s.id));
  assert.equal(f.rpcCalls[0].p_store_ids.length,851);
});
test('default cutoff excludes stores outside the selected state',async()=>{
  const f=fixture(),report=await retailAttendanceReport(f.client,admin,{state:'TN'});
  assert.equal(report.cutoff,'2026-10-29');
  assert.equal(f.batches.flat().length,850);
  assert.equal(f.batches.flat().includes('store-850'),false);
  assert.equal(f.rpcCalls[0].p_store_ids.includes('store-850'),false);
});
test('explicit cutoff skips latest-date discovery and an empty result preserves the existing fallback',async()=>{
  const explicit=fixture();
  await retailAttendanceReport(explicit.client,admin,{cutoff:'2026-10-31'});
  assert.equal(explicit.batches.length,0);
  const empty=fixture({empty:true}),report=await retailAttendanceReport(empty.client,admin);
  assert.equal(report.cutoff,indiaToday(new Date(Date.now()-86400000)));
});
