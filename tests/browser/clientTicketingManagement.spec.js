import { test,expect } from '@playwright/test';
const vertical='11111111-1111-4111-8111-111111111111',clientId='22222222-2222-4222-8222-222222222222';
async function setup(page,{failure=false,role='Admin'}={}){
  await page.addInitScript(role=>{localStorage.setItem('qpms-crm-auth-user',JSON.stringify({id:'synthetic-admin',profileId:'synthetic-profile',name:'Synthetic User',role,rawRole:role,status:'Active',isActive:true,webAccessEnabled:true,authProvider:'demo-fixture',is_demo:true,isDemoReadOnly:true,read_only:false}));sessionStorage.setItem('qpms-crm-backend-token','synthetic-local-test-token');},role);
  const calls=[];let client=null;
  await page.route('**/api/**',async route=>{
    const r=route.request(),url=new URL(r.url());
    if(!url.pathname.startsWith('/api/admin/client-ticketing'))return route.fulfill({json:{ok:true,allowed:false}});
    if(failure)return route.fulfill({status:503,json:{message:'Synthetic migration unavailable'}});
    if(r.method()==='POST'){
      const data=r.postDataJSON();calls.push({path:url.pathname,data});
      if(url.pathname==='/api/admin/client-ticketing')client={id:clientId,client_code:data.code,client_name:data.name,business_type:'residential',business_vertical_id:vertical,is_active:false,editable:true,metadata:{ticketing_rollout:{state:'draft'}}};
      await new Promise(resolve=>setTimeout(resolve,100));
      return route.fulfill({json:{ok:true,result:{id:clientId,client_id:clientId,active:false}}});
    }
    if(url.pathname==='/api/admin/client-ticketing')return route.fulfill({json:{ok:true,clients:client?[client]:[],verticals:[{id:vertical,code:'apartment_residential',name:'Apartment / Residential',active:false}]}});
    return route.fulfill({json:{ok:true,client,blocks:[],floors:[],locations:[],categories:[],staff:[],contacts:[],scopes:[]}});
  });
  await page.goto('/settings/user-management/client-ticketing');return calls;
}
test('Admin can create inactive Residential draft and configure staff/contact without activation controls',async({page})=>{
  const calls=await setup(page);
  await expect(page.getByText('Real client access is disabled.',{exact:false})).toBeVisible();
  await page.getByLabel('Code',{exact:true}).fill('SYNTHETIC');await page.getByLabel('Name',{exact:true}).fill('Synthetic Property');await page.getByLabel('Business vertical').selectOption(vertical);
  await page.getByRole('button',{name:'Save inactive draft'}).dblclick({delay:10});
  await expect(page.getByRole('status').filter({hasText:'Draft saved'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Configuration readiness — inactive draft'})).toBeVisible();
  await expect(page.getByText('Draft configuration does not enable login or live ticket routing.')).toBeVisible();
  await expect(page.getByLabel('Configuration type')).toBeVisible();expect(calls.length).toBe(1);expect(calls[0].data).toEqual({code:'SYNTHETIC',name:'Synthetic Property',business_vertical_id:vertical});
  await page.getByLabel('Configuration type').selectOption('staff');await page.getByLabel('Existing QPMS employee code').fill('SYNTHETIC_EMPLOYEE');await page.getByLabel('Client role',{exact:true}).selectOption('operations_executive');await page.getByLabel('Authorized scope').selectOption('client');await page.getByRole('checkbox',{name:'Add this scope and keep existing assignments (same role only)'}).check();await page.getByRole('button',{name:'Save inactive draft'}).click();
  await expect.poll(()=>calls.length).toBe(2);expect(calls[1].data.role_code).toBe('operations_executive');expect(calls[1].data.scope_type).toBe('client');expect(calls[1].data.is_active).toBeUndefined();
  expect(calls[1].data.scope_mode).toBe('add');
  await expect(page.getByLabel('Configuration type')).toBeEnabled();await page.getByLabel('Configuration type').selectOption('contact');await page.getByLabel('Full name',{exact:true}).fill('Synthetic Contact');await page.getByLabel('Mobile',{exact:true}).fill('9000000000');await page.getByRole('button',{name:'Save inactive draft'}).click();await expect.poll(()=>calls.length).toBe(3);
  await expect(page.getByRole('button',{name:/activate|enable login|send invitation/i})).toHaveCount(0);
});
test('migration/backend failure remains visible and cannot be presented as a saved client',async({page})=>{
  const calls=await setup(page,{failure:true});await expect(page.getByRole('alert').filter({hasText:'Synthetic migration unavailable'})).toBeVisible();expect(calls.length).toBe(0);await expect(page.getByText('Draft saved.',{exact:false})).toHaveCount(0);
});

test('non-Admin cannot configure drafts or obtain an activation control',async({page})=>{
  const calls=await setup(page,{role:'Supervisor'});
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Save inactive draft'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:/activate|enable login|send invitation/i})).toHaveCount(0);
  expect(calls).toHaveLength(0);
});

for(const role of ['QPMS Admin','Developer','DEV'])test(`${role} alias can open inactive draft management`,async({page})=>{
  await setup(page,{role});
  await expect(page.getByRole('button',{name:'Save inactive draft'})).toBeVisible();
  await expect(page.getByRole('button',{name:/activate|enable login|send invitation/i})).toHaveCount(0);
});

test('broader IT Admin alias is not approved for migration 234 draft saves',async({page})=>{
  const calls=await setup(page,{role:'IT Admin'});
  await expect(page.getByRole('alert').filter({hasText:'Administrator access required.'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Save inactive draft'})).toHaveCount(0);
  expect(calls).toHaveLength(0);
});
