import test from 'node:test';
import assert from 'node:assert/strict';
import {retailIfmsExcelModuleRows,assertIfmsExcelReader,IFMS_EXCEL_SOURCE_SHA} from '../services/retailIfmsExcelModuleService.js';

const ADMIN={id:'actor',role:'Admin',business:'Reliance Retail',is_active:true,status:'Active'};
function fixture(){
 const calls=[];const data=[
  {id:1,module:'cmpm',source_row:3,state:'TN',store_code:'S001',match_status:'MATCHED',data:{cm_status:'COMPLETED'}},
  {id:2,module:'cmpm',source_row:4,state:'TN',store_code:'S002',match_status:'STORE_NOT_FOUND',data:{cm_status:'PENDING'}},
  {id:3,module:'cmpm',source_row:5,state:'KL',store_code:'K003',match_status:'MATCHED',data:{cm_status:'COMPLETED'}}
 ];
 let rows=data;
 const client={from(table){
  calls.push(['table',table]);
  const q={select(_fields,params){calls.push(['select',params]);return q;},eq(key,value){calls.push(['eq',key,value]);rows=rows.filter(r=>r[key]===value||key==='snapshot_month'||key==='source_sha256');return q;},
   ilike(key,value){calls.push(['ilike',key,value]);const term=value.replaceAll('%','').toLowerCase();rows=rows.filter(r=>r.store_code.toLowerCase().includes(term));return q;},
   order(key){calls.push(['order',key]);rows.sort((a,b)=>a.source_row-b.source_row);return q;},
   range(a,b){calls.push(['range',a,b]);return Promise.resolve({data:rows.slice(a,b+1),count:rows.length,error:null});}};
  return q;
 }};
 return {client,calls};
}
test('Excel module endpoint rejects non-admin accounts before any database access',async()=>{
 const {client,calls}=fixture();
 for(const profile of [{id:'f',role:'FO',business:'Reliance Retail',is_active:true},
  {id:'m',role:'HK MIS',business:'Reliance Retail',is_active:true},
  {...ADMIN,is_active:false},
  {...ADMIN,status:'Inactive'}]){
  await assert.rejects(()=>retailIfmsExcelModuleRows(client,profile,{module:'cmpm'}),error=>error.statusCode===403);
 }
 assert.equal(calls.length,0);
});
test('Excel endpoint filters state, preserves unmatched rows and is read only',async()=>{
 const {client,calls}=fixture();
 const result=await retailIfmsExcelModuleRows(client,ADMIN,{module:'cmpm',state:'TN',month:'2026-10',page:'1',limit:'25'});
 assert.equal(result.total,2);
 assert.deepEqual(result.rows.map(x=>x.match_status),['MATCHED','STORE_NOT_FOUND']);
 assert.equal(result.source_type,'EXCEL_REPORTED_UNVERIFIED');
 assert.ok(calls.some(c=>c[0]==='eq'&&c[1]==='source_sha256'&&c[2]===IFMS_EXCEL_SOURCE_SHA));
 assert.ok(!calls.some(c=>['insert','update','delete'].includes(c[0])));
});
test('Excel endpoint validates module, state, month and avoids querying unimported months',async()=>{
 const {client,calls}=fixture();
 for(const input of [{module:'other'},{module:'cmpm',state:'AP'},{module:'cmpm',month:'today'},{module:'cmpm',search:'X'.repeat(101)}]){
  await assert.rejects(()=>retailIfmsExcelModuleRows(client,ADMIN,input),error=>error.statusCode===400);
 }
 const empty=await retailIfmsExcelModuleRows(client,ADMIN,{module:'cmpm',month:'2026-09'});
 assert.equal(empty.total,0);assert.deepEqual(empty.rows,[]);assert.equal(calls.length,0);
});
test('Excel source search and pagination cannot broaden source or authorized month',async()=>{
 const {client,calls}=fixture();
 const r=await retailIfmsExcelModuleRows(client,ADMIN,{module:'cmpm',state:'TN',search:'S002',page:1,limit:1});
 assert.equal(r.rows[0].store_code,'S002');
 assert.ok(calls.some(c=>c[0]==='ilike'&&c[1]==='search_text'));
 assert.ok(calls.some(c=>c[0]==='range'&&c[1]===0&&c[2]===0));
 assert.doesNotThrow(()=>assertIfmsExcelReader(ADMIN));
});
