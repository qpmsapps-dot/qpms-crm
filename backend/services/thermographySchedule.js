import XLSX from 'xlsx';
import {createHash,randomUUID} from 'node:crypto';
import {writeFile,unlink} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Worker} from 'node:worker_threads';
import {validateThermoWorkbook} from './thermographyWorkbook.js';

export const SCHEDULE_MAX_BYTES=5_000_000;
let parsers=0;
export async function parseScheduleIsolated(bytes,filename,month){
 if(parsers>=2)throw Object.assign(Error('Schedule validation is busy. Retry shortly.'),{statusCode:429});
 parsers++;
 try{return await new Promise((resolve,reject)=>{
  let settled=false;
  const worker=new Worker(new URL('./thermographyScheduleWorker.js',import.meta.url),{workerData:{bytes,filename,month},env:{},resourceLimits:{maxOldGenerationSizeMb:128,maxYoungGenerationSizeMb:16,stackSizeMb:4}});
  const done=(error,rows)=>{if(settled)return;settled=true;clearTimeout(timer);void worker.terminate();if(error)reject(error);else resolve(rows);};
  const timer=setTimeout(()=>done(fail('Schedule parsing exceeded its 5-second safety limit. Use the two-column template.')),5000);
  worker.once('message',result=>result.error?done(fail(result.error)):done(null,result.rows));
  worker.once('error',()=>done(fail('Schedule parsing exceeded its isolated resource limit or failed.')));
  worker.once('exit',code=>{if(code!==0)done(fail('Schedule parsing stopped before validation completed.'));});
 });}finally{parsers--;}
}
const fail=message=>Object.assign(Error(message),{statusCode:400});
export function parseSchedule(bytes,filename,month){
 if(!/\.xlsx$/i.test(filename||'')||bytes.length>SCHEDULE_MAX_BYTES||!bytes.length)throw fail('Select an .xlsx schedule up to 5 MB.');
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month||''))throw fail('Select a valid schedule month.');
 let book;try{book=XLSX.read(bytes,{type:'buffer',cellDates:false,cellNF:true,cellText:true});}catch{throw fail('The schedule workbook could not be read.');}
 if(book.SheetNames.length!==1)throw fail('Use one schedule worksheet.');
 const sheet=book.Sheets[book.SheetNames[0]],range=XLSX.utils.decode_range(sheet['!ref']||'A1');
 if(range.e.r>5000||range.e.c!==1||range.s.r!==0||range.s.c!==0)throw fail('Use the two-column template with at most 5,000 rows.');
 if(sheet.A1?.v!=='Store Code'||sheet.B1?.v!=='Scheduled Date')throw fail('Required columns: Store Code | Scheduled Date.');
 const rows=[];
 for(let r=1;r<=range.e.r;r++){
  const a=sheet[XLSX.utils.encode_cell({r,c:0})],b=sheet[XLSX.utils.encode_cell({r,c:1})];
  if(!a&&!b)continue;
  let reason='',date='';
  const code=a?.t==='n'?XLSX.utils.format_cell(a):String(a?.v??'').trim();
  if(a?.f||b?.f)reason='Formulas are not accepted.';
  if(!code||code.length>80)reason='Store Code is required (text, up to 80 characters).';
  if(typeof b?.v==='number'){
   const d=XLSX.SSF.parse_date_code(b.v,{date1904:!!book.Workbook?.WBProps?.date1904});
   if(d&&!d.H&&!d.M&&!d.S)date=`${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
  }else{
   const m=/^(\d{2})-(\d{2})-(\d{4})$/.exec(String(b?.v??'').trim());if(m)date=`${m[3]}-${m[2]}-${m[1]}`;
  }
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)reason='Scheduled Date must be a valid DD-MM-YYYY Excel date.';
  else if(date.slice(0,7)!==month)reason='Scheduled Date is outside the selected month.';
  rows.push({row:r+1,store_code:code,scheduled_date:date||null,error:reason||null});
 }
 if(!rows.length)throw fail('The schedule contains no inspection rows.');
 const seen=new Set();for(const row of rows){const key=row.store_code.toUpperCase()+'|'+row.scheduled_date;if(seen.has(key))row.error='Duplicate Store Code / Scheduled Date in workbook.';seen.add(key);}
 return rows;
}
export async function scheduleRpc(client,profile,action,data={}){
 if(!profile?.id||profile.is_active!==true)throw Object.assign(Error('Active account required.'),{statusCode:403});
 const {data:result,error}=await client.rpc('rpc_retail_thermography_schedule',{p_actor:profile.id,p_action:action,p_data:data});
 if(error)throw Object.assign(Error(['42501','23505','40001','22023'].includes(error.code)?error.message:'Thermography schedule contract unavailable.'),{statusCode:({'42501':403,'23505':409,'40001':409,'22023':400})[error.code]||503});
 return result;
}
export async function scheduleUpload(client,profile,action,bytes,headers){
 const filename=decodeURIComponent(headers['x-schedule-filename']||''),month=headers['x-schedule-month'];
 const file=path.join(os.tmpdir(),`qpms-thermo-schedule-${randomUUID()}.xlsx`);
 try{await writeFile(file,bytes,{flag:'wx'});await validateThermoWorkbook(file,{maxBytes:SCHEDULE_MAX_BYTES});}finally{await unlink(file).catch(()=>{});}
 const rows=await parseScheduleIsolated(bytes,filename,month),sha256=createHash('sha256').update(bytes).digest('hex');
 return scheduleRpc(client,profile,action,{month,filename,sha256,rows,request_id:headers['x-request-id'],preview_digest:headers['x-preview-digest'],reason:headers['x-upload-reason']?decodeURIComponent(headers['x-upload-reason']):''});
}
