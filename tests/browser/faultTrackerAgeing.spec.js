import {test,expect} from '@playwright/test';
import * as XLSX from 'xlsx';
import fs from 'node:fs/promises';
import {RETAIL_FAULT_STAGES} from '../../backend/shared/retailFaultWorkflow.js';
import {AGEING_REGIONS,AGEING_SHEET_NAMES,buildAgeingReports,ageingExportRows,ageingTicketExportRows} from '../../src/utils/faultTrackerAgeing.js';

// Synthetic API responses only. No credentials or actual Supabase/backend calls.
function fixture(){
 const ages=[0,3,4,7,8,15,16,30,31,60,61,90,91,null,0,3,42];
 const rows=RETAIL_FAULT_STAGES.map((stage,i)=>({id:'stage-'+i,ticket_no:'SYN-'+i,store_code:'SYN'+i,store_name:'Synthetic Store '+i,
  operational_state_code:AGEING_REGIONS[i%6][0],stage,ageing_days:ages[i],remarks:'Retained '+i,
  created_at_source:'2026-11-01T00:00:00Z',import_batch_id:'batch',updated_at:'2026-11-25T10:00:00Z',
  metadata:{issueTitle:'Synthetic issue '+i},raw_row:{Status:'IN_PROGRESS'},verified_updates:[],can_update:false}));
 rows.push({...rows[0],id:'py',ticket_no:'PY-0',operational_state_code:'PY',stage:'HK',ageing_days:0});
 rows.push({...rows[0],id:'legacy',ticket_no:'UNKNOWN-STAGE',operational_state_code:'KL',stage:'IN_PROGRESS',ageing_days:null});
 rows.push({...rows[0],id:'unmapped',ticket_no:'UNMAPPED-REGION',operational_state_code:'ZZ',stage:'CAMC',ageing_days:3});
 rows.push({...rows[0],id:'kerala',ticket_no:'KL-RETAINED',store_code:'0007',store_name:'Synthetic Kerala Store',operational_state_code:'KL',
  stage:'Work Completed - Call Yet to Close',ageing_days:101,remarks:'',metadata:{issueTitle:'Kerala retained work'},
  raw_row:{Status:'IN_PROGRESS',Remarks:'Stale Excel remark'},verified_updates:[{id:'synthetic-event',new_stage:'Work Completed - Call Yet to Close',remarks:''}]});
 return rows;
}
const projection=rows=>rows.map(r=>({id:r.id,ticketNumber:r.ticket_no,storeId:r.store_code,storeName:r.store_name,groupedState:r.operational_state_code,ifmsStage:r.stage,ageingDays:r.ageing_days,ageingSourceDays:r.ageing_days,remarks:r.remarks,issueTitle:r.metadata.issueTitle}));
async function seed(page,{role='Admin',state='',allowed=null,deny=false,localImport=false}={}){
 const data={rows:allowed?fixture().filter(r=>allowed.includes(r.operational_state_code)):fixture(),requests:[],imports:0};
 await page.addInitScript(({role,state,localImport})=>{
  localStorage.setItem('qpms-crm-auth-user',JSON.stringify({id:'synthetic',profileId:'synthetic',name:'Synthetic report user',role,rawRole:role,state,business:'Reliance Retail',status:'Active',isActive:true,webAccessEnabled:true,authProvider:'demo-fixture',is_demo:true,isDemoReadOnly:true,...(localImport?{read_only:false}:{})}));
  sessionStorage.setItem('qpms-crm-backend-token','synthetic-token');
 },{role,state,localImport});
 await page.route('**/*',route=>{
  const url=new URL(route.request().url());
  return ['127.0.0.1','localhost'].includes(url.hostname)?route.continue():route.abort();
 });
 await page.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url());data.requests.push({method:request.method(),path:url.pathname,params:Object.fromEntries(url.searchParams)});
  if(url.pathname==='/api/fault-tracker/tickets')return route.fulfill(deny?{status:403,json:{message:'Synthetic scope denied'}}:{json:{ok:true,tickets:data.rows,import_batch:{id:'batch',original_file_name:'Synthetic latest.xlsx',imported_at:'2026-11-25T10:00:00Z',ticket_count:data.rows.length}}});
  if(url.pathname==='/api/fault-tracker/import'&&request.method()==='POST'){
   data.imports++;data.rows=data.rows.map(r=>({...r,ageing_days:r.ageing_days===null?null:r.ageing_days+1,raw_row:{...r.raw_row,Status:'IN_PROGRESS'}}));
   return route.fulfill({json:{ok:true,import_batch_id:'next-batch',ticket_count:data.rows.length}});
  }
  if(request.method()!=='GET')throw Error('Unexpected synthetic mutation: '+url.pathname);
  return route.fulfill({json:{}});
 });
 return data;
}
const stageTable=page=>page.getByRole('region',{name:'Stage ageing table',exact:true});
const stateTable=page=>page.getByRole('region',{name:'State ageing table',exact:true});
const tableRow=(table,label)=>table.getByRole('rowheader',{name:label,exact:true}).locator('..');
async function decodedDownload(page,button){
 const pending=page.waitForEvent('download');await button.click();const download=await pending;
 return XLSX.read(await fs.readFile(await download.path()),{type:'buffer'});
}

test('South and all six region filters synchronize chart and table, include every stage and reconcile exports',async({page})=>{
 const data=await seed(page);await page.goto('/fault-tracker');
 await expect(stageTable(page)).toBeVisible();await expect(page.getByLabel('Ageing region')).toHaveValue('');
 for(const selection of ['',...AGEING_REGIONS.map(([code])=>code)]){
  await page.getByLabel('Ageing region').selectOption(selection);
  await expect(page.getByLabel('Stage progress region')).toHaveValue(selection);
  const expected=buildAgeingReports(projection(data.rows),selection),total=expected.stages.at(-1).total;
  await expect(page.getByLabel('Stage progress total')).toHaveText(total+' tickets');
  await expect(tableRow(stageTable(page),'Grand Total').getByRole('button').first()).toHaveText(String(total));
  const displayed=await stageTable(page).locator('tbody tr').evaluateAll(rows=>rows.map(row=>Array.from(row.cells,cell=>cell.innerText.trim())));
  expect(displayed).toEqual(ageingExportRows(expected.stages).slice(1).map(row=>row.map(value=>value===null?'—':String(value))));
  const consolidated=await stateTable(page).locator('tbody tr').evaluateAll(rows=>rows.map(row=>Array.from(row.cells,cell=>cell.innerText.trim())));
  expect(consolidated).toEqual(ageingExportRows(expected.states,true).slice(1).map(row=>row.map(value=>value===null?'—':String(value))));
  for(const stage of RETAIL_FAULT_STAGES)await expect(stageTable(page).getByRole('rowheader',{name:stage,exact:true})).toBeVisible();
  const book=await decodedDownload(page,page.getByRole('button',{name:'Export ageing Excel',exact:true}));
  expect(book.SheetNames).toEqual(AGEING_SHEET_NAMES);
  for(const [i,rows] of [expected.stages,expected.states].entries())expect(XLSX.utils.sheet_to_json(book.Sheets[AGEING_SHEET_NAMES[i]],{header:1,defval:null})).toEqual(ageingExportRows(rows,i===1));
 }
 await page.getByLabel('Stage progress region').selectOption('TN');
 await expect(page.getByLabel('Ageing region')).toHaveValue('TN');
 await expect(page.getByRole('heading',{name:'Stage-wise Ageing Analysis (TN & PY)',exact:true})).toBeVisible();
 expect(data.requests.filter(r=>r.path==='/api/fault-tracker/tickets').every(r=>r.params.latest==='true')).toBe(true);
});

test('nonzero bucket drill-down and exported detail contain all requested fields and retained Kerala data',async({page})=>{
 const data=await seed(page);await page.goto('/fault-tracker');await page.getByLabel('Ageing region').selectOption('KL');
 const row=tableRow(stageTable(page),'Work Completed - Call Yet to Close');
  await expect(row.getByRole('button',{name:/ >90 /})).toHaveClass(/text-red-700/);
 await row.getByRole('button',{name:/ >90 /}).click();
 const details=page.getByRole('region',{name:'Ageing ticket details'});
 await expect(details.getByRole('cell',{name:'KL-RETAINED',exact:true})).toBeVisible();
 await expect(details.getByRole('cell',{name:'Synthetic Kerala Store',exact:true})).toBeVisible();
 await expect(details.getByRole('cell',{name:'Kerala retained work',exact:true})).toBeVisible();
 await expect(details).not.toContainText('Stale Excel remark');
 const book=await decodedDownload(page,page.getByRole('button',{name:'Export tickets',exact:true}));
 const expected=projection(data.rows).filter(r=>r.ticketNumber==='KL-RETAINED');
 expect(XLSX.utils.sheet_to_json(book.Sheets['Ticket details'],{header:1,defval:''})).toEqual(ageingTicketExportRows(expected));
 await page.getByRole('button',{name:'Close details',exact:true}).click();
 await tableRow(stateTable(page),'TN & PY').getByRole('button',{name:/0–3, 4–7, 8–15, 16–30/}).click();
 const book2=await decodedDownload(page,page.getByRole('button',{name:'Export tickets',exact:true}));
 expect(XLSX.utils.sheet_to_json(book2.Sheets['Ticket details'],{header:1}).length-1).toBe(3);
});

test('subsequent Excel import refreshes ageing, retains stage/cleared remarks and updates an open drill-down',async({page})=>{
 const data=await seed(page,{localImport:true});await page.goto('/fault-tracker');await page.getByLabel('Ageing region').selectOption('KL');
 await tableRow(stageTable(page),'Work Completed - Call Yet to Close').getByRole('button',{name:/ >90 /}).click();
 const input=page.locator('input[type=file]');
 const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.json_to_sheet([{'Ticket No':'KL-RETAINED','Store Code':'0007',Status:'IN_PROGRESS',Ageing:102}]),'Pending Tickets');
 await input.setInputFiles({name:'Synthetic reimport.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:XLSX.write(book,{type:'buffer',bookType:'xlsx'})});
 await expect.poll(()=>data.imports).toBe(1);
 const details=page.getByRole('region',{name:'Ageing ticket details'});
 await expect(details.getByRole('cell',{name:'102',exact:true})).toBeVisible();
 await expect(details.getByRole('cell',{name:'Work Completed - Call Yet to Close',exact:true})).toBeVisible();
 await expect(details).not.toContainText('Stale Excel remark');
 // A complete newer synthetic dump omits the ticket: no closure inference or old-row cache.
 data.rows=data.rows.filter(r=>r.id!=='kerala');
 await input.setInputFiles({name:'Synthetic disappeared.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:XLSX.write(book,{type:'buffer',bookType:'xlsx'})});
 await expect.poll(()=>data.imports).toBe(2);
 await expect(details.getByRole('cell',{name:'KL-RETAINED',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Export tickets',exact:true})).toBeDisabled();
});

test('authorized state subset and denial never fetch or export another state',async({page})=>{
 const data=await seed(page,{role:'Branch Head',state:'KL',allowed:['KL']});await page.goto('/fault-tracker');
 await expect(stageTable(page)).toBeVisible();
 const book=await decodedDownload(page,page.getByRole('button',{name:'Export ageing Excel',exact:true}));
 const totals=XLSX.utils.sheet_to_json(book.Sheets[AGEING_SHEET_NAMES[1]],{header:1,defval:null});
 expect(totals.find(row=>row[0]==='South Total')[1]).toBe(data.rows.length);
 expect(totals.find(row=>row[0]==='KA')[1]).toBe(0);
 expect(data.requests.every(r=>r.method==='GET')).toBe(true);
});

test('403 source failure leaves no stale ageing report or enabled ageing export',async({page})=>{
 await seed(page,{deny:true});await page.goto('/fault-tracker');
 await expect(page.getByText('Synthetic scope denied',{exact:true})).toBeVisible();
 await expect(stageTable(page)).toHaveCount(0);await expect(page.getByRole('button',{name:'Export ageing Excel',exact:true})).toHaveCount(0);
});

test('desktop and mobile tables keep full stage names and scroll within the page',async({page},info)=>{
 await seed(page);await page.goto('/fault-tracker');await expect(stageTable(page)).toBeVisible();
 for(const [width,height] of [[1440,1000],[768,950],[390,844]]){
  await page.setViewportSize({width,height});
  const stage=stageTable(page).getByRole('rowheader',{name:'Work Completed - Call Yet to Close',exact:true});
  await expect(stage).toHaveCSS('white-space','normal');
  expect(await stage.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+2);
  await stageTable(page).locator('..').screenshot({path:info.outputPath('ageing-'+width+'.png')});
 }
});
