import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateCurrentDayEvidenceKm,readOnlyKmClient,summarizeCalculatedEvidence} from '../services/foCurrentDayCalculatedKmService.js';
import {buildOperationsCalculatedKm} from '../services/operationsSummaryService.js';
const day='2026-10-26';
const attendance={id:'test',attendance_date:day,total_approved_km:0,petrol_amount:0,updated_at:'now'};
const leg={status:'calculated',payable:true,payable_km:12.34,source:'GPS_BASED'};
test('positive evidence is separate from unchanged zero saved money; active is supported',async()=>{
 const r=await calculateCurrentDayEvidenceKm({},[attendance],day,{useCache:false,load:async()=>({attendance,rows:[]}),calculate:async(db,id,o)=>{
 assert.equal(o.evidenceOnly,true);assert.equal(o.sharedRecovery,true);assert.equal(o.maxGoogleDirectionsCalls,0);assert.equal(o.enableGoogleDirections,false);assert.equal(o.auditDelayedCheckout,false);
 return {travel_legs:[leg,{status:'unresolved',source:'UNRESOLVED'}]};
 }});
 assert.equal(r.calculated_km,12.34);assert.equal(r.status,'partial');assert.equal(r.saved_payable_km,0);assert.equal(r.saved_petrol_amount,0);assert.equal(r.financial_posted,false);assert.equal(r.results[0].active,true);
});
test('insufficient, excluded and failed evidence never claims calculated zero',async()=>{
 assert.equal(summarizeCalculatedEvidence({travel_legs:[]}).status,'pending');
 assert.equal(summarizeCalculatedEvidence({travel_legs:[{...leg,payable:false}]}).calculated_km,null);
 const r=await calculateCurrentDayEvidenceKm({},[attendance],day,{useCache:false,load:async()=>{throw Error('Timeout');}});
 assert.equal(r.status,'unresolved');assert.equal(r.calculated_km,null);
});
test('read boundary rejects mutations and every RPC before execution',()=>{
 const db=readOnlyKmClient({from:()=>({select(){return this;},update(){throw Error('executed');}})});
 assert.throws(()=>db.from('x').select('*').update({}),/cannot mutate/);
 assert.throws(()=>db.rpc('anything'),/cannot invoke RPC/);
});
test('cache coalesces viewers; historical dates cannot use current-day calculator',async()=>{
 let calls=0;
 const options={load:async()=>{calls++;return {attendance,rows:[]};},calculate:async()=>({travel_legs:[leg]})};
 await Promise.all([calculateCurrentDayEvidenceKm({},[attendance],day,options),calculateCurrentDayEvidenceKm({},[attendance],day,options)]);
 assert.equal(calls,1);
 await assert.rejects(calculateCurrentDayEvidenceKm({},[{...attendance,attendance_date:'2026-10-13'}],day),/historical/);
});
test('unknown saved financial fields remain unknown',async()=>{
 const r=await calculateCurrentDayEvidenceKm({},[{...attendance,total_approved_km:null,petrol_amount:null}],day,{useCache:false,load:async()=>({attendance,rows:[]}),calculate:async()=>({travel_legs:[leg]})});
 assert.equal(r.saved_payable_km,null);assert.equal(r.saved_petrol_amount,null);
});
test('calculations never exceed three concurrent evidence loads',async()=>{
 let active=0,maximum=0;
 await Promise.all(Array.from({length:9},(_,i)=>calculateCurrentDayEvidenceKm({},[{...attendance,id:'limit'+i}],day,{useCache:false,
 load:async()=>{active++;maximum=Math.max(maximum,active);await new Promise(r=>setTimeout(r,5));active--;return {attendance,rows:[]};},calculate:async()=>({travel_legs:[leg]})})));
 assert.equal(maximum,3);
});
test('no permission or historical requests fail before evidence access',async()=>{
 const db={from(){throw Error('Must not access DB');}};
 await assert.rejects(buildOperationsCalculatedKm(db,{role:'FO'},{date:day,calculated_employee_code:'FO123'},day),e=>e.statusCode===403);
 await assert.rejects(buildOperationsCalculatedKm(db,{role:'Admin',status:'active',is_active:true},{date:'2026-10-13',calculated_employee_code:'FO123'},day),e=>e.statusCode===400);
});
