import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import {chromium} from '@playwright/test';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';

test('Deep Cleaning downloads: unchanged dashboard, existing export/View, all export scopes and explicit access warnings',{timeout:180000},async()=>{
  const output=path.resolve(process.env.CLEANING_EXPORT_OUTPUT_DIR||path.join(os.tmpdir(),'qpms-cleaning-export-browser'));await mkdir(output,{recursive:true});
  const envDir=await mkdtemp(path.join(os.tmpdir(),'qpms-cleaning-export-env-'));
  Object.assign(process.env,{VITE_ENABLE_DEMO_AUTH:'true',VITE_APP_MODE:'demo',VITE_SUPABASE_URL:'',VITE_SUPABASE_ANON_KEY:'',VITE_API_URL:'http://127.0.0.1:4999'});
  const original=execFileSync('git',['-c',`safe.directory=${process.cwd()}`,'show','ffcdf2718582d25a8d4b11530fc84fe474af9850:src/pages/reliance-retail/RetailScopedDeepCleaning.jsx'],{encoding:'utf8'});
  const browser=await chromium.launch({headless:true});let denyReport=false,denyEvidence=false;const calls=[];
  const store={id:'store-1',store_code:'0012',store_name:'SYNTHETIC TEST STORE',state:'Tamil Nadu'};
  const row={id:'synthetic-cleaning-1',store,status:'submitted',deep_cleaning_date:'2026-11-14',fo_name:'Synthetic FO',submitted_by_employee_code:'0007',before_count:1,after_count:1};
  const uploads=['before','after','checklist'].map((type,i)=>({id:'synthetic-evidence-'+i,type,name:'SYNTHETIC_'+type+(i===2?'.pdf':'.png'),mime_type:i===2?'application/pdf':'image/png',url:'https://example.invalid/photo?token=NEVER_RETAIN'}));
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j0L0AAAAASUVORK5CYII=','base64');
  async function launch(baseline) {
    const server=await createServer({configFile:false,envDir,cacheDir:path.join(envDir,baseline?'baseline':'candidate'),plugins:[{name:'cleaning-baseline-only',enforce:'pre',load(id){if(baseline&&id.replaceAll('\\','/').endsWith('/src/pages/reliance-retail/RetailScopedDeepCleaning.jsx'))return original;}},react(),tailwindcss()],server:{host:'127.0.0.1',port:0,watch:{ignored:['**/outputs/**','**/artifacts/**','**/tmp/**']}},logLevel:'error'});
    await server.listen();const context=await browser.newContext({acceptDownloads:true}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await context.addInitScript(()=>{localStorage.setItem('qpms-crm-auth-user',JSON.stringify({id:'fixture-auth',profileId:'fixture-profile',employeeCode:'QPMSADMIN',name:'Synthetic Admin',role:'Admin',rawRole:'Admin',status:'Active',isActive:true,webAccessEnabled:true,is_demo:true,isDemoReadOnly:true,read_only:false}));sessionStorage.setItem('qpms-crm-backend-token','synthetic-local-token');});
    await page.route('**/*',async route=>{
      const req=route.request(),url=new URL(req.url());
      if(url.hostname==='example.invalid')return route.fulfill({status:200,body:png,contentType:'image/png',headers:{'access-control-allow-origin':'*'}});
      if(!['127.0.0.1','localhost'].includes(url.hostname))return route.abort();
      if(!url.pathname.startsWith('/api/'))return route.continue();
      calls.push({method:req.method(),path:url.pathname,params:Object.fromEntries(url.searchParams)});assert.equal(req.method(),'GET');
      if(url.pathname.endsWith('/module-reports/deep-cleaning'))return denyReport?route.fulfill({status:403,json:{message:'Synthetic report authorization denied'}}):route.fulfill({json:{report:{from:url.searchParams.get('from'),to:url.searchParams.get('to'),submissions:[row],stores:[store],schedules:[],totals:{scheduled:0,completed:0,not_completed:0,pending:0},exceptions:[]}}});
      if(url.pathname.endsWith('/evidence'))return denyEvidence?route.fulfill({status:403,json:{message:'Synthetic evidence denied'}}):route.fulfill({json:{uploads}});
      if(url.pathname.endsWith('/module-reports/ifms-history'))return route.fulfill({json:{report:{rows:[],total:0}}});
      return route.fulfill({json:{}});
    });
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/reliance-retail/deep-cleaning`);await page.getByRole('heading',{name:'Store-wise Submitted Work',exact:true}).waitFor();await page.getByRole('button',{name:'View evidence for 0012',exact:true}).waitFor();return {page,context,server,errors};
  }
  let baseline,candidate;
  const filterStyle=page=>page.locator('.dc-filter-grid').evaluate(el=>{const c=getComputedStyle(el);return {font:c.font,grid:c.gridTemplateColumns,gap:c.gap,width:el.getBoundingClientRect().width};});
  try {
    baseline=await launch(true);const styles={};for(const width of [1440,768,390]){await baseline.page.setViewportSize({width,height:1000});styles[width]=await filterStyle(baseline.page);}
    const headings=await baseline.page.locator('.dc-table-scroll th').allTextContents(),kpis=await baseline.page.locator('.dc-kpis,.dc-performance').allTextContents();await baseline.context.close();await baseline.server.close();baseline=null;
    candidate=await launch(false);const {page}=candidate;assert.deepEqual(await page.locator('.dc-table-scroll th').allTextContents(),headings);assert.deepEqual(await page.locator('.dc-kpis,.dc-performance').allTextContents(),kpis);
    for(const width of [1440,768,390]){await page.setViewportSize({width,height:1000});assert.deepEqual(await filterStyle(page),styles[width]);await page.screenshot({path:path.join(output,`dashboard-${width}.png`),fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+2));}
    await page.setViewportSize({width:1440,height:1000});
    const oldPending=page.waitForEvent('download');await page.getByRole('button',{name:'Export Report',exact:true}).click();assert.equal((await oldPending).suggestedFilename(),'Retail_Deep_Cleaning.xlsx');
    await page.getByLabel('More Deep Cleaning export options').click();await page.getByLabel('Deep Cleaning export month').fill('2026-11');
    async function download(label,name){const pending=page.waitForEvent('download');await page.getByRole('button',{name:label,exact:true}).click();const file=await pending;assert.equal(await file.failure(),null);await file.saveAs(path.join(output,name));await page.getByRole('status').filter({hasText:'Download prepared:'}).waitFor();}
    for(const [label,name] of [['Export Excel — Monthly','BROWSER_monthly.xlsx'],['Export PowerPoint — Monthly','BROWSER_monthly.pptx'],['Export Excel — Current Filtered View','BROWSER_filtered.xlsx']])await download(label,name);
    assert.ok(calls.some(c=>c.path.endsWith('/module-reports/deep-cleaning')&&c.params.to==='2026-11-30'));
    await page.getByRole('button',{name:'Close',exact:true}).click();await page.getByLabel('Download cleaning submission 0012').click();await download('Export Excel — This Submission','BROWSER_individual.xlsx');await download('Export PowerPoint — This Submission','BROWSER_individual.pptx');
    denyEvidence=true;await download('Export PowerPoint — This Submission','BROWSER_denied-evidence.pptx');assert.match(await page.getByRole('status').filter({hasText:'Download prepared:'}).innerText(),/authorization denied or pending/);
    denyReport=true;let badDownload=false;const listener=()=>{badDownload=true;};page.on('download',listener);await page.getByRole('button',{name:'Export Excel — This Submission'}).click();await page.getByRole('alert').filter({hasText:'Synthetic report authorization denied'}).waitFor();assert.equal(badDownload,false);page.off('download',listener);
    await page.getByRole('button',{name:'Close',exact:true}).click();denyReport=false;denyEvidence=false;await page.getByRole('button',{name:'View evidence for 0012',exact:true}).click();await page.getByRole('complementary',{name:'Evidence Details'}).waitFor();
    await page.getByRole('button',{name:'Preview SYNTHETIC_before.png',exact:true}).click();await page.getByRole('dialog',{name:'Image preview: SYNTHETIC_before.png',exact:true}).waitFor();await page.getByRole('button',{name:'Close image preview',exact:true}).click();
    assert.match(await page.getByRole('link',{name:'Preview SYNTHETIC_checklist.pdf',exact:true}).getAttribute('href'),/^https:\/\//);
    for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.screenshot({path:path.join(output,`evidence-viewer-${width}.png`),fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+2));}
    for(const name of ['BROWSER_monthly.xlsx','BROWSER_filtered.xlsx','BROWSER_individual.xlsx']){const book=new ExcelJS.Workbook();await book.xlsx.readFile(path.join(output,name));assert.equal(book.getWorksheet('Submissions').getCell('C2').value,'0012');}
    for(const name of ['BROWSER_monthly.pptx','BROWSER_individual.pptx','BROWSER_denied-evidence.pptx']){const zip=await JSZip.loadAsync(await readFile(path.join(output,name))),docs=await Promise.all(Object.keys(zip.files).filter(p=>p.endsWith('.xml')||p.endsWith('.rels')).map(async p=>({path:p,xml:await zip.file(p).async('string')})));assert.deepEqual(await page.evaluate(d=>d.filter(x=>new DOMParser().parseFromString(x.xml,'application/xml').querySelector('parsererror')).map(x=>x.path),docs),[]);assert.ok(!docs.some(d=>d.xml.includes('NEVER_RETAIN')));if(!name.includes('denied'))assert.ok(Object.keys(zip.files).some(p=>p.startsWith('ppt/media/')));}
    assert.deepEqual(candidate.errors,[]);assert.ok(calls.every(c=>c.method==='GET'));
  }catch(error){if(candidate){console.error('Synthetic export failure status:',await candidate.page.locator('[role=status],[role=alert]').allTextContents(),candidate.errors);await candidate.page.screenshot({path:path.join(output,'failure.png'),fullPage:true});}throw error;}finally{for(const active of [baseline,candidate])if(active){await active.context.close();await active.server.close();}await browser.close();}
});
