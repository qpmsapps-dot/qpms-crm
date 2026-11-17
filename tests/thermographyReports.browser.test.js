import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import {chromium} from '@playwright/test';
import ExcelJS from 'exceljs';
import {thermoServiceFixture,syntheticThermoWorkbook,express} from '../backend/tests/helpers/thermographyServiceFixture.js';
import {createThermographyReportsRouter} from '../backend/routes/thermographyReportsRoutes.js';
import {THERMO_MIME} from '../backend/services/thermographyWorkbook.js';

test('Thermography browser + actual isolated SQL: upload response-loss retry, two reworks, original/history downloads, approval, deletion and Super Admin restore',{timeout:180000},async()=>{
 const fixture=await thermoServiceFixture();let actor=fixture.profile;const h=fixture,backendErrors=[];
 const envDir=await mkdtemp(path.join(os.tmpdir(),'qpms-thermo-browser-env-')),output=process.env.THERMOGRAPHY_TEST_OUTPUT_DIR||await mkdtemp(path.join(os.tmpdir(),'qpms-thermo-browser-output-'));await mkdir(output,{recursive:true});
 Object.assign(process.env,{VITE_ENABLE_DEMO_AUTH:'true',VITE_APP_MODE:'demo',VITE_SUPABASE_URL:'',VITE_SUPABASE_ANON_KEY:'',VITE_API_URL:'http://127.0.0.1:4999'});
 const app=express();app.use((req,res,next)=>{res.set({'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,content-type','Access-Control-Allow-Methods':'GET,POST,OPTIONS'});if(req.method==='OPTIONS')return res.sendStatus(204);if(req.get('authorization')==='Bearer synthetic-local-token'){req.profile=actor;req.authUser={id:actor.auth_user_id};}next();});app.use('/api/reliance-retail/mis/thermography',createThermographyReportsRouter({getClient:()=>h.client,options:{fetcher:h.fetcher,onError:e=>backendErrors.push(e.stack)},environment:{}}));
 const backend=app.listen(0,'127.0.0.1');await new Promise(r=>backend.once('listening',r));const backendBase='http://127.0.0.1:'+backend.address().port;
 const server=await createServer({configFile:false,envDir,cacheDir:path.join(envDir,'cache'),plugins:[react(),tailwindcss()],server:{host:'127.0.0.1',port:0,watch:{ignored:['**/artifacts/**','**/tmp/**']}},logLevel:'error'});await server.listen();
 const browser=await chromium.launch({headless:true}),context=await browser.newContext({acceptDownloads:true}),page=await context.newPage();const errors=[],requests=[],storageUploads=[];let loseFinalize=true;
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
   requests.push({method:req.method(),path:url.pathname});const response=await route.fetch({url:backendBase+url.pathname+url.search});
   if(url.pathname.endsWith('/uploads/finalize')&&loseFinalize){loseFinalize=false;return route.abort('failed');}return route.fulfill({response});
  }
  if(url.pathname.startsWith('/api/'))return route.fulfill({json:{}});
  return route.continue();
 });
 const workbook=await syntheticThermoWorkbook();
 async function waitStatus(value){await page.locator('.thermo-reports tbody tr').filter({hasText:value}).waitFor();}
 async function selectWorkbook(name){await page.getByLabel('Thermography workbook').setInputFiles({name,mimeType:THERMO_MIME,buffer:workbook});}
 async function download(name,expected){const pending=page.waitForEvent('download');await page.getByRole('button',{name,exact:true}).click();const file=await pending;assert.equal(await file.failure(),null);if(expected)assert.deepEqual(await readFile(await file.path()),expected);return file;}
 try{
  await page.goto('http://127.0.0.1:'+server.httpServer.address().port+'/reliance-retail/thermography');try{await page.getByRole('button',{name:'Upload Thermography Report',exact:true}).waitFor();}catch{throw Error('Initial Thermography UI: '+(await page.locator('body').innerText()).slice(-2400)+' requests='+JSON.stringify(requests)+' errors='+JSON.stringify([...errors,...backendErrors]));}
  await page.getByRole('button',{name:'Upload Thermography Report',exact:true}).click();await page.getByLabel('Upload state').selectOption('TN');await page.getByLabel('Upload store').selectOption(h.ids.store);await page.getByLabel('Inspection date', {exact:true}).fill(h.today);await selectWorkbook('SYNTHETIC_Original.xlsx');await page.getByRole('button',{name:'Confirm Upload',exact:true}).click();
  await page.getByRole('dialog').getByRole('alert').waitFor();assert.ok(await page.evaluate(()=>Object.keys(sessionStorage).some(k=>k.startsWith('myqpms.thermography.upload.'))));
  await page.getByRole('button',{name:'Retry Upload',exact:true}).click();await waitStatus('Awaiting Client Approval');assert.equal(storageUploads.length,1);assert.equal((await h.db.query('select count(*)::int n from retail_thermography_report_versions')).rows[0].n,1);
  await download('Download Excel',workbook);
  for(let revision=2;revision<=3;revision++){
   await page.getByRole('button',{name:'Mark Rework Required',exact:true}).click();assert.equal(await page.getByRole('dialog').locator('input[type=file]').count(),0);await page.getByRole('dialog').getByRole('button',{name:'Confirm',exact:true}).click();await waitStatus('Rework Required');
   await page.getByRole('button',{name:'Replace Report',exact:true}).click();await selectWorkbook(`SYNTHETIC_Reworked_${revision}.xlsx`);await page.getByRole('button',{name:'Confirm Upload',exact:true}).click();await waitStatus('Awaiting Client Approval — Revised');
  }
  await page.getByRole('button',{name:'Mark Client Approved',exact:true}).click();assert.equal(await page.getByRole('dialog').locator('input[type=file]').count(),0);await page.getByRole('dialog').getByRole('button',{name:'Confirm',exact:true}).click();await waitStatus('Client Approved');
  assert.equal(await page.getByRole('button',{name:'Replace Report',exact:true}).count(),0);
  const summary=await download('Export Excel');await summary.saveAs(path.join(output,'SYNTHETIC_Thermography_summary.xlsx'));const book=new ExcelJS.Workbook();await book.xlsx.readFile(path.join(output,'SYNTHETIC_Thermography_summary.xlsx'));assert.equal(book.getWorksheet('Report details').getCell('C2').value,'0012');assert.equal(book.getWorksheet('Report details').getCell('H2').value,3);assert.equal(book.getWorksheet('Report details').getCell('G2').value,'Client Approved');
  await page.getByRole('button',{name:'Version History',exact:true}).click();await page.locator('.thermo-version').first().waitFor();assert.equal(await page.locator('.thermo-version').count(),3);await download('Download Version 1',workbook);await page.getByLabel('Close Thermography dialog').click();
  for(const width of [1440,768,390]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+2));await page.screenshot({path:path.join(output,`thermography-${width}.png`),fullPage:true});}await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('button',{name:'Delete Report',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Confirm',exact:true}).click();await page.getByText('No authorized reports match these filters.',{exact:true}).waitFor();
  actor=h.admin;await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByRole('checkbox',{name:'Deleted reports'}).waitFor();await page.getByRole('checkbox',{name:'Deleted reports'}).check();await page.getByRole('button',{name:'Restore Report',exact:true}).waitFor();
  await page.getByRole('button',{name:'Restore Report',exact:true}).click();await page.getByLabel('Thermography action reason').fill('Synthetic authorized restoration');await page.getByRole('dialog').getByRole('button',{name:'Confirm',exact:true}).click();await page.getByText('No authorized reports match these filters.',{exact:true}).waitFor();await page.getByRole('checkbox',{name:'Deleted reports'}).uncheck();await waitStatus('Client Approved');
  assert.equal(await page.getByRole('button',{name:'Upload Thermography Report',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Delete Report',exact:true}).count(),0);
  actor=h.other;await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByText('No authorized reports match these filters.',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Download Excel',exact:true}).count(),0);
  await page.getByRole('button',{name:'Schedule Thermography',exact:true}).click();await page.getByLabel('Schedule store').selectOption(h.ids.otherStore);await page.getByLabel('Scheduled date',{exact:true}).fill(h.today);await page.getByRole('dialog').getByRole('button',{name:'Confirm',exact:true}).click();await waitStatus('Scheduled');assert.equal(await page.getByRole('button',{name:'Mark Client Approved',exact:true}).count(),0);
  assert.deepEqual(errors,[]);assert.equal(storageUploads.length,3);assert.ok(requests.some(r=>r.path.endsWith('/history')));
 }finally{await context.close();await browser.close();await server.close();backend.closeAllConnections();await new Promise(r=>backend.close(r));await h.db.close();}
});
