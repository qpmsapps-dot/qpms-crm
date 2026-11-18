import {createHash,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';

import {thermoFixture} from './thermographyFixture.js';
import {THERMO_MIME} from '../../services/thermographyPdf.js';
export {default as express} from 'express';
// Valid blank-page PDF, explicitly synthetic, with optional inert padding for limits.
export async function syntheticThermoPdf(size=0){
 let content='%PDF-1.7\n',offsets=[0];
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R >>','<< /Length 0 >>\nstream\n\nendstream'];
 for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(content));content+=(i+1)+' 0 obj\n'+objects[i]+'\nendobj\n';}
 content+=' '.repeat(Math.max(0,size-Buffer.byteLength(content)-200));const offset=Buffer.byteLength(content);
 content+='xref\n0 5\n0000000000 65535 f \n'+offsets.slice(1).map(v=>String(v).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n'+offset+'\n%%EOF\n';
 return Buffer.from(content);
}
export async function thermoServiceFixture(){
 const f=await thermoFixture(),objects=new Map(),profile={id:f.ids.mepc,auth_user_id:f.ids.mepc,is_active:true,status:'Active'},other={...profile,id:f.ids.other,auth_user_id:f.ids.other},admin={...profile,id:f.ids.admin,auth_user_id:f.ids.admin};
 const client={rpc:async(name,{p_actor,p_action,p_data})=>{assert.ok(['rpc_retail_thermography_reports','rpc_retail_thermography_schedule'].includes(name));try{return {data:name==='rpc_retail_thermography_reports'?await f.call(p_actor,p_action,p_data):(await f.db.query('select rpc_retail_thermography_schedule($1,$2,$3::jsonb) result',[p_actor,p_action,JSON.stringify(p_data)])).rows[0].result};}catch(e){return {error:{code:e.code,message:e.message}};}},storage:{getBucket:async id=>({data:(await f.db.query('select * from storage.buckets where id=$1',[id])).rows[0]}),from(bucket){assert.equal(bucket,'retail-thermography-reports');return {
  list:async folder=>({data:[...objects].filter(([p])=>p.startsWith(folder+'/')).map(([p,o])=>({id:o.id,name:p.split('/').at(-1),metadata:{size:o.bytes.length,mimetype:THERMO_MIME}}))}),
  createSignedUploadUrl:async(p,opts)=>{assert.equal(opts.upsert,false);return {data:{signedUrl:'https://synthetic.invalid/storage/v1/object/upload/sign/'+bucket+'/'+p+'?token=synthetic-upload-token',token:'synthetic-upload-token'}};},
  createSignedUrl:async p=>({data:{signedUrl:'https://synthetic.invalid/'+p}}),
  remove:async paths=>{for(const p of paths){await f.db.query('delete from storage.objects where name=$1',[p]);objects.delete(p);}return {data:[]};}
 };}}};
 const fetcher=async(url,config)=>{const o=objects.get(new URL(url).pathname.slice(1));return o?new Response(config?.method==='HEAD'?null:o.bytes,{status:200,headers:{'content-type':THERMO_MIME,'content-length':String(o.bytes.length)}}):new Response(null,{status:404});};
 const payload=async(bytes,existing)=>{const saved=existing||await f.schedule();return {id:saved.id,revision:saved.revision,request_id:randomUUID(),store_id:f.ids.store,date:f.today,filename:'SYNTHETIC_Original.pdf',size:bytes.length,mime:THERMO_MIME,source_sha256:createHash('sha256').update(bytes).digest('hex')};};
 const upload=async(input,bytes)=>{const v=(await f.db.query('select * from retail_thermography_report_versions where operation_id=$1',[input.request_id])).rows[0];const id=await f.object(v);objects.set(v.object_path,{id,bytes});return v;};
 return {...f,client,profile,other,admin,objects,fetcher,payload,upload};
}
