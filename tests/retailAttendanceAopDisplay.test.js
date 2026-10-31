import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeAttendance} from '../backend/shared/retailAttendance.js';
import {attendanceAopCoverage,attendanceAopValue,attendanceExportRows,attendanceColumns} from '../src/utils/retailAttendanceExport.js';

function report() {
  return summarizeAttendance({stores:[
    {id:'known',store_code:'KNOWN',state:'PY'},
    {id:'zero',store_code:'ZERO',state:'TN'},
    {id:'missing',store_code:'MISSING',state:'TN'},
  ],attendance:[],aop:[
    {retail_store_id:'known',hk_count:1.25,mepc_count:0.55,effective_from:'2026-07-01',effective_to:null},
    {retail_store_id:'zero',hk_count:0,mepc_count:0,effective_from:'2026-07-01',effective_to:null},
  ],cutoff:'2026-10-31',view:'daily'});
}
test('configured AOP subtotal preserves decimals and explicit zeros without inventing missing targets',()=>{
  const r=report();
  assert.deepEqual(attendanceAopCoverage(r),{stores:3,configured:2,missing:1,hk_aop:1.25,mepc_aop:0.55,total_aop:1.8});
  assert.equal(attendanceAopValue(r,r.total,'hk_aop'),1.25);
  assert.equal(attendanceAopValue(r,r.states[0],'mepc_aop'),0.55);
  assert.equal(attendanceAopValue(r,r.stores[1],'hk_aop'),0);
  assert.equal(attendanceAopValue(r,r.stores[2],'hk_aop'),null);
  assert.equal(r.total.overall_pct,null);
  assert.equal(attendanceAopCoverage(r,'AP-1').configured,0);
});
test('exports retain configured subtotals, missing store N/A and incomplete target N/A',()=>{
  const r=report(),columns=attendanceColumns.map(([key])=>key),stateRows=attendanceExportRows(r),storeRows=attendanceExportRows(r,'stores');
  assert.equal(stateRows[1][columns.indexOf('hk_aop')],1.25);
  assert.equal(stateRows[1][columns.indexOf('hk_target')],'N/A');
  assert.equal(stateRows[1][columns.indexOf('overall_pct')],'N/A');
  const missing=storeRows.find(row=>row[0]==='MISSING');
  assert.equal(missing[3+columns.indexOf('hk_aop')],'N/A');
});
test('AOP coverage is evaluated at the selected cutoff and stays unavailable before approval',()=>{
  const r=report();
  r.stores[0].missing_aop.push('2026-10-01');
  assert.equal(attendanceAopCoverage(r).configured,2,'An earlier missing date does not hide configured cutoff AOP');
  r.cutoff='2026-06-30';
  r.stores.forEach(store=>store.missing_aop.push(r.cutoff));
  assert.equal(attendanceAopCoverage(r).configured,0);
  assert.equal(attendanceAopValue(r,r.total,'hk_aop'),null);
});
test('configured subtotal normalizes floating-point noise while retaining fractional AOP',()=>{
  const r=report();
  r.stores.push({store_code:'FRACTION',state:'TN',hk_aop:0.1234,mepc_aop:0.0012,missing_aop:[]});
  assert.equal(attendanceAopCoverage(r).hk_aop,1.3734);
  assert.equal(attendanceAopCoverage(r).mepc_aop,0.5512);
  assert.equal(attendanceAopCoverage(r).total_aop,1.9246);
});
