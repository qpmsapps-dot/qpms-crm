import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile,unlink} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import JSZip from 'jszip';
import express from 'express';
import {thermoServiceFixture,syntheticThermoWorkbook} from './helpers/thermographyServiceFixture.js';
import {THERMO_MIME,THERMO_MAX_BYTES,validateThermoFile,validateThermoWorkbook} from '../services/thermographyWorkbook.js';
import {prepareThermoUpload,finalizeThermoUpload,thermoReportAction,thermoDownload,cleanupThermoUploads} from '../services/thermographyReportsService.js';
import {createThermographyReportsRouter} from '../routes/thermographyReportsRoutes.js';

test('workbook validation accepts original package with embedded images, formulas, formatting and multiple sheets; rejects malformed/unsupported/oversized files',async()=>{
 const bytes=await syntheticThermoWorkbook(),file=path.join(os.tmpdir(),'thermo-validator-'+randomUUID()+'.xlsx');
 try{
  await writeFile(file,bytes);assert.ok((await validateThermoWorkbook(file)).entries>4);
  const zip=await JSZip.loadAsync(bytes);assert.ok(Object.keys(zip.files).some(p=>p.startsWith('xl/media/')));
  for(const input of [{filename:'bad.xls',size:bytes.length},{filename:'../bad.xlsx',size:bytes.length},{filename:'safe.xlsx',size:THERMO_MAX_BYTES+1},{filename:'safe.xlsx',size:bytes.length,mime:'application/pdf'}])assert.throws(()=>validateThermoFile(input),/workbook|MiB|xlsx/);
  for(const corrupt of [Buffer.from('not a workbook'),bytes.subarray(0,bytes.length-4),Buffer.from(bytes)]){
   if(corrupt.length===bytes.length)corrupt[40]^=255;await writeFile(file,corrupt);await assert.rejects(validateThermoWorkbook(file),/archive|signature|size|validated|checksum/i);
  }
  const notXlsx=new JSZip();notXlsx.file('unrelated.txt','No workbook');await writeFile(file,await notXlsx.generateAsync({type:'nodebuffer'}));await assert.rejects(validateThermoWorkbook(file),/parts/);
 }finally{await unlink(file).catch(()=>{});}
});

test('real SQL + private Storage fixture: upload finalization, response-loss retry and original-byte downloads including previous versions',async()=>{
 const h=await thermoServiceFixture();try{
  const bytes=await syntheticThermoWorkbook(),input=h.payload(bytes),ticket=await prepareThermoUpload(h.client,h.profile,input);assert.equal(ticket.state,'pending');
  await assert.rejects(finalizeThermoUpload(h.client,h.profile,input,{fetcher:h.fetcher}),/not stored/);assert.equal((await h.row(ticket.inspection_id)).status,'Scheduled');
  const v=await h.upload(input,bytes);const retry=await prepareThermoUpload(h.client,h.profile,input);assert.equal(retry.version_id,ticket.version_id);assert.equal(retry.object_exists,true);assert.equal(retry.upload_url,undefined);
  const [a,b]=await Promise.all([finalizeThermoUpload(h.client,h.profile,input,{fetcher:h.fetcher}),finalizeThermoUpload(h.client,h.profile,input,{fetcher:h.fetcher})]);assert.deepEqual(a,b);
  assert.deepEqual(await finalizeThermoUpload(h.client,h.profile,input,{fetcher:h.fetcher}),a);
  const download=await thermoDownload(h.client,h.profile,a.id,null,{fetcher:h.fetcher});assert.deepEqual(Buffer.from(await download.response.arrayBuffer()),bytes);
  const r=await h.row(a.id);await thermoReportAction(h.client,h.profile,'reject',{id:r.id,revision:r.revision,request_id:randomUUID()});const rejected=await h.row(r.id);
  const revised=h.payload(bytes);Object.assign(revised,{id:r.id,revision:rejected.revision});await prepareThermoUpload(h.client,h.profile,revised);await h.upload(revised,bytes);await finalizeThermoUpload(h.client,h.profile,revised,{fetcher:h.fetcher});
  const old=await thermoDownload(h.client,h.profile,r.id,v.id,{fetcher:h.fetcher});assert.deepEqual(Buffer.from(await old.response.arrayBuffer()),bytes);
  await assert.rejects(thermoDownload(h.client,h.other,r.id,v.id,{fetcher:h.fetcher}),/authorized state/);
 }finally{await h.db.close();}
});

test('failed/corrupt/interrupted upload preserves previous report and cannot be approved; wrong-state and wrong-role writes fail',async()=>{
 const h=await thermoServiceFixture();try{
  const bytes=await syntheticThermoWorkbook(),input=h.payload(bytes);await assert.rejects(prepareThermoUpload(h.client,h.other,input),/assigned MEPC/);await assert.rejects(prepareThermoUpload(h.client,h.admin,input),/assigned MEPC/);
  const ticket=await prepareThermoUpload(h.client,h.profile,input);await h.upload(input,bytes);
  await assert.rejects(finalizeThermoUpload(h.client,h.profile,input,{fetcher:async()=>{throw Error('Synthetic interrupted stream');}}),/interrupted/);
  assert.equal((await h.row(ticket.inspection_id)).status,'Scheduled');
  await assert.rejects(thermoReportAction(h.client,h.profile,'approve',{id:ticket.inspection_id,revision:1,request_id:randomUUID()},{fetcher:h.fetcher}),/No confirmed/);
  await finalizeThermoUpload(h.client,h.profile,input,{fetcher:h.fetcher});let r=await h.row(ticket.inspection_id);
  await thermoReportAction(h.client,h.profile,'reject',{id:r.id,revision:r.revision,request_id:randomUUID()});r=await h.row(r.id);
  const bad=h.payload(bytes);Object.assign(bad,{id:r.id,revision:r.revision});await prepareThermoUpload(h.client,h.profile,bad);const corrupt=Buffer.from(bytes);corrupt[40]^=255;await h.upload(bad,corrupt);
  await assert.rejects(finalizeThermoUpload(h.client,h.profile,bad,{fetcher:h.fetcher}),/archive|checksum|validated/i);
  assert.equal((await h.row(r.id)).active_report_version_id,r.active_report_version_id);assert.equal((await h.row(r.id)).report_review_state,'rework');
 }finally{await h.db.close();}
});

test('approval needs only authorized MIS confirmation; missing physical workbook blocks approval and restoration',async()=>{
 const h=await thermoServiceFixture();try{
  const bytes=await syntheticThermoWorkbook(),input=h.payload(bytes),ticket=await prepareThermoUpload(h.client,h.profile,input);const v=await h.upload(input,bytes);await finalizeThermoUpload(h.client,h.profile,input,{fetcher:h.fetcher});let r=await h.row(ticket.inspection_id);
  const data={id:r.id,revision:r.revision,request_id:randomUUID()};const saved=await thermoReportAction(h.client,h.profile,'approve',data,{fetcher:h.fetcher});assert.deepEqual(await thermoReportAction(h.client,h.profile,'approve',data,{fetcher:h.fetcher}),saved);
  r=await h.row(r.id);await thermoReportAction(h.client,h.profile,'delete',{id:r.id,revision:r.revision,request_id:randomUUID()});r=await h.row(r.id);
  const stored=h.objects.get(v.object_path);h.objects.delete(v.object_path);
  await assert.rejects(thermoReportAction(h.client,h.admin,'restore',{id:r.id,revision:r.revision,request_id:randomUUID(),reason:'Authorized restore'},{fetcher:h.fetcher}),/missing/);
  h.objects.set(v.object_path,stored);await thermoReportAction(h.client,h.admin,'restore',{id:r.id,revision:r.revision,request_id:randomUUID(),reason:'Authorized restore'},{fetcher:h.fetcher});assert.equal((await h.row(r.id)).status,'Client Approved');
 }finally{await h.db.close();}
});

test('authenticated HTTP downloads preserve bytes, use safe filenames and never return private storage URLs',async()=>{
 const h=await thermoServiceFixture();let server;try{
  const bytes=await syntheticThermoWorkbook(),input=h.payload(bytes),ticket=await prepareThermoUpload(h.client,h.profile,input);await h.upload(input,bytes);await finalizeThermoUpload(h.client,h.profile,input,{fetcher:h.fetcher});
  const app=express();app.use((req,res,next)=>{if(req.get('authorization')==='Bearer synthetic-own'){req.profile=h.profile;req.authUser={id:h.profile.id};}else if(req.get('authorization')==='Bearer synthetic-other'){req.profile=h.other;req.authUser={id:h.other.id};}next();});app.use('/thermography',createThermographyReportsRouter({getClient:()=>h.client,options:{fetcher:h.fetcher},environment:{}}));server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const url=`http://127.0.0.1:${server.address().port}/thermography/reports/${ticket.inspection_id}/download`;
  assert.equal((await fetch(url)).status,401);assert.equal((await fetch(url,{headers:{authorization:'Bearer synthetic-other'}})).status,403);
  const listResponse=await fetch(`http://127.0.0.1:${server.address().port}/thermography/reports?from=${h.today}&to=${h.today}&page=0&limit=25`,{headers:{authorization:'Bearer synthetic-own'}});const listBody=await listResponse.json();assert.equal(listResponse.status,200,JSON.stringify(listBody));assert.equal(listBody.result.total,1);
  const downloaded=await fetch(url,{headers:{authorization:'Bearer synthetic-own'}});assert.equal(downloaded.status,200);assert.match(downloaded.headers.get('content-disposition'),/SYNTHETIC_Original.xlsx/);assert.match(downloaded.headers.get('cache-control'),/no-store/);assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()),bytes);
  const listing=await h.call(h.ids.mepc,'list',{from:h.today,to:h.today});assert.equal(JSON.stringify(listing).includes('object_path'),false);assert.equal(JSON.stringify(listing).includes('https://'),false);
 }finally{if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await h.db.close();}
});

test('cleanup reconciles only abandoned pending workbooks and never confirmed history',async()=>{
 const h=await thermoServiceFixture();try{
  const bytes=await syntheticThermoWorkbook(),input=h.payload(bytes);const ticket=await prepareThermoUpload(h.client,h.profile,input);const v=await h.upload(input,bytes);await finalizeThermoUpload(h.client,h.profile,input,{fetcher:h.fetcher});
  const abandoned=h.payload(bytes);await prepareThermoUpload(h.client,h.profile,abandoned);const old=await h.upload(abandoned,bytes);
  await h.db.transaction(async tx=>{await tx.query(`select set_config('myqpms.thermography_report_contract','reports.v1',true)`);await tx.query(`update retail_thermography_report_versions set prepared_at=clock_timestamp()-interval '25 hours' where id=$1`,[old.id]);});
  await assert.rejects(cleanupThermoUploads(h.client,h.profile),/Super Admin/);assert.equal((await cleanupThermoUploads(h.client,h.admin))[0].cleaned,true);assert.ok(h.objects.has(v.object_path));assert.ok(!h.objects.has(old.object_path));assert.equal((await h.row(ticket.inspection_id)).active_report_version_id,v.id);
 }finally{await h.db.close();}
});
