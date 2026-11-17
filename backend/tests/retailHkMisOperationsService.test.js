import test from 'node:test';
import assert from 'node:assert/strict';
import { retailHkMisOperations,retailSouthHeadOperations } from '../services/retailHkMisOperationsService.js';
import { indiaToday } from '../shared/retailAttendance.js';

function mockClient(rows, queries) {
  return {from(table) {
    const q = {
      select(columns) { queries.push({table,columns}); return this; },
      eq() { return this; }, in() { return this; }, gte() { return this; },
      lt() { return this; }, order() { return this; },
      then(resolve,reject) { return Promise.resolve({data:rows[table]||[],error:null}).then(resolve,reject); },
    };
    return q;
  }};
}
test('HK MIS FO overview fails closed for unauthorized roles and empty state grants',async()=>{
  const calls=[], client=mockClient({},calls);
  await assert.rejects(()=>retailHkMisOperations(client,{role:'MIS_MEPC',states:['TN'],active:true}),/HK MIS/);
  await assert.rejects(()=>retailHkMisOperations(client,{role:'MIS_HK',states:[],active:true}),/No authorized state/);
  assert.equal(calls.length,0);
});

test('South Head operations reuse the nonfinancial reader only after effective Retail state grants',async()=>{
 const profile={id:'actor',auth_user_id:'auth',employee_code:'SYNTHETIC',role:'South Head',business:'Reliance Retail',
  is_active:true,status:'Active',web_access_enabled:true,_retailRoleStates:['TN','AP-1','AP-2']};
 const calls=[],client=mockClient({profiles:[]},calls);
 for(const denied of [{...profile,_retailRoleStates:[]},{...profile,business:'Hospital'},{...profile,role:'FO'},
  {...profile,_retailRoleStates:['AP']},{...profile,is_active:false}])
  await assert.rejects(()=>retailSouthHeadOperations(client,denied),e=>e.statusCode===403);
 assert.equal(calls.length,0);
 const result=await retailSouthHeadOperations(client,profile);
 assert.deepEqual(result.states,['TN','AP-1','AP-2']);assert.equal(result.read_only,true);
 await assert.rejects(()=>retailHkMisOperations(client,{role:'MIS_HK',states:['TN'],active:true},{state:'AP-1'}),e=>e.statusCode===403);
});
test('HK MIS returns only state-matched Reliance Retail FO attendance, site visits and live coordinates without finances',async()=>{
  const date=indiaToday(),calls=[];
  const profiles=[
    {employee_code:'RR-TN-01',role:'FO',business:'Reliance Retail',state:'TN',status:'Active',is_active:true,full_name:'Test FO'},
    {employee_code:'HOSP-01',role:'FO',business:'Hospitals',state:'TN',status:'Active',is_active:true,full_name:'Not Retail'},
    {employee_code:'RR-TG-01',role:'FO',business:'Reliance Retail',state:'TG',status:'Active',is_active:true,full_name:'Another State'},
  ];
  const client=mockClient({
    profiles,
    fo_attendance:[{employee_code:'RR-TN-01',attendance_date:date,login_time:date+'T09:30:00+05:30',logout_time:null,status:'started',petrol_amount:9999,eligible_km:400}],
    fo_live_status:[{fo_user_id:'RR-TN-01',latitude:13.01,longitude:80.12,last_seen_at:new Date().toISOString(),is_online:true,route_km_today:987,rate_per_km:8}],
    fo_site_visits:[
      {employee_code:'RR-TN-01',state:'TN',business:'Retail',site_name:'Reliance Store A',check_in_time:date+'T10:00:00+05:30',check_out_time:null,route_km:500},
      {employee_code:'RR-TN-01',state:'TG',business:'Retail',site_name:'Other State Store',check_in_time:date+'T11:00:00+05:30',check_out_time:null},
    ],
  },calls);
  const result=await retailHkMisOperations(client,{role:'MIS_HK',states:['TN'],active:true});
  assert.equal(result.officers.length,1);
  assert.equal(result.officers[0].name,'Test FO');
  assert.equal(result.officers[0].active_today,true);
  assert.equal(result.officers[0].visited_count,1);
  assert.equal(result.officers[0].visits[0].site_name,'Reliance Store A');
  assert.equal(result.officers[0].latitude,13.01);
  assert.ok(!/route_km|petrol|eligible_km|rate_per_km|amount|travel_mode/i.test(JSON.stringify(result)));
  assert.ok(calls.every(({columns})=>!/route_km|petrol|eligible_km|rate_per_km|amount|travel_mode/i.test(columns)));
});
