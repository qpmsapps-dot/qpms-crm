import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {savedFoPayableKm,savedFoPetrolAmount} from '../src/utils/savedFoFinancials.js';
test('saved zero wins over GPS, visits, stale route and eligible evidence',()=>{
 const a={total_approved_km:0,eligible_km:58.27,total_route_km:51.08,raw_gps_km:58.2,petrol_amount:0};
 assert.equal(savedFoPayableKm(a),0);assert.equal(savedFoPetrolAmount(a),0);
});
test('genuinely saved partial KM and petrol survive pending metadata',()=>{
 const a={total_approved_km:11.42,eligible_km:11.42,petrol_amount:45.68,metadata:{canonical_recalculation_pending:true}};
 assert.equal(savedFoPayableKm(a),11.42);assert.equal(savedFoPetrolAmount(a),45.68);
});
test('historical stored values retained; missing money never estimated from rate',()=>{
 assert.equal(savedFoPayableKm({eligible_km:26.43}),26.43);assert.equal(savedFoPetrolAmount({eligible_km:26.43,rate_per_km:4}),null);
});
test('Train remains non-payable; receipt-backed mixed Bike segments remain saved',()=>{
 const a={total_approved_km:6.25,petrol_amount:25,payable_km_allowed:false,travel_mode:'train'};
 assert.equal(savedFoPayableKm(a),0);
 assert.equal(savedFoPayableKm({...a,route_sync_status:'canonical_v2_incremental_persisted',metadata:{shared_km_last_receipt:'00000000-0000-4000-8000-000000000001'}}),6.25);
});
test('existing dashboard pending helper and directory resolver execute with saved precedence',()=>{
 const source=fs.readFileSync(new URL('../src/pages/FOActivities.jsx',import.meta.url),'utf8');
 const extract=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
 const pending=Function('savedFoPetrolAmount','attendanceMetadata',extract('function isCanonicalPetrolPending(', 'function officerPetrolDisplay(')+'; return isCanonicalPetrolPending;')(savedFoPetrolAmount,a=>a?.metadata || {});
 const resolver=Function('savedFoPayableKm','logPayableKmSource',extract('function payableRouteKmForOfficer(', 'function reviewFlagsForOfficer(')+'; return payableRouteKmForOfficer;')(savedFoPayableKm,()=>{});
 for(const amount of [0,45.68])assert.equal(pending({petrol_amount:amount,metadata:{canonical_recalculation_pending:true}}),false);
 assert.equal(resolver({attendance:{total_approved_km:0},live:{route_km_today:58.2},visits:[{route_km:51.08}]}).km,0);
 assert.equal(resolver({attendance:{total_approved_km:11.42,eligible_km:99,total_route_km:100}}).km,11.42);
});
