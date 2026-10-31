import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';
import {indiaToday} from '../backend/shared/retailAttendance.js';

// In-memory browser acceptance: no screenshots, video, trace or report files.
test('Retail module pages use real report responses, filters, evidence and unavailable states',{timeout:120000},async()=>{
 Object.assign(process.env,{VITE_ENABLE_DEMO_AUTH:'true',VITE_APP_MODE:'demo',VITE_SUPABASE_URL:'',VITE_SUPABASE_ANON_KEY:'',VITE_API_URL:'http://127.0.0.1:4999'});
 const server=await createServer({cacheDir:path.join(os.tmpdir(),'qpms-retail-modules-b-vite'),server:{host:'127.0.0.1',port:0},logLevel:'error'});await server.listen();
 const browser=await chromium.launch({headless:true}),context=await browser.newContext(),page=await context.newPage(),today=indiaToday(),store={id:'s',store_code:'P1',store_name:'Canonical Puducherry',state:'PY'};
 const errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));
 await context.addInitScript(()=>{localStorage.setItem('qpms-crm-auth-user',JSON.stringify({id:'local-admin',profileId:'local-profile',name:'Local Admin',role:'Admin',rawRole:'Admin',status:'Active',isActive:true,webAccessEnabled:true,authProvider:'demo-fixture',is_demo:true,isDemoReadOnly:true,read_only:false}));sessionStorage.setItem('qpms-crm-backend-token','synthetic-local-test-token');});
 const source={status:'ready',rows:[{state:'TN',hk_actual:12.5,mepc_actual:2,total_actual:14.5,total_target:20,complete:true,overall_pct:72.5}]};
 let cleaningRows=[{state:'TN',scheduled:3,completed:1,not_completed:1,pending:1,remaining:2}];
 const training=[{id:'t1',store,canonical_store_id:'s',category:{code:'hk'},training_date:today,status:'submitted'},{id:'t2',store,canonical_store_id:'s',category:{code:'technical_mep'},training_date:today,status:'submitted'}];
 await page.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url());requests.push({method:request.method(),path:url.pathname});
  if(url.pathname.endsWith('/module-reports/dashboard'))return route.fulfill({json:{report:{updated_at:new Date().toISOString(),stores:[store],modules:{attendance:source,cleaning:{status:'ready',rows:cleaningRows},technical:{status:'ready',rows:[{state:'TN',completed:1}]},soft:{status:'ready',rows:[{state:'TN',completed:1}]},cm:{status:'unavailable',reason:'Authoritative CM data source missing.'},pm:{status:'unavailable',reason:'Authoritative PM data source missing.'},thermography:{status:'unavailable',reason:'Authoritative scan results missing.'}}}}});
  if(url.pathname.endsWith('/module-reports/deep-cleaning/d/evidence'))return route.fulfill({json:{uploads:[{id:'image',type:'before',name:'before.jpg',mime_type:'image/jpeg',url:'https://example.test/signed-before.jpg'}]}});
  if(url.pathname.endsWith('/module-reports/deep-cleaning'))return route.fulfill({json:{report:{stores:[store],exceptions:[],totals:{scheduled:3,completed:1,not_completed:1,pending:1},schedules:[{id:'plan',store,reporting_state:'TN',scheduled_date:today,display_status:'Completed',submission_ids:['d']},{id:'notdone',store,reporting_state:'TN',scheduled_date:today,display_status:'Not Completed',submission_ids:[],not_done_reason:'Recorded reason'}],submissions:[{id:'d',store,deep_cleaning_date:today,status:'submitted',before_count:1,after_count:1}]}}});
  if(url.pathname.endsWith('/module-reports/training'))return route.fulfill({json:{report:{rows:training,complete:true}}});
  if(url.pathname.endsWith('/unified-master'))return route.fulfill({json:{result:{stores:[store],epoch_at:'2026-01-01',store_zone_history:[],assignments:[],zones:[],fos:[],rows:[],files:[],attendance:[],aop:[],deep_cleaning:[],images:[],schedules:[],training:[],events:[],proposals:[],permissions:[],from:today,to:today}}});
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
  await page.goto(base+'/reliance-retail/training');
  await page.getByText('TN: HK 1 · MEPC 1',{exact:true}).waitFor();
  await page.getByLabel('Training State').selectOption('TN');
  assert.equal(await page.getByRole('button',{name:'View Training evidence'}).count(),2);
  assert.equal(requests.some(r=>r.method!=='GET'),false,'Reporting must not mutate operational data');
  await page.goto(base+'/reliance-retail');await page.getByText('14.5',{exact:true}).waitFor();
  for(const width of [1920,1024,390]){await page.setViewportSize({width,height:1000});assert.equal(await page.locator('.ifms-dashboard').evaluate(root=>[...root.querySelectorAll('.ifms-card,.ifms-table-wrap,.ifms-card-header')].every(el=>el.scrollWidth<=el.clientWidth+1)),true,`Dashboard fits at ${width}px`);}
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await server.close();}
});
