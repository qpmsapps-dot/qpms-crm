import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import {thermoMonthRange,thermoFileIdentity,validateThermoSelection,thermoPendingKey,readThermoPending,saveThermoPending,thermoOperation,loadThermoExport,buildThermoSummary} from '../src/utils/thermographyReports.js';
import {thermographyReport} from '../backend/shared/retailOperations.js';
import {moduleMetric} from '../src/utils/retailExecutiveReport.js';

const storage=()=>{const m=new Map();return {getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};};
test('original-file identity is bounded and stable; invalid formats and oversized selections fail before upload',async()=>{
 const bytes=new Uint8Array(30);bytes.set([80,75,3,4]);const file=new File([bytes],'SYNTHETIC.xlsx',{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
 assert.equal((await thermoFileIdentity(file)).length,64);assert.equal(await thermoFileIdentity(file),await thermoFileIdentity(file));
 assert.throws(()=>validateThermoSelection(new File([bytes],'bad.xls')),/xlsx/);assert.throws(()=>validateThermoSelection({name:'large.xlsx',size:101*1024*1024}),/100 MiB/);
 await assert.rejects(thermoFileIdentity(new File([new Uint8Array(30)],'fake.xlsx')),/signature/);assert.deepEqual(thermoMonthRange('2028-02'),{from:'2028-02-01',to:'2028-02-29'});
});
test('retry identities survive repeated calls, stay actor scoped and do not claim local workbook persistence',()=>{
 const s=storage(),pending={payload:{request_id:crypto.randomUUID(),filename:'SYNTHETIC.xlsx',source_sha256:'a'.repeat(64)}};
 saveThermoPending(s,'one',pending);assert.deepEqual(readThermoPending(s,'one'),pending);assert.equal(readThermoPending(s,'two'),null);assert.ok(!JSON.stringify(readThermoPending(s,'one')).includes('bytes'));
 const id=thermoOperation(s,'action-one',{id:'r',revision:1});assert.equal(thermoOperation(s,'action-one',{id:'r',revision:1}),id);assert.notEqual(thermoOperation(s,'action-two',{id:'r',revision:1}),id);assert.ok(s.getItem(thermoPendingKey('one')));
 assert.throws(()=>saveThermoPending({getItem:()=>null,setItem:()=>{}},'one',pending),/retained/);
});
test('export uses complete server-filtered pages and cancels on concurrent changes, duplicates or excessive selection',async()=>{
 const filter={from:'2026-11-01',to:'2026-11-30',state:'TN',store:'s',status:'awaiting',q:'0012'};const calls=[];
 const report={contract:'thermography-reports.v1',scope_digest:'synthetic-snapshot',total:2,counts:{awaiting:2},rows:[{id:'r1'}]};
 const data=await loadThermoExport(async p=>{calls.push(p);return {...report,rows:[{id:p.page?'r2':'r1'}]};},filter);assert.equal(data.rows.length,2);assert.deepEqual(calls.map(c=>c.state),['TN','TN']);assert.equal(calls[1].q,'0012');
 for(const scenario of ['changed','duplicate','too-large'])await assert.rejects(loadThermoExport(async p=>({...report,total:scenario==='too-large'?5001:2,scope_digest:scenario==='changed'&&p.page?'other':report.scope_digest,rows:[{id:'r1'}]}),filter),/changed|pagination|5,000/);
});
test('summary XLSX preserves dates, identifier types, missing values and accurate upload terminology',async()=>{
 const row={id:'r',state:'TN',store_code:'0012',store_name:'SYNTHETIC',report_date:'2026-11-14',status:'Completed',display_status:'Awaiting Client Approval — Revised',version_number:3,report_rework_count:2,filename:'SYNTHETIC.xlsx',file_size:123,active_version_id:'v3',uploaded_at:'2026-11-15T10:00:00Z'};
 const book=await buildThermoSummary({rows:[row],counts:{awaiting:1,approved:0,active_reports:1},total:1},{from:'2026-11-01',to:'2026-11-30',q:'0012'});const bytes=await book.xlsx.writeBuffer(),read=new ExcelJS.Workbook();await read.xlsx.load(bytes);const detail=read.getWorksheet('Report details');assert.equal(detail.getCell('C2').value,'0012');assert.equal(detail.getCell('H2').value,3);assert.equal(detail.getCell('N2').value,'Not recorded');assert.ok(detail.getCell('E2').value instanceof Date);assert.equal(detail.getCell('Q2').value,'Confirmed original workbook');
 const zip=await JSZip.loadAsync(bytes),xml=(await Promise.all(Object.keys(zip.files).filter(p=>p.endsWith('.xml')).map(p=>zip.file(p).async('string')))).join('');assert.equal(xml.includes('Evidence verified'),false);assert.equal(xml.includes('signedUrl'),false);assert.equal(xml.includes('Not Normal'),false);
});
test('Thermography dashboard excludes soft-deleted reports and separates rework, approval and thermal-condition concepts',()=>{
 const source={today:'2026-11-15',stores:[{id:'s',state:'TN'}],events:[],thermography:[
  {id:'rework',retail_store_id:'s',report_managed:true,status:'Completed',report_review_state:'rework',active_report_version_id:'v1',approval_due_on:'2026-11-01'},
  {id:'approved',retail_store_id:'s',report_managed:true,status:'Client Approved',report_review_state:'approved',active_report_version_id:'v2'},
  {id:'deleted',retail_store_id:'s',report_managed:true,status:'Client Approved',active_report_version_id:'v3',report_deleted_at:'2026-11-15'}]};
 const r=thermographyReport(source,'2026-11');assert.equal(r.total.approved,1);assert.equal(r.total.rework,1);assert.equal(r.total.awaiting,0);assert.equal(r.total.overdue,0);assert.equal(r.total.active_reports,2);
 const metric=moduleMetric({modules:{thermography:{status:'ready',rows:r.states}}},'thermography');assert.equal(metric.value,1);assert.equal(metric.counts['Rework Required'],1);assert.equal(Object.hasOwn(metric.counts,'Normal'),false);
});
test('unrelated modules, mobile, existing migrations/policies and shared maintenance calculations retain their committed source',()=>{
 const git=args=>execFileSync('git',['-c',`safe.directory=${process.cwd()}`,...args],{encoding:'utf8'}),base='f23bb8ac03afcba3222b9738369a01043ede2d11';
 const paths=['Mobile_FO_V2','src/pages/reliance-retail/RetailTraining.jsx','src/pages/reliance-retail/RetailScopedDeepCleaning.jsx','src/pages/reliance-retail/RetailAttendance.jsx','backend/server.js','backend/services/clientDeepCleaningService.js','backend/services/trainingService.js','backend/services/retailAttendanceService.js','src/pages/FOActivities.jsx'];assert.equal(git(['diff','--name-only',base,'--',...paths]).trim(),'');
 const file='backend/shared/retailOperations.js';assert.equal(readFileSync(file,'utf8').replaceAll('\r\n','\n').split('export function thermographyReport')[0],git(['show',base+':'+file]).replaceAll('\r\n','\n').split('export function thermographyReport')[0]);
 const routes='backend/routes/relianceRetailManagementRoutes.js',routeSource=readFileSync(routes,'utf8').replaceAll('\r\n','\n').replace(/^import \{createThermographyReportsRouter\}[^\n]+\n/m,'').replace(/^  \/\/ Thermography-specific RPCs[^\n]+\n  router.use\('\/mis\/thermography',createThermographyReportsRouter\(\{getClient\}\)\);\n/m,'');assert.equal(routeSource,git(['show',base+':'+routes]).replaceAll('\r\n','\n'));
 const service='backend/services/retailModuleReportService.js',serviceSource=readFileSync(service,'utf8').replaceAll('\r\n','\n').replace('(t.report_date||t.scheduled_date)<=range.to','t.scheduled_date<=range.to');assert.equal(serviceSource,git(['show',base+':'+service]).replaceAll('\r\n','\n'));
 for(const file of git(['diff','--name-only',base,'--','supabase/migrations']).trim().split('\n').filter(Boolean))assert.equal(file,'supabase/migrations/20261115140000_retail_thermography_reports.sql');
 const mis='src/pages/reliance-retail/RetailMisWorkspace.jsx',current=readFileSync(mis,'utf8').replaceAll('\r\n','\n').replace(/^import ThermographyReports[^\n]+\n/m,'').replace(/export default function RetailMisWorkspace\(\)\{\n const \{module\}=useParams\(\);\n return module==='thermography'\?<ThermographyReports\/>:<RetailMisExistingWorkspace\/>;\n\}\nfunction RetailMisExistingWorkspace\(\)\{/,'export default function RetailMisWorkspace(){');assert.equal(current,git(['show',base+':'+mis]).replaceAll('\r\n','\n'));
});
