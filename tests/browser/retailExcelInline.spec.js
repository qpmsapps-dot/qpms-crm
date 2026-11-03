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
test('October Excel cleaning rows occupy existing schedule/work tables without unverified FO evidence',async({page})=>{
 await setup(page);
 await page.goto('/reliance-retail/deep-cleaning');
 await expect(page.getByRole('heading',{name:'Reliance Retail Deep Cleaning'})).toBeVisible();
 await page.getByLabel('Cleaning from').fill('2026-10-01');
 await page.getByLabel('Cleaning to').fill('2026-10-31');
 const schedules=page.getByRole('region',{name:'Cleaning schedules'});
 const work=page.getByRole('region',{name:'Submitted cleaning work'});
 await expect(schedules.getByText('6228')).toBeVisible();
 await expect(schedules.getByText('T2LJ')).toBeVisible();
 await expect(work.getByText('Completed (Excel reported)')).toBeVisible();
 await expect(work.getByText('No FO photo evidence in Excel')).toBeVisible();
 await expect(page.getByText('Deep Cleaning — imported October records')).toHaveCount(0);
 await expect(work.getByRole('button',{name:'View evidence'})).toHaveCount(0);
 await expect(schedules.getByText('Excel reported · not FO verified')).toHaveCount(2);
});
