import XLSX from 'xlsx';
import { storeImportAdmin } from './retailStoreImportService.js';
import { ATTENDANCE_COLUMNS, attendanceError, previewRetailAttendance, commitRetailAttendance, retailAttendanceHistory, validateAttendanceRows } from './retailAttendanceService.js';

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

/**
 * Read-only candidate discovery for historical imports made before Store Master
 * activation. This does not create a preview batch or write attendance.
 * The returned source rows are bounded; callers must page until has_more=false.
 */
async function canonicalRecoveryAnalysis(client,profile,input){
 storeImportAdmin(profile);
 if(typeof input?.attendance_batch_id!=='string'||!input.attendance_batch_id.trim())throw attendanceError(400,'Original attendance batch is required.');
 const original=await retailAttendanceHistory(client,profile,{id:input.attendance_batch_id});
 if(original.kind!=='attendance'||original.status!=='committed')throw attendanceError(409,'Committed original attendance import required.');
 const source=original.raw_source;
 if(!Array.isArray(source?.rows)||!Array.isArray(source?.rejected))
   throw attendanceError(409,'Retained attendance audit is incomplete.');
 if(!original.checksum||!Array.isArray(source.headers)||!source.headers.length)throw attendanceError(409,'Original checksum and headers required.');
 const ids=new Set();
 for(const row of source.rows){
   if(!Number.isSafeInteger(row.source_row)||ids.has(row.source_row)||!Array.isArray(row.raw_cells))throw attendanceError(409,'Invalid or duplicate original source row evidence.');
   ids.add(row.source_row);
 }
 if(source.rejected.some(row=>!ids.has(row.source_row))||new Set(source.rejected.map(row=>row.source_row)).size!==source.rejected.length)throw attendanceError(409,'Ambiguous rejected source references.');
 const page=Number(input.page??0);
 if(!Number.isSafeInteger(page)||page<0||page>100000)
   throw attendanceError(400,'Invalid recovery audit page.');
 const limit=500;
 const storeRows=[];
 for(let offset=0;offset<100000;offset+=1000){
   const rows=await result(client.from('reliance_retail_store_master').select('store_code,id,state').order('id').range(offset,offset+999));
   storeRows.push(...rows);
   if(rows.length<1000)break;
   if(offset===99000)throw attendanceError(413,'Store Master exceeds recovery audit limit.');
 }
 const canonical=new Map();
 for(const store of storeRows){
   const code=String(store.store_code||'').trim().toUpperCase();
   if(code){
     if(canonical.has(code))throw attendanceError(409,'Ambiguous canonical Store Code.');
     canonical.set(code,store);
   }
 }
 const sourceById=new Map(source.rows.map(row=>[row.source_row,row]));
 for(const rejected of source.rejected){
   const row=sourceById.get(rejected.source_row);
   if(['store_code','employee_code','attendance_date','original_status'].some(key=>String(row[key]??'').trim().toUpperCase()!==String(rejected[key]??'').trim().toUpperCase()))throw attendanceError(409,'Rejected record does not match retained source evidence.');
 }
 const unknownRows=new Map(source.rejected
   .filter(r=>Array.isArray(r.reasons)&&r.reasons.length===1&&r.reasons[0]==='Unknown Reliance Retail Store Code')
   .map(r=>[r.source_row,r]));
 const candidates=source.rows.filter(r=>unknownRows.has(r.source_row));
 if(new Set(candidates.map(r=>r.source_row)).size!==candidates.length)
   throw attendanceError(409,'Duplicate original source row identifiers; manual review required.');
 const matched=candidates.reduce((n,r)=>n+(canonical.has(String(unknownRows.get(r.source_row).store_code||'').trim().toUpperCase())?1:0),0);
 // Validate across all pages, including already accepted source allocations.
 const validation=validateAttendanceRows(source.rows,storeRows);
 const invalid=new Map([...validation.rejected,...validation.excluded].map(row=>[row.source_row,row.reasons]));
 const validByRow=new Map(validation.valid.map(row=>[row.source_row,row]));
 const eligible=validation.valid.filter(row=>unknownRows.has(row.source_row));
 const conflicts=[];
 for(let offset=0;offset<eligible.length;offset+=500){
   for(let from=0;from<100000;from+=1000){
     const rows=await result(client.rpc('rpc_retail_attendance_conflicts',{p_rows:eligible.slice(offset,offset+500)}).range(from,from+999));
     conflicts.push(...rows);
     if(rows.length<1000)break;
     if(from===99000)throw attendanceError(413,'Employee-day conflicts exceed recovery audit limit.');
   }
 }
 const dayKey=row=>String(row.employee_code).trim().toUpperCase()+':'+row.attendance_date;
 const conflictDays=new Set(conflicts.map(dayKey));
 const states=new Map();
 for(const row of candidates){
   const code=String(unknownRows.get(row.source_row).store_code||'').trim().toUpperCase();
   const state=canonical.get(code)?.state||'UNMATCHED';
   const totals=states.get(state)||{state,source_rows:0,matched_rows:0,validation_rejected_rows:0,conflicting_rows:0,eligible_rows:0,eligible_credits:0};
   totals.source_rows++;
   if(canonical.has(code)){totals.matched_rows++;if(invalid.has(row.source_row))totals.validation_rejected_rows++;else if(conflictDays.has(dayKey(row)))totals.conflicting_rows++;else {totals.eligible_rows++;totals.eligible_credits+=validByRow.get(row.source_row)?.credit||0;}}
   states.set(state,totals);
 }
 const start=page*limit;
 const sample=candidates.slice(start,start+limit).map(row=>{
   const rejected=unknownRows.get(row.source_row);
   const code=String(rejected.store_code||'').trim().toUpperCase();
   const store=canonical.get(code);
   return {source_row:row.source_row,store_code:rejected.store_code,
     attendance_date:rejected.attendance_date,employee_code:rejected.employee_code,
     original_status:rejected.original_status,
     validation_reasons:invalid.get(row.source_row)||[],employee_day_conflict:conflictDays.has(dayKey(row)),
     result:store?'STORE_MATCHED_REQUIRES_ATTENDANCE_VALIDATION':'STORE_UNMATCHED',
     retail_store_id:store?.id||null,state:store?.state||null};
 });
 return {original,audit:{attendance_batch_id:original.id,source_checksum:original.checksum,
   state_totals:[...states.values()].sort((a,b)=>a.state.localeCompare(b.state)),
   total_source_rows:source.rows.length,total_rejected_rows:source.rejected.length,
   total_originally_unknown:candidates.length,matched_store_rows:matched,unmatched_store_rows:candidates.length-matched,page,page_size:limit,
   has_more:start+limit<candidates.length,rows:sample,
   note:'Read-only full-source attendance validation and existing employee-day conflict audit. Candidate totals do not imply AOP coverage or commit eligibility.'}};
}

/**
 * Preview a bounded page of historical unknown-code records now matched by the
 * canonical Store Master. No attendance is committed by this operation.
 * Any existing employee-day conflict makes the preview ineligible for recovery.
 */
let recoveryBusy=false;
async function recoveryReview(profile,run){
 storeImportAdmin(profile);
 if(recoveryBusy)throw attendanceError(409,'A recovery review is already running. Retry after it completes.');
 recoveryBusy=true;
 try{return await run();}finally{recoveryBusy=false;}
}
export async function auditCanonicalAttendanceRecovery(client,profile,input){
 return recoveryReview(profile,async()=>(await canonicalRecoveryAnalysis(client,profile,input)).audit);
}

async function canonicalRecoveryPreview(client,profile,input){
 storeImportAdmin(profile);
 const {audit,original}=await canonicalRecoveryAnalysis(client,profile,input);
 const headers=original.raw_source?.headers;
 if(!Array.isArray(headers)||headers.length===0||headers.length>98)
   throw attendanceError(409,'Original attendance headers require manual review.');
 const sourceRows=new Map(original.raw_source.rows.map(r=>[r.source_row,r]));
 const matched=audit.rows.filter(r=>r.result==='STORE_MATCHED_REQUIRES_ATTENDANCE_VALIDATION'&&!r.validation_reasons.length&&!r.employee_day_conflict);
 if(!matched.length)return {...audit,preview:null,can_commit:false};
 const workbook=XLSX.utils.book_new();
 const grid=[headers,...matched.map(r=>{
   const source=sourceRows.get(r.source_row);
   if(!Array.isArray(source?.raw_cells))throw attendanceError(409,'Original source row missing raw cell evidence.');
   // Reconstructed raw values have no Excel formatting or workbook date epoch.
   // Use retained normalized mandatory values to preserve identifiers and dates.
   return Array.from({length:headers.length},(_,i)=>{
     const field=Object.keys(ATTENDANCE_COLUMNS).find(key=>ATTENDANCE_COLUMNS[key]===String(headers[i]).trim());
     return field?source[field]:source.raw_cells[i]??'';
   });
 })];
 XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet(grid),'Recovery review');
 const bytes=XLSX.write(workbook,{type:'buffer',bookType:'xlsx'});
 const preview=await previewRetailAttendance(client,profile,bytes,'canonical-store-attendance-recovery-review.xlsx',{reviewOnly:true});
 const conflicts=(preview.affected_records||[]).length;
 return {...audit,preview,can_commit:false,
   blocked_reason:conflicts?'Existing employee-day conflicts require manual reconciliation.':'Review-only preview; canonical recovery commit is not enabled.',
   original_source_rows:matched.map(r=>r.source_row)};
}

export async function previewCanonicalAttendanceRecoveryPage(client,profile,input){
 return recoveryReview(profile,()=>canonicalRecoveryPreview(client,profile,input));
}
