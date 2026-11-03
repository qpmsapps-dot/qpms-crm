import test from 'node:test';
import assert from 'node:assert/strict';
import {excelCleaningRows,excelOperationsRows,excelTrainingRows,excelOosRows,isExcelSource} from '../src/utils/retailExcelInline.js';

const rows=[
 {id:1,module:'deep_cleaning',reporting_state:'TN',retail_store_id:'a',store_code:'TN1',source_row:3,
  match_status:'MATCHED',status:'Completed',record_date:'2026-10-12',
  data:{store_name:'T Nagar',scheduled_date:'2026-10-15',completed_date:'2026-10-12',cleaning_status:'Completed'}},
 {id:2,module:'deep_cleaning',reporting_state:'AP-1',retail_store_id:null,store_code:'S969',source_row:4,
  match_status:'NOT_IN_MASTER',status:'Pending',record_date:'2026-10-22',data:{store_name:'Unmatched',scheduled_date:'2026-10-22',cleaning_status:'PENDING'}},
 {id:3,module:'deep_cleaning',reporting_state:'TN',retail_store_id:'a',store_code:'TN1',source_row:5,
  status:'Cancelled By SM',record_date:'2026-10-18',data:{cleaning_status:'Cancelled By SM',scheduled_date:'2026-10-18'}},
 {id:4,module:'deep_cleaning',reporting_state:'TN',retail_store_id:'a',store_code:'TN1',source_row:6,
  status:'Completed',record_date:'2026-11-14',data:{cleaning_status:'Completed',scheduled_date:'2026-11-15',completed_date:'2026-11-14'}},
];
test('Excel cleaning schedules share the main table and are never treated as verified FO work',()=>{
 const result=excelCleaningRows(rows,{from:'2026-10-01',to:'2026-10-31'});
 assert.equal(result.schedules.length,3);
 assert.equal(result.submissions.length,1);
 assert.equal(result.submissions[0].deep_cleaning_date,'2026-10-12');
 assert.equal(result.submissions[0].before_count,null);
 assert.equal(result.submissions[0].after_count,null);
 assert.deepEqual(result.schedules[0].submission_ids,[]);
 assert.equal(result.schedules[0].overdue,false);
 assert.equal(isExcelSource(result.submissions[0]),true);
 assert.equal(result.schedules[1].store.id,null,'unmatched Store Code must not be mapped to an invented store');
 assert.equal(result.schedules[1].display_status,'Scheduled');
 assert.equal(result.schedules[2].display_status,'Cancelled');
 assert.equal(excelCleaningRows(rows,{from:'2026-10-01',to:'2026-10-31',store:'a'}).schedules.length,2);
 assert.equal(excelCleaningRows(rows,{from:'2026-11-01',to:'2026-11-30'}).schedules.length,1);
});
test('CM/PM source rows retain one record per input row without creating a call log',()=>{
 const source=[{id:10,reporting_state:'TN',store_code:'TN1',retail_store_id:'a',status:'COMPLETED / Pending',
 data:{cm_status:'COMPLETED',pm_status:'Pending',store_name:'Store 1'}},
 {id:11,reporting_state:'TN',store_code:'TN1',retail_store_id:'a',status:'COMPLETED / Completed',
 data:{cm_status:'COMPLETED',pm_status:'Completed',store_name:'Store 1'}}];
 const cm=excelOperationsRows(source,'CM'),pm=excelOperationsRows(source,'PM');
 assert.equal(cm.length,2,'repeated calls must not be deduplicated');
 assert.equal(cm.filter(r=>r.completed).length,2);
 assert.equal(pm.filter(r=>r.completed).length,1);
 assert.equal(cm[0].call_count,null);
 assert.deepEqual(cm[0].call_logs,[]);
 assert.equal(excelOperationsRows(source,'CM',{state:'KL'}).length,0);
});
test('Training source preserves employee identity instead of fabricating a trainer or evidence',()=>{
 const src=[{id:20,reporting_state:'TN',store_code:null,retail_store_id:null,record_date:'2026-10-10',
 data:{training_date:'2026-10-10',employee_name:'Employee A',employee_code:'EMP1',topics:'Safety'},status:'Completed'}];
 const [row]=excelTrainingRows(src,'MEPC');
 assert.equal(row.training_class,'MEPC');
 assert.equal(row.trainer_name,null);
 assert.equal(row.source_data.employee_name,'Employee A');
 assert.equal(row.evidence_count,null);
 assert.equal(row.ownership.known,false);
 assert.equal(excelTrainingRows(src,'MEPC',{from:'2026-11-01',to:'2026-11-30'}).length,0);
});
test('OOS source rows are strictly historical, never executable financial stages',()=>{
 const [row]=excelOosRows([{id:30,reporting_state:'AP-2',store_code:'U784',retail_store_id:'a',source_row:2,
 status:'Done',match_status:'MATCHED',data:{quotation_no:'QPMSAPXXXX',po_number:'PO1'}}]);
 assert.equal(row.status,'EXCEL_REPORTED');
 assert.equal(row.source_kind,'IFMS_EXCEL');
 assert.equal(row.details.po_number,'PO1');
 assert.match(row.details.evidence_status,/NOT a live quotation/);
 assert.equal(row.rework_count,0);
});
