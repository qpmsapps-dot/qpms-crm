import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {deflateRawSync,inflateRawSync} from 'node:zlib';
import http from 'node:http';
import express from 'express';
import XLSX from 'xlsx';
import {inspectAttendanceZip,parseAttendanceWorkbookStreaming,XLSX_LIMITS,acquireAttendancePreviewSlot} from '../services/retailAttendanceXlsx.js';
import {ATTENDANCE_COLUMNS,parseAttendanceWorkbook,validateAttendanceRows} from '../services/retailAttendanceService.js';
import {createRetailAttendanceRouter} from '../routes/retailAttendanceRoutes.js';

const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const parse=b=>parseAttendanceWorkbookStreaming(b,'fixture.xlsx',ATTENDANCE_COLUMNS);
function workbook({shared=false,date1904=false}={}){
 const w=XLSX.utils.book_new(),s=XLSX.utils.aoa_to_sheet([
  ['EP No','EP Name','Site Code','Att. Date','Att. Status','Class','Source evidence'],
  [17,'Employee','S1',date1904?44834:46296,'HD','House Keeping','Original & <notes> _x0041_'],
  ['E2','Other','S1','2026-10-01','P','MEPC',true],
 ]);
 s.A2.z='000000';s.G3={t:'n',v:3,f:'1+2'};w.Workbook={WBProps:{date1904}};
 XLSX.utils.book_append_sheet(w,s,'Attendance');return XLSX.write(w,{type:'buffer',bookType:'xlsx',bookSST:shared});
}
function parts(bytes){return [...inspectAttendanceZip(bytes,'source.xlsx').parts.values()].map(p=>({name:p.name,data:p.method===8?inflateRawSync(bytes.subarray(p.start,p.start+p.compressed)):bytes.subarray(p.start,p.start+p.compressed)}));}
const table=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^n>>>1:n>>>1;return n>>>0});
function crc(b){let c=0xffffffff;for(const v of b)c=table[(c^v)&255]^c>>>8;return(c^0xffffffff)>>>0;}
function zip(entries,{compressed=false,encrypted=false}={}){
 const locals=[],central=[];let offset=0;
 for(const {name,data:input}of entries){const data=Buffer.isBuffer(input)?input:Buffer.from(input),n=Buffer.from(name),body=compressed?deflateRawSync(data):data,local=Buffer.alloc(30),head=Buffer.alloc(46),flags=encrypted?1:0;
 local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(flags,6);local.writeUInt16LE(compressed?8:0,8);local.writeUInt32LE(crc(data),14);local.writeUInt32LE(body.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(n.length,26);
 head.writeUInt32LE(0x02014b50);head.writeUInt16LE(20,4);head.writeUInt16LE(20,6);head.writeUInt16LE(flags,8);head.writeUInt16LE(compressed?8:0,10);head.writeUInt32LE(crc(data),16);head.writeUInt32LE(body.length,20);head.writeUInt32LE(data.length,24);head.writeUInt16LE(n.length,28);head.writeUInt32LE(offset,42);
 locals.push(local,n,body);central.push(head,n);offset+=local.length+n.length+body.length;
 }
 const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...locals,directory,end]);
}
function mutate(name,transform,options){return zip(parts(workbook()).map(p=>p.name===name?{...p,data:transform(p.data.toString('utf8'))}:p),options);}
const category=code=>e=>e.code===code&&e.statusCode<500;

for(const shared of [false,true])for(const date1904 of [false,true])test(`stream parser preserves exact source/formula/date/identifier output (shared=${shared}, 1904=${date1904})`,async()=>{
 const b=workbook({shared,date1904}),a=parseAttendanceWorkbook(b,'fixture.xlsx'),s=await parse(b);
 assert.equal(digest(s),digest(a));
 const stores=[{id:'one',store_code:'S1',state:'TN'}];
 assert.equal(digest(validateAttendanceRows(s.rows,stores)),digest(validateAttendanceRows(a.rows,stores)));
});

test('external-link ZIP parts, macros, encryption and path traversal stay blocked',async()=>{
 for(const name of ['xl/vbaProject.bin','xl/externalLinks/externalLink1.xml','../evil.xml'])await assert.rejects(()=>parse(zip([...parts(workbook()),{name,data:'<blocked/>'}])),category('UNSAFE_XLSX'));
 await assert.rejects(()=>parse(zip(parts(workbook()),{encrypted:true})),category('UNSAFE_XLSX'));
});
test('external relationships (including numeric XML escapes) and disguised macro content types stay blocked',async()=>{
 const external=mutate('xl/_rels/workbook.xml.rels',s=>s.replace('</Relationships>','<Relationship Id="blocked" Type="http://example.invalid/hyperlink" Target="https://private.invalid" TargetMode="&#69;xternal"/></Relationships>'));
 await assert.rejects(()=>parse(external),category('UNSAFE_XLSX'));
 const macro=zip([...parts(workbook()),{name:'xl/disguised.bin',data:'payload'}]);
 await assert.rejects(()=>parse(macro),category('UNSAFE_XLSX'));
});
test('DTD/entity declarations and deeply nested XML are refused',async()=>{
 await assert.rejects(()=>parse(mutate('xl/worksheets/sheet1.xml',s=>s.replace('<worksheet','<!DOCTYPE worksheet [<!ENTITY payload "unsafe">]><worksheet'))),category('UNSAFE_XLSX'));
 await assert.rejects(()=>parse(mutate('xl/worksheets/sheet1.xml',()=>'<x>'.repeat(65)+'</x>'.repeat(65))),category('XLSX_RESOURCE_LIMIT'));
});
test('extreme compression ratio and declared ZIP bomb expansion are refused before inflation',async()=>{
 const bomb=zip([...parts(workbook()),{name:'extra.xml',data:'<x>'+'A'.repeat(400000)+'</x>'}],{compressed:true});
 await assert.rejects(()=>parse(bomb),category('XLSX_RESOURCE_LIMIT'));
 const big=Buffer.from(workbook()),dir=big.readUInt32LE(big.length-6);big.writeUInt32LE(XLSX_LIMITS.expandedBytes+1,dir+24);
 await assert.rejects(()=>parse(big),category('XLSX_RESOURCE_LIMIT'));
});
test('lying ZIP sizes, CRC mismatch, truncated ZIP and malformed XML are rejected',async()=>{
 const b=zip(parts(workbook()),{compressed:true}),d=b.readUInt32LE(b.length-6);b.writeUInt32LE(1,d+24);b.writeUInt32LE(1,22);
 await assert.rejects(()=>parse(b),category('INVALID_XLSX'));
 const c=Buffer.from(workbook()),p=[...inspectAttendanceZip(c,'a.xlsx').parts.values()][0];c[p.start]^=1;
 await assert.rejects(()=>parse(c),category('INVALID_XLSX'));
 await assert.rejects(()=>parse(workbook().subarray(0,100)),category('INVALID_XLSX'));
 await assert.rejects(()=>parse(mutate('xl/worksheets/sheet1.xml',s=>s.replace('</worksheet>',''))),category('INVALID_XLSX'));
});
test('row, column, cell-text and large CDATA budgets are enforced before audit insertion',async()=>{
 for(const dimension of ['A1:AR100002','A1:CX2'])await assert.rejects(()=>parse(mutate('xl/worksheets/sheet1.xml',s=>s.replace(/<dimension[^>]*\/>/,`<dimension ref="${dimension}"/>`))),category('XLSX_RESOURCE_LIMIT'));
 await assert.rejects(()=>parse(mutate('xl/worksheets/sheet1.xml',s=>s.replace('<sheetData>','<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>'+'A'.repeat(32768)+'</t></is></c></row>'))),category('XLSX_RESOURCE_LIMIT'));
 await assert.rejects(()=>parse(mutate('xl/worksheets/sheet1.xml',()=>'<worksheet><x><![CDATA['+'>'.repeat(530000)+']]></x></worksheet>')),category('XLSX_RESOURCE_LIMIT'));
});
test('mandatory formulas remain blocked, only one attendance sheet allowed',async()=>{
 const b=workbook(),w=XLSX.read(b,{type:'buffer'});w.Sheets.Attendance.A2.f='1+1';
 await assert.rejects(()=>parse(XLSX.write(w,{type:'buffer',bookType:'xlsx'})),category('INVALID_XLSX'));
 delete w.Sheets.Attendance.A2.f;XLSX.utils.book_append_sheet(w,w.Sheets.Attendance,'Duplicate');
 await assert.rejects(()=>parse(XLSX.write(w,{type:'buffer',bookType:'xlsx'})),category('INVALID_XLSX'));
});
test('shared/array formula attributes are retained as source evidence without evaluating formulas',async()=>{
 const b=mutate('xl/worksheets/sheet1.xml',s=>s.replace('<f>1+2</f>','<f t="shared" si="0" ref="G3:G4">1+2</f>'));
 const p=await parse(b);assert.equal(p.rows[1].raw_formulas[6],'1+2');
 assert.deepEqual(p.rows[1].raw_formula_attributes[6],{t:'shared',si:'0',ref:'G3:G4'});
});
test('only one active preview/audit can retain parsed source at a time; slot releases cleanly',()=>{
 const release=acquireAttendancePreviewSlot();assert.throws(()=>acquireAttendancePreviewSlot(),e=>e.code==='XLSX_RESOURCE_LIMIT'&&e.statusCode===429);release();acquireAttendancePreviewSlot()();
});
test('HTTP diagnostics expose safe category/message only, without paths, contents or stack',async()=>{
 let queried=false;const app=express();app.use((req,_res,next)=>{req.profile={id:'admin',role:'Admin',is_active:true};next()});app.use('/attendance',createRetailAttendanceRouter({getClient:()=>({from(){queried=true;throw Error('Must not query')}}),environment:{RETAIL_ATTENDANCE_ENABLED:'true'}}));
 const server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{for(const [bytes,code]of [[Buffer.from('PRIVATE INTERNAL CONTENT'),'INVALID_XLSX'],[zip(parts(workbook()),{encrypted:true}),'UNSAFE_XLSX']]){const r=await fetch(`http://127.0.0.1:${server.address().port}/attendance/preview`,{method:'POST',headers:{'Content-Type':'application/octet-stream','X-File-Name':'C%3A%2Fprivate%2Fsecret.xlsx'},body:bytes});assert.equal(r.status,400);const body=await r.json();assert.equal(body.code,code);assert.deepEqual(Object.keys(body).sort(),['code','message','ok']);assert.doesNotMatch(JSON.stringify(body),/PRIVATE|private|secret|stack|Error:|node_modules/);}assert.equal(queried,false);}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
});
test('genuine user workbook parses within bounded streaming budgets', {skip:!process.env.RETAIL_ATTENDANCE_GENUINE_FILE,timeout:90000},async()=>{
 const b=readFileSync(process.env.RETAIL_ATTENDANCE_GENUINE_FILE);assert.equal(b.length,11534036);assert.equal(createHash('sha256').update(b).digest('hex'),'987a4d77477a0a5c39c6aee6b368d637be8014b3076b2d598d62046f4546a4d7');
 const p=await parse(b);assert.equal(p.rows.length,64838);assert.equal(p.headers.length,44);assert.equal(new Set(p.rows.map(r=>r.attendance_date)).size,27);
});
