import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';
test('IFMS schedule viewer desktop/mobile: pending visibility, read-only actions, refresh and denied access',{timeout:120000},async()=>{
 Object.assign(process.env,{VITE_ENABLE_DEMO_AUTH:'true',VITE_APP_MODE:'demo',VITE_SUPABASE_URL:'',VITE_SUPABASE_ANON_KEY:'',VITE_API_URL:'http://127.0.0.1:4999'});
 const server=await createServer({server:{host:'127.0.0.1',port:4187,strictPort:true,fs:{allow:[path.resolve('../../')] }},logLevel:'error'});await server.listen();
 const browser=await chromium.launch({headless:true});const shots=path.resolve('tmp/cleaning-delivery-screenshots');fs.mkdirSync(shots,{recursive:true});
 try{for(const [name,width,height] of [['desktop',1440,950],['mobile',390,844]]){
  const context=await browser.newContext({viewport:{width,height}});await context.addInitScript(()=>{localStorage.setItem('qpms-crm-auth-user',JSON.stringify({id:'synthetic-viewer',profileId:'viewer',name:'Synthetic IFMS Viewer',role:'GM',rawRole:'GM',business:'IFMS',status:'Active',isActive:true,webAccessEnabled:true,is_demo:true,isDemoReadOnly:true,read_only:false}));sessionStorage.setItem('qpms-crm-backend-token','synthetic-test-only');});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));let allowed=true,mutations=0,reads=0,exportAllowed=false,exports=0;
  await page.route('**/api/**',route=>{if(route.request().method()!=='GET'){mutations++;return route.fulfill({status:403,json:{message:'Mutations denied'}});}if(new URL(route.request().url()).pathname==='/api/client-deep-cleaning/schedules/export'){exports++;return route.fulfill(exportAllowed?{json:{rows:[{store_code:'PY001',store_name:'Synthetic PY store',geographic_state:'PY',reporting_state:'TN',scheduled_date:'2026-11-03',status:'Planned',assignment_status:'Assignment Pending'}],pagination:{total:1}}}:{status:403,json:{message:'Export denied'}});}if(new URL(route.request().url()).pathname==='/api/client-deep-cleaning/schedules'){reads++;return route.fulfill(allowed?{json:{contract_version:'retail-cleaning.v1',capabilities:{export:exportAllowed},rows:[{schedule_id:'s1',store_code:'PY001',store_name:'Synthetic PY store',geographic_state:'PY',reporting_state:'TN',zone_id:'ZONE-4',scheduled_date:'2026-11-03',activity:'Deep Cleaning',status:'Planned',assignment_status:'Assignment Pending',notes:'Existing cleaning instructions',permitted_actions:['view']}],pagination:{page:1,limit:50,total:1}}}:{status:403,json:{message:'An explicit Reliance Retail Deep Cleaning grant is required.'}});}return route.fulfill({json:{allowed:false,access_granted:false}});});
  await page.goto('http://127.0.0.1:4187/retail-cleaning-schedules');await page.getByRole('cell',{name:'PY001 — Synthetic PY store'}).waitFor();assert.equal(await page.getByRole('cell',{name:'Planned',exact:true}).count(),1);assert.equal(await page.getByRole('cell',{name:'Assignment Pending',exact:true}).count(),1);assert.equal(await page.getByRole('button',{name:/create|complete|assign|edit|delete/i}).count(),0);
  await page.screenshot({path:path.join(shots,`${name}.png`),fullPage:true});
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2);assert.equal(overflow,false);
  const before=reads;await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByRole('cell',{name:'Assignment Pending',exact:true}).waitFor();assert.ok(reads>before);
  assert.equal(await page.getByRole('button',{name:'Export Excel',exact:true}).count(),0);
  exportAllowed=true;await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByRole('button',{name:'Export Excel',exact:true}).waitFor();
  const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Export Excel',exact:true}).click();const download=await downloadPromise;assert.equal(download.suggestedFilename(),'Retail_Cleaning_Schedules.xlsx');assert.equal(exports,1);
  allowed=false;await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByRole('alert').waitFor();assert.equal(await page.getByRole('cell',{name:'PY001 — Synthetic PY store'}).count(),0);assert.equal(mutations,0);assert.deepEqual(errors,[]);await context.close();
 }}finally{await browser.close();await server.close();}
});
