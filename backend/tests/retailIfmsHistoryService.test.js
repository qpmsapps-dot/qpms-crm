import test from 'node:test';
import assert from 'node:assert/strict';
import {retailIfmsHistoryRows,IFMS_HISTORY_MODULES} from '../services/retailIfmsHistoryService.js';
const actor={id:'admin',role:'Admin',is_active:true,status:'Active'};
const fixture=[
 {id:1,module:'cmpm',source_row:3,store_code:'T100',reporting_state:'TN',snapshot_month:'2026-10-01',status:'Completed',match_status:'MATCHED',data:{cm_status:'Completed'}},
 {id:2,module:'cmpm',source_row:4,store_code:'K200',reporting_state:'KA',snapshot_month:'2026-10-01',status:'Pending',match_status:'NOT_IN_MASTER',data:{cm_status:'Pending'}},
 {id:3,module:'deep_cleaning',source_row:3,store_code:'T100',reporting_state:'TN',snapshot_month:'2026-10-01',status:'Completed',match_status:'MATCHED',data:{}}
];
function client(){
 let queryCount=0;
 return {get queryCount(){return queryCount;},from(table){
  queryCount++;assert.equal(table,'retail_ifms_source_rows');
  let rows=fixture.slice();
  const q={
   select(){return q;},
   eq(key,value){rows=rows.filter(row=>row[key]===value);return q;},
   ilike(key,value){const term=value.replaceAll('%','').toUpperCase();rows=rows.filter(row=>String(row[key]||'').toUpperCase().includes(term));return q;},
   order(key){rows.sort((a,b)=>a[key]>b[key]?1:-1);return q;},
   range(start,end){return Promise.resolve({data:rows.slice(start,end+1),count:rows.length,error:null});}
  };return q;
 }};
}
test('every operational module has explicit historical source identity',()=>{
 assert.deepEqual(IFMS_HISTORY_MODULES,['cmpm','thermography','deep_cleaning','technical_training','soft_skill_training','shortage','manpower_vacancy','oos_historical']);
});
test('administrator can page, filter exact reporting state and store identity',async()=>{
 const db=client();
 const report=await retailIfmsHistoryRows(db,actor,{module:'cmpm',month:'2026-10',state:'KN',match_status:'NOT_IN_MASTER',q:'K200',limit:25,page:1});
 assert.equal(report.total,1);assert.equal(report.rows[0].store_code,'K200');
 assert.equal(report.source,'EXCEL_REPORTED_HISTORICAL_UNVERIFIED');assert.equal(db.queryCount,1);
 const other=await retailIfmsHistoryRows(db,actor,{module:'deep_cleaning'});assert.equal(other.total,1);
});
test('month outside source scope returns no rows instead of misrepresenting October activity',async()=>{
 const db=client();
 const result=await retailIfmsHistoryRows(db,actor,{module:'cmpm',month:'2026-11'});
 assert.equal(result.total,0);assert.equal(db.queryCount,0);
});
test('no source access for FO, Retail MIS, inactive account, unknown module, or invalid filters',async()=>{
 const db=client();
 for(const profile of [
  {id:'fo',role:'FO',business:'Reliance Retail',is_active:true},
  {id:'mis',role:'HK MIS',business:'Reliance Retail',is_active:true},
  {...actor,is_active:false}
 ])await assert.rejects(retailIfmsHistoryRows(db,profile,{module:'cmpm'}),e=>e.statusCode===403);
 for(const input of [{module:'oos12'},{module:'cmpm',state:'AP'},{module:'cmpm',month:'2026'},{module:'cmpm',match_status:'PENDING'}])
  await assert.rejects(retailIfmsHistoryRows(db,actor,input),e=>e.statusCode===400);
 assert.equal(db.queryCount,0,'Authorization and parameter checks happen before data queries');
});
test('missing source table does not return a misleading zero count',async()=>{
 const db={from:()=>({select:()=>({eq(){return this},order(){return this},range:async()=>({error:{code:'42P01'}})})})};
 await assert.rejects(retailIfmsHistoryRows(db,actor,{module:'cmpm'}),e=>e.statusCode===503);
});

test('large October inline tables use capped admin history pages without bypassing authorization',async()=>{
 const db=client();
 const first=await retailIfmsHistoryRows(db,actor,{module:'cmpm',limit:500});
 assert.equal(first.limit,500);
 assert.equal(first.total,2);
 const capped=await retailIfmsHistoryRows(db,actor,{module:'cmpm',limit:10000});
 assert.equal(capped.limit,500);
});
