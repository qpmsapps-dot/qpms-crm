import { test, expect } from '@playwright/test';
const actor='synthetic-central-mis',batch={id:'synthetic-batch',preview_key:'review-key'};
async function fixture(page,{timeout=false,busy=false,unavailable=false}={}){
  let posts=0,statusCalls=0,finished=false;
  await page.addInitScript(({actor})=>{localStorage.setItem('qpms-crm-auth-user',JSON.stringify({id:actor,profileId:actor,name:'Synthetic Central MIS',role:'CENTRAL_MIS',rawRole:'CENTRAL_MIS',status:'Active',isActive:true,webAccessEnabled:true,authProvider:'demo-fixture',is_demo:true,isDemoReadOnly:true,read_only:false}));sessionStorage.setItem('qpms-crm-backend-token','synthetic-local-test-token');},{actor});
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path.endsWith('/mis/access'))return route.fulfill({json:{result:{active:true,role:'CENTRAL_MIS',states:['AP-1','AP-2','TN'],modules:['imports','attendance-hk','attendance-mepc']}}});
    if(path.includes('/mis/report/'))return route.fulfill({json:{result:{rows:[],stores:[],read_only:false}}});
    if(path.endsWith('/imports/preview'))return route.fulfill({json:{result:{...batch,valid_rows:2468,rejected_rows:0,affected_record_count:2446,conflict_snapshot_complete:true,preview:[{store_code:'001',employee_code:'SYN001',attendance_date:'2026-11-01',class:'HK',original_status:'HD',credit:0.5}],can_commit:true}}});
    if(path.endsWith('/attendance/commit')){posts++;expect(route.request().postDataJSON()).toMatchObject({...batch,replace:true,reason:'Verified original workbook'});if(timeout)return route.abort('timedout');return route.fulfill({json:{result:batch.id}});}
    if(path.includes('/attendance/status/')){statusCalls++;if(unavailable&&!finished)return route.fulfill({status:503,json:{message:'Synthetic status unavailable'}});return route.fulfill({json:{result:{id:batch.id,status:finished||!busy?'committed':'preview',writer_busy:!finished&&busy}}});}
    return route.fulfill({json:{result:{}}});
  });
  await page.goto('/reliance-retail/mis/imports',{waitUntil:'domcontentloaded'});
  const region=page.getByRole('region',{name:'M-Here Attendance import'});await expect(region).toBeVisible();
  return {region,get posts(){return posts;},get statusCalls(){return statusCalls;},finish(){finished=true;}};
}
async function previewAndConfirm(page,region){
  await region.getByLabel('Attendance workbook',{exact:true}).setInputFiles({name:'MHere_Correction_2026-11-01.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from('synthetic transport; parser verified in backend tests')});
  await region.getByRole('button',{name:'Preview attendance upload'}).click();
  await expect(region.getByText(/2,446 affected records/)).toBeVisible();
  await region.getByLabel('This is an explicit correction of existing rows').check();
  await region.getByLabel('Correction reason',{exact:true}).fill('Verified original workbook');
  await region.getByLabel('I reviewed the upload and any corrections.').check();
}
test('full correction scope, required confirmation and one commit request even on duplicate clicks',async({page},info)=>{
  const f=await fixture(page);await previewAndConfirm(page,f.region);
  await f.region.getByRole('button',{name:'Commit reviewed attendance'}).evaluate(n=>{n.click();n.click();});
  await expect(f.region.getByText(/Attendance commit confirmed/)).toBeVisible();expect(f.posts).toBe(1);
  await page.screenshot({path:info.outputPath('mhere-correction-confirmed.png'),fullPage:true});
});
test('lost HTTP reply checks persisted status and confirms completion without resubmitting',async({page})=>{
  const f=await fixture(page,{timeout:true});await previewAndConfirm(page,f.region);await f.region.getByRole('button',{name:'Commit reviewed attendance'}).click();
  await expect(f.region.getByText(/Attendance commit confirmed/)).toBeVisible();expect(f.posts).toBe(1);expect(f.statusCalls).toBe(1);
});
test('preview while writer active stays unconfirmed; explicit status recovery makes no second POST',async({page},info)=>{
  await page.setViewportSize({width:390,height:844});
  const f=await fixture(page,{timeout:true,busy:true});await previewAndConfirm(page,f.region);await f.region.getByRole('button',{name:'Commit reviewed attendance'}).click();
  await expect(f.region.getByText(/An attendance writer is still active/)).toBeVisible();
  await expect(f.region.getByRole('button',{name:'Commit reviewed attendance'})).toBeDisabled();
  await expect(f.region.getByRole('button',{name:'Preview attendance upload'})).toBeDisabled();
  await page.screenshot({path:info.outputPath('mhere-correction-pending-mobile.png'),fullPage:true});
  f.finish();await f.region.getByRole('button',{name:'Check attendance batch status'}).click();await expect(f.region.getByText(/Attendance commit confirmed/)).toBeVisible();expect(f.posts).toBe(1);
});
test('unconfirmed receipt survives reload without retaining employee/workbook data',async({page})=>{
  const f=await fixture(page,{timeout:true,unavailable:true});await previewAndConfirm(page,f.region);await f.region.getByRole('button',{name:'Commit reviewed attendance'}).click();
  await expect(f.region.getByRole('alert')).toContainText('status remains unconfirmed');
  const saved=await page.evaluate(()=>Object.entries(sessionStorage).find(([k])=>k.startsWith('retail-attendance-pending:'))?.[1]);expect(JSON.parse(saved)).toEqual(batch);
  await page.reload({waitUntil:'domcontentloaded'});await expect(f.region.getByRole('button',{name:'Check attendance batch status'})).toBeVisible();
  f.finish();await f.region.getByRole('button',{name:'Check attendance batch status'}).click();await expect(f.region.getByText(/Attendance commit confirmed/)).toBeVisible();expect(f.posts).toBe(1);
});
test('incomplete preview cannot enable import confirmation',async({page})=>{
  const f=await fixture(page);
  await page.route('**/imports/preview',route=>route.fulfill({json:{result:{...batch,valid_rows:2468,rejected_rows:0,can_commit:true,affected_records:Array(1000).fill({})}}}));
  await f.region.getByLabel('Attendance workbook',{exact:true}).setInputFiles({name:'fixture.xlsx',mimeType:'application/octet-stream',buffer:Buffer.from('synthetic')});
  await f.region.getByRole('button',{name:'Preview attendance upload'}).click();await expect(f.region.getByRole('alert')).toContainText('complete correction preview is required');
  await expect(f.region.getByRole('button',{name:'Commit reviewed attendance'})).toHaveCount(0);expect(f.posts).toBe(0);
});
test('stale snapshot rejection permits fresh validation, with no automatic resubmission',async({page})=>{
  const f=await fixture(page);let posts=0;
  await page.route('**/attendance/commit',route=>{posts++;return route.fulfill({status:409,json:{code:'ATTENDANCE_PREVIEW_STALE',outcome:'not_committed',message:'Data changed; validate again.'}});});
  await previewAndConfirm(page,f.region);await f.region.getByRole('button',{name:'Commit reviewed attendance'}).click();
  await expect(f.region.getByText(/This commit was rejected/)).toBeVisible();await expect(f.region.getByRole('button',{name:'Commit reviewed attendance'})).toHaveCount(0);
  await expect(f.region.getByRole('button',{name:'Preview attendance upload'})).toBeEnabled();await f.region.getByRole('button',{name:'Preview attendance upload'}).click();
  await expect(f.region.getByText(/2,446 affected records/)).toBeVisible();expect(posts).toBe(1);expect(f.statusCalls).toBe(0);
});
