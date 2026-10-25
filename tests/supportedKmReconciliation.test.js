import test from 'node:test';
import assert from 'node:assert/strict';
import { runSupportedKmPeriod } from '../src/utils/supportedKmReconciliation.js';
test('selected-period posting uses explicit employee/dates, shows real added KM and partial failures', async () => {
  const bodies = [], progress = [];
  const result = await runSupportedKmPeriod({ employee:'FO1', dates:['2026-10-16','2026-10-17'], endpoint:'/reconcile-supported', onProgress:m=>progress.push(m), request:async(url,init)=>{
    bodies.push(JSON.parse(init.body));
    if(bodies.length===2)throw Error('GPS query timed out');
    return {ok:true,json:async()=>({results:[{date:'2026-10-16',status:'posted',financial_posted:true,existingPayableKm:68.31,additionalKm:40,finalPayableKm:108.31,additionalAmount:160}]})};
  }});
  assert.equal(result.ok,false);assert.match(result.message,/108.31/);assert.match(result.message,/timed out/);assert.equal(progress.length,2);
  assert.deepEqual(bodies[0],{employee_code:'FO1',from_date:'2026-10-16',to_date:'2026-10-16'});
});
test('financial pause is never displayed as successful posting or a journey-entry form',async()=>{
  const r=await runSupportedKmPeriod({employee:'FO1',dates:['2026-10-16'],endpoint:'/reconcile-supported',request:async()=>({ok:true,json:async()=>({results:[{date:'2026-10-16',status:'deferred',financial_posted:false,message:'KM financial writes are paused.'}]})})});
  assert.equal(r.ok,false);assert.match(r.message,/paused/);assert.doesNotMatch(r.message,/Recalculation completed/);
});
