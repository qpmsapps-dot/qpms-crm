import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';
import {RETAIL_MIS_MODULES} from '../backend/shared/retailMisAccess.js';
test('four MIS fixtures: exact navigation, denied routes, scoped states and complete exports',{timeout:120000},async()=>{
 Object.assign(process.env,{VITE_ENABLE_DEMO_AUTH:'true',VITE_APP_MODE:'demo',VITE_SUPABASE_URL:'',VITE_SUPABASE_ANON_KEY:'',VITE_API_URL:'http://127.0.0.1:4999'});
 const server=await createServer({cacheDir:path.join(os.tmpdir(),'qpms-retail-mis-vite'),server:{host:'127.0.0.1',port:0},logLevel:'error'});await server.listen();const browser=await chromium.launch({headless:true}),errors=[];
 try{for(const [role,modules] of Object.entries(RETAIL_MIS_MODULES)){
  const context=await browser.newContext();await context.addInitScript(role=>{localStorage.setItem('qpms-crm-auth-user',JSON.stringify({id:'fixture-auth',profileId:'fixture-profile',employeeCode:'FIXTURE_'+role,name:'Isolated '+role,role,rawRole:role,business:'Reliance Retail',status:'Active',isActive:true,webAccessEnabled:true,authProvider:'demo-fixture',is_demo:true,isDemoReadOnly:true,isDemo:true,read_only:false}));sessionStorage.setItem('qpms-crm-backend-token','synthetic-local-token');},role);
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));let state='';
  await page.route('**/api/**',async route=>{const u=new URL(route.request().url());if(u.pathname.endsWith('/mis/access'))return route.fulfill({json:{ok:true,result:{active:true,role,states:role==='CENTRAL_MIS'?['AP-1','AP-2','KA','KL','TG','TN','PY']:['TN','KL']}}});if(u.pathname.includes('/mis/report/')){state=u.searchParams.get('state');return route.fulfill({json:{ok:true,result:{rows:Array.from({length:31},(_,i)=>({id:'fixture-'+i,store_code:'S'+i,state:'TN',status:'draft'})),stores:[],evidence:[],complete:true}}});}return route.fulfill({status:403,json:{message:'Synthetic route denied'}});});
  const base='http://127.0.0.1:'+server.httpServer.address().port;
  await page.goto(base+'/reliance-retail/mis/'+modules[0]);await page.getByText('31 authorized records',{exact:true}).waitFor();
  const hrefs=await page.locator('nav a').evaluateAll(xs=>xs.map(x=>x.getAttribute('href')));for(const m of modules)assert.ok(hrefs.includes('/reliance-retail/mis/'+m));
  for(const m of modules){await page.goto(base+'/reliance-retail/mis/'+m);await page.getByText('31 authorized records',{exact:true}).waitFor();}
  await page.goto(base+'/reliance-retail/mis/'+modules[0]);await page.getByText('31 authorized records',{exact:true}).waitFor();
  if(role==='MIS_OOS'){assert.equal(hrefs.some(h=>h.includes('/stores')),false);assert.equal(await page.getByLabel('Geographic state',{exact:true}).count(),1);}
  await page.getByLabel('Geographic state',{exact:true}).selectOption('KL');await page.getByText('31 authorized records',{exact:true}).waitFor();await page.waitForTimeout(100);assert.equal(state,'KL');
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export Excel',exact:true}).click();const chunks=[];for await(const chunk of await(await download).createReadStream())chunks.push(chunk);const {default:ExcelJS}=await import('exceljs'),book=new ExcelJS.Workbook();await book.xlsx.load(Buffer.concat(chunks));assert.equal(book.worksheets[0].rowCount,32);
  const forbidden=role==='MIS_OOS'?'stores':role==='MIS_HK'?'maintenance':role==='MIS_MEPC'?'pest':'not-a-module';await page.goto(base+'/reliance-retail/mis/'+forbidden);await page.waitForURL(base+'/reliance-retail/mis/'+modules[0]);
  await context.close();
 }
 const context=await browser.newContext();await context.addInitScript(()=>{localStorage.setItem('qpms-crm-auth-user',JSON.stringify({id:'79cd196c-c6f3-404a-b22a-d4683afefa3f',profileId:'d40c2b3f-87f1-4c34-8798-cf9b0d9ca784',employeeCode:'QPMSADMIN',name:'Isolated Super Admin fixture',role:'Admin',rawRole:'Admin',status:'Active',isActive:true,webAccessEnabled:true,is_demo:true,isDemoReadOnly:true,read_only:false}));sessionStorage.setItem('qpms-crm-backend-token','synthetic-local-token');});
 const admin=await context.newPage();let saved;
 await admin.route('**/api/**',async route=>{const r=route.request(),u=new URL(r.url());if(u.pathname.endsWith('/identity'))return route.fulfill({json:{ok:true,result:{id:'fixture-target',auth_user_id:'fixture-auth',employee_code:'FIXTURE_MIS',full_name:'Isolated test account',role:'Business Development Head'}}});if(u.pathname.endsWith('/store-reviews'))return route.fulfill({json:{ok:true,result:[]}});if(u.pathname.endsWith('/assignments')){if(r.method()==='POST')saved=r.postDataJSON();return route.fulfill({json:{ok:true,result:r.method()==='POST'?{}:{assignments:[]}}});}return route.fulfill({json:{}});});
 await admin.goto('http://127.0.0.1:'+server.httpServer.address().port+'/settings/retail-mis-access');await admin.getByLabel('Existing employee code',{exact:true}).fill('FIXTURE_MIS');await admin.getByRole('button',{name:'Verify existing identity',exact:true}).click();await admin.getByLabel('Retail role',{exact:true}).selectOption('CENTRAL_MIS');await admin.getByLabel('Business reason',{exact:true}).fill('Verified fixture business approval');await admin.getByLabel('I verified this exact existing profile/auth/employee identity and the requested scope.',{exact:true}).check();await admin.getByRole('button',{name:'Save audited assignment',exact:true}).click();await admin.getByText('Assignment saved with immutable before/after audit.',{exact:true}).waitFor();assert.equal(saved.profile_id,'fixture-target');assert.equal(saved.auth_user_id,'fixture-auth');assert.equal(saved.role,'CENTRAL_MIS');assert.deepEqual(saved.states,[]);await context.close();
 assert.deepEqual(errors,[]);}finally{await browser.close();await server.close();}
});
