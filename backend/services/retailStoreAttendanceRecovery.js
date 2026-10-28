import XLSX from 'xlsx';
import { storeImportAdmin } from './retailStoreImportService.js';
import { attendanceError, previewRetailAttendance, commitRetailAttendance, retailAttendanceHistory } from './retailAttendanceService.js';

async function result(query){const {data,error}=await query;if(error)throw error;return data;}
// Rebuild only previously unmatched source rows for identities created by the exact
// approved Store Master batch. Existing employee-days require separate correction review.
export async function previewStoreAttendanceRecovery(client,profile,input){
 storeImportAdmin(profile);
 const master=await result(client.from('retail_store_import_batches').select('id,status,receipt').eq('id',input.store_batch_id).single());
 const original=await retailAttendanceHistory(client,profile,{id:input.attendance_batch_id});
 const kind=await result(client.from('retail_attendance_uploads').select('kind').eq('id',input.attendance_batch_id).single());
 if(master.status!=='committed'||kind.kind!=='attendance'||original.status!=='committed')throw attendanceError(409,'Committed Store Master additions and an original attendance import are required.');
 const codes=new Set((master.receipt?.stores||[]).map(s=>s.after.store_code));
 const rejected=new Set((original.raw_source?.rejected||[]).filter(r=>r.reasons?.includes('Unknown Reliance Retail Store Code')&&codes.has(r.store_code)).map(r=>r.source_row));
 const rows=(original.raw_source?.rows||[]).filter(r=>rejected.has(r.source_row));
 if(!rows.length)throw attendanceError(409,'No previously unmatched rows belong to this approved Store Master batch.');
 const headers=original.raw_source.headers;
 if(!Array.isArray(headers)||headers.length>98)throw attendanceError(409,'Original source layout needs manual review.');
 const book=XLSX.utils.book_new();
 const grid=[...headers,'Original attendance batch','Original source row','Approved Store Master batch'];
 XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([grid,...rows.map(r=>[...Array.from({length:headers.length},(_,i)=>r.raw_cells[i]??''),original.id,r.source_row,master.id])]),'Recovery review');
 const bytes=XLSX.write(book,{type:'buffer',bookType:'xlsx'});
 const preview=await previewRetailAttendance(client,profile,bytes,'store-matched-attendance-recovery.xlsx');
 const hasConflicts=(preview.affected_records||[]).length>0;
 return {...preview,recovery_source:{attendance_batch_id:original.id,store_batch_id:master.id,original_checksum:original.checksum},can_commit:preview.can_commit&&!hasConflicts,
  recovery_blocked:hasConflicts?'Existing employee-days require a separate correction review. Recovery does not replace attendance.':null};
}
export async function confirmStoreAttendanceRecovery(client,profile,input,environment=process.env){
 storeImportAdmin(profile);
 if(environment.RETAIL_STORE_ATTENDANCE_REPROCESS_ENABLED!=='true')throw attendanceError(409,'Attendance recovery awaits separate preview approval.');
 const b=await result(client.from('retail_attendance_uploads').select('filename,expected_ids').eq('id',input.id).single());
 if(b.filename!=='store-matched-attendance-recovery.xlsx'||b.expected_ids?.length)throw attendanceError(409,'Recovery cannot replace existing employee-days.');
 return commitRetailAttendance(client,profile,{id:input.id,preview_key:input.preview_key,replace:false,reason:''});
}
