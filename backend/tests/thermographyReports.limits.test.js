import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import ExcelJS from 'exceljs';
import {thermoServiceFixture} from './helpers/thermographyServiceFixture.js';
import {THERMO_MAX_BYTES,THERMO_MIME,validateThermoFile} from '../services/thermographyWorkbook.js';
import {thermoUploadLimit,prepareThermoUpload,finalizeThermoUpload,thermoDownload,thermoReportAction} from '../services/thermographyReportsService.js';
import {syntheticThermoWorkbook} from './helpers/thermographyServiceFixture.js';
import {randomUUID} from 'node:crypto';
import {THERMO_UPLOAD_LIMIT,validateThermoSelection} from '../../src/utils/thermographyReports.js';

test('100 MiB boundary agrees across browser, backend, prepared SQL constraint and bucket',()=>{
 assert.equal(THERMO_MAX_BYTES,104857600);assert.equal(THERMO_UPLOAD_LIMIT,THERMO_MAX_BYTES);
 const sql=readFileSync(new URL('../../supabase/migrations/20261115140000_retail_thermography_reports.sql',import.meta.url),'utf8');
 assert.match(sql,/file_size between 1 and 104857600/);assert.match(sql,/false,104857600/);
 const f={name:'SYNTHETIC.xlsx',filename:'SYNTHETIC.xlsx',size:THERMO_MAX_BYTES,type:THERMO_MIME};
 validateThermoSelection(f);validateThermoFile(f);
 assert.throws(()=>validateThermoSelection({...f,size:f.size+1}),/MiB/);assert.throws(()=>validateThermoFile({...f,size:f.size+1}),/MiB/);
});
test('backend advertises the lower actual private bucket limit; invalid policy/config fails before reservation',async()=>{
 const h=await thermoServiceFixture();try{
  assert.equal(await thermoUploadLimit(h.client),THERMO_MAX_BYTES);
  const bucket={public:false,file_size_limit:4*1024*1024,allowed_mime_types:[THERMO_MIME]};
  h.client.storage.getBucket=async()=>({data:bucket});assert.equal(await thermoUploadLimit(h.client,8*1024*1024),4*1024*1024);
  await assert.rejects(prepareThermoUpload(h.client,h.profile,{filename:'SYNTHETIC.xlsx',size:5*1024*1024}),/MiB/);
  assert.equal((await h.db.query('select count(*)::int n from retail_thermography_report_versions')).rows[0].n,0);
  for(const data of [{...bucket,public:true},{...bucket,file_size_limit:null},{...bucket,file_size_limit:THERMO_MAX_BYTES+1},{...bucket,allowed_mime_types:null}]){
   h.client.storage.getBucket=async()=>({data});await assert.rejects(thermoUploadLimit(h.client),/verification/);
  }
  await assert.rejects(thermoUploadLimit(h.client,THERMO_MAX_BYTES+1),/configuration/);
 }finally{await h.db.close();}
});

// Real valid PNG with incompressible synthetic pixels: exercise a photo-heavy
// original workbook without presenting invented operational thermal evidence.
function syntheticPng(){
 const crcTable=Uint32Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
 const chunk=(type,data)=>{const header=Buffer.from(type),out=Buffer.alloc(12+data.length);out.writeUInt32BE(data.length);header.copy(out,4);data.copy(out,8);let c=0xffffffff;for(const b of out.subarray(4,8+data.length))c=crcTable[(c^b)&255]^(c>>>8);out.writeUInt32BE((c^0xffffffff)>>>0,8+data.length);return out;};
 const width=2048,height=5200,raw=randomBytes((width*3+1)*height);for(let row=0;row<height;row++)raw[row*(width*3+1)]=0;
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=2;
 return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
test('30 and 60 MiB photo-heavy XLSX files retain images, formulas and original bytes through finalization',{timeout:120000},async()=>{
 const h=await thermoServiceFixture();try{
  for(const imageCount of [1,2]){
  const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('SYNTHETIC ONLY');sheet.getCell('A1').value='Synthetic image-size validation, not operational evidence';
  const png=syntheticPng();for(let i=0;i<imageCount;i++)sheet.addImage(book.addImage({buffer:png,extension:'png'}),'C3:N30');book.addWorksheet('Second worksheet').getCell('A1').value={formula:'1+1',result:2};
  const bytes=Buffer.from(await book.xlsx.writeBuffer());assert.ok(bytes.length>30*imageCount*1024*1024&&bytes.length<THERMO_MAX_BYTES);
  const input=h.payload(bytes),ticket=await prepareThermoUpload(h.client,h.profile,input);assert.ok(ticket.tus);assert.equal(ticket.tus.size,bytes.length);await h.upload(input,bytes);
  const receipt=await finalizeThermoUpload(h.client,h.profile,input,{fetcher:h.fetcher});const file=await thermoDownload(h.client,h.profile,receipt.id,null,{fetcher:h.fetcher});
  assert.deepEqual(Buffer.from(await file.response.arrayBuffer()),bytes);
  const opened=new ExcelJS.Workbook();await opened.xlsx.load(bytes);assert.equal(opened.worksheets.length,2);assert.deepEqual(opened.getImage(0).buffer,png);
  console.log('Synthetic embedded-image XLSX bytes: '+bytes.length);
  }
 }finally{await h.db.close();}
});

test('large-upload tickets retain one version, enforce state/role authorization and cannot replace an approved original',async()=>{
 const h=await thermoServiceFixture();try{
  const small=await syntheticThermoWorkbook(),pending={...h.payload(small),size:40*1024*1024};
  await assert.rejects(prepareThermoUpload(h.client,h.other,pending),/assigned MEPC/);
  await assert.rejects(prepareThermoUpload(h.client,h.admin,pending),/assigned MEPC/);
  const first=await prepareThermoUpload(h.client,h.profile,pending),retry=await prepareThermoUpload(h.client,h.profile,pending);
  assert.equal(first.version_id,retry.version_id);assert.equal(first.tus.request_id,pending.request_id);assert.equal(first.tus.bucket,'retail-thermography-reports');assert.match(first.tus.endpoint,/\/upload\/resumable\/sign$/);
  await assert.rejects(finalizeThermoUpload(h.client,h.profile,pending,{fetcher:h.fetcher}),/not stored/);
  const row=await h.row(first.inspection_id);assert.equal(row.status,'Scheduled');assert.equal(row.active_report_version_id,null);
  const input=h.payload(small);await prepareThermoUpload(h.client,h.profile,input);await h.upload(input,small);
  const receipt=await finalizeThermoUpload(h.client,h.profile,input,{fetcher:h.fetcher});let original=await h.row(receipt.id);
  await thermoReportAction(h.client,h.profile,'approve',{id:original.id,revision:original.revision,request_id:randomUUID()},{fetcher:h.fetcher});original=await h.row(original.id);
  await assert.rejects(prepareThermoUpload(h.client,h.profile,{...pending,request_id:randomUUID(),id:original.id,revision:original.revision}),/replace a rejected/);
  assert.deepEqual(await h.row(original.id),original);
  const download=await thermoDownload(h.client,h.profile,original.id,null,{fetcher:h.fetcher});assert.deepEqual(Buffer.from(await download.response.arrayBuffer()),small);
 }finally{await h.db.close();}
});
