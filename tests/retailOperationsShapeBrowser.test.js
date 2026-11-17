import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp} from 'node:fs/promises';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';
import {maintenanceReport,thermographyReport} from '../backend/shared/retailOperations.js';
import {isCompleteOperationsReport} from '../src/utils/retailOperationsReport.js';

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
 const complete=()=>({contract:'thermography-reports.v1',scope_digest:'synthetic-empty',today:source.today,stores:[],rows:[],counts:{scheduled:0,awaiting:0,rework:0,approved:0,active_reports:0},total:0,page:0,limit:25,max_bytes:26214400,can_upload:false,can_schedule:true,is_super:true});
 let result=complete();
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{localStorage.setItem('qpms-crm-auth-user',JSON.stringify({id:'fixture',role:'Admin',rawRole:'Admin',is_demo:true,isDemoReadOnly:true,read_only:true,status:'Active'}));sessionStorage.setItem('qpms-crm-backend-token','synthetic-local-test-token');});
 await page.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
 await page.route('**/api/**',async route=>{
  if(route.request().method()!=='GET')throw Error('Regression must not write any records');
  const url=new URL(route.request().url());
  if(url.pathname.endsWith('/operations/maintenance'))return route.fulfill({json:{result:maintenanceReport(source,'2026-10')}});
  if(url.pathname.endsWith('/mis/thermography/reports')){await new Promise(r=>setTimeout(r,200));return route.fulfill({json:{result}});}
  return route.fulfill({json:{}});
 });
 const base=`http://127.0.0.1:${server.httpServer.address().port}`;
 try{
  await page.goto(base+'/reliance-retail/cmpm');await page.getByLabel('CM / PM Calls entry Store Code').waitFor();
  await page.locator('aside').getByRole('link',{name:'Thermography',exact:true}).click();
  await page.getByRole('heading',{name:'Thermography',exact:true}).waitFor();
  await page.getByText('Loading authorized Thermography reports...',{exact:true}).waitFor();
  assert.equal(await page.locator('.retail-report-stats').count(),0);
  await page.locator('.retail-report-stats').waitFor();
  assert.equal(await page.locator('.retail-report-stats article').filter({hasText:'Scheduled'}).locator('strong').textContent(),'0');
  for(const partial of [{}, {...result,counts:undefined},{...result,stores:null},{...result,rows:[{id:'partial'}]},{...result,status:'unavailable'}]){
   result=partial;await page.getByRole('button',{name:'Refresh',exact:true}).click();
   await page.getByRole('alert').filter({hasText:'Thermography report contract is incomplete or unavailable.'}).waitFor();
   assert.equal(await page.locator('.retail-report-stats').count(),0);
   assert.equal(await page.getByRole('button',{name:'Export Excel',exact:true}).isDisabled(),true);
   assert.equal(await page.getByRole('button',{name:'Schedule Thermography',exact:true}).count(),0);
  }
  result=complete();await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.locator('.retail-report-stats').waitFor();
  await page.locator('aside').getByRole('link',{name:'CM/PM',exact:true}).click();await page.getByRole('heading',{name:'CM / PM Calls',exact:true}).waitFor();await page.getByLabel('CM / PM Calls entry Store Code').waitFor();
  assert.equal(await page.getByText(/Cannot read properties|Unexpected Application Error/).count(),0);
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await server.close();}
});
