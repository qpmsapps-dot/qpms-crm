// Synthetic browser API only. Native SQL/import/concurrency is tested separately.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import {chromium} from '@playwright/test';
import ExcelJS from 'exceljs';

test('monthly wizard validates the whole workbook, confirms import, retries identically and preserves HK read-only UI',{timeout:180000},async()=>{
 const envDir=await mkdtemp(path.join(os.tmpdir(),'qpms-cleaning-workflow-'));
 Object.assign(process.env,{VITE_ENABLE_DEMO_AUTH:'true',VITE_APP_MODE:'demo',VITE_SUPABASE_URL:'',VITE_SUPABASE_ANON_KEY:'',VITE_API_URL:'http://127.0.0.1:4999'});
 const server=await createServer({configFile:false,envDir,cacheDir:path.join(envDir,'cache'),plugins:[react(),tailwindcss()],server:{host:'127.0.0.1',port:0,watch:{ignored:['**/outputs/**','**/artifacts/**','**/tmp/**']}},logLevel:'error'});
 await server.listen();await server.environments.client.warmupRequest('/src/main.jsx');await server.environments.client.waitForRequestsIdle();
 const browser=await chromium.launch({headless:true}),context=await browser.newContext({acceptDownloads:true}),page=await context.newPage();
 const errors=[],imports=[];page.on('pageerror',e=>errors.push(e.message));
 let role='CLEANING_SCHEDULE_WRITER',imported=false,invalid=false,first=true,manualMode=false,manualDone=false;
 const historicalId='00000000-0000-4000-8000-000000000040';
 const input={STATE:'TN',STORE_CODE:'0012',SCHEDULE_DATE:'2026-12-05',REMARKS:'Synthetic monthly schedule'};
 await context.addInitScript(()=>{localStorage.setItem('qpms-crm-auth-user',JSON.stringify({id:'fixture-auth',profileId:'fixture-profile',employeeCode:'QPMSADMIN',isDemoReadOnly:true,name:'Synthetic writer',role:'Admin',rawRole:'Admin',status:'Active',isActive:true,webAccessEnabled:true,is_demo:true,read_only:false}));sessionStorage.setItem('qpms-crm-backend-token','synthetic-local-token');});
 await page.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(!['127.0.0.1','localhost'].includes(url.hostname))return route.abort();
  if(!url.pathname.startsWith('/api/'))return route.continue();
  if(url.pathname.endsWith('/mis/access'))return route.fulfill({json:{result:{active:true,role,states:['TN'],modules:['cleaning'],schedule_writer:role==='CLEANING_SCHEDULE_WRITER',read_only:role==='MIS_HK'}}});
  if(url.pathname.endsWith('/module-reports/deep-cleaning')){
   const store={id:'store',store_code:'0012',store_name:'Synthetic historical store',state:'TN'};
   return route.fulfill({json:{report:{from:url.searchParams.get('from'),to:url.searchParams.get('to'),stores:manualMode?[store]:[],
    schedules:manualMode?[{id:'plan',store,retail_store_id:'store',scheduled_date:'2026-11-03',display_status:manualDone?'Completed':'Scheduled',status:manualDone?'Completed':'Planned',submission_ids:manualDone?[historicalId]:[],metadata:manualDone?{verified_link_contract:'cleaning-match.manual.v2',verified_submission_id:historicalId,verified_actual_date:'2026-11-02',manual_reason:'Verified original dates and historical paired evidence'}:{}}]:[],
    submissions:manualMode?[{id:historicalId,store,retail_store_id:'store',status:'submitted',deep_cleaning_date:'2026-11-02',final_outcome:'Completed',submitted_by_employee_code:'FO1',metadata:{contract_version:'cleaning-independent.phase1b.v1'}}]:[],exceptions:[],totals:{scheduled:manualMode?1:0,completed:manualMode?1:0,pending:manualMode&&!manualDone?1:0}}}});
  }
  if(url.pathname.endsWith('/link-fo')){
   const body=req.postDataJSON();assert.equal(body.source_kind,'client');assert.equal(body.source_id,historicalId);
   if(body.action==='preview')return route.fulfill({json:{result:{store_code:'0012',scheduled_date:'2026-11-03',actual_date:'2026-11-02',employee_code:'FO1',revision:0,exact_date:false}}});
   assert.equal(body.action,'link');assert.equal(body.allow_date_exception,true);assert.ok(body.reason.length>=20);assert.equal(body.revision,0);manualDone=true;
   return route.fulfill({json:{result:{saved:true}}});
  }
  if(url.pathname.endsWith('/cleaning/plans/preview')){
   assert.equal(req.method(),'POST');assert.equal(req.headers()['x-file-name'],'monthly.xlsx');assert.ok(req.postDataBuffer().length>100);
   return route.fulfill({json:{result:{total:1,valid:invalid?0:1,invalid:invalid?1:0,rows:[{row:2,input,resolved:{state:'TN'},errors:invalid?['UNKNOWN_OR_AMBIGUOUS_STORE_CODE']:[]}]}}});
  }
  if(url.pathname.endsWith('/cleaning/plans/import')){
   const body=req.postDataJSON();imports.push(body);assert.deepEqual(body.rows,[input]);assert.equal(body.month,'2026-12');assert.equal(body.actor,undefined);
   if(first){first=false;return route.fulfill({status:503,json:{message:'Synthetic uncertain response; retry unchanged import'}});}
   imported=true;return route.fulfill({json:{result:{replayed:true,receipts:[{schedule_id:'synthetic-schedule',store_id:'synthetic-store',fo_profile_id:null}]}}});
  }
  if(url.pathname.endsWith('/cleaning/plans'))return route.fulfill({json:{result:{schedules:imported?[{id:'synthetic-schedule',store_code:'0012',state:'TN',scheduled_date:'2026-12-05',status:'Planned',revision:0}]:[]}}});
  assert.equal(req.method(),'GET','Unexpected mutation: '+url.pathname);return route.fulfill({json:{}});
 });
 try{
  const url=`http://127.0.0.1:${server.httpServer.address().port}/reliance-retail/deep-cleaning`;
  await page.goto(url);await page.getByRole('heading',{name:'Deep Cleaning',exact:true}).waitFor();
  await page.getByText('Schedule Deep Cleaning',{exact:true}).click();await page.getByRole('button',{name:'Monthly Excel schedule import',exact:true}).click();
  const template=page.waitForEvent('download');await page.getByRole('button',{name:'Download Excel template',exact:true}).click();const book=new ExcelJS.Workbook();await book.xlsx.readFile(await (await template).path());assert.deepEqual(book.worksheets[0].getRow(1).values.slice(1),['STATE','STORE_CODE','SCHEDULE_DATE','REMARKS']);
  const workbook=new ExcelJS.Workbook();workbook.addWorksheet('Schedules').addRows([['STATE','STORE_CODE','SCHEDULE_DATE','REMARKS'],Object.values(input)]);
  await page.getByLabel('Schedule month',{exact:true}).fill('2026-12');await page.getByLabel('Schedule workbook',{exact:true}).setInputFiles({name:'monthly.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(await workbook.xlsx.writeBuffer())});
  invalid=true;await page.getByRole('button',{name:'Preview and validate schedules'}).click();await page.getByText('UNKNOWN_OR_AMBIGUOUS_STORE_CODE',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Confirm atomic import'}).isDisabled(),true);assert.equal(imports.length,0);
  invalid=false;await page.getByRole('button',{name:'Preview and validate schedules'}).click();await page.getByText('Valid',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Confirm atomic import'}).isDisabled(),true);
  await page.getByLabel('I verified every Store Code, state and scheduled date.').check();await page.getByRole('button',{name:'Confirm atomic import'}).click();await page.getByRole('alert').filter({hasText:'Synthetic uncertain response'}).waitFor();
  await page.getByRole('button',{name:'Confirm atomic import'}).click();await page.getByRole('status').filter({hasText:'Import accepted'}).waitFor();assert.equal(imports.length,2);assert.deepEqual(imports[0],imports[1]);await page.getByRole('cell',{name:'Unassigned',exact:true}).waitFor();
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
  role='MIS_HK';await page.reload();const accessReply=page.waitForResponse(r=>r.url().endsWith('/mis/access'));await page.getByText('Schedule Deep Cleaning',{exact:true}).click();await accessReply;assert.equal(await page.getByRole('button',{name:'Monthly Excel schedule import'}).count(),0);
  manualMode=true;role='CENTRAL_MIS';await page.setViewportSize({width:1440,height:1000});await page.reload();
  await page.getByText('Link verified FO completion',{exact:true}).click();await page.getByLabel('Submission source').selectOption('client');await page.getByLabel('Existing FO cleaning submission ID').fill(historicalId);
  assert.equal(await page.getByRole('button',{name:'Confirm verified link'}).isDisabled(),true);
  await page.getByRole('button',{name:'Preview authorized historical link'}).click();await page.getByRole('status').filter({hasText:'scheduled 2026-11-03; actual visit 2026-11-02'}).waitFor();
  await page.getByLabel('Historical review reason').fill('Verified original dates and historical paired evidence');
  await page.getByLabel('I explicitly approve this recorded date exception after reviewing both original dates.').check();await page.getByLabel('I verified this submitted work against the recorded schedule.').check();
  await page.getByRole('button',{name:'Confirm verified link'}).click();await page.getByRole('region',{name:'Cleaning schedules',exact:true}).getByText('Completed',{exact:true}).waitFor();
  assert.equal(manualDone,true);assert.equal(await page.getByRole('region',{name:'Submitted cleaning work'}).getByRole('cell',{name:'2026-11-02',exact:true}).count(),1);
  assert.deepEqual(errors,[]);
 }catch(e){console.error('Synthetic browser failure:',page.url(),errors,(await page.locator('body').innerText()).slice(0,700));throw e;}finally{await context.close();await browser.close();await server.close();}
});
