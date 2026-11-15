import {trainingReport} from '../../backend/shared/retailTrainingReport.js';
import {filterTrainingRows} from './trainingView.js';

export const EXPORT_LIMITS = {sessions:500, evidence:2000, photos:80, photoBytes:5*1024*1024, totalPhotoBytes:40*1024*1024};
export const notRecorded = value => value === null || value === undefined || value === '' ? 'Not recorded' : value;
export function indiaMonth(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit'}).formatToParts(now);
  return `${parts.find(p=>p.type==='year').value}-${parts.find(p=>p.type==='month').value}`;
}
export function trainingMonthRange(month) {
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw Error('Select a valid export month.');
  const [year,m] = month.split('-').map(Number);
  if(year<2000||year>2100) throw Error('Select an export month between 2000 and 2100.');
  return {from:month+'-01',to:month+'-'+new Date(Date.UTC(year,m,0)).getUTCDate()};
}
export function filteredTrainingExportRows(sessions,snapshot,filter={},query='') {
  if((filter.zone||filter.fo||filter.store)&&!snapshot) throw Error('Authorized Store / historical Zone/FO ownership is unavailable. Retry before exporting these filters.');
  return filterTrainingRows(trainingReport(sessions,snapshot),filter,query);
}
export async function loadMonthlyTrainingExport({request,loadSnapshot,month,filter,query}) {
  const range=trainingMonthRange(month);
  const [report,master]=await Promise.allSettled([
    request({url:'/api/reliance-retail/module-reports/training',params:range}),loadSnapshot(range)
  ]);
  if(report.status!=='fulfilled') throw report.reason;
  if(report.value.data?.report?.complete!==true||!Array.isArray(report.value.data.report.rows)) throw Error('The server did not confirm a complete Training report. Export cancelled.');
  const snapshot=master.status==='fulfilled'?master.value:null;
  return {rows:filteredTrainingExportRows(report.value.data.report.rows,snapshot,filter,query),snapshot,range};
}
function normalizeSession(detail,row,snapshot) {
  const session=detail.session;
  if(!session?.id||session.id!==row.id||!['hk','technical_mep'].includes(detail.category?.code)) throw Error('Training session identity or class could not be verified.');
  if(row.training_date&&session.training_date!==row.training_date) throw Error('Training date changed after the report loaded. Refresh before exporting.');
  if(!['submitted','completed'].includes(session.status)) throw Error('Only persisted submitted Training sessions can be exported. Refresh the dashboard.');
  const attendees=Array.isArray(detail.attendees)?detail.attendees:null;
  const evidence=Array.isArray(detail.evidence)?detail.evidence:null;
  const topics=Array.isArray(detail.topics)?detail.topics:null;
  if(!evidence||!topics) throw Error('Training detail response is incomplete. Export cancelled.');
  // An empty optional attendee register does not prove zero people attended.
  const attendeeCount=Number.isInteger(session.attendee_count)&&session.attendee_count>=0?session.attendee_count:attendees?.length?attendees.length:null;
  return {id:session.id,date:session.training_date,trainingClass:detail.category.code==='hk'?'HK':'MEPC',
    storeCode:detail.store?.store_code||session.store_code_snapshot,storeName:detail.store?.store_name||session.store_name_snapshot,
    state:detail.store?.state||session.state_snapshot,
    zone:snapshot?.zones?.find(z=>z.id===row.ownership?.zone_id)?.zone_name,
    zoneId:row.ownership?.zone_id,foId:row.ownership?.fo_profile_id,
    trainer:session.trainer_name_snapshot,trainerCode:session.trainer_employee_code_snapshot||snapshot?.fos?.find(fo=>fo.id===session.trainer_profile_id)?.employee_code,
    status:session.status,submittedAt:session.submitted_at,attendeeCount,attendees:attendees||[],topics,
    evidence:evidence.map(e=>({id:e.id,topicId:e.training_session_topic_id,type:e.evidence_type,fileName:e.file_name,mime:e.mime_type,size:e.file_size,access:'Not requested',reference:`/api/training/sessions/${encodeURIComponent(session.id)}/evidence/${encodeURIComponent(e.id)}/view-url`}))};
}
export async function collectTrainingExport({rows,snapshot,request,photos=false,readPhoto=readTrainingPhoto,onProgress=()=>{}}) {
  const unique=[...new Map(rows.filter(r=>r.source_kind!=='IFMS_EXCEL').map(r=>[r.id,r])).values()];
  if(unique.length>EXPORT_LIMITS.sessions) throw Error(`More than ${EXPORT_LIMITS.sessions} sessions selected. Narrow the month or filters; no records were exported.`);
  const result={sessions:[],historical:rows.filter(r=>r.source_kind==='IFMS_EXCEL'),warnings:[]};
  let evidenceCount=0,photoCount=0,photoBytes=0;
  for(const [index,row] of unique.entries()) {
    onProgress(`Loading session ${index+1} of ${unique.length}`);
    // Session authorization failures abort the export rather than silently omit sessions.
    const response=await request({url:`/api/training/sessions/${encodeURIComponent(row.id)}`});
    const session=normalizeSession(response.data,row,snapshot);
    evidenceCount+=session.evidence.length;
    if(evidenceCount>EXPORT_LIMITS.evidence) throw Error('Too many evidence references. Narrow the selection; no export was downloaded.');
    for(const evidence of session.evidence) {
      try {
        const response=await request({url:evidence.reference});
        const url=response.data?.view?.url;
        if(!url||new URL(url).protocol!=='https:') throw Error('unavailable');
        evidence.access='Authorized at export; reopen through dashboard';
        if(photos&&['image/jpeg','image/png'].includes(evidence.mime)) {
          if(photoCount>=EXPORT_LIMITS.photos||photoBytes>=EXPORT_LIMITS.totalPhotoBytes) throw Error('photo export size limit reached');
          if(Number(evidence.size)>EXPORT_LIMITS.photoBytes) throw Error('photo exceeds 5 MB export limit');
          const image=await readPhoto(url,Math.min(EXPORT_LIMITS.photoBytes,EXPORT_LIMITS.totalPhotoBytes-photoBytes));
          if(!(image.width>0&&image.height>0)) throw Error('Photo dimensions unavailable');
          evidence.image=image.data;evidence.imageWidth=image.width;evidence.imageHeight=image.height;photoBytes+=image.bytes; photoCount++;
        }
      } catch(error) {
        const code=error.response?.status;
        const limitMessages=['photo export size limit reached','photo exceeds 5 MB export limit','Photo exceeds export limit.','Photo dimensions unavailable','Photo dimensions are invalid or exceed the export limit.'];
        const reason=limitMessages.includes(error.message)?error.message:'photo download failed';
        evidence.access=code===401||code===403?'Authorization denied or pending':evidence.access.startsWith('Authorized')?'Authorized; '+reason:'Evidence authorization unavailable';
        result.warnings.push(`${session.id} / ${evidence.id}: ${evidence.access}.`);
      }
    }
    if(photos&&!session.evidence.some(e=>e.image)) result.warnings.push(`${session.id}: No authorized photographs could be included.`);
    result.sessions.push(session);
  }
  if(!unique.length) result.warnings.push('No submitted Training sessions match this selection.');
  if(result.historical.length) result.warnings.push(`${result.historical.length} historical Excel rows are listed separately; they are not verified Training sessions and have no verified evidence.`);
  return result;
}
export async function readTrainingPhoto(url,maxBytes) {
  const response=await fetch(url,{credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(30000)});
  if(!response.ok||!['image/jpeg','image/png'].includes(response.headers.get('content-type')?.split(';')[0])) throw Error('Photo download unavailable.');
  if(Number(response.headers.get('content-length'))>maxBytes) {await response.body?.cancel();throw Error('Photo exceeds export limit.');}
  const reader=response.body?.getReader();
  if(!reader) throw Error('Photo streaming is unavailable in this browser.');
  let size=0;const chunks=[];
  try {while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes)throw Error('Photo exceeds export limit.');chunks.push(value);}}
  finally {await reader.cancel();}
  const blob=new Blob(chunks,{type:response.headers.get('content-type')});
  const dimensions=trainingPhotoDimensions(new Uint8Array(await blob.arrayBuffer()));
  const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('Photo could not be read.'));reader.readAsDataURL(blob);});
  return {data,bytes:size,...dimensions};
}
// Inspect only bounded file headers; avoid decoding full-resolution photos on the UI thread.
export function trainingPhotoDimensions(bytes) {
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let width,height;
  if(bytes.length>=24&&bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71) {
    width=view.getUint32(16);height=view.getUint32(20);
  }else if(bytes[0]===255&&bytes[1]===216){
    let offset=2;
    while(offset+8<bytes.length){
      if(bytes[offset++]!==255)break;
      while(bytes[offset]===255)offset++;
      const marker=bytes[offset++];
      if(marker===217||marker===218)break;
      const length=view.getUint16(offset);
      if(length<2||offset+length>bytes.length)break;
      if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) {height=view.getUint16(offset+3);width=view.getUint16(offset+5);break;}
      offset+=length;
    }
  }
  if(!width||!height||width*height>40000000)throw Error('Photo dimensions are invalid or exceed the export limit.');
  return {width,height};
}
export function trainingExportFilename({format,month,session,from,to}) {
  const scope=session?`${session.trainingClass}_${session.storeCode||'store'}_${session.date}_${session.id}`:month||`${from}_to_${to}_filtered`;
  return `myQPMS_Training_${scope}`.replace(/[^a-zA-Z0-9_-]/g,'_')+'.'+format;
}
