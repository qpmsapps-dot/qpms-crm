import test from 'node:test';
import assert from 'node:assert/strict';
import {ownedEndDayKmStatus} from '../services/foOwnedEndDayKmService.js';
const id='cb8c582e-76b4-423d-99f8-0b38ef6305c4', receipt='00000000-0000-4000-8000-000000000001';
const profile={employee_code:'QPMSTNC16951',is_active:true,status:'Active',role:'FO'};
const pending={id,employee_code:profile.employee_code,attendance_date:'2026-10-26',logout_time:'2026-10-26T14:35:59Z',status:'Completed',updated_at:'2026-10-26T14:39Z',total_approved_km:0,eligible_km:0,petrol_amount:0,route_sync_status:'pending_canonical_end_day_recalculation',metadata:{canonical_recalculation_pending:true}};
function db(rows,credits=[]) {
 let reads=0;const calls=[];
 const client={from(name){assert.equal(name,'fo_attendance');const q={select(){return q;},eq(k,v){assert.equal(k,'id');assert.equal(v,id);return q;},async maybeSingle(){return {data:rows[Math.min(reads++,rows.length-1)]};}};return q;},async rpc(name){calls.push(name);assert.equal(name,'rpc_fo_km_reconciliation_state_v1');return {data:{credits}};}};
 return {client,calls};
}
test('owned End Day acknowledges existing work under shutdown without any job or financial RPC',async()=>{
 const {client,calls}=db([pending]);const r=await ownedEndDayKmStatus(client,profile,{attendance_id:id},{KM_FINANCIAL_WRITES_EMERGENCY_PAUSE:'true'});
 assert.equal(r.status,'pending');assert.equal(r.updated,false);assert.equal(r.financial_posted,false);assert.equal(r.financial_paused,true);assert.equal(r.retry_after_seconds,120);assert.deepEqual(calls,[]);assert.equal(r.total_approved_km,undefined);
});
test('cross-attendance, Admin correction and previews stay on existing authorization paths',async()=>{
 for(const payload of [{attendance_id:id,approval_reason:'Correction'},{attendance_id:id,dry_run:true},{attendance_id:id,manual_refresh:true},{attendance_id:'invalid'}])assert.equal(await ownedEndDayKmStatus(db([pending]).client,profile,payload),null);
 assert.equal(await ownedEndDayKmStatus(db([pending]).client,{...profile,employee_code:'OTHER'},{attendance_id:id}),null);
});
test('reopened attendance cannot acknowledge a canceled End Day',async()=>{
 await assert.rejects(ownedEndDayKmStatus(db([{...pending,logout_time:null,status:'Active'}]).client,profile,{attendance_id:id}),e=>e.statusCode===409);
});
const saved={...pending,total_approved_km:11.42,eligible_km:11.42,petrol_amount:45.68,route_sync_status:'canonical_v2_incremental_persisted',metadata:{...pending.metadata,shared_km_last_receipt:receipt,km_recalculation_status:'partial'}};
const credit={id:receipt,attendance_id:id,applied_to_attendance:true,input_digest:'a'.repeat(64),created_at:'2026-10-26T15:00Z'};
test('only saved partial eligible totals with a real post-closure receipt are confirmed',async()=>{
 const r=await ownedEndDayKmStatus(db([saved],[credit]).client,profile,{attendance_id:id});
 assert.equal(r.status,'persisted');assert.equal(r.total_approved_km,11.42);assert.equal(r.petrol_amount,45.68);assert.equal(r.receipt_id,receipt);
});
test('stale receipts, settled-only credits and malformed saved money never confirm completion',async()=>{
 for(const c of [{...credit,created_at:'2026-10-26T12:00Z'},{...credit,applied_to_attendance:false},{...credit,input_digest:'bad'}])assert.equal((await ownedEndDayKmStatus(db([saved],[c]).client,profile,{attendance_id:id})).status,'pending');
 assert.equal((await ownedEndDayKmStatus(db([{...saved,petrol_amount:null}],[credit]).client,profile,{attendance_id:id})).status,'pending');
});
test('reopening or evidence changes between reads invalidates confirmation',async()=>{
 await assert.rejects(ownedEndDayKmStatus(db([saved,{...saved,logout_time:null}],[credit]).client,profile,{attendance_id:id}),e=>e.statusCode===409);
 assert.equal((await ownedEndDayKmStatus(db([saved,{...saved,updated_at:'later'}],[credit]).client,profile,{attendance_id:id})).status,'pending');
});
test('unpaused delayed work remains pending, and verified canonical zero may complete',async()=>{
 const r=await ownedEndDayKmStatus(db([pending]).client,profile,{attendance_id:id},{KM_FINANCIAL_WRITES_EMERGENCY_PAUSE:'false',END_DAY_KM_AUTO_RECALC_ENABLED:'true'});
 assert.equal(r.status,'pending');assert.equal(r.retry_after_seconds,30);
 const zero={...pending,route_sync_status:'canonical_v2_persisted',metadata:{canonical_recalculation_pending:false,km_calculation_run_id:receipt,km_input_digest:'b'.repeat(64)}};
 assert.equal((await ownedEndDayKmStatus(db([zero]).client,profile,{attendance_id:id})).status,'persisted');
});
