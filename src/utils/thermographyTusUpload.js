import {THERMO_UPLOAD_LIMIT,THERMO_XLSX_MIME,validateThermoSelection} from './thermographyReports.js';

export const THERMO_TUS_CHUNK_BYTES=6*1024*1024;
const uuid=value=>/^[a-f0-9-]{36}$/i.test(value||'');
// Store only the resumable resource identity, never the signed token or workbook.
export async function uploadThermoResumable(ticket,file,{actor,requestId,sourceSha,storage=sessionStorage,onProgress=()=>{},Upload,retryDelays=[0,1000,3000,5000],allowLoopback=false}={}){
 validateThermoSelection(file,THERMO_UPLOAD_LIMIT);
 let endpoint;
 try{endpoint=new URL(ticket.endpoint);}catch{throw Error('Resumable upload authorization is incomplete. Retry the same report.');}
 const secure=endpoint.protocol==='https:'||(allowLoopback&&endpoint.protocol==='http:'&&endpoint.hostname==='127.0.0.1');
 if(!secure||endpoint.username||endpoint.password||endpoint.search||endpoint.hash||endpoint.pathname!=='/storage/v1/upload/resumable/sign'
  ||!actor||ticket.bucket!=='retail-thermography-reports'||!uuid(ticket.version_id)||!uuid(requestId)||ticket.request_id!==requestId
  ||!/^[a-f0-9-]{36}\/[a-f0-9-]{36}\.xlsx$/i.test(ticket.object_path||'')||ticket.size!==file.size
  ||!/^[a-f0-9]{64}$/.test(sourceSha||'')||ticket.source_sha256!==sourceSha||!ticket.token)throw Error('Resumable upload identity does not match this workbook. Retry the authorized report.');
 const safeUrl=value=>{
  const url=new URL(value);
  if(url.origin!==endpoint.origin||url.username||url.password||url.search||url.hash||!url.pathname.startsWith(endpoint.pathname+'/'))throw Error('Untrusted resumable upload location.');
  return url.href;
 };
 const fingerprint=JSON.stringify([actor,requestId,ticket.version_id,endpoint.origin,ticket.object_path,sourceSha,file.size]);
 const key='myqpms.thermography.tus.v1.'+fingerprint;
 // Probe persistence before sending any bytes. File re-selection is still required after reload.
 const previous=storage.getItem(key);storage.setItem(key,previous||'null');
 if(storage.getItem(key)!==(previous||'null'))throw Error('Upload resume identity could not be retained.');
 const urlStorage={
  async findAllUploads(){return [];},
  async findUploadsByFingerprint(value){
   if(value!==fingerprint)return [];
   const saved=JSON.parse(storage.getItem(key)||'null');
   if(!saved)return [];
   if(saved.size!==file.size)throw Error('Saved upload identity does not match the workbook.');
   return [{uploadUrl:safeUrl(saved.uploadUrl),size:saved.size,urlStorageKey:key}];
  },
  async addUpload(value,upload){
   if(value!==fingerprint)throw Error('Upload fingerprint changed.');
   const json=JSON.stringify({uploadUrl:safeUrl(upload.uploadUrl),size:file.size});
   storage.setItem(key,json);if(storage.getItem(key)!==json)throw Error('Upload resume identity could not be retained.');return key;
  },
  async removeUpload(value){if(value!==key)throw Error('Unexpected upload resume identity.');storage.removeItem(key);},
 };
 const TusUpload=Upload||(await import('tus-js-client')).Upload;
 return new Promise((resolve,reject)=>{
  const upload=new TusUpload(file,{
   endpoint:endpoint.href,chunkSize:THERMO_TUS_CHUNK_BYTES,uploadDataDuringCreation:false,
   retryDelays,removeFingerprintOnSuccess:true,storeFingerprintForResuming:true,urlStorage,
   fingerprint:async()=>fingerprint,
   headers:{'x-signature':ticket.token,'x-upsert':'false'},
   metadata:{bucketName:ticket.bucket,objectName:ticket.object_path,contentType:THERMO_XLSX_MIME,cacheControl:'0'},
   onBeforeRequest:req=>{
    if(req.getURL()!==endpoint.href)safeUrl(req.getURL());
    const xhr=req.getUnderlyingObject?.();if(xhr&&'timeout' in xhr)xhr.timeout=120000;
   },
   onProgress:(sent,total)=>onProgress(total?Math.min(100,Math.round(sent/total*100)):0),
   onError:error=>{
    const status=error.originalResponse?.getStatus();
    reject(Error([401,403].includes(status)?'Upload authorization expired or was denied. Retry the same report to refresh authorization.':
     'Resumable upload interrupted or unconfirmed. Re-select the same workbook and retry; the active report is unchanged.'));
   },
   onSuccess:()=>resolve(),
  });
  upload.findPreviousUploads().then(previousUploads=>{
   if(previousUploads.length)upload.resumeFromPreviousUpload(previousUploads[0]);upload.start();
  }).catch(()=>reject(Error('Saved upload resume information is unavailable or invalid. No submission was confirmed.')));
 });
}
