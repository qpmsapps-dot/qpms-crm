import {test,expect} from '@playwright/test';

async function admin(page){
 await page.addInitScript(()=>{
  localStorage.setItem('qpms-crm-auth-user',JSON.stringify({id:'test-admin',profileId:'test-admin',name:'Admin',
   role:'Admin',rawRole:'Admin',business:'Reliance Retail',status:'Active',isActive:true,
   webAccessEnabled:true,authProvider:'demo-fixture',is_demo:true,isDemoReadOnly:true,read_only:false}));
  sessionStorage.setItem('qpms-crm-backend-token','test-token');
 });
 const states=['TN','KN','KL','AP-1','AP-2','TG'];
 const excelRows=[
  {module:'cmpm',state:'TN',source_rows:133,distinct_store_codes:133,metrics:{cm_completed:133,pm_completed:126,pm_pending:7}},
  {module:'deep_cleaning',state:'TN',source_rows:95,distinct_store_codes:95,metrics:{completed:41,pending:54}},
  {module:'soft_skill_training',state:'TN',source_rows:78,distinct_store_codes:26,metrics:{completed:78}},
  {module:'technical_training',state:'TN',source_rows:56,distinct_store_codes:0,metrics:{completed:6,pending:50}},
  {module:'oos_historical',state:'TN',source_rows:376,distinct_store_codes:101,metrics:{po_referenced:219}},
  {module:'manpower_vacancy',state:'KL',source_rows:3,distinct_store_codes:3,metrics:{vacancies_reported:3}},
 ];
 await page.route('**/api/**',route=>{
  const path=new URL(route.request().url()).pathname;
  if(route.request().method()!=='GET')throw new Error('No source import writes from browser UI');
  if(path.endsWith('/module-reports/dashboard')){
   const rows=states.map(state=>({state,complete:false,total_actual:0,total_target:0,overall_pct:null,completed:0,scheduled:0,pending:0,remaining:0,hk_actual:0,mepc_actual:0}));
   return route.fulfill({json:{report:{stores:[],modules:Object.fromEntries(['attendance','technical','soft','cleaning','cm','pm','thermography'].map(k=>[k,{status:'ready',rows}])),historical_ifms:{status:'ready',source_class:'EXCEL_REPORTED_HISTORICAL_UNVERIFIED',rows:excelRows}}}});
  }
  if(path.endsWith('/module-reports/excel/cmpm')){
   return route.fulfill({json:{result:{module:'cmpm',month:'2026-10',source_type:'EXCEL_REPORTED_UNVERIFIED',total:2,page:1,limit:25,rows:[
    {id:1,source_row:3,state:'TN',store_code:'S001',match_status:'MATCHED',data:{store_name:'Test store A',cm_status:'COMPLETED',pm_status:'PENDING',remarks:'October source'}},
    {id:2,source_row:4,state:'TN',store_code:'S002',match_status:'STORE_NOT_FOUND',data:{store_name:'Test store B',cm_status:'COMPLETED',pm_status:'COMPLETED'}}
   ]}}});
  }
  if(path.endsWith('/operations/maintenance'))return route.fulfill({json:{result:{today:'2026-11-03',stores:[],events:[],modules:{cm:{status:'ready',rows:[],stores:[],window:{start:'2026-11-01',end:'2026-11-15'},total:{}},pm:{status:'ready',rows:[],stores:[],window:{start:'2026-11-16',end:'2026-11-30'},total:{}}}}}});
  return route.fulfill({json:{result:{rows:[],total:0},report:{rows:[]},stores:[],zones:[]}});
 });
}
test('October Excel figures appear inside existing dashboard cards, not in a separate summary panel',async({page})=>{
 await admin(page);await page.goto('/reliance-retail',{waitUntil:'domcontentloaded'});
 await page.getByLabel('Reporting month',{exact:true}).fill('2026-10');
 await expect(page.getByRole('button',{name:'Imported October Excel'})).toBeVisible();
 await expect(page.getByRole('button',{name:'Imported October Excel'})).toHaveAttribute('aria-pressed','true');
 await expect(page.getByRole('heading',{name:'October 2026 — Historical IFMS Excel report'})).toHaveCount(0);
 await expect(page.locator('#ifms-cm').locator('xpath=ancestor::section')).toContainText('133');
 await expect(page.locator('#ifms-cleaning').locator('xpath=ancestor::section')).toContainText('95');
 await expect(page.getByRole('heading',{name:'OOS Excel Tracker'})).toBeVisible();
 await page.getByRole('button',{name:'Verified App Records'}).click();
 await expect(page.getByRole('button',{name:'Verified App Records'})).toHaveAttribute('aria-pressed','true');
});
test('CM/PM module displays all imported per-row details and unmatched store warnings',async({page})=>{
 await admin(page);await page.goto('/reliance-retail/cmpm',{waitUntil:'domcontentloaded'});
 await expect(page.getByRole('heading',{name:'CM / PM October Excel'})).toBeVisible();
 const source=page.getByRole('region',{name:'CM / PM October Excel source table'});
 await expect(source.locator('tbody tr')).toHaveCount(2);
 await expect(source).toContainText('S001');
 await expect(source).toContainText('STORE NOT FOUND');
 await source.getByText('View source').first().click();
 await expect(source).toContainText('October source');
});
