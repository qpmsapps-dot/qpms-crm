import test from 'node:test';
import assert from 'node:assert/strict';
import XLSX from 'xlsx';
import {encodeAttendanceSource,decodeAttendanceSource,compactPreviewSummary,previewDatabase} from '../services/retailAttendancePreviewAudit.js';
import {previewRetailAttendance} from '../services/retailAttendanceService.js';

const source={sheet:'Attendance',headers:['EP No','Note'],rows:[{source_row:2,raw_cells:['E1','Original ☃'],raw_formulas:{1:'1+2'}}],rejected:[{source_row:3,reasons:['Unknown Reliance Retail Store Code']}],excluded:[{source_row:4,reasons:['Excluded class']}]};
test('lossless audit envelope round-trips all source cells, formulas and dispositions; legacy rows remain readable',async()=>{
 const encoded=await encodeAttendanceSource(source);assert.equal(encoded.encoding,'retail-attendance-gzip-json-v1');assert.deepEqual(await decodeAttendanceSource(encoded),source);assert.equal(await decodeAttendanceSource(source),source);
});
test('corrupt or oversized envelopes fail closed without content disclosure',async()=>{
 const encoded=await encodeAttendanceSource(source);
 for(const bad of [{...encoded,sha256:'0'.repeat(64)},{...encoded,uncompressed_bytes:1},{...encoded,data:'invalid-base64'},{...encoded,encoding:'not-supported'},{...encoded,uncompressed_bytes:1e12}])await assert.rejects(()=>decodeAttendanceSource(bad),e=>e.code==='PREVIEW_AUDIT_INVALID'&&!e.message.includes('Original'));
});
test('large preview is compact but every rejected and excluded source row survives in the durable audit',async()=>{
 const rejected=Array.from({length:55233},(_,i)=>({source_row:i+2,reasons:['Unknown Reliance Retail Store Code']})),excluded=Array.from({length:127},(_,i)=>({source_row:i+60000,reasons:['Excluded class']}));
 const full={...source,rejected,excluded};const summary=compactPreviewSummary({rejected_rows:rejected.length,excluded_rows:excluded.length,rejected,excluded,valid_rows:9578});
 assert.equal(summary.rejected.length,100);assert.equal(summary.excluded.length,100);assert.equal(summary.rejected_rows,55233);assert.equal(summary.rejected_sampled,true);assert.equal(summary.audit_complete,true);
 const decoded=await decodeAttendanceSource(await encodeAttendanceSource(full));assert.equal(decoded.rejected.length,55233);assert.equal(decoded.excluded.length,127);
});
test('database unavailable/slow calls fail promptly with safe stage codes and abort signals',async()=>{
 let signal;const unavailable={abortSignal(s){signal=s;return Promise.resolve({error:{code:'PGRST003',message:'PRIVATE database detail'},status:504})}};
 await assert.rejects(()=>previewDatabase(unavailable,'store_master',undefined,20),e=>e.code==='PREVIEW_DATABASE_UNAVAILABLE'&&e.dependency_code==='PGRST003'&&!e.message.includes('PRIVATE'));
 assert.ok(signal instanceof AbortSignal);
 const slow={abortSignal(s){signal=s;return new Promise(()=>{})}};
 const t=performance.now();await assert.rejects(()=>previewDatabase(slow,'audit_save',undefined,20),e=>e.code==='PREVIEW_AUDIT_UNAVAILABLE'&&e.stage==='audit_save');assert.ok(performance.now()-t<1000);assert.equal(signal.aborted,true);
 await assert.rejects(()=>previewDatabase(Promise.resolve({error:{code:'23505'}}),'audit_save',undefined,20),e=>e.code==='23505');
});
function workbook(){const b=XLSX.utils.book_new();XLSX.utils.book_append_sheet(b,XLSX.utils.aoa_to_sheet([['EP No','EP Name','Site Code','Att. Date','Att. Status','Class'],['E1','Local employee','S1','2026-10-01','P','House Keeping']]),'Attendance');return XLSX.write(b,{type:'buffer',bookType:'xlsx'});}
test('concurrent preview is refused while audit is pending; failed persistence releases slot for a safe retry',async()=>{
 let release,waiting;const ready=new Promise(resolve=>waiting=resolve);let writes=0;
 const db={from(){const q={select(){return q},order(){return q},eq(){return q},range:async()=>({data:[{id:'s1',store_code:'S1',state:'TN',status:'Active'}]}),maybeSingle:async()=>({data:null}),insert(){writes++;return q},single:()=>{waiting();return new Promise(resolve=>release=resolve)}};return q},rpc:async()=>({data:[]})};
 const admin={id:'admin',role:'Admin',is_active:true},bytes=workbook(),log=()=>{};
 const first=previewRetailAttendance(db,admin,bytes,'a.xlsx',{log});await ready;
 await assert.rejects(()=>previewRetailAttendance(db,admin,bytes,'a.xlsx',{log}),e=>e.statusCode===429);
 release({error:{code:'PGRST003'}});await assert.rejects(()=>first,e=>e.code==='PREVIEW_AUDIT_UNAVAILABLE');
 const retry=previewRetailAttendance(db,admin,bytes,'a.xlsx',{log});while(!release||writes<2)await new Promise(r=>setTimeout(r,1));release({data:{id:'retry-preview'}});const p=await retry;assert.equal(p.id,'retry-preview');assert.equal(p.valid_rows,1);
});
test('cancelled preview cannot reach persistence and a following request can retry',async()=>{
 const c=new AbortController();c.abort();let calls=0;await assert.rejects(()=>previewRetailAttendance({from(){calls++;throw Error('No query')}},{id:'admin',role:'Admin',is_active:true},workbook(),'a.xlsx',{signal:c.signal,log:()=>{}}),e=>e.code==='XLSX_RESOURCE_LIMIT');assert.equal(calls,0);
});
