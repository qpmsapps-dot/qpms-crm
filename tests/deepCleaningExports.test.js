import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import {loadCleaningExport,collectCleaningExport,cleaningExportFilename,webpDimensions,indiaMonth} from '../src/utils/deepCleaningExport.js';
import {buildCleaningWorkbook,buildCleaningPresentation} from '../src/utils/deepCleaningExportFiles.js';

const store={id:'store-1',store_code:'0012',store_name:'SYNTHETIC TEST STORE',state:'Tamil Nadu'};
const row=(id='synthetic-cleaning-1',extra={})=>({id,store,status:'submitted',deep_cleaning_date:'2026-11-14',submitted_at:'2026-11-14T10:00:00Z',fo_name:'Synthetic FO',submitted_by_employee_code:'0007',...extra});
const range={from:'2026-11-01',to:'2026-11-30'};
const uploads=['before','after','checklist'].map((type,i)=>({id:'synthetic-evidence-'+i,type,name:'SYNTHETIC_'+type+(i===2?'.pdf':'.png'),mime_type:i===2?'application/pdf':'image/png',url:'https://example.invalid/private?token=NEVER_RETAIN'}));
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j0L0AAAAASUVORK5CYII=';
const readPhoto=async()=>({data:png,bytes:68,width:1,height:1});
function fixture(rows=[row()]){const calls=[];return {calls,request:async c=>{calls.push(c);assert.equal(c.method,undefined);return {data:c.url.endsWith('/evidence')?{uploads}:{report:{...range,submissions:rows,stores:[store],schedules:null}}};}};}

test('India default month uses Asia/Kolkata',()=>assert.equal(indiaMonth(new Date('2026-10-31T20:00:00Z')),'2026-11'));
test('fresh monthly report preserves state/store/status/search and filters actual cleaning dates',async()=>{
  const f=fixture([row(),row('duplicate'),row('outside',{deep_cleaning_date:'2026-10-31'}),row('draft',{status:'draft'}),row('historical',{source_kind:'IFMS_EXCEL'}),row()]);
  const loaded=await loadCleaningExport({request:f.request,month:'2026-11',filter:{state:'TN',store:'store-1',status:'submitted',query:'Synthetic FO'}});
  assert.deepEqual(f.calls[0].params,{...range,state:'TN',store:'store-1'});assert.deepEqual(loaded.rows.map(r=>r.id),['synthetic-cleaning-1','duplicate']);
  assert.equal((await loadCleaningExport({request:f.request,month:'2026-11',filter:{query:'no-match'}})).rows.length,0);
});
test('incomplete reports, unresolved identities and stale individual records fail closed',async()=>{
  for(const report of [{...range,submissions:[]},{...range,submissions:[],stores:[],complete:false},{...range,submissions:[row('x',{store:{...store,id:'wrong'}})],stores:[store],schedules:null}])await assert.rejects(loadCleaningExport({request:async()=>({data:{report}}),month:'2026-11'}),/incomplete|identity/);
  await assert.rejects(loadCleaningExport({request:fixture().request,month:'2026-11',row:row('missing')}),/no longer available/);
  await assert.rejects(loadCleaningExport({request:fixture().request,month:'2026-11',row:row(undefined,{deep_cleaning_date:'2026-11-13'})}),/no longer available/);
});
test('report authorization failure prevents all evidence access',async()=>{
  let calls=0;await assert.rejects(loadCleaningExport({request:async()=>{calls++;throw Object.assign(Error('Denied'),{response:{status:403}});},month:'2026-11'}),/Denied/);assert.equal(calls,1);
});
test('confirmed evidence is deduplicated, paired labels retained, signed URLs never retained',async()=>{
  const f=fixture();const data=await collectCleaningExport({rows:[row(),row()],params:range,request:async c=>{f.calls.push(c);return {data:{uploads:[...uploads,uploads[0]]}};},photos:true,readPhoto});
  assert.equal(data.records.length,1);assert.equal(data.records[0].evidence.length,3);assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0].params,range);
  assert.deepEqual(data.records[0].evidence.filter(e=>e.image).map(e=>e.type),['before','after']);assert.equal(JSON.stringify(data).includes('NEVER_RETAIN'),false);assert.equal(data.warnings.length,0);
});
test('Excel authorizes manifest without downloading images',async()=>{
  const data=await collectCleaningExport({rows:[row()],params:range,request:fixture().request,readPhoto:()=>{throw Error('Unexpected download');}});
  assert.equal(data.records[0].evidence.length,3);assert.ok(data.records[0].evidence.every(e=>!e.image));
});
test('evidence denied, absent, malformed URLs and failed downloads are explicit partial warnings',async()=>{
  for(const request of [async()=>{throw Object.assign(Error('Denied'),{response:{status:403}});},async()=>({data:{uploads:[]}}),async()=>({data:{uploads:[{...uploads[0],url:'http://example.invalid'}]}}),fixture().request]) {
    const data=await collectCleaningExport({rows:[row()],params:range,request,photos:true,readPhoto:async()=>{throw Error('Contains private URL? token=SECRET');}});
    assert.ok(data.warnings.length);assert.ok(data.warnings.some(w=>w.includes('BEFORE')));assert.equal(JSON.stringify(data).includes('SECRET'),false);assert.equal(data.records[0].evidence.filter(e=>e.image).length,0);
  }
});
test('export budgets fail explicitly rather than silently truncate records or evidence',async()=>{
  await assert.rejects(collectCleaningExport({rows:Array.from({length:501},(_,i)=>row(String(i))),request:fixture().request}),/500/);
  await assert.rejects(collectCleaningExport({rows:[row()],request:async()=>({data:{uploads:Array.from({length:2001},(_,i)=>({...uploads[0],id:String(i)}))}})}),/Too many evidence/);
});
test('missing FO/timestamps stay Not recorded; empty months generate honest reports',async()=>{
  const data=await collectCleaningExport({rows:[row('missing',{fo_name:undefined,submitted_by_employee_code:undefined,submitted_at:undefined})],request:fixture().request});
  const book=await buildCleaningWorkbook(data,{title:'SYNTHETIC',scope:'Test'});assert.equal(book.getWorksheet('Submissions').getCell('F2').value,'Not recorded');assert.equal(book.getWorksheet('Submissions').getCell('I2').value,'Not recorded');
  const empty=await collectCleaningExport({rows:[],request:()=>{throw Error('No requests expected');}});assert.match(empty.warnings[0],/No submitted/);assert.ok(await buildCleaningPresentation(empty,{title:'SYNTHETIC empty month',scope:'Test'}));
});
test('WebP dimensions are parsed before decoding, malformed files rejected',()=>{
  const b=new Uint8Array(30);b.set(Buffer.from('RIFF'),0);b.set(Buffer.from('WEBPVP8X'),8);b[24]=99;b[27]=49;assert.deepEqual(webpDimensions(b),{width:100,height:50});assert.throws(()=>webpDimensions(new Uint8Array(10)),/Invalid/);
});
test('dashboard is unchanged apart from the new export import and wrappers',()=>{
  const file='src/pages/reliance-retail/RetailScopedDeepCleaning.jsx';const original=execFileSync('git',['-c',`safe.directory=${process.cwd()}`,'show',`ffcdf2718582d25a8d4b11530fc84fe474af9850:${file}`],{encoding:'utf8'}).replaceAll('\r\n','\n');
  const current=readFileSync(file,'utf8').replaceAll('\r\n','\n').replace(/^import DeepCleaningExportControls[^\n]+\n/m,'').replace(/<DeepCleaningExportControls [^>]+>/g,'').replaceAll('</DeepCleaningExportControls>','');assert.equal(current,original);
});
test('individual and monthly XLSX/PPTX are genuine packages with correct typed data and no signed links',async()=>{
  const out=process.env.CLEANING_EXPORT_OUTPUT_DIR||path.join(os.tmpdir(),'qpms-cleaning-export-validation');await mkdir(out,{recursive:true});
  const data=await collectCleaningExport({rows:[row()],params:range,request:fixture().request,photos:true,readPhoto});
  for(const mode of ['individual','monthly']) {
    const options={title:`SYNTHETIC TEST - ${mode} Deep Cleaning`,scope:'SYNTHETIC fixtures only | November 2026'};
    const book=await buildCleaningWorkbook(data,options),bytes=await book.xlsx.writeBuffer();await writeFile(path.join(out,`SYNTHETIC_${mode}.xlsx`),bytes);
    const reopened=new ExcelJS.Workbook();await reopened.xlsx.load(bytes);assert.equal(reopened.worksheets.length,5);assert.equal(reopened.getWorksheet('Submissions').getCell('C2').value,'0012');assert.ok(reopened.getWorksheet('Submissions').getCell('E2').value instanceof Date);assert.equal(reopened.getWorksheet('Submissions').getCell('J2').value,3);
    const deck=await buildCleaningPresentation(data,options),ppt=await deck.write({outputType:'nodebuffer'});await writeFile(path.join(out,`SYNTHETIC_${mode}.pptx`),ppt);
    for(const packageBytes of [bytes,ppt]){const zip=await JSZip.loadAsync(packageBytes);const xml=(await Promise.all(Object.keys(zip.files).filter(p=>p.endsWith('.xml')||p.endsWith('.rels')).map(p=>zip.file(p).async('string')))).join('\n');assert.equal(xml.includes('NEVER_RETAIN'),false);assert.equal(xml.includes('https://example.invalid'),false);assert.ok(xml.includes('0012'));}
    const zip=await JSZip.loadAsync(ppt);assert.ok(Object.keys(zip.files).some(p=>p.startsWith('ppt/media/')));const slides=(await Promise.all(Object.keys(zip.files).filter(p=>/^ppt\/slides\/slide\d+\.xml$/.test(p)).map(p=>zip.file(p).async('string')))).join('');assert.ok(slides.includes('BEFORE'));assert.ok(slides.includes('AFTER'));assert.ok(slides.includes('SYNTHETIC_checklist.pdf'));
  }
  assert.match(cleaningExportFilename({format:'xlsx',month:'2026-11',range}),/2026-11.xlsx$/);
});
