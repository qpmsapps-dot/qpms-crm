import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createHash,randomUUID} from 'node:crypto';
import {uploadThermoResumable,THERMO_TUS_CHUNK_BYTES} from '../src/utils/thermographyTusUpload.js';

const memory=()=>{const values=new Map();return {values,getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};};
function input(size=41*1024*1024){
 const bytes=Buffer.alloc(size,7);Object.assign(bytes,{name:'SYNTHETIC.xlsx',size,type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
 const sha=createHash('sha256').update(bytes).digest('hex'),requestId=randomUUID();
 return {bytes,sha,requestId,ticket:{endpoint:'https://synthetic.invalid/storage/v1/upload/resumable/sign',token:'synthetic-first-token',bucket:'retail-thermography-reports',object_path:randomUUID()+'/'+randomUUID()+'.xlsx',version_id:randomUUID(),request_id:requestId,source_sha256:sha,size}};
}
test('real TUS client resumes a 41 MiB workbook after interruption and fresh authorization without a duplicate upload',{timeout:60000},async()=>{
 const f=input(),storage=memory();let offset=0,posts=0,heads=0,interrupt=true,token=f.ticket.token;const chunks=[],offsets=[];
 const server=createServer(async(req,res)=>{
  res.setHeader('Tus-Resumable','1.0.0');
  if(req.headers['x-signature']!==token){res.writeHead(403).end();return;}
  assert.equal(req.headers['x-upsert'],'false');
  if(req.method==='POST'){
   posts++;assert.equal(Number(req.headers['upload-length']),f.bytes.length);assert.match(req.headers['upload-metadata'],/bucketName /);
   res.writeHead(201,{Location:`http://127.0.0.1:${server.address().port}/storage/v1/upload/resumable/sign/synthetic-resource`,'Upload-Offset':'0'}).end();return;
  }
  if(req.method==='HEAD'){heads++;res.writeHead(200,{'Upload-Offset':String(offset),'Upload-Length':String(f.bytes.length)}).end();return;}
  assert.equal(req.method,'PATCH');assert.equal(req.headers['content-type'],'application/offset+octet-stream');
  const parts=[];for await(const part of req)parts.push(part);const chunk=Buffer.concat(parts);
  offsets.push(Number(req.headers['upload-offset']));assert.equal(offsets.at(-1),offset);assert.ok(chunk.length<=THERMO_TUS_CHUNK_BYTES);
  chunks.push(chunk);offset+=chunk.length;
  if(interrupt){interrupt=false;res.writeHead(503).end();return;}
  res.writeHead(204,{'Upload-Offset':String(offset)}).end();
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');f.ticket.endpoint=`http://127.0.0.1:${server.address().port}/storage/v1/upload/resumable/sign`;
 const options={actor:'synthetic-mis',requestId:f.requestId,sourceSha:f.sha,storage,retryDelays:[],allowLoopback:true};
 try{
  await assert.rejects(uploadThermoResumable(f.ticket,f.bytes,options),/interrupted or unconfirmed/);
  assert.equal(offset,THERMO_TUS_CHUNK_BYTES);assert.equal(posts,1);assert.equal(storage.values.size,1);
  assert.ok(![...storage.values.values()].join('').includes(token));
  token='synthetic-refreshed-token';await uploadThermoResumable({...f.ticket,token},f.bytes,options);
  assert.equal(posts,1);assert.ok(heads>=1);assert.equal(offset,f.bytes.length);assert.equal(offsets[1],THERMO_TUS_CHUNK_BYTES);
  assert.equal(createHash('sha256').update(Buffer.concat(chunks)).digest('hex'),f.sha);assert.equal(storage.values.size,0);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
test('TUS rejects authorization/identity drift and untrusted cached locations before transmitting credentials',async()=>{
 const f=input(30),storage=memory();let requests=0;
 class Upload{
  constructor(file,options){this.options=options;}
  async findPreviousUploads(){return this.options.urlStorage.findUploadsByFingerprint(await this.options.fingerprint());}
  start(){requests++;}
 }
 const options={actor:'synthetic-mis',requestId:f.requestId,sourceSha:f.sha,storage,Upload};
 for(const ticket of [{...f.ticket,bucket:'other'},{...f.ticket,request_id:randomUUID()},{...f.ticket,size:31},{...f.ticket,source_sha256:'0'.repeat(64)},{...f.ticket,endpoint:'http://attacker.invalid/storage/v1/upload/resumable/sign'}])
  await assert.rejects(uploadThermoResumable(ticket,f.bytes,options),/identity/);
 const fingerprint=JSON.stringify([options.actor,f.requestId,f.ticket.version_id,new URL(f.ticket.endpoint).origin,f.ticket.object_path,f.sha,f.bytes.size]);
 storage.setItem('myqpms.thermography.tus.v1.'+fingerprint,JSON.stringify({uploadUrl:'https://attacker.invalid/steal',size:f.bytes.size}));
 await assert.rejects(uploadThermoResumable(f.ticket,f.bytes,options),/resume information/);assert.equal(requests,0);
});
test('expired signed authorization is explicit; resume identities remain actor scoped and no completion is fabricated',async()=>{
 const f=input(30),storage=memory(),fingerprints=[];
 class Upload{
  constructor(file,options){this.options=options;}
  async findPreviousUploads(){fingerprints.push(await this.options.fingerprint());return [];}
  start(){assert.equal(this.options.headers['x-upsert'],'false');this.options.onError({originalResponse:{getStatus:()=>403}});}
 }
 for(const actor of ['one','two'])await assert.rejects(uploadThermoResumable(f.ticket,f.bytes,{actor,requestId:f.requestId,sourceSha:f.sha,storage,Upload}),/authorization expired or was denied/);
 assert.notEqual(fingerprints[0],fingerprints[1]);
});
