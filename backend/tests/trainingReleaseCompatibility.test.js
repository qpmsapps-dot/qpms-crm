import test from 'node:test';
import assert from 'node:assert/strict';
import { assertTrainingActor, loadTrainingCreateContext } from '../services/trainingAccessService.js';
import {loadTrainingRetailStore,searchTrainingRetailStores,listTrainingZones} from '../services/trainingService.js';

const fo = { id: 'local-profile', employee_code: 'LOCAL-FO', role: 'FO', business: 'Reliance Retail', state: 'KA', is_active: true, status: 'Active' };
function client(overrides = {}) {
  const tables = {
    fo_attendance: [{ id: 'attendance', employee_code: fo.employee_code, status: 'Active', logout_time: null }],
    fo_site_visits: [{ id: 'visit', attendance_id: 'attendance', employee_code: fo.employee_code, check_in_time: '2026-10-24T04:00:00Z', check_out_time: null }],
    reliance_retail_store_master: [{ id: 'retail', state: 'KA', status: 'Active', zone_id: null, metadata: { operational_model: 'SUPERVISOR_ONLY' } }],
    ...overrides,
  };
  return { from(table) { let rows = tables[table] || []; const q = { select() { return q; }, eq(key, value) { rows = rows.filter(r => r[key] === value); return q; }, async maybeSingle() { return { data: rows[0] || null, error: null }; } }; return q; } };
}
test('existing Training mutations remain FO-only; reporting roles gain no mutation authority', () => {
  assert.equal(assertTrainingActor(fo, { mutation: true }), fo);
  for (const role of ['Admin', 'Operations Manager', 'Management', 'MIS']) assert.throws(() => assertTrainingActor({ ...fo, role }, { mutation: true }), { code: 'forbidden_role' });
});
test('current checked-in FO attendance/visit context passes; foreign and closed visits fail', async () => {
  const input = { attendance_id: 'attendance', site_visit_id: 'visit' };
  const result = await loadTrainingCreateContext(client(), fo, input);
  assert.equal(result.attendance.id, 'attendance'); assert.equal(result.visit.id, 'visit');
  for (const change of [{ employee_code: 'OTHER' }, { check_out_time: '2026-10-24T05:00:00Z' }, { check_in_time: null }]) {
    const visit = { ...result.visit, ...change };
    await assert.rejects(loadTrainingCreateContext(client({ fo_site_visits: [visit] }), fo, input), { code: change.employee_code ? 'site_visit_forbidden' : 'site_visit_not_active' });
  }
});
test('authoritative Retail store gate denies other state, business and unsupported supervisor category', async () => {
  assert.equal((await loadTrainingRetailStore(client(), fo, 'retail', 'technical_mep')).id, 'retail');
  await assert.rejects(loadTrainingRetailStore(client(), { ...fo, state: 'TN' }, 'retail', 'technical_mep'), { code: 'store_scope_forbidden' });
  await assert.rejects(loadTrainingRetailStore(client(), { ...fo, business: 'Other' }, 'retail', 'technical_mep'), { code: 'store_scope_forbidden' });
  await assert.rejects(loadTrainingRetailStore(client(), fo, 'retail', 'housekeeping'), { code: 'store_scope_forbidden' });
});

function scopedClient(overrides={}) {
 const tables={
  reliance_retail_store_master:[
   {id:'ka-zone',store_code:'KA01',store_name:'Bengaluru Retail',state:'KA',status:'Active',zone_id:'zone-ka',metadata:{}},
   {id:'ka-no-zone',store_code:'KA02',store_name:'Mysuru Retail',state:'KA',status:'Active',zone_id:null,metadata:{}},
   {id:'ka-supervisor',store_code:'KA03',store_name:'KA Supervisor',state:'KA',status:'Active',zone_id:null,metadata:{operational_model:'SUPERVISOR_ONLY'}},
   {id:'tn-zone',store_code:'TN01',store_name:'Chennai Retail',state:'TN',status:'Active',zone_id:'zone-tn',metadata:{}},
   {id:'tn-other',store_code:'TN02',store_name:'Other TN zone',state:'TN',status:'Active',zone_id:'zone-other',metadata:{}}
  ],
  reliance_retail_zones:[
   {id:'zone-tn',zone_name:'Chennai',zone_code:'TN1',state:'TN',status:'Active'},
   {id:'zone-other',zone_name:'Other',zone_code:'TN2',state:'TN',status:'Active'}
  ],
  reliance_retail_zone_fo_assignments:[
   {zone_id:'zone-tn',fo_profile_id:'tn-fo',effective_from:'2025-01-01T00:00:00Z',effective_to:null}
  ],...overrides
 };
 return {from(table){
  let values=[...(tables[table]||[])],range=[0,9999];
  const q={
   select(){return q;},
   eq(k,v){values=values.filter(row=>row[k]===v);return q;},
   in(k,a){values=values.filter(row=>a.includes(row[k]));return q;},
   lte(k,v){values=values.filter(row=>String(row[k])<=String(v));return q;},
   is(k,v){values=values.filter(row=>row[k]===v);return q;},
   or(v){
    if(String(v).startsWith('effective_to.is.null,effective_to.gt.')){
      const date=String(v).split('effective_to.gt.')[1];
      values=values.filter(row=>row.effective_to==null||String(row.effective_to)>date);
    }
    return q;
   },
   order(){return q;},
   range(from,to){range=[from,to];return q;},
   maybeSingle(){return Promise.resolve({data:values[0]||null,error:null});},
   then(resolve,reject){return Promise.resolve({data:values.slice(range[0],range[1]+1),error:null}).then(resolve,reject);}
  };
  return q;
 }};
}
test('KA Training searches all own-state stores without zone assignment; supervisor-only remains Technical',async()=>{
 const db=scopedClient(),profile={...fo,state:'KA'};
 const zones=await listTrainingZones(db,profile);
 assert.equal(zones[0].id,'STATE_WIDE');
 const found=await searchTrainingRetailStores(db,profile,{zone_id:'STATE_WIDE',limit:25});
 assert.deepEqual(found.stores.map(x=>x.store_code),['KA01','KA02','KA03']);
 assert.equal((await loadTrainingRetailStore(db,profile,'ka-no-zone','hk')).id,'ka-no-zone');
 await assert.rejects(loadTrainingRetailStore(db,profile,'ka-supervisor','hk'),{code:'store_scope_forbidden'});
 assert.equal((await loadTrainingRetailStore(db,profile,'ka-supervisor','technical_mep')).id,'ka-supervisor');
 await assert.rejects(loadTrainingRetailStore(db,profile,'tn-zone','hk'),{code:'store_scope_forbidden'});
});
test('TN Training exposes only active assigned zones and rejects another zone',async()=>{
 const db=scopedClient(),profile={...fo,id:'tn-fo',state:'TN'};
 assert.deepEqual((await listTrainingZones(db,profile)).map(z=>z.zone_code),['TN1']);
 const eligible=await searchTrainingRetailStores(db,profile,{zone_id:'zone-tn'});
 assert.deepEqual(eligible.stores.map(x=>x.store_code),['TN01']);
 await assert.rejects(searchTrainingRetailStores(db,profile,{zone_id:'zone-other'}),{code:'store_scope_forbidden'});
 await assert.rejects(loadTrainingRetailStore(db,profile,'tn-other','hk'),{code:'store_scope_forbidden'});
 assert.equal((await loadTrainingRetailStore(db,profile,'tn-zone','hk')).id,'tn-zone');
});
test('expired TN zone assignment does not authorize Training',async()=>{
 const db=scopedClient({reliance_retail_zone_fo_assignments:[{zone_id:'zone-tn',fo_profile_id:'tn-fo',effective_from:'2025-01-01T00:00:00Z',effective_to:'2026-01-01T00:00:00Z'}]});
 const profile={...fo,id:'tn-fo',state:'TN'};
 assert.deepEqual(await listTrainingZones(db,profile),[]);
 await assert.rejects(loadTrainingRetailStore(db,profile,'tn-zone','hk'),{code:'store_scope_forbidden'});
});
