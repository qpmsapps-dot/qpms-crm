import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import {chromium,expect} from '@playwright/test';
import ExcelJS from 'exceljs';
import {thermoServiceFixture,syntheticThermoPdf,express} from '../backend/tests/helpers/thermographyServiceFixture.js';
import {createThermographyReportsRouter} from '../backend/routes/thermographyReportsRoutes.js';
import {THERMO_MIME} from '../backend/services/thermographyPdf.js';

test('V2 browser + real isolated SQL: Excel preview/import, till-date vs whole month, verified PDF retries, client review, exports and state denial',{timeout:180000},async()=>{
 const h=await thermoServiceFixture();let actor=h.profile;
 await h.db.exec("create or replace function public.retail_operations_today() returns date language sql stable as $$select date '2026-11-18'$$;");h.today='2026-11-18';
 await h.db.query("update retail_mis_assignments set states=array['TN','KA'] where profile_id=$1",[h.ids.mepc]);
 const envDir=await mkdtemp(path.join(os.tmpdir(),'qpms-thermo-v2-env-')),output=process.env.THERMOGRAPHY_TEST_OUTPUT_DIR||await mkdtemp(path.join(os.tmpdir(),'qpms-thermo-v2-output-'));await mkdir(output,{recursive:true});
 Object.assign(process.env,{VITE_ENABLE_DEMO_AUTH:'true',VITE_APP_MODE:'demo',VITE_SUPABASE_URL:'',VITE_SUPABASE_ANON_KEY:'',VITE_API_URL:'http://127.0.0.1:4999'});
 const app=express();app.use((req,res,next)=>{if(req.get('authorization')==='Bearer synthetic-local-token'){req.profile=actor;req.authUser={id:actor.auth_user_id};}next();});app.use('/api/reliance-retail/mis/thermography',createThermographyReportsRouter({getClient:()=>h.client,options:{fetcher:h.fetcher},environment:{}}));
 const backend=app.listen(0,'127.0.0.1');await new Promise(r=>backend.once('listening',r));const backendBase='http://127.0.0.1:'+backend.address().port;
 const server=await createServer({configFile:false,envDir,cacheDir:path.join(envDir,'cache'),plugins:[react(),tailwindcss()],optimizeDeps:{entries:['index.html']},server:{host:'127.0.0.1',port:0,watch:{ignored:['**/artifacts/**','**/tmp/**']}},logLevel:'error'});await server.listen();
 await server.environments.client.warmupRequest('/src/main.jsx');await server.environments.client.waitForRequestsIdle();
 const origin='http://127.0.0.1:'+server.httpServer.address().port;assert.equal((await fetch(origin)).status,200,'Vite must be ready before navigation');
 const browser=await chromium.launch({headless:true,channel:'chromium'}),context=await browser.newContext({acceptDownloads:true,viewport:{width:1440,height:1000}}),page=await context.newPage();const errors=[],storageUploads=[];let loseFinalize=true;
 page.on('pageerror',e=>errors.push(e.message));
 await context.addInitScript(()=>{localStorage.setItem('qpms-crm-auth-user',JSON.stringify({id:'synthetic-browser-user',profileId:'synthetic-browser-profile',employeeCode:'QPMSADMIN',name:'Synthetic UI reviewer',role:'Admin',rawRole:'Admin',status:'Active',isActive:true,webAccessEnabled:true,is_demo:true,isDemoReadOnly:true,read_only:false}));sessionStorage.setItem('qpms-crm-backend-token','synthetic-local-token');});
 await page.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.hostname==='synthetic.invalid'){
   if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-methods':'PUT,OPTIONS','access-control-allow-headers':'content-type,x-upsert'}});
   assert.equal(req.method(),'PUT');assert.equal(req.headers()['x-upsert'],'false');const bytes=req.postDataBuffer();const version=(await h.db.query('select * from retail_thermography_report_versions where object_path=$1',[url.pathname.replace('/storage/v1/object/upload/sign/retail-thermography-reports/','')])).rows[0];assert.ok(version);const id=await h.object(version);h.objects.set(version.object_path,{id,bytes});storageUploads.push(version.id);return route.fulfill({status:200,body:'{}',headers:{'access-control-allow-origin':'*'}});
  }
  if(!['127.0.0.1','localhost'].includes(url.hostname))return route.abort();
  if(url.pathname.startsWith('/api/reliance-retail/mis/thermography/')){
   // Keep the loading state observable: one placeholder row is not a result row.
   if(url.pathname.endsWith('/dashboard')&&url.searchParams.get('q'))await new Promise(resolve=>setTimeout(resolve,100));
   const response=await route.fetch({url:backendBase+url.pathname+url.search});
   if(url.pathname.endsWith('/uploads/finalize')&&loseFinalize){loseFinalize=false;return route.abort('failed');}return route.fulfill({response});
  }
  if(url.pathname.startsWith('/api/'))return route.fulfill({json:{}});return route.continue();
 });
 const pdf=await syntheticThermoPdf();
 async function download(button,expected){const pending=page.waitForEvent('download');await button.click();const file=await pending;assert.equal(await file.failure(),null);const bytes=await readFile(await file.path());if(expected)assert.deepEqual(bytes,expected);return bytes;}
 const row=code=>page.locator('.thv2-schedule tbody tr').filter({hasText:code});
 try{
  assert.equal(await page.evaluate(()=>navigator.pdfViewerEnabled),true,'The full Chromium PDF viewer is mandatory for this test');
  await page.goto(origin+'/reliance-retail/thermography',{waitUntil:'domcontentloaded'});await page.getByLabel('Month',{exact:true}).fill('2026-11');
  await page.getByRole('button',{name:'Upload Schedule (Excel)',exact:true}).waitFor({state:'visible'});await page.waitForFunction(()=>!document.querySelector('.thv2-upload-strip button').disabled);
  const template=await download(page.getByRole('button',{name:'Download Template',exact:true})),read=new ExcelJS.Workbook();await read.xlsx.load(template);assert.deepEqual(read.worksheets[0].getRow(1).values.slice(1),['Store Code','Scheduled Date']);
  const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('Schedule');sheet.addRows([['Store Code','Scheduled Date'],['0012',new Date('2026-11-05T00:00:00Z')],['0012',new Date('2026-11-30T00:00:00Z')],['0099',new Date('2026-11-06T00:00:00Z')]]);sheet.getColumn(1).numFmt='@';sheet.getColumn(2).numFmt='dd-mm-yyyy';
  await page.getByRole('button',{name:'Upload Schedule (Excel)',exact:true}).click();await page.getByLabel('Monthly Excel schedule').setInputFiles({name:'any-month-name.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(await book.xlsx.writeBuffer())});await page.getByRole('button',{name:'Validate & preview',exact:true}).click();await page.getByText('3 valid',{exact:true}).waitFor();await page.getByLabel(/Audit reason/).fill('Synthetic reviewed late upload');await page.getByRole('button',{name:'Confirm import (3 inspections)',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
  await page.waitForFunction(()=>document.querySelectorAll('.thv2-schedule tbody tr').length===3);assert.equal(await page.locator('.thv2-scheduled strong').innerText(),'2');assert.equal(await row('0012').count(),2);await expect(row('0012').filter({hasText:'30-Nov-2026'}).getByRole('button',{name:'Upload PDF',exact:true})).toBeEnabled();
  const first=row('0012').filter({hasText:'05-Nov-2026'});await first.getByRole('button',{name:'Upload PDF',exact:true}).click();await page.getByLabel('Inspection PDF',{exact:true}).setInputFiles({name:'SYNTHETIC_Original.pdf',mimeType:THERMO_MIME,buffer:pdf});await page.getByRole('button',{name:'Upload & verify PDF',exact:true}).click();await page.getByRole('dialog').getByRole('alert').waitFor();
  await page.getByRole('button',{name:'Upload & verify PDF',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});await first.getByRole('button',{name:'View',exact:true}).waitFor();assert.equal(storageUploads.length,1);assert.equal(await page.locator('.thv2-completed strong').innerText(),'1');await download(first.getByRole('button',{name:/SYNTHETIC_Original.pdf/}),pdf);const opened=context.waitForEvent('page');await first.getByRole('button',{name:'View',exact:true}).click();const viewer=await opened;await viewer.waitForURL('blob:**',{waitUntil:'commit'});assert.match(viewer.url(),/^blob:http:\/\/127\.0\.0\.1:/);await viewer.close();
  await first.getByRole('button',{name:'History 0012',exact:true}).click();await page.getByRole('button',{name:'Request rework',exact:true}).click();await page.getByLabel('Audit remark').fill('Synthetic correction');await page.getByRole('button',{name:'Confirm rework',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});await first.getByRole('button',{name:'Replace PDF',exact:true}).click();await page.getByLabel('Inspection PDF',{exact:true}).setInputFiles({name:'SYNTHETIC_Revised.pdf',mimeType:THERMO_MIME,buffer:pdf});await page.getByRole('button',{name:'Upload & verify PDF',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
  await first.getByRole('button',{name:'History 0012',exact:true}).click();await page.getByRole('button',{name:'Client approve',exact:true}).click();await page.getByRole('button',{name:'Confirm approval',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});await first.getByText('Client: Approved',{exact:true}).waitFor();assert.equal(await first.getByRole('button',{name:'Replace PDF',exact:true}).count(),0);
  await page.getByLabel('KPI start date').fill('2026-11-06');await page.getByLabel('KPI end date').fill('2026-11-18');await page.waitForFunction(()=>document.querySelector('.thv2-scheduled strong')?.textContent==='1');assert.equal(await page.locator('.thv2-completed strong').innerText(),'1');assert.equal(await page.locator('.thv2-schedule tbody tr').count(),3,'Custom KPI range must retain the full monthly table');
  const exported=await download(page.getByRole('button',{name:'Export Excel',exact:true})),summary=new ExcelJS.Workbook();await summary.xlsx.load(exported);assert.equal(summary.worksheets[0].rowCount,4);assert.equal(summary.worksheets[0].getCell('B2').value,'0012');assert.equal(summary.worksheets[0].getCell('E2').value,'Completed');
  await page.getByRole('button',{name:'Completed (1)',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.thv2-schedule tbody tr').length===1);await page.getByRole('button',{name:'All (3)',exact:true}).click();await page.getByLabel('Search by Store Code').fill('0099');await expect(page.locator('.thv2-schedule tbody')).toContainText('0099');await expect(page.locator('.thv2-schedule tbody tr')).toHaveCount(1);assert.match(await page.locator('.thv2-schedule tbody').innerText(),/0099/);await page.getByLabel('Search by Store Code').fill('');
  await page.getByRole('button',{name:'Schedule History',exact:true}).click();await page.getByText('any-month-name.xlsx',{exact:true}).waitFor();await page.getByLabel('Close dialog').click();await expect(page.locator('.thv2-schedule tbody tr')).toHaveCount(3);
  for(const width of [1440,1120,768,390]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+2));await page.screenshot({path:path.join(output,`thermography-v2-${width}.png`),fullPage:true});}
  actor=h.other;await page.reload({waitUntil:'domcontentloaded'});await page.getByLabel('Month',{exact:true}).fill('2026-11');await page.waitForFunction(()=>document.querySelector('.thv2-schedule tbody')?.textContent.includes('0099'));assert.equal(await row('0012').count(),0);assert.equal(await row('0099').count(),1);
  assert.deepEqual(errors,[]);assert.equal(storageUploads.length,2);console.log('Synthetic browser screenshots: '+output);
 }finally{await context.close();await browser.close();await server.close();backend.closeAllConnections();await new Promise(r=>backend.close(r));await h.db.close();}
});
