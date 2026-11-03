import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';
import {OOS12} from '../src/pages/reliance-retail/retailOosModel.js';
import {OOS12_FIELDS} from '../backend/shared/retailOos12Workflow.js';
import {RETAIL_OOS_STATES,retailOosState} from '../backend/shared/retailMisAccess.js';
test('OOS UI: workflow badges, six states, PY consolidation, shared role layout, capability denial and desktop/mobile captures',{timeout:120000},async()=>{
Object.assign(process.env,{VITE_ENABLE_DEMO_AUTH:'true',VITE_APP_MODE:'demo',VITE_SUPABASE_URL:'',VITE_SUPABASE_ANON_KEY:'',VITE_API_URL:'http://127.0.0.1:4999'});
const shots=path.resolve('tmp/oos-ui-release-screenshots');fs.mkdirSync(shots,{recursive:true});
const states=['TN','KA','KL','TG','AP-1','AP-2'];assert.deepEqual([...RETAIL_OOS_STATES],states);assert.equal(retailOosState('PY'),'TN');
const rows=[...states,'PY'].map((state,i)=>({id:'visual-'+i,reference:i===1?'QA-LEGACY-002':'QA-OOS12-00'+(i+1),workflow_version:i===1?1:2,stage:i===1?undefined:7,status:i===1?'PO_RECORDED':OOS12[6][0],revision:7,rework_count:1,created_by:'Synthetic uploader',store_ids:['s'+i],mapped_stores:[{id:'s'+i,state,store_code:'QA'+i,store_name:'Synthetic '+state+' store'}],original_items:[{total_amount:'12508.00',quotation_header:{quotation_date:'2026-10-24',totals:{numeric_text:{taxable_amount:'10600.00',total_gst:'1908.00',management_fees:'600.00',total_amount:'12508.00'},source_row:99}}}],original_po_number:'QA-PO-00'+i,original_po_date:'2026-10-27',status_entered_at:'2026-10-30T04:30:00Z',updated_at:'2026-10-30T04:30:00Z',details:{items:[{store_id:'s'+i,description:'Synthetic OOS service line',quantity:'1',unit_rate:'10000.00',total_amount:'12508.00'}]},history:[]}));
const history=[{id:'ev2',action:OOS12[6][0],actor_id:'qa-oos-mis',actor_name:'Synthetic OOS-MIS actor',created_at:'2026-10-30T04:30:00Z',after_value:{revision:7},evidence:{fields:{confirming_person_name:'Synthetic confirming person',confirming_department:'Operations',confirmation_date:'2026-10-30',confirmation_reference:'QA-OFFLINE-007'},remarks:'Work commenced following recorded offline confirmation.',confirmation_authenticity:'MIS_SUBMITTED_UNVERIFIED',system_actor_capacity:'OOS-MIS',evidence_ids:['qa-evidence-007']}},{id:'ev1',action:'CREATE_OOS',actor_id:'qa-uploader',actor_name:'Synthetic uploader',created_at:'2026-10-24T06:00:00Z',after_value:{revision:1},evidence:{},has_workbook:true}];
const server=await createServer({cacheDir:path.join(os.tmpdir(),'qpms-oos-final-visual'),server:{host:'127.0.0.1',port:0,watch:{ignored:[path.resolve('tmp').split(path.sep).join('/')+'/**',path.resolve('dist').split(path.sep).join('/')+'/**']}},logLevel:'error'});await server.listen();const browser=await chromium.launch({headless:true});const results={states,PY:'TN',captures:[],roles:{},mutations:0};
try{
for(const role of ['Admin','MIS_OOS']){
 const context=await browser.newContext({viewport:{width:1600,height:1100}});
 await context.addInitScript(({role})=>{localStorage.setItem('qpms-crm-auth-user',JSON.stringify({id:'qa-user',profileId:'qa-profile',employeeCode:role==='Admin'?'QPMSADMIN':'QA-OOS',name:'LOCAL VISUAL REVIEW',role,rawRole:role,business:'Reliance Retail',status:'Active',isActive:true,webAccessEnabled:true,is_demo:true,isDemoReadOnly:true,read_only:false}));sessionStorage.setItem('qpms-crm-backend-token','local-synthetic-token');},{role});
 const page=await context.newPage();let allowed=true;const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',async route=>{const url=new URL(route.request().url());if(route.request().method()!=='GET'){results.mutations++;return route.fulfill({status:403,json:{message:'Visual review is read-only'}});}let result;
 if(url.pathname.endsWith('/mis/access'))result={active:true,role:'MIS_OOS',operator:role==='Admin',states:[...states,'PY']};
 else if(url.pathname.endsWith('/oos/register'))result={complete:true,twelve_stage_available:true,twelve_stage_enabled:true,states,rows};
 else if(url.pathname.endsWith('/oos/capabilities'))result={writes_enabled:true,twelve_stage_enabled:true,actions:Object.fromEntries(rows.map(r=>[r.id,allowed?[r.workflow_version===1?'COMMERCIALLY_CONFIRMED':OOS12[7][0]]:[]])),requirements:Object.fromEntries(rows.filter(r=>r.workflow_version===2).map(r=>[r.id,{next:{code:OOS12[7][0]},spec:{fields:OOS12_FIELDS[OOS12[7][0]],minimum_evidence:1,confirmation_department:'Operations'},can_submit:allowed}]))};
 else if(url.pathname.includes('/oos/history/'))result=history;
 else return route.fulfill({status:403,json:{message:'Synthetic review route unavailable'}});
 await route.fulfill({json:{ok:true,result}});
 });
 await page.goto('http://127.0.0.1:'+server.httpServer.address().port+'/reliance-retail/mis/oos');await page.getByText('7 authorized quotations',{exact:true}).waitFor();
 const options=await page.getByLabel('Geographic state').locator('option').allTextContents();assert.deepEqual(options,['All authorized states',...states]);
 await page.getByLabel('Geographic state').selectOption('TN');await page.getByText('2 authorized quotations',{exact:true}).waitFor();await page.getByLabel('Geographic state').selectOption('');
 const mark=async()=>{await page.evaluate(()=>{if(document.querySelector('#visual-qa'))return;const p=document.createElement('p');p.id='visual-qa';p.textContent='LOCAL BROWSER CAPTURE - SYNTHETIC DATA - NOT PRODUCTION';p.style='padding:10px;background:#fff4d2;color:#744b00;font-weight:700';document.querySelector('.oos-workspace').prepend(p);});};await mark();
 const capture=async(name,locator)=>{await (locator||page).screenshot({path:path.join(shots,name+'.png'),...(!locator&&name.includes('register')?{fullPage:true}:{})});results.captures.push(name+'.png');};
 const table=page.getByRole('table',{name:'Quotation register'});const structure={kpis:await page.locator('.oos-kpis article p').allTextContents(),headers:await table.locator('th').allTextContents(),states:options};results.roles[role]=structure;
 if(role==='Admin'){
 assert.equal(await table.getByLabel('Workflow: Legacy',{exact:true}).count(),1);assert.equal(await table.getByLabel('Workflow: 12-Stage',{exact:true}).count(),6);
 await capture('01-desktop-register');
 await page.getByRole('button',{name:'QA-OOS12-001',exact:true}).click();await page.getByRole('dialog',{name:'Quotation details',exact:true}).waitFor();assert.equal(await page.getByRole('dialog').getByLabel('Workflow: 12-Stage',{exact:true}).count(),1);await page.getByRole('button',{name:'Expand drawer'}).click();await capture('02-desktop-expanded-details');
 await page.getByLabel('Financial summary').scrollIntoViewIfNeeded();await capture('03-desktop-financial-summary',page.getByLabel('Financial summary'));
 const timeline=page.locator('.oos-stage-timeline');assert.equal(await timeline.locator('.completed').count(),6);assert.equal(await timeline.locator('.current').count(),1);assert.equal(await timeline.locator('.pending').count(),5);await timeline.scrollIntoViewIfNeeded();await capture('04-desktop-12-stage-progress',timeline);
 await page.getByRole('dialog').getByRole('button',{name:'Update Status',exact:true}).click();await page.getByLabel('Twelve-stage status update').waitFor();await page.locator('.oos-drawer-body').evaluate(el=>el.scrollTop=0);await capture('05-desktop-update-status');assert.equal(await page.getByRole('button',{name:'Review status change',exact:true}).isDisabled(),true);
 await page.getByRole('button',{name:'Close drawer'}).click();await table.locator('tbody tr').first().getByRole('button',{name:'View History',exact:true}).click();await page.getByText('Synthetic confirming person',{exact:true}).waitFor();await capture('06-desktop-audit-history');assert.equal(await page.locator('pre').count(),0);await page.getByRole('button',{name:'Close drawer'}).click();
 await page.getByRole('button',{name:'QA-LEGACY-002',exact:true}).click();await page.getByText('Approved 12-stage workflow (not active for this legacy quotation)',{exact:true}).waitFor();assert.equal(await page.locator('.oos-stage-timeline .completed').count(),0);assert.equal(await page.getByRole('dialog').getByLabel('Workflow: Legacy',{exact:true}).count(),1);await capture('07-desktop-legacy-distinction');await page.getByRole('button',{name:'Close drawer'}).click();
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'QA-OOS12-001',exact:true}).click();await page.getByRole('dialog',{name:'Quotation details',exact:true}).waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.equal(await page.getByRole('dialog').getByLabel('Workflow: 12-Stage',{exact:true}).count(),1);await capture('08-mobile-details');await page.getByRole('button',{name:'Close drawer'}).click();await page.getByRole('button',{name:'QA-LEGACY-002',exact:true}).click();assert.equal(await page.getByRole('dialog').getByLabel('Workflow: Legacy',{exact:true}).count(),1);await capture('10-mobile-legacy');await page.getByRole('button',{name:'Close drawer'}).click();await table.getByLabel('Workflow: Legacy',{exact:true}).scrollIntoViewIfNeeded();await capture('11-mobile-register');
 }else{await capture('09-desktop-oos-mis-register');allowed=false;await page.reload();await page.getByText('7 authorized quotations',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Update Status',exact:true}).first().isDisabled(),true);await page.getByRole('button',{name:'QA-OOS12-001',exact:true}).click();assert.equal(await page.getByRole('dialog').getByRole('button',{name:'Update Status',exact:true}).isDisabled(),true);results.permissionDenialVerified=true;}
 assert.deepEqual(errors,[]);await context.close();
}
assert.deepEqual(results.roles.Admin,results.roles.MIS_OOS);assert.equal(results.mutations,0);results.sharedLayoutVerified=true;results.legacyInactiveVerified=true;fs.writeFileSync(path.join(shots,'verification.json'),JSON.stringify(results,null,2));console.log(JSON.stringify({ok:true,captures:results.captures,states,sharedLayoutVerified:true,permissionDenialVerified:true,mutations:0}));
}finally{await browser.close();await server.close();}

});
