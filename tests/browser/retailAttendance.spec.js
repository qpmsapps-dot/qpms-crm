import { test, expect } from '@playwright/test';
import { summarizeAttendance } from '../../backend/shared/retailAttendance.js';
const stores = [{ id:'kn', store_code:'K1', store_name:'Synthetic Karnataka Store', state:'KA', status:'Active' }, { id:'tn',store_code:'T1',store_name:'Synthetic Tamil Nadu Store',state:'TN',status:'Active' }];
function source(cutoff, view, state, partial = false) {
  const days = Number(cutoff.slice(8));
  const attendance = stores.flatMap(s=>Array.from({length:days},(_,i)=>`${cutoff.slice(0,7)}-${String(i+1).padStart(2,'0')}`).filter(d=>!partial||d!==cutoff).flatMap(attendance_date=>[
    {retail_store_id:s.id,attendance_date,class:'HK',credit:4},{retail_store_id:s.id,attendance_date,class:'MEPC',credit:1},
  ]));
  const aop=stores.map(s=>({retail_store_id:s.id,effective_from:`${cutoff.slice(0,7)}-01`,effective_to:null,hk_count:5,mepc_count:2}));
  return {...summarizeAttendance({stores,attendance,aop,cutoff,view,state}),can_upload:true,available_states:['KN','TN'],latest_imported_date:cutoff};
}
async function seed(page, { partial = false, empty = false, fail = false, delay = 0 } = {}) {
  await page.addInitScript(()=>{
    localStorage.setItem('qpms-crm-auth-user',JSON.stringify({id:'synthetic-admin',profileId:'synthetic-profile',name:'Local Test Admin',role:'Admin',rawRole:'Admin',status:'Active',isActive:true,webAccessEnabled:true,authProvider:'demo-fixture',is_demo:true,isDemoReadOnly:true,read_only:false}));
    sessionStorage.setItem('qpms-crm-backend-token','synthetic-local-test-token');
  });
  await page.route('**/api/**',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname.endsWith('/attendance/summary')) {
      if(delay) await new Promise(resolve=>setTimeout(resolve,delay));
      if(fail) return route.fulfill({status:503,json:{message:'Synthetic service unavailable'}});
      let report=source(url.searchParams.get('cutoff') || '2026-10-20',url.searchParams.get('view'),url.searchParams.get('state')||'',partial);
      if(empty){report={...summarizeAttendance({stores:[],attendance:[],aop:[],cutoff:url.searchParams.get('cutoff') || '2026-10-20',view:url.searchParams.get('view')}),can_upload:true,available_states:[],latest_imported_date:null};}
      return route.fulfill({json:{report}});
    }
    if(url.pathname.endsWith('/attendance/preview')) return route.fulfill({json:{preview:{id:'preview',preview_key:'key',total_rows:2,valid_rows:1,rejected_rows:1,rejected:[{source_row:3,store_code:'UNKNOWN',reasons:['Unknown Reliance Retail Store Code']}],affected_records:[],dates:['2026-10-20'],preview:[],can_commit:false}}});
    return route.fulfill({json:{}});
  });
  await page.goto('/reliance-retail/attendance', { waitUntil: 'domcontentloaded' });
}
test('MTD, Daily, historical month, state filter and export use the same selected scope', async({page},testInfo)=>{
  await seed(page);
  await expect(page.getByRole('heading',{name:'Reliance Retail Attendance',exact:true})).toBeVisible();
  await expect(page.getByText('Total AOP Count',{exact:true})).toBeVisible();
  await page.getByLabel('Attendance cutoff date').fill('2026-10-20');
  await expect(page.getByRole('heading',{name:'Month-to-Date Attendance (2026-10-01 to 2026-10-20)',exact:true})).toBeVisible();
  await expect(page.locator('.recharts-bar-rectangle')).toHaveCount(4);
  await page.screenshot({path:testInfo.outputPath('monthly.png'),fullPage:true});
  await page.getByRole('tab',{name:'Daily View'}).click();
  await expect(page.getByText('Attendance Shortfall (Target − Actual)',{exact:true})).toBeVisible();
  await expect(page.getByText('Total AOP Count',{exact:true})).toHaveCount(0);
  await page.screenshot({path:testInfo.outputPath('daily.png'),fullPage:true});
  await page.getByLabel('State filter').selectOption('TN');
  await expect(page.getByRole('button',{name:'TN',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'KN',exact:true})).toHaveCount(0);
  const download=page.waitForEvent('download'); await page.getByRole('button',{name:'Export',exact:true}).click();
  expect((await download).suggestedFilename()).toContain('daily-2026-10-20-states.xlsx');
  await page.getByLabel('Month and year').fill('2024-02');
  await expect(page.getByLabel('Attendance cutoff date')).toHaveValue('2024-02-29');
});
test('partial-data view makes missing dates explicit and percentages N/A',async({page})=>{
  await seed(page,{partial:true});
  await expect(page.getByText(/Incomplete data. Missing store attendance dates/)).toBeVisible();
  await expect(page.getByText('N/A',{exact:true}).first()).toBeVisible();
});
test('loading, empty and error states are readable; invalid preview cannot be committed',async({page})=>{
  await seed(page,{delay:500,empty:true});
  await expect(page.getByText('Loading attendance…',{exact:true})).toBeVisible();
  await expect(page.getByText('No Retail stores in this authorized state/filter.')).toBeVisible();
  await page.getByRole('button',{name:'Upload Day Attendance'}).click();
  await page.getByLabel('Attendance Excel file').setInputFiles({name:'fixture.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from('synthetic-preview-transport-fixture')});
  await page.getByRole('button',{name:'Validate and Preview'}).click();
  await expect(page.getByText(/Unknown Reliance Retail Store Code/)).toBeVisible();
  await expect(page.getByRole('button',{name:'Confirm Import'})).toBeDisabled();
});
test('server failure does not show fabricated KPIs',async({page})=>{
  await seed(page,{fail:true});
  await expect(page.getByRole('alert').filter({hasText:'Synthetic service unavailable'})).toBeVisible();
  await expect(page.getByText('Total AOP Count',{exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Retry',exact:true})).toBeVisible();
});
test('responsive layout keeps KPIs readable and wide tables inside their panels',async({page},testInfo)=>{
  await page.setViewportSize({width:390,height:844});
  await seed(page);
  await expect(page.getByText('Total AOP Count',{exact:true})).toBeVisible();
  await expect(page.locator('article')).toHaveCount(6);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('mobile.png'),fullPage:true});
});

test('latest imported date is selected automatically and prominently displayed',async({page})=>{
  await seed(page);
  await expect(page.getByLabel('Attendance cutoff date')).toHaveValue('2026-10-20');
  await expect(page.getByText('Latest imported attendance date: 2026-10-20')).toBeVisible();
});

test('partial import confirmation, retained history and downloadable source exceptions',async({page})=>{
  await seed(page);
  const batch={id:'phase1',filename:'multi-date.xlsx',checksum:'synthetic-checksum',status:'committed',uploaded_at:'2026-10-21T04:00:00Z',committed_at:'2026-10-21T04:01:00Z',date_from:'2026-10-19',date_to:'2026-10-20',valid_rows:1,rejected_rows:1,raw_source:{headers:['EP No','Site Code','Class'],rows:[{source_row:2,raw_cells:['E1','T1','House Keeping']},{source_row:3,raw_cells:['E2','UNKNOWN','MEPC']},{source_row:4,raw_cells:['E3','T1','Goods Receiving']}],rejected:[{source_row:3,store_code:'UNKNOWN',attendance_date:'2026-10-20',reasons:['Unknown Reliance Retail Store Code']}],excluded:[{source_row:4,original_class:'Goods Receiving',reasons:['Excluded class']} ]}};
  await page.route('**/attendance/preview',route=>route.fulfill({json:{preview:{id:'phase1',preview_key:'snapshot',total_rows:3,valid_rows:1,rejected_rows:1,excluded_rows:1,rejected:batch.raw_source.rejected,excluded:batch.raw_source.excluded,dates:['2026-10-19','2026-10-20'],date_counts:{'2026-10-19':1,'2026-10-20':2},class_counts:{'House Keeping':1,MEPC:1,'Goods Receiving':1},status_counts:{P:3},preview:[],affected_records:[],can_commit:true}}}));
  let confirmed=false;
  await page.route('**/attendance/commit',route=>{const body=route.request().postDataJSON();confirmed=body.preview_key==='snapshot'&&body.replace===false;return route.fulfill({json:{batch_id:'phase1'}});});
  await page.route('**/attendance/history*',route=>route.fulfill({json:{history:new URL(route.request().url()).searchParams.has('id')?batch:[batch]}}));
  await page.getByRole('button',{name:'Upload Day Attendance'}).click();
  await page.getByLabel('Attendance Excel file').setInputFiles({name:'multi-date.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from('isolated transport fixture')});
  await page.getByRole('button',{name:'Validate and Preview'}).click();
  await expect(page.getByText('3 rows',{exact:false})).toBeVisible();
  await expect(page.getByRole('button',{name:'Confirm Import'})).toBeEnabled();
  await page.getByRole('button',{name:'Confirm Import'}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);expect(confirmed).toBe(true);
  await page.getByRole('button',{name:'Import history and exceptions'}).click();
  await page.getByRole('button',{name:'Source and exceptions'}).click();
  await expect(page.getByText(/3 retained source rows/)).toBeVisible();
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export source and exceptions'}).click();
  const file=await download;expect(file.suggestedFilename()).toBe('retail-attendance-source-phase1.xlsx');
  const ExcelJS=(await import('exceljs')).default;const book=new ExcelJS.Workbook();await book.xlsx.readFile(await file.path());
  expect(book.getWorksheet('Source rows').getRow(5).getCell(4).value).toBe('Goods Receiving');
  expect(book.getWorksheet('Exceptions').rowCount).toBe(3);
});
