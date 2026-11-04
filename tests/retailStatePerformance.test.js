import test from 'node:test';
import assert from 'node:assert/strict';
import {retailPercent,retailReportState,summarizeCleaningSchedules,summarizeReportedOperations,
 summarizeTrainingByClass,summarizeStateRows} from '../src/utils/retailStatePerformance.js';
import {excelCleaningRows,excelOperationsRows} from '../src/utils/retailExcelInline.js';

test('state percentage is completed divided by scheduled, not a fixed or guessed value',()=>{
 assert.equal(retailPercent(16,20),80);
 assert.equal(retailPercent(0,0),null);
 assert.equal(retailPercent(44,44),100);
 assert.equal(retailPercent(24,286),8.4);
});
test('six state reporting consolidates KA/KN and PY/TN, never combines AP divisions',()=>{
 const result=summarizeStateRows([
  {state:'KA'},{state:'KN'},{state:'PY'},{state:'AP-1'},{state:'AP-2'}
 ],()=>({scheduled:1,completed:1}));
 assert.equal(result.rows.length,6);
 assert.equal(retailReportState('KA'),'KN');
 assert.equal(retailReportState('PY'),'TN');
 assert.equal(result.rows.find(r=>r.state==='KN').scheduled,2);
 assert.equal(result.rows.find(r=>r.state==='TN').scheduled,1);
 assert.equal(result.rows.find(r=>r.state==='AP-1').scheduled,1);
 assert.equal(result.rows.find(r=>r.state==='AP-2').scheduled,1);
});
test('Deep Cleaning shows 20 schedules / 16 completed = 80% with cancelled included in denominator',()=>{
 const items=Array.from({length:20},(_,i)=>({
  reporting_state:'KA',display_status:i<16?'Completed':i===19?'Cancelled':'Scheduled',
  source_kind:'IFMS_EXCEL'
 }));
 const result=summarizeCleaningSchedules(items);
 const kn=result.rows.find(r=>r.state==='KN');
 assert.equal(kn.scheduled,20);assert.equal(kn.completed,16);
 assert.equal(kn.pending,3);assert.equal(kn.other,1);assert.equal(kn.percentage,80);
 assert.equal(kn.verified,0,'Excel source is never FO verified');
});
test('activity KPIs count repeated calls as source rows, never invent live call logs',()=>{
 const source=Array.from({length:3},(_,i)=>({id:i,status:i?'Pending':'COMPLETED',reporting_state:'TN',
  data:{cm_status:i?'Pending':'COMPLETED',store_name:'Same Store'},store_code:'T001'}));
 const rows=excelOperationsRows(source,'CM');
 const sum=summarizeReportedOperations(rows);
 assert.equal(sum.total.scheduled,3);
 assert.equal(sum.total.completed,1);
 assert.equal(sum.total.entries,3);
 assert.equal(sum.total.verified,0);
});
test('Training provides separate HK and MEPC totals and does not turn Excel into FO evidence',()=>{
 const s=summarizeTrainingByClass([
  {state:'TN',training_class:'HK',status:'Completed',source_kind:'IFMS_EXCEL'},
  {state:'TN',training_class:'HK',status:'Pending',source_kind:'IFMS_EXCEL'},
  {state:'TN',training_class:'MEPC',status:'Completed',source_kind:'IFMS_EXCEL'}]);
 const tn=s.rows.find(r=>r.state==='TN');
 assert.equal(tn.hk_total,2);assert.equal(tn.hk_completed,1);
 assert.equal(tn.mepc_total,1);assert.equal(tn.mepc_completed,1);
 assert.equal(tn.percentage,66.7);assert.equal(tn.verified,0);
});
test('Karnataka October Excel records match KN filter and remain scoped by store',()=>{
 const source=[{id:1,reporting_state:'KA',store_code:'KA01',retail_store_id:'store-1',
  status:'Completed',record_date:'2026-10-05',data:{scheduled_date:'2026-10-05',
   completed_date:'2026-10-05',cleaning_status:'Completed'}}];
 assert.equal(excelCleaningRows(source,{from:'2026-10-01',to:'2026-10-31',state:'KN'}).schedules.length,1);
 assert.equal(excelCleaningRows(source,{from:'2026-10-01',to:'2026-10-31',state:'KL'}).schedules.length,0);
 assert.equal(excelOperationsRows(source,'CM',{state:'KN',store:'store-1'}).length,1);
});

test('Excel Completed without completion date stays in detail, but date remains unknown',()=>{
 const row={id:'x',source_row:51,reporting_state:'TN',store_code:'T001',
  record_date:'2026-10-15',status:'Completed',data:{scheduled_date:'2026-10-15',cleaning_status:'Completed'}};
 const source=excelCleaningRows([row],{from:'2026-10-01',to:'2026-10-31'});
 assert.equal(source.schedules.length,1);
 assert.equal(source.submissions.length,1);
 assert.equal(source.submissions[0].deep_cleaning_date,null);
 assert.equal(source.submissions[0].source_kind,'IFMS_EXCEL');
});
