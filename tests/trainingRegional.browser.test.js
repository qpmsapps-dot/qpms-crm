// Synthetic regional reporting and upload-route integration; no production sessions.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';

test('Branch Head HK/MEPC report, OM MEPC-only register, scoped Excel and evidence denial',{timeout:120000},async()=>{
 const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter} from 'react-router-dom';import {AuthContext} from '/src/context/auth-context.js';import Training from '/src/pages/reliance-retail/RetailTraining.jsx';import Upload from '/src/pages/reliance-retail/RetailTrainingUpload.jsx';import '/src/index.css';
 const om=location.search.includes('om');const role=om?'Operations Manager':'Branch Head';
 createRoot(document.getElementById('root')).render(React.createElement(MemoryRouter,null,React.createElement(AuthContext.Provider,{value:{user:{id:'synthetic',profileId:'synthetic',role,rawRole:role,business:'Reliance Retail'}}},React.createElement(om?Upload:Training))));`;
 const envDir=path.resolve('.phase4-test-output/empty-env');fs.mkdirSync(envDir,{recursive:true});
 const server=await createServer({envDir,cacheDir:path.resolve('.phase4-test-output/regional-vite-cache'),plugins:[{name:'training-regional',resolveId(id){if(id==='virtual:training-regional')return '\0training-regional';},load(id){if(id==='\0training-regional')return entry;},configureServer(s){s.middlewares.use('/__training_regional',async(req,res)=>{res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml('/__training_regional','<html><head><meta charset="UTF-8"></head><body><div id="root"></div><script type="module" src="/@id/__x00__training-regional"></script></body></html>'));});}}],server:{host:'127.0.0.1',port:0,watch:null},logLevel:'error'});
 await server.listen();let browser;
 const store={id:'tn',store_code:'SYN-TN',store_name:'Sample TN Store',state:'TN'};
 const rows=['hk','technical_mep'].map((code,i)=>({id:'session-'+i,category:{code},store,training_date:'2026-11-20',submitted_at:'2026-11-20T07:00:00Z',status:'submitted',trainer_name:'Sample FO (synthetic)',attendee_count:null,topic_count:1,evidence_count:1}));
 try{
  browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1280,height:900}});await page.addInitScript(()=>sessionStorage.setItem('qpms-crm-backend-token','synthetic-fixture'));
  await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
  const seen=[];await page.route('**/api/**',route=>{
   const url=new URL(route.request().url());seen.push(url.pathname);assert.equal(route.request().method(),'GET');
   if(url.pathname.includes('/view-url'))return route.fulfill({status:403,json:{message:'Synthetic scoped evidence denial'}});
   if(url.pathname.endsWith('/sessions'))return route.fulfill({json:{sessions:rows}});
   if(url.pathname.includes('/sessions/'))return route.fulfill({json:{session:{...rows[1],can_edit:false},category:rows[1].category,store,topics:[{id:'st',topic:{module_name:'Electrical Safety'},is_covered:true}],evidence:[{id:'photo',evidence_type:'topic_photo',file_name:'synthetic.png',mime_type:'image/png'}],attendees:[],events:[]}});
   if(url.pathname.endsWith('/module-reports/training'))return route.fulfill({json:{report:{rows}}});
   if(url.pathname.includes('unified-master'))return route.fulfill({json:{snapshot:{stores:[store],zones:[],fos:[],assignments:[],store_zone_history:[],epoch_at:'2026-01-01',permissions:[]}}});
   return route.fulfill({json:{}});
  });
  const base='http://127.0.0.1:'+server.httpServer.address().port+'/__training_regional';
  await page.goto(base);await page.getByRole('heading',{name:'HK & MEPC Training',exact:true}).waitFor();
  await page.getByRole('button',{name:'View Training evidence for SYN-TN'}).first().waitFor();assert.equal(await page.getByRole('button',{name:'View Training evidence for SYN-TN'}).count(),2);
  assert.equal(await page.getByText('Upload MEPC Training report',{exact:true}).count(),0);assert.equal(await page.getByText('Sample KA Store').count(),0);
  fs.mkdirSync('.phase4-test-output/screenshots',{recursive:true});await page.screenshot({path:'.phase4-test-output/screenshots/branch-head-training-regional.png',fullPage:true});
  const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Export Training review',exact:true}).click();const download=await downloadPromise;
  const {default:ExcelJS}=await import('exceljs');const book=new ExcelJS.Workbook();await book.xlsx.readFile(await download.path());assert.equal(book.getWorksheet('Training').rowCount,3);
  await page.getByLabel('Training Class',{exact:true}).selectOption('MEPC');assert.equal(await page.getByRole('button',{name:'View Training evidence for SYN-TN'}).count(),1);
  await page.getByRole('button',{name:'View Training evidence for SYN-TN'}).click();await page.getByRole('button',{name:'Load photo',exact:true}).click();await page.getByText('Synthetic scoped evidence denial',{exact:true}).waitFor();assert.equal(await page.locator('.tv-drawer img').count(),0);
  await page.goto(base+'?om');await page.getByRole('button',{name:'View SYN-TN',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'View SYN-TN',exact:true}).count(),1);
  const omDownloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Download MEPC reports'}).click();const omDownload=await omDownloadPromise;const omBook=new ExcelJS.Workbook();await omBook.xlsx.readFile(await omDownload.path());assert.equal(omBook.getWorksheet('MEPC Training').rowCount,2);
  await page.screenshot({path:'.phase4-test-output/screenshots/operations-manager-training-register.png',fullPage:true});
  assert.ok(seen.includes('/api/training/sessions'));
 }finally{await browser?.close();await server.close();}
});
