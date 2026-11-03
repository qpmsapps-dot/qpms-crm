import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';

test('OOS operator browser: access denial, reviewed upload, duplicate prevention, list, filters and status confirmation',{timeout:120000},async()=>{
 Object.assign(process.env,{VITE_ENABLE_DEMO_AUTH:'true',VITE_APP_MODE:'demo',VITE_SUPABASE_URL:'',VITE_SUPABASE_ANON_KEY:'',VITE_API_URL:'http://127.0.0.1:4999'});
 const server=await createServer({cacheDir:path.join(os.tmpdir(),'qpms-oos-training-vite'),server:{host:'127.0.0.1',port:0},logLevel:'error'});await server.listen();const browser=await chromium.launch({headless:true});
 try{
  const context=await browser.newContext();await context.addInitScript(()=>{localStorage.setItem('qpms-crm-auth-user',JSON.stringify({id:'fixture-auth',profileId:'fixture-profile',employeeCode:'QPMSADMIN',name:'Synthetic Admin',role:'Admin',rawRole:'Admin',status:'Active',isActive:true,webAccessEnabled:true,is_demo:true,isDemoReadOnly:true,read_only:false}));sessionStorage.setItem('qpms-crm-backend-token','synthetic-local-token');});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));let enabled=false,saved=false,imports=0,commands=0,reports=0,payload;
  const item={store_id:'store-1',store_code:'TEST1',description:'Synthetic line',quantity:2,unit_rate:50};
  await page.route('**/api/**',async route=>{const req=route.request(),u=new URL(req.url());let result={};
   if(u.pathname.endsWith('/mis/access')){if(!enabled)return route.fulfill({status:403,json:{message:'Active verified Retail MIS assignment required.'}});result={active:true,operator:true,role:'MIS_OOS',states:['TN']};}
   else if(u.pathname.endsWith('/oos/register')){reports++;result={complete:true,states:['TN'],twelve_stage_enabled:false,rows:saved?[{id:'order-1',reference:'TRAIN-1',state:'TN',workflow_version:1,store_ids:['store-1'],mapped_stores:[{id:'store-1',store_code:'TEST1',store_name:'Test store',state:'TN'}],store_codes:['TEST1'],store_codes_by_id:{'store-1':'TEST1'},status:'QUOTED',revision:1,details:{items:[item]}}]:[]};}
   else if(u.pathname.endsWith('/oos/capabilities'))result={writes_enabled:true,environment_writes_enabled:true,database_writes_enabled:true,actions:{'order-1':['PO_RECORDED','RETIRE']}};
   else if(u.pathname.endsWith('/quotation/preview'))result={source_rows:1,groups:[{quotation_number:'TRAIN-1',state:'TN',items:[item]}],plan:[{reference:'TRAIN-1',expected_revision:0,disposition:'CREATE'}]};
   else if(u.pathname.endsWith('/quotation/import')){imports++;assert.ok(req.headers()['x-quotation-review']);await new Promise(r=>setTimeout(r,250));saved=true;result={receipts:[{order_id:'order-1'}]};}
   else if(u.pathname.endsWith('/command/oos')){commands++;payload=req.postDataJSON();await new Promise(r=>setTimeout(r,200));}
   else if(u.pathname.includes('/oos/history/'))result=[{id:'event-1',action:'CREATE_OOS',actor_id:'fixture-profile',evidence:{revision:1}}];
   else return route.fulfill({status:403,json:{message:'Synthetic route denied'}});
   return route.fulfill({json:{ok:true,result}});
  });
  const url='http://127.0.0.1:'+server.httpServer.address().port+'/reliance-retail/mis/oos';await page.goto(url);await page.getByRole('alert').waitFor();assert.equal(reports,0);assert.equal(await page.getByRole('button',{name:'Upload Quotation'}).count(),0);
  enabled=true;await page.reload();await page.getByText('0 authorized quotations',{exact:true}).waitFor();
  await page.getByLabel('Quotation workbook').setInputFiles({name:'synthetic.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from('synthetic fixture')});await page.getByRole('button',{name:'Preview Quotation',exact:true}).click();await page.getByText('Synthetic line',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Save Quotation',exact:true}).isDisabled(),true);
  await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Save Quotation',exact:true}).evaluate(b=>{b.click();b.click();});await page.getByText('1 authorized quotations',{exact:true}).waitFor();assert.equal(imports,1);await page.getByRole('status').filter({hasText:'Quotation saved'}).waitFor();
  await page.getByLabel('Search quotations').fill('MISSING');await page.getByText('No authorized quotations match these filters.',{exact:false}).waitFor();await page.getByLabel('Search quotations').fill('TEST1');await page.getByRole('button',{name:'View Details',exact:true}).click();await page.getByText('Synthetic line',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Update Status',exact:true}).click();assert.deepEqual(await page.getByLabel('Next action').locator('option').evaluateAll(xs=>xs.map(x=>x.value)),['','PO_RECORDED','RETIRE']);await page.getByLabel('PO Number',{exact:true}).fill('PO-TEST');await page.getByLabel('PO Date',{exact:true}).fill('2026-11-02');await page.getByLabel('Reason',{exact:true}).fill('Approved synthetic PO');await page.getByRole('button',{name:'Review status change'}).click();await page.getByRole('dialog').waitFor();assert.equal(commands,0);await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(commands,0);
  await page.getByRole('button',{name:'Review status change'}).click();await page.getByRole('button',{name:'Confirm and save',exact:true}).evaluate(b=>{b.click();b.click();});await page.getByText('Status saved.',{exact:false}).waitFor();assert.equal(commands,1);assert.equal(payload.action,'PO_RECORDED');assert.equal(payload.data.fields.po_number,'PO-TEST');assert.ok(payload.data.request_id);
  await page.getByRole('button',{name:'View History',exact:true}).click();await page.getByText('CREATE_OOS',{exact:true}).waitFor();await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.querySelector('.oos-workspace').getBoundingClientRect().width<=window.innerWidth),true);assert.deepEqual(errors,[]);await context.close();
 }finally{await browser.close();await server.close();}
});
