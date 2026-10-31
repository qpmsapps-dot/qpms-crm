import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';
import {indiaToday,summarizeAttendance} from '../backend/shared/retailAttendance.js';
import {verifyRetailLayout} from './retailLayoutQa.js';

async function workbookFromDownload(download){
 const {default:ExcelJS}=await import('exceljs'),chunks=[];
 for await(const chunk of await download.createReadStream())chunks.push(chunk);
 const book=new ExcelJS.Workbook();await book.xlsx.load(Buffer.concat(chunks));return book;
}

// In-memory browser acceptance; optional visual QA writes only to the OS temp folder.
test('Retail module pages use real report responses, filters, evidence and unavailable states',{timeout:120000},async()=>{
 Object.assign(process.env,{VITE_ENABLE_DEMO_AUTH:'true',VITE_APP_MODE:'demo',VITE_SUPABASE_URL:'',VITE_SUPABASE_ANON_KEY:'',VITE_API_URL:'http://127.0.0.1:4999'});
 const server=await createServer({cacheDir:path.join(os.tmpdir(),'qpms-retail-modules-b-vite'),server:{host:'127.0.0.1',port:0},logLevel:'error'});await server.listen();
 const browser=await chromium.launch({headless:true}),context=await browser.newContext(),page=await context.newPage(),today=indiaToday(),store={id:'s',store_code:'P1',store_name:'Canonical Puducherry',state:'PY',ownership:{known:true,zone_id:null,fo_profile_id:null}};
 const errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));
 await context.addInitScript(()=>{localStorage.setItem('qpms-crm-auth-user',JSON.stringify({id:'local-admin',profileId:'local-profile',name:'Local Admin',role:'Admin',rawRole:'Admin',status:'Active',isActive:true,webAccessEnabled:true,authProvider:'demo-fixture',is_demo:true,isDemoReadOnly:true,read_only:false}));sessionStorage.setItem('qpms-crm-backend-token','synthetic-local-test-token');});
 const source={status:'ready',rows:[{state:'TN',hk_actual:12.5,mepc_actual:2,total_actual:14.5,total_target:20,complete:true,overall_pct:72.5}]};
 let cleaningRows=[{state:'TN',scheduled:3,completed:1,not_completed:1,pending:1,remaining:2}],masterUnavailable=false,attendanceConfigured=false;
 const training=[{id:'t1',store,canonical_store_id:'s',category:{code:'hk'},training_date:today,status:'submitted'},{id:'t2',store,canonical_store_id:'s',category:{code:'technical_mep'},training_date:today,status:'submitted'}];
 await page.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url());requests.push({method:request.method(),path:url.pathname});
  if(url.pathname.endsWith('/module-reports/dashboard'))return route.fulfill({json:{report:{updated_at:new Date().toISOString(),stores:[store],modules:{attendance:source,cleaning:{status:'ready',rows:cleaningRows},technical:{status:'ready',rows:[{state:'TN',completed:1}]},soft:{status:'ready',rows:[{state:'TN',completed:1}]},cm:{status:'unavailable',reason:'Authoritative CM data source missing.'},pm:{status:'unavailable',reason:'Authoritative PM data source missing.'},thermography:{status:'unavailable',reason:'Authoritative scan results missing.'}}}}});
  if(url.pathname.endsWith('/module-reports/deep-cleaning/d/evidence'))return route.fulfill({json:{uploads:[{id:'image',type:'before',name:'before.jpg',mime_type:'image/jpeg',url:'https://example.test/signed-before.jpg'}]}});
  if(url.pathname.endsWith('/module-reports/deep-cleaning'))return route.fulfill({json:{report:{stores:[store],exceptions:[],totals:{scheduled:3,completed:1,not_completed:1,pending:1},schedules:[{id:'plan',store,reporting_state:'TN',scheduled_date:today,display_status:'Completed',submission_ids:['d']},{id:'notdone',store,reporting_state:'TN',scheduled_date:today,display_status:'Not Completed',submission_ids:[],not_done_reason:'Recorded reason'}],submissions:[{id:'d',store,deep_cleaning_date:today,status:'submitted',before_count:1,after_count:1}]}}});
  if(url.pathname.endsWith('/module-reports/training'))return route.fulfill({json:{report:{rows:training,complete:true}}});
  if(url.pathname.endsWith('/attendance/summary'))return route.fulfill({json:{report:{...summarizeAttendance({stores:attendanceConfigured?[store,{id:'missing',store_code:'MISSING',store_name:'Missing target',state:'TN'}]:[store],aop:attendanceConfigured?[{retail_store_id:'s',hk_count:1.25,mepc_count:0.55,effective_from:today.slice(0,7)+'-01',effective_to:null}]:[],attendance:[{retail_store_id:'s',attendance_date:today,class:'HK',credit:12.5},{retail_store_id:'s',attendance_date:today,class:'MEPC',credit:2}],cutoff:today,view:url.searchParams.get('view')||'mtd'}),latest_imported_date:today,can_upload:false,aop_mapping_blocked:'Obsolete source-pending flag'}}});
  if(url.pathname.endsWith('/unified-master'))return route.fulfill(masterUnavailable?{status:503,json:{message:'Synthetic ownership unavailable'}}:{json:{result:{stores:[store],epoch_at:'2026-01-01',store_zone_history:[],assignments:[],zones:[],fos:[],rows:[],files:[],attendance:[],aop:[],deep_cleaning:[],images:[],schedules:[],training:[],events:[],proposals:[],permissions:[],from:today,to:today}}});
  if(url.pathname.endsWith('/fault-tracker/tickets'))return route.fulfill({json:{ok:true,import_batch:{id:'fixture',original_file_name:'ISOLATED LAYOUT FIXTURE',ticket_count:3},tickets:[1,2,3].map(i=>({id:`fixture-${i}`,ticket_no:`LAYOUT-${i}`,store_code:'P1',store_name:'Canonical Puducherry',state:'PY',operational_state_code:'TN',stage:'Fault Raised - Quote Yet to Submit',category_group:'HK',is_active:true}))}});
  return route.fulfill({json:{}});
 });
 await page.route('https://example.test/**',route=>route.fulfill({status:204,body:''}));
 const base='http://127.0.0.1:'+server.httpServer.address().port;
 try{
  await page.goto(base+'/reliance-retail');
  await page.getByText('14.5',{exact:true}).waitFor();
  assert.equal(await page.getByText('Authoritative CM data source missing.',{exact:false}).count(),1);
  assert.equal(await page.getByText('Authoritative scan results missing.',{exact:false}).count(),1);
  const cleaning=page.locator('#ifms-cleaning').locator('xpath=ancestor::section');
  assert.equal(await cleaning.getByText('Not Done',{exact:true}).count(),0);
  assert.ok(await cleaning.getByText('Remaining',{exact:true}).count()>0);
  assert.match(await cleaning.textContent(),/Recorded Not Completed: 1; Scheduled and pending: 1/);
  await page.getByLabel('Global reporting state').selectOption('AP-1');
  assert.equal(await page.locator('#ifms-attendance').locator('..').locator('..').getByText('14.5',{exact:true}).count(),0);
  cleaningRows=[];await page.reload();await page.getByText('14.5',{exact:true}).waitFor();
  assert.equal(await cleaning.locator('.ifms-metric').filter({hasText:'Completion'}).locator('strong').textContent(),'N/A');
  await page.goto(base+'/reliance-retail/deep-cleaning');
  await page.getByText('Recorded reason',{exact:true}).waitFor();
  await page.getByLabel('Cleaning status').selectOption('Not Completed');
  assert.equal(await page.getByRole('button',{name:'Before / after evidence',exact:true}).count(),0);
  await page.getByRole('button',{name:'View evidence',exact:true}).click();
  await page.getByRole('heading',{name:'Authorized evidence',exact:true}).waitFor();
  assert.equal(await page.getByRole('img',{name:'before cleaning evidence'}).getAttribute('src'),'https://example.test/signed-before.jpg');
  const cleaningDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Export cleaning report',exact:true}).click();
  const cleaningBook=await workbookFromDownload(await cleaningDownload);
  assert.equal(cleaningBook.getWorksheet('Filtered schedules').rowCount,2,'Schedule export follows the selected status');
  assert.equal(cleaningBook.getWorksheet('Recorded work').rowCount,2,'Recorded work remains independently visible');
  await page.goto(base+'/reliance-retail/training');
  await page.getByText('TN: HK 1 · MEPC 1',{exact:true}).waitFor();
  await page.getByLabel('Training State').selectOption('TN');
  assert.equal(await page.getByRole('button',{name:'View Training evidence'}).count(),2);
  for(let i=0;i<250;i++)training.push({id:`bulk-${i}`,store,canonical_store_id:'s',category:{code:i%2?'technical_mep':'hk'},training_date:today,status:'submitted',trainer_name:`Pagination Trainer ${i}`});
  await page.reload();await page.getByText('TN: HK 126 · MEPC 126',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'View Training evidence'}).count(),25);
  await page.getByRole('button',{name:'Training records next page',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'View Training evidence'}).count(),25);
  const trainingDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Export Training review',exact:true}).click();
  const trainingBook=await workbookFromDownload(await trainingDownload);
  assert.equal(trainingBook.getWorksheet('Training').rowCount,253,'Export includes all 252 filtered records, not just one page');
  await page.getByLabel('Search Training records').fill('Pagination Trainer 249');
  assert.equal(await page.getByRole('button',{name:'View Training evidence'}).count(),1);
  await verifyRetailLayout(page,'training');
  for(const width of [1920,1024,390]){await page.setViewportSize({width,height:1000});assert.equal(await page.locator('.retail-report').evaluate(root=>root.scrollWidth<=root.clientWidth+1),true,`Training fits at ${width}px`);if(process.env.RETAIL_MODULES_B_VISUAL_QA==='true'&&width!==1024)await page.screenshot({path:path.join(os.tmpdir(),`retail-b-training-${width}.png`),fullPage:true,animations:'disabled'});}
  masterUnavailable=true;await page.reload();await page.getByText('Zone/FO ownership unavailable in your authorized scope. Training records remain available.',{exact:true}).waitFor();
  assert.equal(await page.getByText('Verified trained stores',{exact:true}).locator('..').locator('strong').textContent(),'N/A');
  assert.equal(await page.getByText('HK trainings completed',{exact:true}).locator('..').locator('strong').textContent(),'126');
  masterUnavailable=false;
  await page.goto(base+'/reliance-retail/attendance');
  await page.getByText('Actual Man-days',{exact:true}).waitFor();
  assert.ok(await page.getByText('14.5',{exact:true}).count()>0,'Actual credits remain visible with missing AOP');
  assert.ok(await page.getByText('N/A',{exact:true}).count()>0,'Missing AOP is never converted to zero');
  attendanceConfigured=true;await page.reload();
  await page.getByLabel('Approved AOP coverage').filter({hasText:'1 of 2 stores configured; 1 without AOP'}).waitFor();
  assert.match(await page.getByLabel('Approved AOP coverage').textContent(),/HK: 1.25 · MEPC: 0.55/);
  assert.equal(await page.getByText('Configured AOP Count',{exact:true}).locator('..').getByText('1.8',{exact:true}).count(),1);
  assert.equal(await page.getByText('Approved effective-dated AOP configuration is pending budget-source confirmation.',{exact:false}).count(),0);
  await page.getByText('Admin: coverage and source reconciliation',{exact:true}).waitFor();
  await verifyRetailLayout(page,'attendance');
  await page.goto(base+'/reliance-retail/deep-cleaning');await page.getByText('Recorded reason',{exact:true}).waitFor();
  await page.getByLabel('Search cleaning records').fill('Recorded reason');
  assert.equal(await page.getByRole('region',{name:'Cleaning schedules',exact:true}).locator('tbody tr').count(),1);
  await verifyRetailLayout(page,'deep-cleaning');
  for(const width of [1920,1024,390]){await page.setViewportSize({width,height:1000});assert.equal(await page.locator('.retail-report').evaluate(root=>root.scrollWidth<=root.clientWidth+1),true,`Cleaning fits at ${width}px`);if(process.env.RETAIL_MODULES_B_VISUAL_QA==='true'&&width!==1024)await page.screenshot({path:path.join(os.tmpdir(),`retail-b-cleaning-${width}.png`),fullPage:true,animations:'disabled'});}
  assert.equal(requests.some(r=>r.method!=='GET'),false,'Reporting must not mutate operational data');
  await page.goto(base+'/reliance-retail');await page.getByText('14.5',{exact:true}).waitFor();
  for(const width of [1920,1024,390]){await page.setViewportSize({width,height:1000});assert.equal(await page.locator('.ifms-dashboard').evaluate(root=>[...root.querySelectorAll('.ifms-card,.ifms-table-wrap,.ifms-card-header')].every(el=>el.scrollWidth<=el.clientWidth+1)),true,`Dashboard fits at ${width}px`);}
  await verifyRetailLayout(page,'dashboard');
  await page.goto(base+'/reliance-retail/fault-tracker');
  await page.getByText(/Eligible tickets from saved dump:/).waitFor();
  await verifyRetailLayout(page,'fault-tracker');
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await server.close();}
});
