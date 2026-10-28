import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {createGzip,createGunzip} from 'node:zlib';

const ENCODING='retail-attendance-gzip-json-v1';
const MAX_SOURCE_BYTES=96*1024*1024,MAX_COMPRESSED_BYTES=16*1024*1024;
export const PREVIEW_SAMPLE_LIMIT=100;
export const PREVIEW_ERROR_CODES=new Set(['PREVIEW_DATABASE_UNAVAILABLE','PREVIEW_AUDIT_UNAVAILABLE','PREVIEW_AUDIT_INVALID']);
const error=(code,message,statusCode=503)=>Object.assign(new Error(message),{code,statusCode});

// Each row/exception is serialized once into gzip. Never create the old ~69 MB
// request string/tree or another full-workbook JSON copy before persistence.
function* sourceChunks(source){
  yield '{';let first=true;
  for(const [key,value]of Object.entries(source)){
    if(!first)yield ',';first=false;yield JSON.stringify(key)+':';
    if(Array.isArray(value)){
      yield '[';for(let i=0;i<value.length;i++){if(i)yield ',';yield JSON.stringify(value[i]);}yield ']';
    }else yield JSON.stringify(value);
  }
  yield '}';
}
export async function encodeAttendanceSource(source){
  const hash=createHash('sha256');let decodedBytes=0,compressedBytes=0;
  const input=Readable.from((async function*(){let pending=[],pendingBytes=0;for(const chunk of sourceChunks(source)){
    const b=Buffer.from(chunk);decodedBytes+=b.length;
    if(decodedBytes>MAX_SOURCE_BYTES)throw error('PREVIEW_AUDIT_INVALID','The retained source exceeds the safe audit limit. Split the workbook.',400);
    hash.update(b);pending.push(b);pendingBytes+=b.length;
    if(pendingBytes>=65536){yield Buffer.concat(pending,pendingBytes);pending=[];pendingBytes=0;}
  }if(pendingBytes)yield Buffer.concat(pending,pendingBytes);})());
  const gzip=createGzip({level:3,chunkSize:65536});
  input.on('error',e=>gzip.destroy(e));input.pipe(gzip);const chunks=[];
  try{for await(const chunk of gzip){compressedBytes+=chunk.length;if(compressedBytes>MAX_COMPRESSED_BYTES)throw error('PREVIEW_AUDIT_INVALID','The retained source exceeds the safe audit limit. Split the workbook.',400);chunks.push(chunk);}}
  finally{input.destroy();gzip.destroy();}
  return {encoding:ENCODING,uncompressed_bytes:decodedBytes,sha256:hash.digest('hex'),data:Buffer.concat(chunks,compressedBytes).toString('base64')};
}
export async function decodeAttendanceSource(source){
  if(!source?.encoding)return source; // Existing historical rows remain readable.
  if(source.encoding!==ENCODING||!Number.isSafeInteger(source.uncompressed_bytes)||source.uncompressed_bytes<0||source.uncompressed_bytes>MAX_SOURCE_BYTES||typeof source.data!=='string'||source.data.length>Math.ceil(MAX_COMPRESSED_BYTES/3)*4||!/^[a-f0-9]{64}$/.test(source.sha256||''))throw error('PREVIEW_AUDIT_INVALID','The retained source audit cannot be read safely.',409);
  const buffer=Buffer.from(source.data,'base64');if(buffer.length>MAX_COMPRESSED_BYTES)throw error('PREVIEW_AUDIT_INVALID','The retained source audit cannot be read safely.',409);
  const input=Readable.from([buffer]),gunzip=createGunzip({chunkSize:65536});input.pipe(gunzip);
  let bytes=0;const chunks=[],hash=createHash('sha256');
  try{for await(const c of gunzip){bytes+=c.length;if(bytes>source.uncompressed_bytes||bytes>MAX_SOURCE_BYTES)throw Error('Invalid size');hash.update(c);chunks.push(c);}if(bytes!==source.uncompressed_bytes||hash.digest('hex')!==source.sha256)throw Error('Invalid digest');return JSON.parse(Buffer.concat(chunks,bytes).toString('utf8'));}
  catch{throw error('PREVIEW_AUDIT_INVALID','The retained source audit cannot be read safely.',409)}
  finally{input.destroy();gunzip.destroy();}
}

export function compactPreviewSummary(summary){
  const rejected=summary.rejected||[],excluded=summary.excluded||[];
  return {...summary,rejected:rejected.slice(0,PREVIEW_SAMPLE_LIMIT),excluded:excluded.slice(0,PREVIEW_SAMPLE_LIMIT),
    rejected_sampled:rejected.length>PREVIEW_SAMPLE_LIMIT,excluded_sampled:excluded.length>PREVIEW_SAMPLE_LIMIT,
    exception_sample_limit:PREVIEW_SAMPLE_LIMIT,audit_complete:true};
}

export async function previewDatabase(query,stage,signal,timeoutMs=stage==='audit_save'?20000:10000){
  // Applies to each PostgREST call, not the upload size or attendance rules.
  const timeout=AbortSignal.timeout(timeoutMs);
  const combined=signal?AbortSignal.any([signal,timeout]):timeout;
  const bounded=typeof query.abortSignal==='function'?query.abortSignal(combined):query;
  let timer;
  try{
    const result=await Promise.race([Promise.resolve(bounded),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Dependency timeout')),timeoutMs)})]);
    if(result.error){if(Number.isInteger(result.status))result.error.status=result.status;throw result.error}return result.data;
  }catch(cause){
    if(['23505','40001','P0001','42501'].includes(cause.code))throw cause;
    const code=stage==='audit_save'?'PREVIEW_AUDIT_UNAVAILABLE':'PREVIEW_DATABASE_UNAVAILABLE';
    const safe=error(code,stage==='audit_save'?'Preview audit could not be saved. No attendance was imported. Retry Validate and Preview.':'Attendance preview database is unavailable. No attendance was imported. Please retry.');
    safe.stage=stage;safe.dependency_code=typeof cause.code==='string'?cause.code.slice(0,40):null;safe.dependency_status=Number.isInteger(cause.status)?cause.status:null;
    throw safe;
  }finally{clearTimeout(timer)}
}
