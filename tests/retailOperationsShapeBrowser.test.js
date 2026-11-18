import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp} from 'node:fs/promises';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';
import {maintenanceReport,thermographyReport} from '../backend/shared/retailOperations.js';
import {isCompleteOperationsReport} from '../src/utils/retailOperationsReport.js';
import {isThermographyV2Dashboard} from '../src/utils/thermographyV2.js';

const source={today:'2026-10-31',stores:[],calls:[],thermography:[],events:[]};
test('real empty report shapes are valid; missing totals and partial records are unavailable, not fabricated zeroes',()=>{
 const thermo=thermographyReport(source,'2026-10');
 assert.equal(isCompleteOperationsReport(thermo,'thermography'),true);
 assert.equal(isCompleteOperationsReport(maintenanceReport(source,'2026-10'),'maintenance'),true);
 for(const partial of [null,{}, {...thermo,total:undefined},{...thermo,states:undefined},{...thermo,events:null},{...thermo,status:'unavailable'},{...thermo,rows:[{id:'partial'}]}])assert.equal(Boolean(isCompleteOperationsReport(partial,'thermography')),false);
});

test('client-side CM/PM to Thermography navigation never reads scheduled from the previous report; partial/loading/unavailable responses remain safe',{timeout:90000},async()=>{
 Object.assign(process.env,{VITE_ENABLE_DEMO_AUTH:'true',VITE_APP_MODE:'demo',VITE_SUPABASE_URL:'',VITE_SUPABASE_ANON_KEY:'',VITE_API_URL:'http://127.0.0.1:4999'});
 const envDir=await mkdtemp(path.join(os.tmpdir(),'qpms-thermo-report-shape-'));
 const server=await createServer({envDir,cacheDir:path.join(envDir,'cache'),optimizeDeps:{entries:['index.html']},server:{host:'127.0.0.1',port:0},logLevel:'error'});await server.listen();
 // Listening does not mean the cold module graph is ready for browser navigation.
 await server.environments.client.warmupRequest('/src/main.jsx');
 await server.environments.client.waitForRequestsIdle();
 const browser=await chromium.launch({headless:true}),page=await browser.newPage(),errors=[];
 const complete=()=>({contract:'thermography.v2',scope_digest:'synthetic-empty',today:'2026-11-18',month:'2026-11',stores:[],rows:[],chart:[],summary:{scheduled:0,completed:0,percentage:0},monthly:{total:0,completed:0,scheduled:0},total:0,page:0,limit:25,max_bytes:10000000,can_upload:false,can_schedule:false});
 let result=complete(),releaseFirst;const firstResponse=new Promise(resolve=>{releaseFirst=resolve;});let first=true;
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{localStorage.setItem('qpms-crm-auth-user',JSON.stringify({id:'fixture',role:'Admin',rawRole:'Admin',is_demo:true,isDemoReadOnly:true,read_only:true,status:'Active'}));sessionStorage.setItem('qpms-crm-backend-token','synthetic-local-test-token');});
 await page.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
 await page.route('**/api/**',async route=>{
  if(route.request().method()!=='GET')throw Error('Regression must not write any records');
  const url=new URL(route.request().url());
  if(url.pathname.endsWith('/operations/maintenance'))return route.fulfill({json:{result:maintenanceReport(source,'2026-10')}});
  if(url.pathname.endsWith('/mis/thermography/dashboard')){if(first){first=false;await firstResponse;}return route.fulfill({json:{result}});}
  return route.fulfill({json:{}});
 });
 const base=`http://127.0.0.1:${server.httpServer.address().port}`;
 try{
  await page.goto(base+'/reliance-retail/cmpm');await page.getByLabel('CM / PM Calls entry Store Code').waitFor();
  await page.locator('aside').getByRole('link',{name:'Thermography',exact:true}).click();
  await page.getByRole('heading',{name:'Thermography',exact:true}).waitFor();
  await page.locator('.thv2-scheduled small').filter({hasText:/Loading/}).waitFor();
  assert.equal(await page.locator('.thv2-scheduled strong').textContent(),'N/A');releaseFirst();
  await page.waitForFunction(()=>document.querySelector('.thv2-scheduled strong')?.textContent==='0');
  assert.equal(isThermographyV2Dashboard(result),true);
  for(const partial of [{}, {...result,summary:undefined},{...result,stores:null},{...result,rows:[{id:'partial'}]},{...result,summary:{scheduled:1,completed:0,percentage:0}}]){
   result=partial;await page.reload({waitUntil:'domcontentloaded'});
   await page.getByRole('alert').filter({hasText:'Thermography V2 contract is incomplete or unavailable.'}).waitFor();
   assert.equal(await page.locator('.thv2-scheduled strong').textContent(),'N/A');
   assert.equal(await page.getByRole('button',{name:'Export Excel',exact:true}).isDisabled(),true);
   assert.equal(await page.getByRole('button',{name:'Upload Schedule (Excel)',exact:true}).isDisabled(),true);
  }
  result=complete();await page.getByRole('button',{name:'Retry',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.thv2-scheduled strong')?.textContent==='0');
  await page.locator('aside').getByRole('link',{name:'CM/PM',exact:true}).click();await page.getByRole('heading',{name:'CM / PM Calls',exact:true}).waitFor();await page.getByLabel('CM / PM Calls entry Store Code').waitFor();
  assert.equal(await page.getByText(/Cannot read properties|Unexpected Application Error/).count(),0);
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await server.close();}
});
