import test from 'node:test';
import assert from 'node:assert/strict';
import {buildIncrementalKmPlan,reconcileSupportedKm} from '../services/foKmIncrementalReconciliationService.js';
const start='2026-10-26T06:14:07.068960+00:00',end='2026-10-26T06:15:22.827016+00:00';
const evidence={attendance:{id:'a',total_approved_km:0,petrol_amount:0},visits:[],recoveries:[],corrections:[],originalRows:[],snapshots:[{id:'saved',started_at:start,ended_at:end,status:'completed',payable_km:0}]};
const leg={type:'site_checkout_to_next_checkin',persisted_travel_leg_id:'saved',from_time:start,to_time:end,status:'calculated',payable:true,payable_km:0.1,rate_per_km:4,travel_mode:'bike'};
test('microsecond truncation cannot bind a reconstructed window to a different saved leg',()=>{
 const r=buildIncrementalKmPlan(evidence,{travel_legs:[{...leg,from_time:'2026-10-26T06:14:07.068Z'}]},[]);
 assert.equal(r.additionalKm,0);assert.equal(r.legs[0].evidence_status,'recorded_leg_window_requires_review');
});
test('one invalid reopened window cannot discard an independent matching supported window',()=>{
 const r=buildIncrementalKmPlan(evidence,{travel_legs:[leg,{...leg,type:'other',from_time:'2026-10-26T06:14:58.229242Z'}]},[]);
 assert.equal(r.additionalKm,0.1);assert.equal(r.additionalAmount,0.4);assert.equal(r.unresolved.length,1);
});
test('equivalent timezone representations preserve the exact recorded window',()=>{
 const r=buildIncrementalKmPlan(evidence,{travel_legs:[{...leg,from_time:'2026-10-26T11:44:07.068960+05:30'}]},[]);
 assert.equal(r.additionalKm,0.1);
});
test('reopened or canceled work stops before calculator and financial persistence',async()=>{
 for(const attendance of [{id:'a',logout_time:null,status:'Active'},{id:'a',logout_time:end,status:'Canceled'}]) {
  const calls=[];
  const client={from(){throw Error('Calculator must not access evidence');},async rpc(name){calls.push(name);assert.equal(name,'rpc_fo_km_reconciliation_state_v1');return {data:{credits:[],digest:'state'}};}};
  const r=await reconcileSupportedKm(client,{attendance_id:'a'},{evidence:{attendance},persist:true,trigger:'manual_end_day',actorSource:'lease',environment:{KM_SHARED_RECONCILIATION_ENABLED:'true',KM_INCREMENTAL_REPORTING_ENABLED:'true'}});
  assert.equal(r.code,'KM_COMPLETED_ATTENDANCE_REQUIRED');assert.equal(r.financial_posted,false);assert.deepEqual(calls,['rpc_fo_km_reconciliation_state_v1']);
 }
});
