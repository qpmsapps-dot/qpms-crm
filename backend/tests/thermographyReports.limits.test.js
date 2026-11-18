import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,unlinkSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {thermoServiceFixture,syntheticThermoPdf} from './helpers/thermographyServiceFixture.js';
import {THERMO_MAX_BYTES,THERMO_MIME,validateThermoFile,validateThermoPdf} from '../services/thermographyPdf.js';
import {thermoUploadLimit,prepareThermoUpload,finalizeThermoUpload,thermoDownload,thermoReportAction} from '../services/thermographyReportsService.js';
import {PDF_MAX_BYTES,pdfIdentity} from '../../src/utils/thermographyV2.js';

test('exact decimal 10 MB limit agrees in frontend, backend, SQL and private bucket; one byte over denied',async()=>{
 assert.equal(THERMO_MAX_BYTES,10_000_000);assert.equal(PDF_MAX_BYTES,THERMO_MAX_BYTES);
 const sql=readFileSync(new URL('../../supabase/migrations/20261115140000_retail_thermography_reports.sql',import.meta.url),'utf8');assert.match(sql,/file_size between 1 and 10000000/);assert.match(sql,/false,10000000,array\['application\/pdf'\]/);
 const input={filename:'SYNTHETIC.pdf',size:THERMO_MAX_BYTES,mime:THERMO_MIME};validateThermoFile(input);assert.throws(()=>validateThermoFile({...input,size:THERMO_MAX_BYTES+1}),/10 MB/);
 const head='%PDF-1.7\n',padding=' '.repeat(THERMO_MAX_BYTES-100),offset=head.length+padding.length,tail='xref\n0 1\n0000000000 65535 f \ntrailer\n<< /Size 1 >>\nstartxref\n'+offset+'\n%%EOF\n';
 const exact=Buffer.concat([Buffer.from(head+padding),Buffer.from(tail)]);const extra=THERMO_MAX_BYTES-exact.length;
 const final=Buffer.concat([exact.subarray(0,offset),Buffer.alloc(Math.max(0,extra),32),Buffer.from(tail.replace(String(offset),String(offset+Math.max(0,extra))))]);
 assert.equal(final.length,THERMO_MAX_BYTES);const file=path.join(os.tmpdir(),'thermo-boundary-'+randomUUID()+'.pdf');
 try{writeFileSync(file,final);await validateThermoPdf(file);await pdfIdentity(new File([final],'SYNTHETIC.pdf',{type:THERMO_MIME}));await assert.rejects(pdfIdentity(new File([final,Buffer.from(' ')],'SYNTHETIC.pdf',{type:THERMO_MIME})),/10 MB/);}finally{unlinkSync(file);}
});
test('private bucket advertises lower actual limit; invalid bucket policy/config fails closed',async()=>{
 const h=await thermoServiceFixture();try{
  assert.equal(await thermoUploadLimit(h.client),THERMO_MAX_BYTES);const bucket={public:false,file_size_limit:4_000_000,allowed_mime_types:[THERMO_MIME]};h.client.storage.getBucket=async()=>({data:bucket});assert.equal(await thermoUploadLimit(h.client,8_000_000),4_000_000);
  const p=await h.payload(await syntheticThermoPdf());await assert.rejects(prepareThermoUpload(h.client,h.profile,{...p,size:4_000_001}),/10 MB/);assert.equal((await h.db.query('select count(*)::int n from retail_thermography_report_versions')).rows[0].n,0);
  for(const data of [{...bucket,public:true},{...bucket,file_size_limit:null},{...bucket,file_size_limit:THERMO_MAX_BYTES+1},{...bucket,allowed_mime_types:['application/octet-stream']}]){h.client.storage.getBucket=async()=>({data});await assert.rejects(thermoUploadLimit(h.client),/verification/);}
  await assert.rejects(thermoUploadLimit(h.client,THERMO_MAX_BYTES+1),/configuration/);
 }finally{await h.db.close();}
});
test('near-limit original PDF bytes survive verification and download; approved originals cannot be replaced',async()=>{
 const h=await thermoServiceFixture();try{
  const bytes=await syntheticThermoPdf(9_999_000);assert.ok(bytes.length>9_900_000&&bytes.length<=10_000_000);const input=await h.payload(bytes),ticket=await prepareThermoUpload(h.client,h.profile,input);
  assert.equal(ticket.tus,undefined);assert.ok(ticket.upload_url);assert.equal((await prepareThermoUpload(h.client,h.profile,input)).version_id,ticket.version_id);
  await h.upload(input,bytes);const receipt=await finalizeThermoUpload(h.client,h.profile,input,{fetcher:h.fetcher});const download=await thermoDownload(h.client,h.profile,receipt.id,null,{fetcher:h.fetcher});assert.deepEqual(Buffer.from(await download.response.arrayBuffer()),bytes);
  let row=await h.row(receipt.id);await thermoReportAction(h.client,h.profile,'approve',{id:row.id,revision:row.revision,request_id:randomUUID()},{fetcher:h.fetcher});row=await h.row(row.id);
  await assert.rejects(prepareThermoUpload(h.client,h.profile,{...input,request_id:randomUUID(),revision:row.revision}),/scheduled record|rejected/);assert.deepEqual(await h.row(row.id),row);
 }finally{await h.db.close();}
});
