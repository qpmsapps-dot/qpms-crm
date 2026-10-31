import { test, expect } from '@playwright/test';

async function openDashboard(page, failure = false, role = 'Admin') {
  await page.addInitScript(role => {
    localStorage.setItem('qpms-crm-auth-user', JSON.stringify({id:'synthetic-admin',profileId:'synthetic-profile',name:'Local Test Admin',role,rawRole:role,business:'Reliance Retail',status:'Active',isActive:true,webAccessEnabled:true,authProvider:'demo-fixture',is_demo:true,isDemoReadOnly:true,read_only:false}));
    sessionStorage.setItem('qpms-crm-backend-token','synthetic-local-test-token');
  }, role);
  await page.route('**/api/**', route => {
    if (new URL(route.request().url()).pathname.endsWith('/module-reports/dashboard')) {
      const rows=['TN','KN','KL','AP-1','AP-2','TG'].map(state=>({state,hk_actual:0,mepc_actual:0,total_actual:0,total_target:0,complete:false,overall_pct:null,completed:0,scheduled:0,remaining:0,pending:0,not_completed:0}));
      return route.fulfill(failure ? {status:503,json:{message:'Test inventory unavailable'}} : {json:{report:{stores:[],modules:Object.fromEntries(['attendance','technical','soft','cleaning'].map(key=>[key,{status:'ready',rows}]).concat(['cm','pm','thermography'].map(key=>[key,{status:'unavailable',reason:'Operational source not configured.'}])))}}});
    }
    return route.fulfill({json:{}});
  });
  await page.goto('/reliance-retail', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading',{name:'South Zone – IFMS Operations Summary'})).toBeVisible();
}
test('existing route, seven honest empty cards, filters and verified links', async ({page}) => {
  await openDashboard(page);
  await expect(page.locator('.ifms-card')).toHaveCount(7);
  await expect(page.locator('.ifms-empty-ring')).toHaveCount(1);
  await expect(page.locator('.ifms-table-wrap tbody tr')).toHaveCount(24);
  await expect(page.getByRole('button',{name:'Export summary'})).toBeEnabled();
  await expect(page.locator('.ifms-dashboard')).not.toContainText(/NaN|Infinity|100%|Puducherry|Incl\. PY/);
  await expect(page.locator('#ifms-attendance').locator('xpath=ancestor::section')).toContainText('N/A');
  for (const id of ['technical','soft']) {
    const card = page.locator(`#ifms-${id}`).locator('xpath=ancestor::section');
    await expect(card.locator('.ifms-ring')).toHaveCount(0);
    await expect(card).not.toContainText(/Pending|Scheduled|Not Started|Completion/);
  }
  await page.getByLabel('Attendance reporting state',{exact:true}).selectOption('TN');
  await expect(page.locator('#ifms-attendance').locator('xpath=ancestor::section').locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('#ifms-thermography').locator('xpath=ancestor::section')).toContainText('Totals unavailable');
  await page.getByLabel('Global reporting state',{exact:true}).selectOption('KN');
  await expect(page.locator('.ifms-table-wrap tbody tr')).toHaveCount(4);
  await page.getByLabel('Global reporting state',{exact:true}).selectOption('');
  await expect(page.locator('.ifms-table-wrap tbody tr')).toHaveCount(24);
  await expect(page.locator('.ifms-card-footer a')).toHaveCount(7);
  await expect(page.locator('.ifms-card-footer a').first()).toHaveAttribute('href','/reliance-retail/attendance');
  await page.getByLabel('Reporting month',{exact:true}).fill('2024-02');
  await expect(page.locator('.ifms-date-range')).toContainText('29 Feb 2024');
});

test('dashboard detail links respect existing role permissions', async ({page}) => {
  await openDashboard(page, false, 'Technical MIS');
  await expect(page.locator('.ifms-card-footer a')).toHaveCount(1);
  await expect(page.locator('.ifms-card-footer a')).toHaveAttribute('href','/reliance-retail/attendance');
});
test('desktop, tablet and mobile layout has readable tables and no overflow', async ({page}) => {
  await openDashboard(page);
  for (const [name,width,height] of [['desktop',1920,1200],['tablet',1024,1000],['mobile',390,844]]) {
    await page.setViewportSize({width,height});
    await expect(page.locator('.ifms-card').first()).toBeVisible();
    if (width < 1024) await expect.poll(() => page.locator('aside').evaluate(el => el.getBoundingClientRect().right)).toBeLessThanOrEqual(1);
    const fits = await page.locator('.ifms-dashboard').evaluate(root => [...root.querySelectorAll('.ifms-card,.ifms-table-wrap,.ifms-card-header')].every(el => el.scrollWidth <= el.clientWidth + 1));
    expect(fits, `${name} content fits`).toBe(true);
  }
});
test('inventory failure keeps metrics honest and operational filters usable', async ({page}) => {
  await openDashboard(page,true);
  await expect(page.locator('.ifms-data-status')).toContainText('Module data unavailable');
  await expect(page.getByRole('button',{name:'Export summary'})).toBeDisabled();
  await page.getByLabel('PM Calls reporting state',{exact:true}).selectOption('TG');
  await expect(page.locator('#ifms-pm').locator('xpath=ancestor::section')).toContainText('Totals unavailable');
});

test('Retail dashboard requires a signed-in user', async ({page}) => {
  await page.route('**/api/**', route => route.fulfill({json:{}}));
  await page.goto('/reliance-retail', {waitUntil:'domcontentloaded'});
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator('.ifms-dashboard')).toHaveCount(0);
});

test('Retail dashboard denies a signed-in role from another business', async ({page}) => {
  await page.addInitScript(() => {
    localStorage.setItem('qpms-crm-auth-user',JSON.stringify({id:'synthetic-other',role:'Technical MIS',rawRole:'Technical MIS',business:'Other',status:'Active',isActive:true,webAccessEnabled:true,isDemoReadOnly:true,is_demo:true,read_only:false}));
    sessionStorage.setItem('qpms-crm-backend-token','synthetic-local-test-token');
  });
  let dashboardRequested=false;
  await page.route('**/api/**', route => {
    if(new URL(route.request().url()).pathname.endsWith('/module-reports/dashboard'))dashboardRequested=true;
    return route.fulfill({json:{}});
  });
  await page.goto('/reliance-retail', {waitUntil:'domcontentloaded'});
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator('.ifms-dashboard')).toHaveCount(0);
  expect(dashboardRequested).toBe(false);
});
