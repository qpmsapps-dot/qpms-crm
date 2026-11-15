import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import {EXPORT_LIMITS,indiaMonth,trainingMonthRange,filteredTrainingExportRows,loadMonthlyTrainingExport,collectTrainingExport,trainingExportFilename,trainingPhotoDimensions} from '../src/utils/trainingExport.js';
import {buildTrainingWorkbook,buildTrainingPresentation,containTrainingPhoto} from '../src/utils/trainingExportFiles.js';

// Synthetic fixtures only. No API, credentials, environment files, database or Storage access.
const store={id:'store-1',store_code:'0012',store_name:'SYNTHETIC TEST STORE',state:'Tamil Nadu',observed_zone_id:'zone-1'};
const snapshot={epoch_at:'2026-01-01',stores:[store],store_zone_history:[],assignments:[{zone_id:'zone-1',fo_profile_id:'fo-1',effective_from:'2026-01-01'}],zones:[{id:'zone-1',zone_name:'Synthetic Zone'}]};
const row=(id='session-hk',code='hk')=>({id,training_date:'2026-11-14',submitted_at:'2026-11-14T10:00:00Z',category:{code},store,trainer_name:'Synthetic Trainer',ownership:{zone_id:'zone-1',fo_profile_id:'fo-1'}});
const detail=(id='session-hk',code='hk')=>({session:{id,training_date:'2026-11-14',trainer_name_snapshot:'Synthetic Trainer',status:'submitted',submitted_at:'2026-11-14T10:00:00Z'},store,category:{code},attendees:[],topics:[{id:'topic-1',is_covered:true,topic:{module_name:'Synthetic safety topic',topic_description:'Recorded topic description'}}],evidence:[{id:'photo-1',file_name:'SYNTHETIC_PIXEL.png',mime_type:'image/png',file_size:68,evidence_type:'topic_photo'}]});
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j0L0AAAAASUVORK5CYII=';
function fixtureRequest(details={}) {
  const calls=[];
  const request=async config=>{calls.push(config);assert.equal(config.method,undefined);const path=config.url;if(path.endsWith('/view-url'))return {data:{view:{url:'https://example.invalid/private-photo?token=DO_NOT_EXPORT'}}};const id=decodeURIComponent(path.split('/').at(-1));return {data:details[id]||detail(id,id.includes('mepc')?'technical_mep':'hk')};};
  return {request,calls};
}
const readPhoto=async()=>({data:png,bytes:68,width:1,height:1});
test('photo headers and contain geometry preserve portrait and landscape aspect ratios',()=>{
  assert.deepEqual(trainingPhotoDimensions(new Uint8Array(Buffer.from(png.split(',')[1],'base64'))),{width:1,height:1});
  for(const [width,height] of [[4000,3000],[3000,4000]]){const box=containTrainingPhoto(width,height,.6,1.6,5.85,4.5);assert.ok(Math.abs(box.w/box.h-width/height)<.000001);assert.ok(box.w<=5.85&&box.h<=4.5);}
  assert.throws(()=>trainingPhotoDimensions(new Uint8Array([1,2,3])),/invalid/);
});
test('India calendar month and leap-year range do not use UTC month boundaries',()=>{
  assert.equal(indiaMonth(new Date('2026-10-31T19:00:00Z')),'2026-11');
  assert.deepEqual(trainingMonthRange('2028-02'),{from:'2028-02-01',to:'2028-02-29'});
  assert.throws(()=>trainingMonthRange('2026-13'),/valid/);
});
test('all dashboard filters and query preserve historical ownership and authorized rows',()=>{
  const rows=[row(),row('session-mepc','technical_mep')];
  assert.deepEqual(filteredTrainingExportRows(rows,snapshot,{state:'TN',class:'HK',zone:'zone-1',fo:'fo-1',store:'store-1'},'0012').map(s=>s.id),['session-hk']);
  assert.equal(filteredTrainingExportRows(rows,snapshot,{fo:'other'}).length,0);
  assert.throws(()=>filteredTrainingExportRows(rows,null,{zone:'zone-1'}),/unavailable/);
});
test('monthly export requests a fresh complete period report, not the visible page',async()=>{
  let params;
  const result=await loadMonthlyTrainingExport({request:async config=>{params=config.params;return {data:{report:{complete:true,rows:[row()]}}};},loadSnapshot:async()=>snapshot,month:'2026-11',filter:{class:'HK'},query:''});
  assert.deepEqual(params,{from:'2026-11-01',to:'2026-11-30'});assert.equal(result.rows.length,1);
  await assert.rejects(loadMonthlyTrainingExport({request:async()=>({data:{report:{rows:[]}}}),loadSnapshot:async()=>snapshot,month:'2026-11'}),/complete/);
});
test('denied session access aborts export and does not attempt evidence',async()=>{
  const denied=Object.assign(Error('Denied'),{response:{status:403}});let calls=0;
  await assert.rejects(collectTrainingExport({rows:[row()],request:async()=>{calls++;throw denied;}}),/Denied/);assert.equal(calls,1);
});
test('wrong session identity, class, or draft status cannot be exported',async()=>{
  for(const change of [{id:'wrong'},{status:'draft'}]){
    const d=detail();Object.assign(d.session,change);
    await assert.rejects(collectTrainingExport({rows:[row()],request:async()=>({data:d})}),/identity|submitted/);
  }
  const d=detail();d.category.code='other';await assert.rejects(collectTrainingExport({rows:[row()],request:async()=>({data:d})}),/class/);
});
test('duplicates do not inflate totals or download evidence twice',async()=>{
  const {request,calls}=fixtureRequest();const data=await collectTrainingExport({rows:[row(),row()],request,photos:true,readPhoto});
  assert.equal(data.sessions.length,1);assert.equal(calls.filter(c=>c.url.endsWith('/view-url')).length,1);assert.equal(data.sessions[0].evidence[0].image,png);
  assert.equal(JSON.stringify(data).includes('DO_NOT_EXPORT'),false);
});
test('missing optional attendance stays unknown while explicit zero remains zero',async()=>{
  const {request}=fixtureRequest();const data=await collectTrainingExport({rows:[row()],request});assert.equal(data.sessions[0].attendeeCount,null);
  const d=detail();d.session.attendee_count=0;const explicit=await collectTrainingExport({rows:[row()],request:fixtureRequest({'session-hk':d}).request});assert.equal(explicit.sessions[0].attendeeCount,0);
  d.attendees=[{id:'a1',employee_code:'0001',employee_name:'Synthetic attendee'}];delete d.session.attendee_count;
  const recorded=await collectTrainingExport({rows:[row()],request:fixtureRequest({'session-hk':d}).request});assert.equal(recorded.sessions[0].attendeeCount,1);
});
test('trainer code joins only the recorded trainer identity; changed dates abort stale exports',async()=>{
  const d=detail();d.session.trainer_profile_id='trainer-1';
  const data=await collectTrainingExport({rows:[row()],snapshot:{...snapshot,fos:[{id:'trainer-1',employee_code:'0009'}]},request:fixtureRequest({'session-hk':d}).request});
  assert.equal(data.sessions[0].trainerCode,'0009');
  d.session.training_date='2026-10-31';await assert.rejects(collectTrainingExport({rows:[row()],request:fixtureRequest({'session-hk':d}).request}),/date changed/);
});
test('pending photo authorization and failed downloads produce explicit partial warnings',async()=>{
  const base=fixtureRequest().request;
  const data=await collectTrainingExport({rows:[row()],photos:true,request:async config=>{if(config.url.endsWith('/view-url'))throw Object.assign(Error('Denied'),{response:{status:403}});return base(config);},readPhoto:async()=>{throw Error('must not download');}});
  assert.equal(data.sessions.length,1);assert.match(data.sessions[0].evidence[0].access,/denied or pending/);assert.ok(data.warnings.length>=2);
  const failed=await collectTrainingExport({rows:[row()],request:base,photos:true,readPhoto:async()=>{throw Error('Network');}});assert.match(failed.warnings.join(' '),/download failed/);
});
test('empty months and missing evidence create accurate warnings and valid workbooks',async()=>{
  const empty=await collectTrainingExport({rows:[],request:async()=>{throw Error('No request expected');}});assert.match(empty.warnings[0],/No submitted/);
  const d=detail();d.evidence=[];const missing=await collectTrainingExport({rows:[row()],request:fixtureRequest({'session-hk':d}).request,photos:true});assert.match(missing.warnings[0],/No authorized photographs/);
  const book=await buildTrainingWorkbook(empty,{title:'Empty month',scope:'2026-12'});const restored=new ExcelJS.Workbook();await restored.xlsx.load(await book.xlsx.writeBuffer());assert.equal(restored.getWorksheet('Sessions').rowCount,1);
});
test('size limits fail clearly without silently truncating selected sessions',async()=>{
  await assert.rejects(collectTrainingExport({rows:Array.from({length:EXPORT_LIMITS.sessions+1},(_,i)=>row('s'+i)),request:async()=>{throw Error('No requests expected');}}),/Narrow/);
  const d=detail();d.evidence[0].file_size=EXPORT_LIMITS.photoBytes+1;let downloads=0;
  const result=await collectTrainingExport({rows:[row()],request:fixtureRequest({'session-hk':d}).request,photos:true,readPhoto:async()=>{downloads++;return readPhoto();}});assert.equal(downloads,0);assert.match(result.warnings.join(' '),/limit/);
});
test('historical source records remain distinct from verified sessions',async()=>{
  const source={id:'ifms-excel-12',source_kind:'IFMS_EXCEL',training_class:'HK',training_date:'2026-11-14',source_data:{employee_name:'Source employee'}};
  const data=await collectTrainingExport({rows:[source],request:async()=>{throw Error('Not a session');}});
  assert.equal(data.sessions.length,0);assert.equal(data.historical.length,1);assert.match(data.warnings.join(' '),/not verified/);
  const book=await buildTrainingWorkbook(data,{title:'Historical source',scope:'Current view'});assert.equal(book.getWorksheet('Historical Excel source').getCell('G2').value,'Source employee');
});
test('filenames contain real session identities, store codes and period',()=>{
  assert.equal(trainingExportFilename({format:'xlsx',session:{id:'actual-id',storeCode:'0012',trainingClass:'HK',date:'2026-11-14'}}),'myQPMS_Training_HK_0012_2026-11-14_actual-id.xlsx');
  assert.equal(trainingExportFilename({format:'pptx',month:'2026-11'}),'myQPMS_Training_2026-11.pptx');
});
test('individual and monthly genuine XLSX/PPTX packages reopen with typed data, native tables and embedded evidence',async()=>{
  const output=pathToFileURL(path.resolve(process.env.TRAINING_EXPORT_OUTPUT_DIR||path.join(os.tmpdir(),'qpms-training-exports-v2-validation'))+path.sep);await mkdir(output,{recursive:true});
  for(const kind of ['individual','monthly']) {
    const rows=kind==='individual'?[row()]:[row(),row('session-mepc','technical_mep')];
    const d=detail('session-mepc','technical_mep');d.attendees=[{id:'a1',employee_code:'0007',employee_name:'Synthetic attendee',designation_snapshot:'Technician'}];
    const data=await collectTrainingExport({rows,snapshot,request:fixtureRequest({'session-mepc':d}).request,photos:true,readPhoto});
    const options={title:'SYNTHETIC Training validation',scope:kind==='monthly'?'2026-11':'session-hk'};
    const book=await buildTrainingWorkbook(data,options),xlsx=await book.xlsx.writeBuffer();await writeFile(new URL(`SYNTHETIC_${kind}.xlsx`,output),xlsx);
    const restored=new ExcelJS.Workbook();await restored.xlsx.load(xlsx);const sessions=restored.getWorksheet('Sessions');
    assert.equal(sessions.rowCount,rows.length+1);assert.ok(sessions.getCell('B2').value instanceof Date);assert.equal(sessions.getCell('H2').value,'0012');assert.equal(sessions.getCell('L2').value,'Not recorded');assert.equal(sessions.getCell('O2').value,1);
    if(kind==='monthly'){assert.equal(restored.getWorksheet('Summary').getCell('D3').value,2);assert.equal(restored.getWorksheet('Attendees').getCell('C3').value,'0007');}
    const ppt=await buildTrainingPresentation(data,options),pptx=await ppt.write({outputType:'nodebuffer'});await writeFile(new URL(`SYNTHETIC_${kind}.pptx`,output),pptx);
    const zip=await JSZip.loadAsync(pptx);assert.ok(zip.file('[Content_Types].xml'));assert.ok(zip.file('ppt/presentation.xml'));const slides=Object.keys(zip.files).filter(p=>/^ppt\/slides\/slide\d+\.xml$/.test(p));assert.ok(slides.length>=5);
    const xml=(await Promise.all(slides.map(p=>zip.file(p).async('string')))).join('');assert.match(xml,/Synthetic safety topic/);assert.match(xml,/session-hk/);assert.match(xml,/<a:tbl>/);assert.equal(xml.includes('DO_NOT_EXPORT'),false);
    assert.ok(Object.keys(zip.files).some(p=>/^ppt\/media\/.+\.png$/.test(p)));
    const allText=(await Promise.all(Object.keys(zip.files).filter(p=>p.endsWith('.xml')||p.endsWith('.rels')).map(p=>zip.file(p).async('string')))).join('');assert.equal(allText.includes('example.invalid'),false);assert.equal(allText.includes('DO_NOT_EXPORT'),false);
  }
});
test('dashboard modification is limited to export controls, with original review handler and details intact',async()=>{
  const source=await readFile(new URL('../src/pages/reliance-retail/RetailTraining.jsx',import.meta.url),'utf8');
  assert.match(source,/downloadUnified\(book, 'Retail_Training_Review.xlsx'\)/);assert.match(source,/TrainingExportControls rows=\{rows\}/);assert.match(source,/TrainingExportControls row=\{row\}/);
  const original=execFileSync('git',['-c',`safe.directory=${process.cwd()}`,'show','f15f390fcab107efd480f5889454fe8ca95c08ca:src/pages/reliance-retail/RetailTraining.jsx'],{encoding:'utf8'});
  const withoutExports=source.replaceAll('\r\n','\n').replace("import TrainingExportControls from '../../components/reliance-retail/TrainingExportControls.jsx';\n",'').replace(/<TrainingExportControls\b[^>]*>/g,'').replace(/<\/TrainingExportControls>/g,'');
  assert.equal(withoutExports.replaceAll('\r\n','\n'),original.replaceAll('\r\n','\n'),'Every pre-existing V2 feature must remain byte-for-byte unchanged after removing export wrappers.');
});
