import {cleaningView,recordedFoName,recordedFoCode} from './deepCleaningView.js';
import {EXPORT_LIMITS,indiaMonth,trainingMonthRange,readTrainingPhoto} from './trainingExport.js';

export {indiaMonth,trainingMonthRange};
const REPORT='/api/reliance-retail/module-reports/deep-cleaning';
const submitted=row=>['submitted','completed'].includes(String(row.status||'').toLowerCase());
export async function loadCleaningExport({request,month,from,to,filter={},row}) {
  const range=month?trainingMonthRange(month):{from,to};
  if(!/^\d{4}-\d{2}-\d{2}$/.test(range.from||'')||!/^\d{4}-\d{2}-\d{2}$/.test(range.to||'')||range.from>range.to)throw Error('Select a valid reporting date range.');
  const params={...range,state:filter.state||undefined,store:filter.store||undefined};
  const response=await request({url:REPORT,params});
  const report=response.data?.report;
  if(!report||report.from!==range.from||report.to!==range.to||!Array.isArray(report.submissions)||!Array.isArray(report.stores)||report.complete===false)throw Error('Authorized cleaning report is incomplete. Export cancelled.');
  const work=cleaningView(report,{schedules:[],submissions:[]},{status:filter.status,query:filter.query}).work;
  const rows=[...new Map(work.filter(r=>r.source_kind!=='IFMS_EXCEL'&&submitted(r)&&r.deep_cleaning_date>=range.from&&r.deep_cleaning_date<=range.to).map(r=>[r.id,r])).values()];
  if(rows.some(r=>!r.id||!r.store?.id||!r.store?.store_code||!report.stores.some(s=>s.id===r.store.id&&s.store_code===r.store.store_code)))throw Error('Persisted submission/store identity could not be verified.');
  const selected=row?rows.filter(r=>r.id===row.id):rows;
  if(row&&(!selected.length||selected[0].store.id!==row.store?.id||selected[0].deep_cleaning_date!==row.deep_cleaning_date))throw Error('Submission is no longer available in this authorized view. Refresh before exporting.');
  if(selected.length>EXPORT_LIMITS.sessions)throw Error('More than 500 submissions selected. Narrow the month or filters; no export was downloaded.');
  return {rows:selected,range,params,exceptions:report.exceptions?.length||0};
}
export async function collectCleaningExport({rows,params,exceptions=0,request,photos=false,readPhoto=readCleaningPhoto,onProgress=()=>{}}) {
  const unique=[...new Map(rows.map(r=>[r.id,r])).values()];
  if(unique.length>EXPORT_LIMITS.sessions)throw Error('More than 500 submissions selected. Narrow the month or filters.');
  const data={records:[],warnings:[]};let evidenceCount=0,photoCount=0,photoBytes=0;
  if(exceptions)data.warnings.push(`${exceptions} source records excluded by the server because canonical store identity could not be resolved.`);
  for(const [index,row] of unique.entries()) {
    onProgress(`Loading authorized evidence ${index+1} of ${unique.length}`);
    const reference=`${REPORT}/${encodeURIComponent(row.id)}/evidence`;
    const record={id:row.id,storeCode:row.store.store_code,storeName:row.store.store_name,state:row.store.state,date:row.deep_cleaning_date,
      fo:recordedFoName(row),employeeCode:recordedFoCode(row),status:row.status,submittedAt:row.submitted_at,source:row.source_kind,evidence:[],evidenceStatus:'Not requested'};
    let uploads;
    try {
      const response=await request({url:reference,params});
      if(!Array.isArray(response.data?.uploads))throw Error('Incomplete evidence response');
      uploads=response.data.uploads;record.evidenceStatus='Authorized evidence list received';
    }catch(e){record.evidenceStatus=[401,403].includes(e.response?.status)?'Evidence authorization denied or pending':'Evidence unavailable; retry through dashboard';data.warnings.push(`${row.id}: ${record.evidenceStatus}.`);}
    if(uploads) {
      uploads=[...new Map(uploads.map(u=>[u.id,u])).values()];evidenceCount+=uploads.length;
      if(evidenceCount>EXPORT_LIMITS.evidence)throw Error('Too many evidence references. Narrow the selection; no export was downloaded.');
      for(const upload of uploads) {
        const e={id:upload.id,type:upload.type,fileName:upload.name,mime:upload.mime_type,reference:`${reference}#${encodeURIComponent(upload.id||'unrecorded')}`,access:'Authorized at export; reopen through dashboard'};
        record.evidence.push(e);
        let valid=false;try{valid=!!upload.id&&new URL(upload.url).protocol==='https:';}catch{ /* Missing authorization URL. */ }
        if(!valid){e.access='Authorized download unavailable';data.warnings.push(`${row.id} / ${e.id||'Not recorded'}: ${e.access}.`);continue;}
        if(photos&&String(e.mime).startsWith('image/')) {
          if(photoCount>=EXPORT_LIMITS.photos||photoBytes>=EXPORT_LIMITS.totalPhotoBytes){e.access='Photo omitted: bounded export size limit';data.warnings.push(`${row.id} / ${e.id}: ${e.access}.`);continue;}
          try {
            const image=await readPhoto(upload.url,Math.min(EXPORT_LIMITS.photoBytes,EXPORT_LIMITS.totalPhotoBytes-photoBytes),e.mime);
            if(!(image.width>0&&image.height>0&&image.bytes>0&&image.bytes<=EXPORT_LIMITS.photoBytes&&image.bytes+photoBytes<=EXPORT_LIMITS.totalPhotoBytes))throw Error('Invalid photo dimensions or size');
            e.image=image.data;e.width=image.width;e.height=image.height;photoBytes+=image.bytes;photoCount++;
          }catch{e.access='Authorized; photograph download or decoding failed';data.warnings.push(`${row.id} / ${e.id}: ${e.access}.`);}
        }
      }
      if(!uploads.length){record.evidenceStatus='No uploaded evidence recorded';data.warnings.push(`${row.id}: No uploaded evidence recorded.`);}
    }
    if(photos)for(const type of ['before','after'])if(!record.evidence.some(e=>e.type===type&&e.image))data.warnings.push(`${row.id}: No authorized ${type.toUpperCase()} photographs included.`);
    data.records.push(record);
  }
  if(!unique.length)data.warnings.push('No submitted Deep Cleaning records match this selection.');
  return data;
}
// Export-only WebP conversion. Upload bytes, upload queues and evidence identities are untouched.
export async function readCleaningPhoto(url,maxBytes,mime) {
  if(mime!=='image/webp')return readTrainingPhoto(url,maxBytes);
  const response=await fetch(url,{credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(30000)});
  if(!response.ok||response.headers.get('content-type')?.split(';')[0]!=='image/webp')throw Error('Photo unavailable');
  if(Number(response.headers.get('content-length'))>maxBytes){await response.body?.cancel();throw Error('Photo exceeds export limit');}
  const reader=response.body?.getReader();if(!reader)throw Error('Streaming unavailable');
  const chunks=[];let bytes=0;
  try{while(true){const next=await reader.read();if(next.done)break;bytes+=next.value.byteLength;if(bytes>maxBytes)throw Error('Photo exceeds export limit');chunks.push(next.value);}}finally{await reader.cancel();}
  const blob=new Blob(chunks,{type:'image/webp'}),header=new Uint8Array(await blob.slice(0,32).arrayBuffer());
  const {width,height}=webpDimensions(header); // Bound decoded pixels before allocating a bitmap.
  if(width*height>40000000)throw Error('Photo dimensions exceed export limit');
  const bitmap=await createImageBitmap(blob);
  try {
    if(bitmap.width!==width||bitmap.height!==height)throw Error('Photo dimensions changed');
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;canvas.getContext('2d').drawImage(bitmap,0,0);
    const png=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    if(!png||png.size>maxBytes)throw Error('Converted photo exceeds export limit');
    const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(Error('Photo conversion failed'));r.readAsDataURL(png);});
    return {data,width,height,bytes:Math.max(bytes,png.size)};
  }finally{bitmap.close();}
}
export function webpDimensions(b) {
  const word=(a,z)=>String.fromCharCode(...b.slice(a,z));let width,height;
  if(b.length<30||word(0,4)!=='RIFF'||word(8,12)!=='WEBP')throw Error('Invalid WebP');
  const u24=i=>b[i]+b[i+1]*256+b[i+2]*65536;
  if(word(12,16)==='VP8X'){width=u24(24)+1;height=u24(27)+1;}
  else if(word(12,16)==='VP8L'&&b[20]===47){width=1+((b[21]|b[22]<<8)&16383);height=1+((b[22]>>6|b[23]<<2|b[24]<<10)&16383);}
  else if(word(12,16)==='VP8 '&&b[23]===157&&b[24]===1&&b[25]===42){width=(b[26]|b[27]<<8)&16383;height=(b[28]|b[29]<<8)&16383;}
  if(!(width>0&&height>0))throw Error('Invalid WebP dimensions');return {width,height};
}
export function cleaningExportFilename({format,month,range,record}) {
  const safe=value=>String(value||'Not_recorded').replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,90);
  return `myQPMS_Deep_Cleaning_${record?safe(record.storeCode)+'_'+safe(record.date)+'_'+safe(record.id):safe(month||range.from+'_'+range.to)}.${format}`;
}
