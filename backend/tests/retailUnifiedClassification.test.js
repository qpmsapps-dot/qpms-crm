import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import XLSX from 'xlsx';
import {sourceNoteIssues,classifyUnifiedRow,IMPORT_CLASSIFICATIONS} from '../shared/retailUnifiedClassification.js';
import {parseUnifiedMaster,previewUnifiedMaster} from '../services/retailUnifiedImport.js';
import {buildUnifiedReview} from '../../src/utils/retailUnifiedExport.js';
const file=process.env.RETAIL_CLASSIFICATION_WORKBOOK,snapshotFile=process.env.RETAIL_CLASSIFICATION_SNAPSHOT,reviewFile=process.env.RETAIL_CLASSIFICATION_REVIEW;
const pending=['ZONE_PENDING','FO_IDENTITY_UNVERIFIED','HK_TOTAL_PENDING','MEPC_TOTAL_PENDING'];

test('optional source notes are pending evidence; genuine contradictions and unknown notes retain review',()=>{
 for(const note of ['FO NAME NOT LINKED TO VERIFIED EMPLOYEE ID','FO NOT PROVIDED; OPERATIONAL ZONE NOT CONFIRMED','FO NAME NOT LINKED TO VERIFIED EMPLOYEE ID; OPERATIONAL ZONE NOT CONFIRMED'])assert.deepEqual(sourceNoteIssues({'Mapping Conflict / Note':note}),[]);
 assert.deepEqual(sourceNoteIssues({'Mapping Conflict / Note':'CONFLICTING FO NAMES: A, B; FO NAME NOT LINKED TO VERIFIED EMPLOYEE ID'}),['SOURCE_CONFLICT']);
 assert.deepEqual(sourceNoteIssues({'Conflict / Closed Evidence':'Closed status evidence requires verification'}),['SOURCE_REVIEW_NOTE']);
 assert.deepEqual(sourceNoteIssues({'Conflict / Closed Evidence':'','Mapping Conflict / Note':'CONFLICTING STORE NAMES'}),['SOURCE_CONFLICT']);
 assert.deepEqual(sourceNoteIssues({'Mapping Conflict / Note':'NO KNOWN CONFLICTS'}),[]);
});
test('classifications prioritize identity blockers, retain all flags, and never mutate legacy evidence',()=>{
 const legacy={source:{raw:{'Mapping Conflict / Note':'FO NOT PROVIDED; OPERATIONAL ZONE NOT CONFIRMED'},issues:[...pending,'SOURCE_CONFLICT']}};const original=JSON.stringify(legacy);
 assert.equal(classifyUnifiedRow(legacy).classification,'Pending MIS Completion');assert.equal(JSON.stringify(legacy),original);
 assert.equal(classifyUnifiedRow({raw:{},issues:[...pending,'EXPIRED_BUDGET']}).classification,'Needs Review');
 assert.equal(classifyUnifiedRow({raw:{},issues:[...pending,'CANONICAL_NAME_CONFLICT']}).classification,'Needs Review');
 for(const issue of ['DUPLICATE_SOURCE_CODE','AMBIGUOUS_STORE_CODE','CANONICAL_GEOGRAPHY_CONFLICT']){const result=classifyUnifiedRow({raw:{},issues:[...pending,issue]});assert.equal(result.classification,'Blocking Identity Conflict');assert.ok(result.issues.includes(issue));}
 assert.equal(classifyUnifiedRow({raw:{},issues:[]}).classification,'Ready for Staging');
 assert.equal(classifyUnifiedRow({issues:['SOURCE_CONFLICT']}).classification,'Needs Review');
 assert.equal(classifyUnifiedRow({issues:['NEW_UNKNOWN_REVIEW_FLAG']}).classification,'Needs Review');
 const oldVersion={source:{raw:{'Site Code':'OLD','Geographic State':'TN'}},review:{store_name:'Old pending record'}};assert.equal(classifyUnifiedRow(oldVersion).classification,'Pending MIS Completion');assert.equal(classifyUnifiedRow(oldVersion).pending_issues.length,4);assert.equal(oldVersion.source.issues,undefined);
});
test('all 854 rows reproduce the user review, separate pending/conflict/match counts and preserve originals',{skip:!file||!snapshotFile||!reviewFile},async()=>{
 const snapshot=JSON.parse(fs.readFileSync(snapshotFile)),before=JSON.stringify(snapshot),parsed=parseUnifiedMaster(fs.readFileSync(file),'source.xlsx'),sourceBefore=JSON.stringify(parsed),preview=previewUnifiedMaster(parsed,snapshot);
 const book=XLSX.read(fs.readFileSync(reviewFile),{type:'buffer'}),old=XLSX.utils.sheet_to_json(book.Sheets['Source review']);
 assert.equal(preview.rows.length,854);assert.equal(old.length,854);
 for(let i=0;i<854;i++){assert.deepEqual(preview.rows[i].raw,JSON.parse(old[i].original_values));assert.equal(preview.rows[i].row_digest,old[i].row_digest);assert.deepEqual(preview.rows[i].review,JSON.parse(old[i].proposed_fields));}
 assert.equal(JSON.stringify(snapshot),before);assert.equal(JSON.stringify(parsed),sourceBefore);
 assert.equal(preview.receipt.matched,854);assert.equal(preview.receipt.canonical_matches,125);assert.equal(preview.receipt.provisional_matches,729);
 assert.equal(preview.receipt.pending_fields_rows,854);assert.equal(preview.receipt.pending_field_flags,3416);
 assert.equal(preview.receipt.actual_conflict_rows,109);assert.equal(preview.receipt.conflicts,109);assert.equal(preview.rows.filter(r=>r.issues.includes('SOURCE_CONFLICT')).length,1);
 assert.deepEqual(preview.receipt.classification_counts,{'Pending MIS Completion':736,'Needs Review':111,'Blocking Identity Conflict':7,'Ready for Staging':0});
 assert.equal(Object.values(preview.receipt.classification_counts).reduce((a,b)=>a+b,0),854);assert.equal(preview.receipt.rejected_technical_rows,0);assert.equal(preview.receipt.operational_writes,0);assert.equal(preview.receipt.proposed_updates,0);assert.equal(preview.can_save,true);
 for(const issue of pending)assert.equal(preview.rows.filter(r=>r.issues.includes(issue)).length,854);
 for(const [issue,count] of [['CANONICAL_NAME_CONFLICT',104],['EXCEPTION_SHEET_REVIEW',14],['EXPIRED_BUDGET',10],['DUPLICATE_SOURCE_CODE',4],['AMBIGUOUS_STORE_CODE',3],['CANONICAL_GEOGRAPHY_CONFLICT',2]])assert.equal(preview.rows.filter(r=>r.issues.includes(issue)).length,count);
 const exportBook=buildUnifiedReview(null,null,preview),sheet=exportBook.getWorksheet('Source review'),headers=sheet.getRow(1).values;assert.equal(sheet.rowCount,855);
 assert.ok(headers.includes('match_type'));assert.ok(headers.includes('pending_fields'));assert.ok(headers.includes('blocking_identity_flags'));
 const replay=previewUnifiedMaster(parsed,{...snapshot,files:[...snapshot.files,{sha256:parsed.checksum}]});assert.equal(replay.receipt.is_replay,true);assert.equal(replay.receipt.staged_rows,0);assert.equal(replay.receipt.unchanged,854);
 const denied=previewUnifiedMaster(parsed,{...snapshot,admin:false,permissions:[{state:'TN',permission:'viewer'}]});assert.equal(denied.can_save,false);assert.equal(denied.rows.length,854);
});
test('ready for staging is not verification or activation and all classifications remain retainable',()=>{
 assert.equal(IMPORT_CLASSIFICATIONS.length,4);
 const r={source_row:2,row_digest:'a'.repeat(64),raw:{},store_code:'SAFE',store_name:'Name',state:'TN',review:{fo_evidence:{employee_code:'EMP1',verification:'PENDING_VERIFICATION'},hk:{total:1,verification:'PENDING_VERIFICATION'},mepc:{total:0.14,verification:'PENDING_VERIFICATION'}},issues:[]};
 const snapshot={stores:[],rows:[],fos:[{employee_code:'EMP1'}],permissions:[],admin:true,stamp:'test'};
 const preview=previewUnifiedMaster({rows:[r],checksum:'b'.repeat(64)},snapshot);assert.equal(preview.rows[0].classification,'Ready for Staging');assert.equal(preview.rows[0].review.fo_evidence.verification,'PENDING_VERIFICATION');assert.equal(preview.rows[0].review.hk.verification,'PENDING_VERIFICATION');assert.equal(preview.receipt.operational_writes,0);assert.equal(preview.can_save,true);
});

test('browser shows full-workbook classifications, keeps Save enabled and exports independent issue buckets',{skip:process.env.RETAIL_CLASSIFICATION_BROWSER!=='1',timeout:120000},async()=>{
 const snapshot=JSON.parse(fs.readFileSync(snapshotFile));const root=new URL('../../',import.meta.url),out=new URL('artifacts/retail-classification-test/',root);fs.mkdirSync(out,{recursive:true});
 const express=(await import('express')).default,{createRetailUnifiedRouter}=await import('../routes/retailUnifiedRoutes.js'),{preview}=await import('vite'),{chromium,expect}=await import('@playwright/test');
 const client={rpc:async(name)=>{assert.equal(name,'rpc_retail_unified_snapshot','Browser audit must not perform writes');return {data:snapshot};}};
 const app=express();app.use(express.json());app.use('/api/reliance-retail/unified-master',(req,res,next)=>{req.profile={id:snapshot.actor_id};next();},createRetailUnifiedRouter({getClient:()=>client,environment:{}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));let web,browser;
 try{
  web=await preview({configFile:false,root:root.pathname.replace(/^\/([A-Za-z]:)/,'$1'),build:{outDir:'dist'},preview:{host:'127.0.0.1',port:4196,strictPort:true}});browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1100}});
  await page.addInitScript(()=>{localStorage.setItem('qpms-crm-auth-user',JSON.stringify({id:'local-fixture',role:'Admin',rawRole:'Admin',isDemoReadOnly:true,is_demo:true,read_only:false,status:'Active',isActive:true,webAccessEnabled:true}));sessionStorage.setItem('qpms-crm-backend-token','isolated-session');});
  await page.route('**/api/**',async route=>{const url=new URL(route.request().url());if(url.pathname.includes('/unified-master')){assert.ok(!url.pathname.endsWith('/stage'),'No Save during read-only browser audit');const response=await route.fetch({url:`http://127.0.0.1:${server.address().port}`+url.pathname+url.search});return route.fulfill({response});}return route.fulfill({json:{ok:true,rows:[],zones:[],employees:[],total:0}});});
  await page.goto('http://127.0.0.1:4196/reliance-retail/store-master',{waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'Import Consolidated Master',exact:true}).click();await page.getByLabel('Consolidated source workbook').setInputFiles(file);await page.getByRole('button',{name:'Preview all source rows',exact:true}).click();
  const panel=page.getByLabel('Import classification counts');await expect(panel).toBeVisible();
  for(const [label,count] of [['Pending fields — rows',854],['Actual conflict rows',109],['Canonical matches',125],['Provisional matches',729],['Pending MIS Completion',736],['Needs Review',111],['Blocking Identity Conflict',7],['Ready for Staging',0]])await expect(panel.getByText(label,{exact:true}).locator('..').locator('b')).toHaveText(String(count));
  await expect(page.getByRole('button',{name:'Save all authorized source rows'})).toBeEnabled();
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download errors & suggested fixes'}).click();const exported=XLSX.read(fs.readFileSync(await (await download).path()),{type:'buffer'}),rows=XLSX.utils.sheet_to_json(exported.Sheets['Source review']);assert.equal(rows.length,854);assert.equal(rows.filter(r=>r.classification==='Blocking Identity Conflict').length,7);assert.equal(rows.filter(r=>JSON.parse(r.actual_conflict_flags).includes('SOURCE_CONFLICT')).length,1);
  await panel.screenshot({path:new URL('counts.png',out).pathname.replace(/^\/([A-Za-z]:)/,'$1')});
 }finally{if(browser)await browser.close();if(web)await new Promise(r=>web.httpServer.close(r));await new Promise(r=>server.close(r));}
});
