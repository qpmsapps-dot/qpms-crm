// Historical Excel reference records are displayed beside live records but
// are never transformed into verified FO submissions or financial events.
export const isExcelSource = row => row?.source_kind==='IFMS_EXCEL';
const norm = value => String(value??'').trim().toLowerCase();
export const excelState = row => row.reporting_state;
export function excelCleaningStatus(row){
 const s=norm(row?.data?.cleaning_status||row?.status);
 if(s==='completed')return 'Completed';
 if(s==='pending'||s==='scheduled')return 'Scheduled';
 if(s.includes('cancel'))return 'Cancelled';
 if(s==='store closed')return 'Not Completed';
 return 'Unknown';
}
export function excelCleaningRows(rows,filters={}){
 const {from='2026-10-01',to='2026-10-31',state='',store='',query=''}=filters;
 const matches = val=>!query||[val.store_code,val.store_name,val.display_status,val.status,val.not_done_reason].join(' ').toLowerCase().includes(query.toLowerCase());
 const schedules=[],submissions=[];
 for(const row of rows){
  const d=row.data||{},day=d.scheduled_date||row.record_date||row.snapshot_date||'';
  const actual=d.completed_date||null,sourceDate=row.record_date||day;
  if(![day,actual,sourceDate].some(date=>date&&date>=from&&date<=to))continue;
  if(state&&row.reporting_state!==state)continue;
  if(store&&row.retail_store_id!==store)continue;
  const code=row.store_code||d.store_code||'Unrecorded', name=d.store_name||'Store name unavailable';
  const base={
   id:'ifms-excel-'+row.id,source_kind:'IFMS_EXCEL',source_row:row.source_row,
   store:{id:row.retail_store_id||null,store_code:code,store_name:name,state:row.reporting_state},
   reporting_state:row.reporting_state,match_status:row.match_status,
   scheduled_date:day,display_status:excelCleaningStatus(row),
   status:row.status,not_done_reason:'Excel-reported only · FO evidence not verified',
   overdue:false,submission_ids:[],source_data:d
  };
  if(matches({...base,store_code:code,store_name:name}))schedules.push(base);
  if(excelCleaningStatus(row)==='Completed'&&actual&&actual>=from&&actual<=to){
   const work={...base,deep_cleaning_date:actual,status:'Completed (Excel reported)',
    before_count:null,after_count:null};
   if(matches({...work,store_code:code,store_name:name}))submissions.push(work);
  }
 }
 return {schedules,submissions};
}
export function excelOperationsRows(rows,kind,filters={}){
 const {state='',store='',query=''}=filters;
 return rows.filter(row=>(!state||row.reporting_state===state)&&(!store||row.retail_store_id===store))
 .map(row=>{
  const d=row.data||{},raw=kind==='CM'?d.cm_status:kind==='PM'?d.pm_status:d.report_submission_status||row.status;
  const completed=['completed','submitted'].includes(norm(raw));
  return {
   id:'ifms-excel-'+row.id,source_kind:'IFMS_EXCEL',source_row:row.source_row,
   store_code:row.store_code||'Not recorded',store_name:d.store_name||'Not recorded',
   reporting_state:row.reporting_state,match_status:row.match_status,
   status:raw||'Not recorded',completed,
   call_count:null,completed_on:null,call_logs:[],
   store:{id:row.retail_store_id||null,store_code:row.store_code||'Not recorded',store_name:d.store_name||'Not recorded',can_save:false},
   scheduled_date:d.scheduled_date||row.record_date||'—',
   approved_on:null,approval_due_on:null,approval_overdue:false,approved_late:false,
   source_data:d
  };
 }).filter(row=>!query||[row.store_code,row.store_name,row.status,row.reporting_state].join(' ').toLowerCase().includes(query.toLowerCase()));
}
export function excelTrainingRows(rows,trainingClass,filters={}){
 const {from='2026-10-01',to='2026-10-31',state='',store='',query=''}=filters;
 return rows.filter(row=>{
  const day=row.data?.training_date||row.record_date||'';
  return day>=from&&day<=to&&(!state||row.reporting_state===state)&&
   (!store||row.retail_store_id===store)&&
   (!query||[row.store_code,row.data?.employee_code,row.data?.employee_name,row.data?.topics].join(' ').toLowerCase().includes(query.toLowerCase()));
 }).map(row=>({
  id:'ifms-excel-'+row.id,source_kind:'IFMS_EXCEL',
  training_date:row.data?.training_date||row.record_date,training_class:trainingClass,
  state:row.reporting_state,store:{id:row.retail_store_id||null,store_code:row.store_code,store_name:row.data?.store_name||null},
  canonical_store_id:row.retail_store_id,trainer_name:null,
  employee_code:row.data?.employee_code,topics_text:row.data?.topics,
  status:row.status||row.data?.training_status||'Not recorded',
  attendee_count:null,topic_count:null,evidence_count:null,
  ownership:{known:false,zone_id:null,fo_profile_id:null},
  source_data:row.data||{},match_status:row.match_status
 }));
}
