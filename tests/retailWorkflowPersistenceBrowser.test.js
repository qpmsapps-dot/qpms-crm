import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';
import {RETAIL_FAULT_STAGES} from '../backend/shared/retailFaultWorkflow.js';

// Synthetic local session and intercepted API; actual SQL persistence is tested separately.
test('Fault Save awaits backend success, reloads saved history, survives refresh and exports scoped saved rows',{timeout:90000},async()=>{
 Object.assign(process.env,{VITE_ENABLE_DEMO_AUTH:'true',VITE_APP_MODE:'demo',VITE_SUPABASE_URL:'',VITE_SUPABASE_ANON_KEY:'',VITE_API_URL:'http://127.0.0.1:4999'});
 const server=await createServer({cacheDir:path.join(os.tmpdir(),'retail-workflow-persistence-vite'),server:{host:'127.0.0.1',port:0},logLevel:'error'});await server.listen();
 const browser=await chromium.launch({headless:true}),page=await browser.newPage(),errors=[],commands=[];
 let failSave=true,available=true,linked=false,failLink=true;
 const ticket={id:'00000000-0000-4000-8000-000000000020',import_batch_id:'batch',ticket_no:'ELIGIBLE-ONLY',canonical_store_code:'T1',store_name:'Scoped fixture',operational_state_code:'TN',stage:RETAIL_FAULT_STAGES[0],updated_at:'2026-10-01T00:00:00Z',remarks:'Original',verified_updates:[],can_update:true,created_at_source:'2026-10-01T00:00:00Z',ageing_days:30,category_group:'HK'};
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{localStorage.setItem('qpms-crm-auth-user',JSON.stringify({id:'fixture-admin',profileId:'fixture-admin',name:'Local fixture',role:'Admin',rawRole:'Admin',status:'Active',isActive:true,webAccessEnabled:true,is_demo:true,isDemoReadOnly:true,read_only:false}));sessionStorage.setItem('qpms-crm-backend-token','synthetic-local-test-token');});
 await page.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.pathname===`/api/fault-tracker/tickets/${ticket.id}`&&req.method()==='PATCH'){
   const data=req.postDataJSON();commands.push(data);
   if(failSave)return route.fulfill({status:409,json:{message:'Ticket changed. Refresh before updating.'}});
   ticket.stage=data.stage;ticket.remarks=data.remarks;ticket.updated_at=new Date().toISOString();ticket.verified_updates=[{id:'event1',previous_stage:RETAIL_FAULT_STAGES[0],new_stage:data.stage,remarks:data.remarks,created_at:ticket.updated_at,updated_by_employee_code:'QPMSADMIN',update_type:'WORK_COMPLETED',metadata:{retail_workflow_version:1}}];
   return route.fulfill({json:{ok:true,saved:true}});
  }
  if(url.pathname==='/api/fault-tracker/tickets')return route.fulfill({json:{ok:true,import_batch:{id:'batch',ticket_count:1},tickets:[available?ticket:{...ticket,verified_updates:undefined,can_update:false}]}});
  if(url.pathname.endsWith('/deep-cleaning/plan/link-fo')){
   assert.deepEqual(req.postDataJSON(),{source_id:'00000000-0000-4000-8000-000000000040'});
   if(failLink)return route.fulfill({status:403,json:{message:'Independent approval required'}});
   linked=true;return route.fulfill({json:{ok:true,result:{saved:true}}});
  }
  if(url.pathname.endsWith('/module-reports/deep-cleaning'))return route.fulfill({json:{report:{stores:[{id:'store',store_code:'T1',state:'TN'}],exceptions:[],totals:{scheduled:1,completed:linked?1:0,pending:linked?0:1,not_completed:0},submissions:[],schedules:[{id:'plan',store:{id:'store',store_code:'T1',state:'TN'},reporting_state:'TN',scheduled_date:'2026-10-31',display_status:linked?'Completed':'Scheduled',submission_ids:[]}]}}});
  return route.fulfill({json:{}});
 });
 const base=`http://127.0.0.1:${server.httpServer.address().port}`;
 const mis=async()=>{await page.locator('select').filter({has:page.locator('option[value="Management View"]')}).selectOption('Project Coordinator / MIS View');await page.getByRole('button',{name:'Detailed View',exact:true}).click();};
 try{
  await page.goto(base+'/fault-tracker');await mis();await page.getByRole('button',{name:'Update',exact:true}).click();
  await page.getByLabel('Update IFMS stage').selectOption(RETAIL_FAULT_STAGES[5]);await page.getByLabel('Update remarks').fill('Verified completion fixture');
  await page.getByRole('button',{name:'Save',exact:true}).click();await page.getByRole('alert').getByText('Ticket changed. Refresh before updating.',{exact:true}).waitFor();
  assert.equal(ticket.remarks,'Original');assert.equal(await page.getByRole('button',{name:'Save',exact:true}).count(),1);
  failSave=false;await page.getByRole('button',{name:'Save',exact:true}).click();await page.getByRole('button',{name:'Save',exact:true}).waitFor({state:'detached'});
  assert.equal(commands[1].expected_updated_at,'2026-10-01T00:00:00Z');assert.equal(commands[1].request_id,commands[0].request_id);assert.equal(Object.hasOwn(commands[1],'p_actor'),false);
  await page.reload();await mis();await page.getByRole('button',{name:'Update',exact:true}).click();
  await page.getByRole('region',{name:'Saved ticket history'}).getByText(/QPMSADMIN/).waitFor();assert.equal(await page.getByLabel('Update remarks').inputValue(),'Verified completion fixture');
  await page.getByRole('button',{name:'Close update drawer'}).click();
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export scoped tickets',exact:true}).click();
  const chunks=[];for await(const chunk of await (await download).createReadStream())chunks.push(chunk);
  const XLSX=await import('xlsx'),book=XLSX.read(Buffer.concat(chunks)),rows=XLSX.utils.sheet_to_json(book.Sheets['Scoped IFMS tickets']);
  assert.equal(rows.length,1);assert.equal(rows[0]['Ticket No'],'ELIGIBLE-ONLY');assert.match(rows[0]['Saved workflow history'],/event1/);
  available=false;await page.reload();await page.getByText('Completed This Week',{exact:true}).waitFor();
  assert.match(await page.getByText('Completed This Week',{exact:true}).locator('..').textContent(),/N\/A/);
  await mis();assert.equal(await page.getByRole('button',{name:'Update',exact:true}).count(),0);
  await page.goto(base+'/reliance-retail/deep-cleaning');await page.getByText('Link verified FO completion',{exact:true}).click();
  await page.getByLabel('Existing FO cleaning submission ID').fill('00000000-0000-4000-8000-000000000040');
  await page.getByLabel('I verified this submitted work against the approved schedule.').check();
  await page.getByRole('button',{name:'Confirm verified link',exact:true}).click();await page.getByRole('alert').getByText('Independent approval required',{exact:true}).waitFor();assert.equal(linked,false);
  failLink=false;await page.getByRole('button',{name:'Confirm verified link',exact:true}).click();
  await page.locator('[data-status="Completed"]').waitFor();assert.equal(linked,true);assert.equal(await page.getByText('Link verified FO completion',{exact:true}).count(),0);
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await server.close();}
});
