import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import {chromium} from '@playwright/test';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';

test('Training exports browser: preserved UI, original review, four export kinds, partial warnings and denied access',{timeout:180000},async()=>{
  const output=path.resolve(process.env.TRAINING_EXPORT_OUTPUT_DIR||path.join(os.tmpdir(),'qpms-training-exports-v2-validation'));await mkdir(output,{recursive:true});
  const envDir=await mkdtemp(path.join(os.tmpdir(),'qpms-training-export-env-'));
  Object.assign(process.env,{VITE_ENABLE_DEMO_AUTH:'true',VITE_APP_MODE:'demo',VITE_SUPABASE_URL:'',VITE_SUPABASE_ANON_KEY:'',VITE_API_URL:'http://127.0.0.1:4999'});
  const original=execFileSync('git',['-c',`safe.directory=${process.cwd()}`,'show','f15f390fcab107efd480f5889454fe8ca95c08ca:src/pages/reliance-retail/RetailTraining.jsx'],{encoding:'utf8'});
  const browser=await chromium.launch({headless:true});let denyDetail=false,denyEvidence=false;const calls=[];
  const store={id:'store-1',store_code:'0012',store_name:'SYNTHETIC TEST STORE',state:'Tamil Nadu',observed_zone_id:'zone-1',ownership:{zone_id:'zone-1',fo_profile_id:'fo-1'}};
  const snapshot={admin:true,from:'2026-11-01',to:'2026-11-15',epoch_at:'2026-01-01',stores:[store],zones:[{id:'zone-1',zone_name:'Synthetic Zone',state:'Tamil Nadu'}],fos:[{id:'fo-1',full_name:'Synthetic FO'}],store_zone_history:[],assignments:[{zone_id:'zone-1',fo_profile_id:'fo-1',effective_from:'2026-01-01'}],rows:[],proposals:[],permissions:[],aop:[],attendance:[]};
  const session={id:'session-hk',training_date:'2026-11-14',submitted_at:'2026-11-14T10:00:00Z',category:{code:'hk'},store,trainer_name:'Synthetic Trainer',status:'submitted'};
  const detail={session:{id:session.id,training_date:session.training_date,submitted_at:session.submitted_at,trainer_name_snapshot:session.trainer_name,status:'submitted'},category:{code:'hk'},store,attendees:[],topics:[{id:'topic-1',is_covered:true,topic:{module_name:'Synthetic safety topic',topic_description:'Synthetic recorded topic'}}],evidence:[{id:'photo-1',file_name:'SYNTHETIC_PIXEL.png',mime_type:'image/png',file_size:68,evidence_type:'topic_photo'}],events:[]};
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j0L0AAAAASUVORK5CYII=','base64');
  async function launch(baseline) {
    const server=await createServer({configFile:false,envDir,cacheDir:path.join(envDir,baseline?'baseline':'candidate'),plugins:[{name:'training-baseline-only',enforce:'pre',load(id){if(baseline&&id.replaceAll('\\','/').endsWith('/src/pages/reliance-retail/RetailTraining.jsx'))return original;}},react(),tailwindcss()],server:{host:'127.0.0.1',port:0,watch:{ignored:['**/outputs/**','**/artifacts/**','**/tmp/**']}},logLevel:'error'});
    await server.listen();const context=await browser.newContext({acceptDownloads:true});const page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await context.addInitScript(()=>{localStorage.setItem('qpms-crm-auth-user',JSON.stringify({id:'fixture-auth',profileId:'fixture-profile',employeeCode:'QPMSADMIN',name:'Synthetic Admin',role:'Admin',rawRole:'Admin',status:'Active',isActive:true,webAccessEnabled:true,is_demo:true,isDemoReadOnly:true,read_only:false}));sessionStorage.setItem('qpms-crm-backend-token','synthetic-local-token');});
    await page.route('**/*',async route=>{
      const req=route.request(),url=new URL(req.url());
      if(url.hostname==='example.invalid')return route.fulfill({status:200,body:png,contentType:'image/png',headers:{'access-control-allow-origin':'*'}});
      if(!['127.0.0.1','localhost'].includes(url.hostname))return route.abort();
      if(!url.pathname.startsWith('/api/'))return route.continue();
      calls.push({method:req.method(),path:url.pathname,params:Object.fromEntries(url.searchParams)});assert.equal(req.method(),'GET');
      if(url.pathname.endsWith('/module-reports/training'))return route.fulfill({json:{report:{rows:[session],complete:true}}});
      if(url.pathname.endsWith('/module-reports/ifms-history'))return route.fulfill({json:{report:{rows:[],total:0}}});
      if(url.pathname.endsWith('/unified-master'))return route.fulfill({json:{result:snapshot}});
      if(url.pathname.endsWith('/view-url'))return denyEvidence?route.fulfill({status:403,json:{message:'Synthetic evidence denied'}}):route.fulfill({json:{view:{url:'https://example.invalid/synthetic-photo?token=NEVER_RETAIN'}}});
      if(url.pathname.endsWith('/training/sessions/session-hk'))return denyDetail?route.fulfill({status:403,json:{message:'Synthetic session authorization denied'}}):route.fulfill({json:detail});
      return route.fulfill({json:{ok:true,result:{},data:[],rows:[]}});
    });
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/reliance-retail/training`);
    await page.getByRole('button',{name:'View Training evidence for 0012',exact:true}).waitFor();
    return {server,context,page,errors};
  }
  let baseline,candidate;
  try {
    const filterStyles=page=>page.locator('.tv-filters').evaluate(root=>[root,...root.querySelectorAll('label,input,select')].map(el=>{const c=getComputedStyle(el),r=el.getBoundingClientRect();return {width:r.width,height:r.height,font:c.font,color:c.color,background:c.backgroundColor,padding:c.padding,margin:c.margin,gap:c.gap,border:c.borderRadius};}));
    baseline=await launch(true);const before={};
    for(const width of [1440,768,390]){await baseline.page.setViewportSize({width,height:1000});before[width]=await filterStyles(baseline.page);await baseline.page.locator('.tv-filters').screenshot({path:path.join(output,`baseline-filters-${width}.png`),animations:'disabled'});await baseline.page.locator('.dc-kpis').screenshot({path:path.join(output,`baseline-kpis-${width}.png`),animations:'disabled'});}
    const headings=await baseline.page.locator('.dc-table-scroll th').allTextContents();
    const overview=await baseline.page.locator('.dc-kpis,.dc-performance').allTextContents();
    await baseline.context.close();await baseline.server.close();baseline=null;
    candidate=await launch(false);const {page}=candidate;
    assert.deepEqual(await page.locator('.dc-table-scroll th').allTextContents(),headings);
    assert.deepEqual(await page.locator('.dc-kpis,.dc-performance').allTextContents(),overview);
    for(const width of [1440,768,390]){await page.setViewportSize({width,height:1000});await page.locator('.tv-filters').screenshot({path:path.join(output,`candidate-filters-${width}.png`),animations:'disabled'});await page.locator('.dc-kpis').screenshot({path:path.join(output,`candidate-kpis-${width}.png`),animations:'disabled'});assert.deepEqual(await filterStyles(page),before[width],`Existing V2 filter styles or dimensions changed at ${width}px`);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+2));}
    await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:path.join(output,'candidate-dashboard.png'),fullPage:true});
    const oldPending=page.waitForEvent('download');await page.getByRole('button',{name:'Export Training review',exact:true}).click();const oldDownload=await oldPending;assert.equal(oldDownload.suggestedFilename(),'Retail_Training_Review.xlsx');
    await page.getByLabel('More Training export options').click();await page.getByLabel('Training export month').fill('2026-11');
    async function download(label,name) {
      const pending=page.waitForEvent('download');await page.getByRole('button',{name:label,exact:true}).click();const file=await pending;assert.equal(await file.failure(),null);const target=path.join(output,name);await file.saveAs(target);await page.getByRole('status').filter({hasText:'Download prepared:'}).waitFor();return target;
    }
    for(const [label,name] of [['Export Excel — Monthly','BROWSER_monthly.xlsx'],['Export PowerPoint — Monthly','BROWSER_monthly.pptx'],['Export Excel — Current Filtered View','BROWSER_filtered.xlsx']])await download(label,name);
    assert.ok(calls.some(c=>c.path.endsWith('/module-reports/training')&&c.params.to==='2026-11-30'));
    await page.getByRole('button',{name:'Close',exact:true}).click();
    await page.getByLabel('Download Training session 0012').click();await download('Export Excel — This Session','BROWSER_session.xlsx');await download('Export PowerPoint — This Session','BROWSER_session.pptx');
    denyEvidence=true;await download('Export PowerPoint — This Session','BROWSER_pending-evidence.pptx');assert.match(await page.getByRole('status').filter({hasText:'Download prepared:'}).innerText(),/denied or pending/);
    denyDetail=true;let deniedDownload=false;const listener=()=>{deniedDownload=true;};page.on('download',listener);await page.getByRole('button',{name:'Export Excel — This Session'}).click();await page.getByRole('alert').filter({hasText:'Synthetic session authorization denied'}).waitFor();assert.equal(deniedDownload,false);page.off('download',listener);
    await page.getByRole('button',{name:'Close',exact:true}).click();denyDetail=false;denyEvidence=false;await page.getByRole('button',{name:'View Training evidence for 0012',exact:true}).click();await page.getByRole('complementary',{name:'Training Details'}).waitFor();assert.equal(await page.getByRole('heading',{name:'Audit Trail',exact:true}).count(),1);
    await page.getByRole('button',{name:'Load photo',exact:true}).click();await page.getByRole('button',{name:'Preview SYNTHETIC_PIXEL.png',exact:true}).click();await page.getByRole('dialog',{name:'Training photo preview'}).waitFor();await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog',{name:'Training photo preview'}).count(),0);
    for(const name of ['BROWSER_monthly.xlsx','BROWSER_filtered.xlsx','BROWSER_session.xlsx']){const book=new ExcelJS.Workbook();await book.xlsx.readFile(path.join(output,name));assert.equal(book.getWorksheet('Sessions').getCell('A2').value,'session-hk');assert.equal(book.getWorksheet('Sessions').getCell('L2').value,'Not recorded');}
    for(const name of ['BROWSER_monthly.pptx','BROWSER_session.pptx','BROWSER_pending-evidence.pptx']){
      const zip=await JSZip.loadAsync(await readFile(path.join(output,name)));const documents=await Promise.all(Object.keys(zip.files).filter(p=>p.endsWith('.xml')||p.endsWith('.rels')).map(async p=>({path:p,xml:await zip.file(p).async('string')})));
      const malformed=await page.evaluate(docs=>docs.filter(d=>new DOMParser().parseFromString(d.xml,'application/xml').querySelector('parsererror')).map(d=>d.path),documents);assert.deepEqual(malformed,[]);
      assert.equal(documents.some(d=>d.xml.includes('NEVER_RETAIN')),false);
      if(!name.includes('pending'))assert.ok(Object.keys(zip.files).some(p=>/^ppt\/media\/.+\.png$/.test(p)));
    }
    assert.deepEqual(candidate.errors,[]);assert.ok(calls.every(c=>c.method==='GET'));
  }finally{if(baseline){await baseline.context.close();await baseline.server.close();}if(candidate){await candidate.context.close();await candidate.server.close();}await browser.close();}
});
