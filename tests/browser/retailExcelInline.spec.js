import {test,expect} from '@playwright/test';

// All responses are synthetic; tests never touch production data or perform writes.
async function setup(page){
 await page.addInitScript(()=>{
  localStorage.setItem('qpms-crm-auth-user',JSON.stringify({
   id:'synthetic-admin',profileId:'synthetic-profile',name:'Retail Test',
   role:'Admin',rawRole:'Admin',business:'Reliance Retail',
   status:'Active',isActive:true,webAccessEnabled:true,
   authProvider:'demo-fixture',is_demo:true,isDemoReadOnly:true,read_only:false
  }));
  sessionStorage.setItem('qpms-crm-backend-token','synthetic-test');
 });
 await page.route('**/api/**',async route=>{
  const url=new URL(route.request().url());
  if(route.request().method()!=='GET')throw Error('Unexpected production mutation');
  if(url.pathname.endsWith('/module-reports/deep-cleaning'))return route.fulfill({json:{report:{
   stores:[],schedules:[],submissions:[],exceptions:[],
   totals:{scheduled:0,completed:0,pending:0,not_completed:0}
  }}});
  if(url.pathname.endsWith('/module-reports/ifms-history')){
   const rows=[
    {id:1,module:'deep_cleaning',source_row:3,reporting_state:'AP-1',store_code:'6228',
     retail_store_id:null,match_status:'NOT_IN_MASTER',record_date:'2026-10-05',status:'Completed',
     data:{store_name:'AP Report Store',scheduled_date:'2026-10-15',completed_date:'2026-10-05',cleaning_status:'Completed'}},
    {id:2,module:'deep_cleaning',source_row:4,reporting_state:'AP-1',store_code:'T2LJ',
     retail_store_id:'store-two',match_status:'MATCHED',record_date:'2026-10-22',status:'Pending',
     data:{store_name:'AP Pending Store',scheduled_date:'2026-10-22',cleaning_status:'Pending'}}
   ];
   return route.fulfill({json:{report:{rows,total:2,source:'EXCEL_REPORTED_HISTORICAL_UNVERIFIED'}}});
  }
  return route.fulfill({json:{stores:[],zones:[],fos:[],snapshot:{stores:[],zones:[],fos:[]}}});
 });
}
test('Deep Cleaning shows state summary and submitted work first; schedules only in collapsed admin maintenance',async({page})=>{
 await setup(page);
 await page.goto('/reliance-retail/deep-cleaning');
 await expect(page.getByRole('heading',{name:'Reliance Retail Deep Cleaning'})).toBeVisible();
 await page.getByLabel('Cleaning from').fill('2026-10-01');
 await page.getByLabel('Cleaning to').fill('2026-10-31');
 const summary=page.getByRole('region',{name:'Deep Cleaning — state-wise performance'});
 const work=page.getByRole('region',{name:'Submitted cleaning work'});
 await expect(summary).toBeVisible();
 const stateRow=summary.getByRole('row').filter({has:page.getByRole('button',{name:'AP-1'})});
 await expect(stateRow.getByText('50%')).toBeVisible();
 await expect(page.getByRole('heading',{name:'Store-wise submitted work'})).toBeVisible();
 // Admin maintenance survives but no longer occupies the primary report.
 await expect(page.getByRole('region',{name:'Cleaning schedules'})).toBeHidden();
 await expect(work.getByText('Completed (Excel reported)')).toBeVisible();
 await expect(work.getByText('No FO photo evidence in Excel')).toBeVisible();
 await expect(page.getByText('Deep Cleaning — imported October records')).toHaveCount(0);
 await expect(work.getByRole('button',{name:'View evidence'})).toHaveCount(0);
 await expect(summary.getByRole('row')).toHaveCount(8); // Header + six states + total
 await expect(page.getByText('Advanced · Schedule administration and verified FO linking')).toBeVisible();
});
