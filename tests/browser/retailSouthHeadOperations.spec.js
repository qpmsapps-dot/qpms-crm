import {test,expect} from '@playwright/test';

test('South Head Retail Operations follows Dashboard, retains OOS restrictions and shows named nonfinancial FO records',async({page})=>{
 await page.addInitScript(()=>{
  localStorage.setItem('qpms-crm-auth-user',JSON.stringify({id:'synthetic-south',profileId:'synthetic-profile',employeeCode:'SYNTHETIC',name:'Synthetic South Head',
   role:'South Head',rawRole:'South Head',business:'Reliance Retail',state:'TN',status:'Active',isActive:true,webAccessEnabled:true,is_demo:true,isDemoReadOnly:true}));
  sessionStorage.setItem('qpms-crm-backend-token','synthetic-local-test-token');
 });
 const writes=[];
 await page.route('**/api/**',route=>{
  if(route.request().method()!=='GET')writes.push(route.request().url());
  if(new URL(route.request().url()).pathname==='/api/reliance-retail/field-operations')return route.fulfill({json:{ok:true,report:{states:['TN','AP-1','AP-2'],read_only:true,
   officers:[{employee_code:'SYN-FO',name:'Synthetic Named FO',state:'TN',active_today:true,online:false,day_status:'Active Today',start_time:'2026-11-17T04:00:00Z',end_time:null,last_seen_at:null,latitude:null,longitude:null,visited_count:1,
    visits:[{site_name:'Synthetic Retail Store',check_in_time:'2026-11-17T05:00:00Z',check_out_time:null,status:'Checked In'}]}]}}});
  return route.fulfill({json:{}});
 });
 await page.goto('/reliance-retail/operations');
 await expect(page.getByRole('heading',{name:'Reliance Retail Operations',exact:true})).toBeVisible();
 const links=page.locator('aside nav a');
 await expect(links).toHaveText(['Dashboard','Operations','Attendance','Deep Cleaning','Training','CM/PM','Thermography','Fault Tracker','Manpower Vacancy','Reliance Retail Store Master','Back to QPMS']);
 await expect(page.locator('aside nav [aria-disabled=true]').filter({hasText:'OOS Tracker'})).toBeVisible();
 await expect(page.getByText('Synthetic Named FO',{exact:false}).first()).toBeVisible();
 await expect(page.getByText('Synthetic Retail Store',{exact:false}).first()).toBeVisible();
 await expect(page.getByText('No GPS locations currently available.')).toBeVisible();
 expect(writes).toEqual([]);
});
