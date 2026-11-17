import {createHash,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {thermoFixture} from './thermographyFixture.js';
import {THERMO_MIME} from '../../services/thermographyWorkbook.js';
export {default as express} from 'express';
export async function syntheticThermoWorkbook(){
 const b=new ExcelJS.Workbook();b.creator='SYNTHETIC TEST ONLY';const s=b.addWorksheet('Synthetic readings');s.getCell('A1').value='SYNTHETIC WORKBOOK — not operational evidence';s.getCell('B2').value={formula:'1+1',result:2};s.getCell('A1').font={bold:true};
 const image=b.addImage({base64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j0L0AAAAASUVORK5CYII=',extension:'png'});s.addImage(image,'C3:D4');b.addWorksheet('Synthetic second worksheet');return Buffer.from(await b.xlsx.writeBuffer());
}
export async function thermoServiceFixture(){
 const f=await thermoFixture(),objects=new Map(),profile={id:f.ids.mepc,auth_user_id:f.ids.mepc,is_active:true,status:'Active'},other={...profile,id:f.ids.other,auth_user_id:f.ids.other},admin={...profile,id:f.ids.admin,auth_user_id:f.ids.admin};
 const client={rpc:async(name,{p_actor,p_action,p_data})=>{assert.equal(name,'rpc_retail_thermography_reports');try{return {data:await f.call(p_actor,p_action,p_data)};}catch(e){return {error:{code:e.code,message:e.message}};}},storage:{getBucket:async id=>({data:(await f.db.query('select * from storage.buckets where id=$1',[id])).rows[0]}),from(bucket){assert.equal(bucket,'retail-thermography-reports');return {
  list:async folder=>({data:[...objects].filter(([p])=>p.startsWith(folder+'/')).map(([p,o])=>({id:o.id,name:p.split('/').at(-1),metadata:{size:o.bytes.length,mimetype:THERMO_MIME}}))}),
  createSignedUploadUrl:async(p,opts)=>{assert.equal(opts.upsert,false);return {data:{signedUrl:'https://synthetic.invalid/storage/v1/object/upload/sign/'+bucket+'/'+p+'?token=synthetic-upload-token',token:'synthetic-upload-token'}};},
  createSignedUrl:async p=>({data:{signedUrl:'https://synthetic.invalid/'+p}}),
  remove:async paths=>{for(const p of paths){await f.db.query('delete from storage.objects where name=$1',[p]);objects.delete(p);}return {data:[]};}
 };}}};
 const fetcher=async(url,config)=>{const o=objects.get(new URL(url).pathname.slice(1));return o?new Response(config?.method==='HEAD'?null:o.bytes,{status:200,headers:{'content-type':THERMO_MIME,'content-length':String(o.bytes.length)}}):new Response(null,{status:404});};
 const payload=bytes=>({request_id:randomUUID(),store_id:f.ids.store,date:f.today,filename:'SYNTHETIC_Original.xlsx',size:bytes.length,mime:THERMO_MIME,source_sha256:createHash('sha256').update(bytes).digest('hex')});
 const upload=async(input,bytes)=>{const v=(await f.db.query('select * from retail_thermography_report_versions where operation_id=$1',[input.request_id])).rows[0];const id=await f.object(v);objects.set(v.object_path,{id,bytes});return v;};
 return {...f,client,profile,other,admin,objects,fetcher,payload,upload};
}
