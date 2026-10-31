import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';
import {indiaToday,summarizeAttendance} from '../backend/shared/retailAttendance.js';

test('CRM scheduling saves an approval request, handles failure, preserves scope and hides Admin diagnostics',{timeout:90000},async()=>{
 Object.assign(process.env,{VITE_ENABLE_DEMO_AUTH:'true',VITE_APP_MODE:'demo',VITE_SUPABASE_URL:'',VITE_SUPABASE_ANON_KEY:'',VITE_API_URL:'http://127.0.0.1:4999'});
 const server=await createServer({cacheDir:path.join(os.tmpdir(),'qpms-retail-crm-workflow'),server:{host:'127.0.0.1',port:0},logLevel:'error'});await server.listen();
 const browser=await chromium.launch({headless:true}),page=await browser.newPage(),today=indiaToday();
 const store={id:'tn',store_code:'TN01',store_name:'Local fixture',state:'TN',status:'Active',ownership:{known:true,zone_id:null,fo_profile_id:null}};
 const snapshot={admin:false,actor_id:'fixture',permissions:[{state:'TN',permission:'editor'}],stores:[store,{...store,id:'ka',store_code:'KA01',state:'KA'}],schedules:[],deep_cleaning:[],images:[],assignments:[],store_zone_history:[],zones:[],fos:[],attendance:[],aop:[],files:[],rows:[],proposals:[],events:[],epoch_at:today,from:today,to:today};
 const writes=[],errors=[];let failSave=true;
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{if(!localStorage.getItem('qpms-crm-auth-user'))localStorage.setItem('qpms-crm-auth-user',JSON.stringify({id:'fixture',profileId:'fixture',name:'Local fixture',role:'HK MIS',rawRole:'HK MIS',business:'Reliance Retail',status:'Active',isActive:true,webAccessEnabled:true,is_demo:true,isDemoReadOnly:true,read_only:false}));sessionStorage.setItem('qpms-crm-backend-token','synthetic-local-test-token');});
 await page.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.pathname.endsWith('/unified-master/propose')){writes.push(req.postDataJSON());return route.fulfill(failSave?{status:403,json:{message:'Existing permission denied'}}:{json:{result:'saved-request'}});}
  if(url.pathname.endsWith('/unified-master'))return route.fulfill({json:{result:snapshot}});
  if(url.pathname.endsWith('/module-reports/deep-cleaning'))return route.fulfill({json:{report:{stores:[store],schedules:[],submissions:[],exceptions:[],totals:{scheduled:0,completed:0,pending:0,not_completed:0}}}});
  if(url.pathname.endsWith('/attendance/summary'))return route.fulfill({json:{report:{...summarizeAttendance({stores:[store],attendance:[],aop:[],cutoff:today}),latest_imported_date:today,can_upload:false}}});
  return route.fulfill({json:{}});
 });
 const base=`http://127.0.0.1:${server.httpServer.address().port}`;
 try{
  await page.goto(base+'/reliance-retail/deep-cleaning');
  await page.getByRole('button',{name:'Schedule Deep Cleaning',exact:true}).click();
  await page.getByLabel('Schedule cleaning store').locator('option[value="tn"]').waitFor({state:'attached'});
  assert.equal(await page.getByLabel('Schedule cleaning store').locator('option[value="ka"]').count(),0);
  await page.getByLabel('Schedule cleaning store').selectOption('tn');
  await page.getByLabel('Selected cleaning store').filter({hasText:'TN01 · Local fixture · TN'}).waitFor();
  await page.getByLabel('Cleaning schedule reason').fill('Existing approval reference TEST');
  await page.getByRole('button',{name:'Submit schedule request',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Existing permission denied'}).waitFor();
  assert.equal(await page.getByText(/Schedule request saved for independent review/).count(),0);
  failSave=false;await page.getByRole('button',{name:'Submit schedule request',exact:true}).click();
  await page.getByText(/Schedule request saved for independent review/).waitFor();
  assert.deepEqual(writes[1],{kind:'DC_SCHEDULE',state:'TN',store_id:'tn',changes:{scheduled_date:today},reason:'Existing approval reference TEST'});
  assert.equal(writes.some(w=>Object.hasOwn(w,'p_actor')),false);
  await page.goto(base+'/reliance-retail/attendance');
  await page.getByLabel('Approved AOP coverage').waitFor();
  assert.equal(await page.getByText('Admin: coverage and source reconciliation',{exact:true}).count(),0);
  await page.evaluate(()=>{const u=JSON.parse(localStorage.getItem('qpms-crm-auth-user'));u.role='Admin';u.rawRole='Admin';localStorage.setItem('qpms-crm-auth-user',JSON.stringify(u));});
  await page.reload();await page.getByText('Admin: coverage and source reconciliation',{exact:true}).waitFor();
  const sidebar=page.locator('aside').first();
  for(const label of ['Dashboard','Attendance','Deep Cleaning','Training','CM/PM','Thermography','Fault Tracker'])assert.equal(await sidebar.getByRole('link',{name:label,exact:true}).count(),1,label);
  assert.equal(await sidebar.getByRole('link',{name:'Pre-Sales',exact:true}).count(),0);
  assert.equal(await page.getByText('Admin: coverage and source reconciliation',{exact:true}).evaluate(el=>el.parentElement.open),false);
  await page.evaluate(()=>{const u=JSON.parse(localStorage.getItem('qpms-crm-auth-user'));u.read_only=true;localStorage.setItem('qpms-crm-auth-user',JSON.stringify(u));});
  await page.goto(base+'/reliance-retail/deep-cleaning');
  await page.getByRole('button',{name:'Schedule Deep Cleaning',exact:true}).click();
  await page.getByText('Read-only access. Schedule requests cannot be submitted.',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Submit schedule request',exact:true}).isDisabled(),true);
  assert.equal(writes.length,2);
  for(const width of [1440,1024,390]){
   await page.setViewportSize({width,height:1000});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1),true,`New Retail navigation and schedule form fit ${width}px`);
   await page.screenshot({path:path.join(os.tmpdir(),`retail-final-scheduling-${width}.png`),fullPage:true,animations:'disabled'});
  }
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await server.close();}
});
