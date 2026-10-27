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
test('a later exact lifecycle snapshot retains its paid window key without double credit',()=>{
 const credit={leg_key:'original-key',started_at:start,ended_at:end,added_km:0.1,applied_to_attendance:true,evidence:{...leg,persisted_travel_leg_id:null}};
 const e={...evidence,attendance:{...evidence.attendance,total_approved_km:0.1,petrol_amount:0.4}};
 const r=buildIncrementalKmPlan(e,{travel_legs:[{...leg,mode_segment:true}]},[credit]);assert.equal(r.legs[0].leg_key,'original-key');assert.equal(r.additionalKm,0);
 const partial=buildIncrementalKmPlan(e,{travel_legs:[{...leg,mode_segment:true,from_time:'2026-10-26T06:14:10Z'}]},[credit]);assert.notEqual(partial.legs[0].leg_key,'original-key');assert.equal(partial.additionalKm,0);
});
test('reconstructed site arrivals and checkouts retain recorded microseconds without rebinding saved legs',()=>{
 const e={...evidence,snapshots:[],visits:[{id:'origin',check_out_time:start},{id:'destination',check_in_time:end}]};
 const reconstructed={...leg,persisted_travel_leg_id:null,from_visit_id:'origin',to_visit_id:'destination',from_time:new Date(start).toISOString(),to_time:new Date(end).toISOString()};
 const result=buildIncrementalKmPlan(e,{travel_legs:[reconstructed]});
 assert.equal(result.legs[0].from_time,start);assert.equal(result.legs[0].to_time,end);assert.equal(result.additionalKm,0.1);
 const saved=buildIncrementalKmPlan({...e,snapshots:evidence.snapshots},{travel_legs:[{...reconstructed,persisted_travel_leg_id:'saved'}]});
 assert.equal(saved.additionalKm,0);assert.equal(saved.legs[0].evidence_status,'recorded_leg_window_requires_review');
});
test('an exactly identified reconstructed GPS departure retains its own recorded precision',()=>{
 const e={...evidence,snapshots:[],originalRows:[{id:'fix',captured_at:start}]};
 const input={...leg,persisted_travel_leg_id:null,from_time:new Date(start).toISOString(),from_source:'corroborated_mobile_departure',source_row_ids:['fix']};
 const result=buildIncrementalKmPlan(e,{travel_legs:[input]});assert.equal(result.legs[0].from_time,start);
 const ambiguous=buildIncrementalKmPlan({...e,originalRows:[...e.originalRows,{id:'second',captured_at:start}]},{travel_legs:[{...input,source_row_ids:['fix','second']}]});
 assert.equal(ambiguous.legs[0].from_time,input.from_time);
});
test('reopened or canceled work stops before calculator and financial persistence',async()=>{
 for(const attendance of [{id:'a',logout_time:null,status:'Active'},{id:'a',logout_time:end,status:'Canceled'}]) {
  const calls=[];
  const client={from(){throw Error('Calculator must not access evidence');},async rpc(name){calls.push(name);assert.equal(name,'rpc_fo_km_reconciliation_state_v1');return {data:{credits:[],digest:'state'}};}};
  const r=await reconcileSupportedKm(client,{attendance_id:'a'},{evidence:{attendance},persist:true,trigger:'manual_end_day',actorSource:'lease',environment:{KM_SHARED_RECONCILIATION_ENABLED:'true',KM_INCREMENTAL_REPORTING_ENABLED:'true'}});
  assert.equal(r.code,'KM_COMPLETED_ATTENDANCE_REQUIRED');assert.equal(r.financial_posted,false);assert.deepEqual(calls,['rpc_fo_km_reconciliation_state_v1']);
 }
});

test('new attendance-bound legs preserve microseconds without changing KM or mutating calculation', () => {
  const login = '2026-10-26T05:36:59.524568+00:00', logout = '2026-10-26T16:34:36.854359+00:00';
  const newLeg = { ...leg, persisted_travel_leg_id: null, from_source: 'attendance_start', to_source: 'attendance_end_location', from_time: new Date(login).toISOString(), to_time: new Date(logout).toISOString(), payable_km: 4.39 };
  const result = buildIncrementalKmPlan({ ...evidence, snapshots: [], attendance: { ...evidence.attendance, login_time: login, logout_time: logout } }, { travel_legs: [newLeg] });
  assert.equal(result.legs[0].from_time, login);
  assert.equal(result.legs[0].to_time, logout);
  assert.equal(result.additionalKm, 4.39);
  assert.equal(result.additionalAmount, 17.56);
  assert.equal(newLeg.from_time, '2026-10-26T05:36:59.524Z');
});

test('attendance endpoints cannot rewrite a saved leg or a different reconstructed window', () => {
  const login = '2026-10-26T06:14:07.068960Z';
  const e = { ...evidence, attendance: { ...evidence.attendance, login_time: login } };
  const recorded = buildIncrementalKmPlan(e, { travel_legs: [{ ...leg, from_source: 'attendance_start', from_time: '2026-10-26T06:14:07.068Z' }] });
  assert.equal(recorded.additionalKm, 0);
  assert.equal(recorded.legs[0].evidence_status, 'recorded_leg_window_requires_review');
  const other = buildIncrementalKmPlan({ ...e, snapshots: [] }, { travel_legs: [{ ...leg, persisted_travel_leg_id: null, from_source: 'attendance_start', from_time: '2026-10-26T06:14:08.068Z' }] });
  assert.equal(other.legs[0].from_time, '2026-10-26T06:14:08.068Z');
});

test('all three saved journey types retain exact boundaries and reject truncated endpoints', () => {
  for (const type of ['start_to_first_checkin', 'site_checkout_to_next_checkin', 'last_checkout_to_end_day']) {
    const savedLeg = { ...leg, type, from_source: 'attendance_start', to_source: 'attendance_end_location' };
    const e = { ...evidence, attendance: { ...evidence.attendance, login_time: start, logout_time: end } };
    const exact = buildIncrementalKmPlan(e, { travel_legs: [savedLeg] });
    assert.equal(exact.additionalKm, 0.1, type);
    assert.equal(exact.legs[0].from_time, start);
    assert.equal(exact.legs[0].to_time, end);
    for (const endpoint of ['from_time', 'to_time']) {
      const truncated = buildIncrementalKmPlan(e, { travel_legs: [{ ...savedLeg, [endpoint]: new Date(savedLeg[endpoint]).toISOString() }] });
      assert.equal(truncated.additionalKm, 0, `${type}: ${endpoint}`);
      assert.equal(truncated.legs[0].evidence_status, 'recorded_leg_window_requires_review');
    }
  }
});
