import {randomUUID,createHash} from 'node:crypto';
import {open,unlink} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {THERMO_BUCKET,THERMO_MAX_BYTES,THERMO_MIME,validateThermoFile,validateThermoWorkbook} from './thermographyWorkbook.js';

const fail=(statusCode,message)=>Object.assign(Error(message),{statusCode});
export async function thermoUploadLimit(client,maxBytes=THERMO_MAX_BYTES){
 if(!Number.isSafeInteger(maxBytes)||maxBytes<22||maxBytes>THERMO_MAX_BYTES)throw fail(503,'Thermography upload limit configuration is invalid.');
 const {data:bucket,error}=await client.storage.getBucket(THERMO_BUCKET);
 const limit=Number(bucket?.file_size_limit);
 if(error||!bucket||bucket.public!==false||!Number.isSafeInteger(limit)||limit<22||limit>THERMO_MAX_BYTES
 ||bucket.allowed_mime_types?.length!==1||bucket.allowed_mime_types[0]!==THERMO_MIME)throw fail(503,'Private Thermography bucket limits require verification before upload.');
 return Math.min(maxBytes,limit);
}
export async function thermoReportRpc(client,profile,action,data={}){
 if(!profile?.id||profile.is_active!==true||String(profile.status||'Active').toUpperCase()!=='ACTIVE')throw fail(403,'Active Thermography account required.');
 const {data:result,error}=await client.rpc('rpc_retail_thermography_reports',{p_actor:profile.id,p_action:action,p_data:data});
 if(error){const status=({'42501':403,'23505':409,'40001':409,'22023':400,'22P02':400,'22007':400,'22008':400,'23514':400})[error.code]||503;throw fail(status,status===503?'Thermography report contracts are unavailable. No upload or action is confirmed.':error.message);}
 return result;
}
function privateVersion(v){
 if(v?.bucket!==THERMO_BUCKET||!/^[-0-9a-f]{36}\/[-0-9a-f]{36}\.xlsx$/.test(v.object_path||'')||!Number.isSafeInteger(Number(v.file_size))||Number(v.file_size)>THERMO_MAX_BYTES)throw fail(503,'Private report metadata could not be verified.');
 return v;
}
async function storedObject(client,v){
 privateVersion(v);const [folder,name]=v.object_path.split('/');
 const {data,error}=await client.storage.from(THERMO_BUCKET).list(folder,{limit:10,search:name});
 if(error)throw fail(503,'Stored workbook could not be checked. Retry without changing the upload identity.');
 const object=(data||[]).find(o=>o.name===name);
 if(!object)return null;
 if(Number(object.metadata?.size)!==Number(v.file_size)||object.metadata?.mimetype!==THERMO_MIME)throw fail(409,'Stored workbook metadata does not match the reserved upload.');
 return object;
}
async function signedDownload(client,v){
 privateVersion(v);const {data,error}=await client.storage.from(THERMO_BUCKET).createSignedUrl(v.object_path,300);
 if(error||!data?.signedUrl?.startsWith('https://'))throw fail(503,'Private workbook download could not be authorized.');return data.signedUrl;
}
export async function prepareThermoUpload(client,profile,input,{maxBytes=THERMO_MAX_BYTES}={}){
 maxBytes=await thermoUploadLimit(client,maxBytes);
 validateThermoFile({filename:input.filename,size:input.size,mime:input.mime},maxBytes);
 if(!/^[a-f0-9]{64}$/.test(input.source_sha256||''))throw fail(400,'Workbook identity is required for safe upload retries.');
 const v=privateVersion(await thermoReportRpc(client,profile,'prepare',input));
 const object=await storedObject(client,v);
 let upload_url,tus;
 if(v.state==='pending'&&!object){
  const {data,error}=await client.storage.from(THERMO_BUCKET).createSignedUploadUrl(v.object_path,{upsert:false});
  if(error||!data?.signedUrl?.startsWith('https://'))throw fail(503,'Upload authorization failed. Retry using the same request ID.');upload_url=data.signedUrl;
  if(Number(v.file_size)>6*1024*1024){
   const signed=new URL(upload_url);
   if(signed.pathname!==`/storage/v1/object/upload/sign/${THERMO_BUCKET}/${v.object_path}`||!data.token||signed.searchParams.get('token')!==data.token||signed.username||signed.password||signed.hash)throw fail(503,'Signed resumable upload authorization could not be verified. Retry the same request.');
   // Use Supabase's direct Storage hostname; retain configured origins for self-hosted Storage.
   const host=/^[a-z0-9-]+\.supabase\.co$/.test(signed.hostname)?signed.hostname.replace('.supabase.co','.storage.supabase.co'):signed.host;
   tus={endpoint:`https://${host}/storage/v1/upload/resumable/sign`,token:data.token,bucket:v.bucket,object_path:v.object_path,
    request_id:v.operation_id,version_id:v.id,source_sha256:v.source_sha256,size:Number(v.file_size)};
  }
 }
 return {inspection_id:v.inspection_id,version_id:v.id,request_id:v.operation_id,revision:v.expected_revision,state:v.state,object_exists:!!object,upload_url,tus,max_bytes:maxBytes};
}
const finalizing=new Map();
export async function finalizeThermoUpload(client,profile,input,options={}){
 const key=profile.id+':'+input.request_id;
 if(finalizing.has(key))return finalizing.get(key);
 if(finalizing.size>=4)throw fail(429,'Workbook validation is busy. Retry the same upload shortly.');
 const promise=finalizeStoredWorkbook(client,profile,input,options);finalizing.set(key,promise);
 try{return await promise;}finally{finalizing.delete(key);}
}
async function finalizeStoredWorkbook(client,profile,input,{fetcher=fetch,validate=validateThermoWorkbook,maxBytes=THERMO_MAX_BYTES}={}){
 const v=privateVersion(await thermoReportRpc(client,profile,'upload',{request_id:input.request_id}));
 if(v.state==='uploaded')return thermoReportRpc(client,profile,'finalize',{request_id:v.operation_id,sha256:v.sha256,object_id:v.object_id});
 maxBytes=await thermoUploadLimit(client,maxBytes);
 const object=await storedObject(client,v);if(!object)throw fail(409,'Workbook is not stored yet. Retry the same upload; the active report is unchanged.');
 const url=await signedDownload(client,v),file=path.join(os.tmpdir(),`qpms-thermo-${randomUUID()}.xlsx`);
 let handle;const hash=createHash('sha256');let size=0;
 try{
  const response=await fetcher(url,{credentials:'omit',redirect:'error',signal:AbortSignal.timeout(180000)});
  if(!response.ok||!response.body)throw fail(503,'Stored workbook bytes are unavailable. Retry finalization.');
  if(Number(response.headers.get('content-length'))>maxBytes)throw fail(422,'Workbook exceeds the upload limit.');
  handle=await open(file,'wx');
  for await(const chunk of response.body){size+=chunk.byteLength;if(size>maxBytes||size>Number(v.file_size))throw fail(422,'Workbook exceeds its reserved size.');hash.update(chunk);let offset=0;while(offset<chunk.length){const written=await handle.write(chunk,offset,chunk.length-offset);offset+=written.bytesWritten;}}
  await handle.close();handle=null;
  if(size!==Number(v.file_size))throw fail(422,'Workbook bytes do not match the reserved size.');
  await validate(file,{maxBytes});
  const digest=hash.digest('hex');if(digest!==v.source_sha256)throw fail(422,'Stored workbook differs from the selected original. Choose the correct file as a new upload attempt.');
  return await thermoReportRpc(client,profile,'finalize',{request_id:v.operation_id,sha256:digest,object_id:object.id});
 }catch(e){
  if(e.statusCode===422){await thermoReportRpc(client,profile,'invalidate',{id:v.inspection_id,revision:v.expected_revision,request_id:v.operation_id}).catch(()=>{});throw e;}
  if(e.statusCode)throw e;throw fail(503,'Workbook validation was interrupted. Retry using the same upload identity.');
 }finally{if(handle)await handle.close();await unlink(file).catch(e=>{if(e.code!=='ENOENT')console.warn('[Thermography] Temporary validation file cleanup requires review.');});}
}
export async function thermoDownload(client,profile,id,versionId,{fetcher=fetch,probe=false}={}){
 const v=privateVersion(await thermoReportRpc(client,profile,'version',{id,version_id:versionId}));
 if(!await storedObject(client,v))throw fail(404,'The private workbook is missing. No report status was changed.');
 const response=await fetcher(await signedDownload(client,v),{method:'GET',headers:probe?{Range:'bytes=0-0'}:undefined,credentials:'omit',redirect:'error',signal:AbortSignal.timeout(60000)});
 const partial=probe&&response.status===206;
 if(!response.ok||partial&&response.headers.get('content-range')!==`bytes 0-0/${v.file_size}`||!partial&&Number(response.headers.get('content-length'))&&Number(response.headers.get('content-length'))!==Number(v.file_size))throw fail(404,'Workbook could not be retrieved from private storage.');
 if(probe){const reader=response.body?.getReader();if(!reader)throw fail(404,'Stored workbook bytes are unavailable.');try{const first=await reader.read();if(first.done||!first.value?.length)throw fail(404,'Stored workbook bytes are unavailable.');}finally{await reader.cancel();}}
 return {version:v,response};
}
export async function thermoReportAction(client,profile,action,input,options={}){
 if(!['schedule','reject','approve','delete','restore','reopen'].includes(action))throw fail(400,'Unsupported Thermography action.');
 if(['approve','restore'].includes(action)){
  // Real Storage check supplements the transactional storage.objects linkage check.
  if(action==='approve')await thermoDownload(client,profile,input.id,null,{...options,probe:true});
  else {const v=await thermoReportRpc(client,profile,'version',{id:input.id}).catch(e=>{if(e.statusCode===400&&e.message==='No confirmed workbook available')return null;throw e;});if(v)await thermoDownload(client,profile,input.id,null,{...options,probe:true});}
 }
 return thermoReportRpc(client,profile,action,input);
}
export async function cleanupThermoUploads(client,profile){
 const candidates=await thermoReportRpc(client,profile,'cleanup_candidates');const result=[];
 for(const v of candidates){
  try{const meta=privateVersion({...v,file_size:1});await thermoReportRpc(client,profile,'cleanup_abandon',{version_id:v.id});const removed=await client.storage.from(THERMO_BUCKET).remove([meta.object_path]);if(removed.error)throw Error('Removal failed');await thermoReportRpc(client,profile,'cleanup_done',{version_id:v.id});result.push({id:v.id,cleaned:true});}
  catch{result.push({id:v.id,cleaned:false,message:'Cleanup incomplete; retry reconciliation. Confirmed report versions are never purged.'});}
 }
 return result;
}
