import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';
import {indiaToday} from '../backend/shared/retailAttendance.js';
import {maintenanceReport,thermographyReport} from '../backend/shared/retailOperations.js';
import {verifyRetailLayout} from './retailLayoutQa.js';

// Isolated automated test fixtures only. No production connection or real login.
test('operational pages confirm saves, enforce period UX, retain Thermography late history and export all rows',{timeout:120000},async()=>{
 Object.assign(process.env,{VITE_ENABLE_DEMO_AUTH:'true',VITE_APP_MODE:'demo',VITE_SUPABASE_URL:'',VITE_SUPABASE_ANON_KEY:'',VITE_API_URL:'http://127.0.0.1:4999'});
 const server=await createServer({cacheDir:path.join(os.tmpdir(),'qpms-retail-operations-test-vite'),server:{host:'127.0.0.1',port:0},logLevel:'error'});await server.listen();
 const browser=await chromium.launch({headless:true}),context=await browser.newContext(),page=await context.newPage();
 const month=indiaToday().slice(0,7),store=randomUUID(),other=randomUUID(),actor=randomUUID();
 const source={today:month+'-15',stores:[{id:store,store_code:'TEST01',store_name:'Test source store',state:'PY',status:'Active',can_save:true},{id:other,store_code:'VIEW01',store_name:'Read only',state:'TN',status:'Active',can_save:false}],calls:[],thermography:[],events:[]};
 const errors=[],writes=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://**',route=>route.abort());
 await context.addInitScript(()=>{localStorage.setItem('qpms-crm-auth-user',JSON.stringify({id:'test-admin',profileId:'test-profile',role:'Admin',rawRole:'Admin',name:'Local test',status:'Active',isActive:true,webAccessEnabled:true,is_demo:true,isDemoReadOnly:true,read_only:false}));sessionStorage.setItem('qpms-crm-backend-token','synthetic-local-test-token');});
 await page.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.pathname.endsWith('/module-reports/dashboard')){const maintenance=maintenanceReport(source,month),thermo=thermographyReport(source,month),unavailable={status:'unavailable',reason:'No records in this isolated test source.'};return route.fulfill({json:{report:{stores:source.stores,modules:{attendance:unavailable,cleaning:unavailable,technical:unavailable,soft:unavailable,cm:maintenance.modules.cm,pm:maintenance.modules.pm,thermography:{status:'ready',rows:thermo.states}}}}});}
  if(url.pathname.includes('/operations/')){
   const maintenance=url.pathname.endsWith('/maintenance');
   if(req.method()==='GET'){const options=Object.fromEntries(url.searchParams);return route.fulfill({json:{result:maintenance?maintenanceReport(source,options.month,options):thermographyReport(source,options.month,options)}});}
   const body=req.postDataJSON();assert.equal(Object.hasOwn(body,'p_actor'),false);writes.push(body);
   if(maintenance){source.calls.push({id:randomUUID(),retail_store_id:body.store_id,store_code:'TEST01',kind:body.kind,completed_on:source.today,completed_at:source.today+'T08:00:00Z',completed_by:actor});}
   else if(body.status==='Scheduled')source.thermography.push({id:randomUUID(),retail_store_id:body.store_id,store_code:'TEST01',scheduled_date:body.scheduled_date,status:'Scheduled',revision:1});
   else{const row=source.thermography.find(t=>t.id===body.id);assert.equal(row.revision,body.revision);row.status=body.status;row.revision++;if(body.status==='Completed'){row.completed_on=source.today;const due=new Date(source.today+'T00:00:00Z');due.setUTCDate(due.getUTCDate()+10);row.approval_due_on=due.toISOString().slice(0,10);}else{row.approved_on=source.today;row.approved_late=source.today>row.approval_due_on;}}
   return route.fulfill({json:{result:{saved:true}}});
  }
  return route.fulfill({json:{}});
 });
 const base=`http://127.0.0.1:${server.httpServer.address().port}`;
 try{
  await page.goto(base+'/reliance-retail/cmpm',{waitUntil:'domcontentloaded',timeout:60000});
  await page.getByRole('heading',{name:'CM / PM Calls',exact:true}).waitFor();
  await page.getByLabel('CM / PM Calls entry Store Code').waitFor();
  await verifyRetailLayout(page,'cmpm');
  await page.getByLabel('CM / PM Calls entry Store Code').selectOption(store);
  await page.getByRole('button',{name:'Record completed CM',exact:true}).click();
  await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(writes.length,0);
  await page.getByRole('button',{name:'Record completed CM',exact:true}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
  await page.getByText('Saved. The report has been refreshed from the operational source.',{exact:true}).waitFor();
  assert.equal(writes.length,1);assert.equal(source.calls[0].kind,'CM');
  await page.getByLabel('CM / PM Calls entry Store Code').selectOption(store);assert.equal(await page.getByRole('button',{name:'Record completed CM',exact:true}).isDisabled(),true);
  await page.getByLabel('Maintenance kind').selectOption('PM');assert.equal(await page.getByRole('button',{name:'Record completed PM',exact:true}).isDisabled(),true,'PM is upcoming on the fifteenth');
  assert.equal(await page.getByLabel('CM / PM Calls entry Store Code').locator('option').filter({hasText:'VIEW01'}).count(),0);
  await page.goto(base+'/reliance-retail/thermography',{waitUntil:'domcontentloaded',timeout:60000});
  await page.getByLabel('Thermography entry Store Code').selectOption(store);await page.getByLabel('Thermography Scheduled Date').fill(source.today);
  await page.getByRole('button',{name:'Schedule inspection',exact:true}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
  await page.getByRole('button',{name:'Record completion',exact:true}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
  await page.getByRole('button',{name:'Record client approval',exact:true}).waitFor();
  const row=source.thermography[0],afterDue=new Date(row.approval_due_on+'T00:00:00Z');afterDue.setUTCDate(afterDue.getUTCDate()+1);source.today=afterDue.toISOString().slice(0,10);
  await page.reload();await page.getByRole('button',{name:'Record client approval',exact:true}).waitFor();
  assert.equal(await page.locator('.retail-report-stats article').filter({hasText:'Approval overdue'}).locator('strong').textContent(),'1');
  await page.getByRole('button',{name:'Record client approval',exact:true}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
  await page.getByText('Approved late — retained',{exact:true}).waitFor();
  await verifyRetailLayout(page,'thermography');
  assert.equal(await page.getByRole('button',{name:'Record completion',exact:true}).count(),0);
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export Excel',exact:true}).click();
  const chunks=[];for await(const chunk of await (await download).createReadStream())chunks.push(chunk);
  const {default:ExcelJS}=await import('exceljs'),book=new ExcelJS.Workbook();await book.xlsx.load(Buffer.concat(chunks));assert.equal(book.getWorksheet('Store details').rowCount,2);
  for(const width of [1920,1024,390]){await page.setViewportSize({width,height:1000});assert.equal(await page.locator('.retail-report').evaluate(r=>r.scrollWidth<=r.clientWidth+1),true,`Thermography fits at ${width}`);}
  await page.goto(base+'/reliance-retail',{waitUntil:'domcontentloaded'});await page.locator('#ifms-thermography').waitFor();
  const card=page.locator('#ifms-thermography').locator('xpath=ancestor::section');
  assert.equal(await card.getByText('Normal',{exact:true}).count(),0);
  for(const width of [1920,1366,1024,390]){await page.setViewportSize({width,height:1000});assert.equal(await page.locator('.ifms-dashboard').evaluate(root=>[...root.querySelectorAll('.ifms-card,.ifms-table-wrap,.ifms-card-header')].every(el=>el.scrollWidth<=el.clientWidth+1)),true,`Live operation Dashboard fits at ${width}`);}
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await server.close();}
});
