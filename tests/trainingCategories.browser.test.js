// Isolated component harness. Synthetic responses only; no application login/session.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';

test('Training category administration: independent save, history, conflicts, denial and mobile layout',{timeout:120000},async()=>{
 const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import Panel from '/src/components/user-management/TrainingCategoriesPanel.jsx';import '/src/index.css';
 let state={can_administer:true,eligible:true,categories:[{code:'hk',active:true,effective:true,revision:1},{code:'technical_mep',active:false,effective:false,revision:0}],history:[]};
 const request=async c=>{window.requests=(window.requests||[]).concat(c);if(location.search.includes('denied'))throw {response:{status:403}};if(c.method==='PUT'){if(location.search.includes('conflict'))throw {response:{status:409}};for(const change of c.data.changes){const category=state.categories.find(v=>v.code===change.code);Object.assign(category,{active:change.active,effective:change.active,revision:category.revision+1});state.history.unshift({created_at:'2026-11-26T12:00:00Z',actor_user_id:'SYNTHETIC-ADMIN',after_state:{active:change.active},metadata:{category:change.code,reason:c.data.reason}});}}return {data:{result:structuredClone(state)}};};
 createRoot(document.getElementById('root')).render(React.createElement(Panel,{profileId:'SYNTHETIC-FO',request}));`;
 const server=await createServer({envFile:false,cacheDir:path.resolve('artifacts/training-v2-vite-cache'),plugins:[{name:'training-category-qa',resolveId(id){if(id==='virtual:training-category-qa')return '\0training-category-qa';},load(id){if(id==='\0training-category-qa')return entry;},configureServer(s){s.middlewares.use('/__training_qa',async(req,res)=>{res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml('/__training_qa','<html><head><meta charset="UTF-8"></head><body><p>LOCAL SYNTHETIC VALIDATION — NOT PRODUCTION DATA</p><div id="root"></div><script type="module" src="/@id/__x00__training-category-qa"></script></body></html>'));});}}],server:{host:'127.0.0.1',port:0},logLevel:'error'});
 await server.listen();let browser;
 try{
  browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1100,height:800}});const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  const base='http://127.0.0.1:'+server.httpServer.address().port+'/__training_qa';await page.goto(base);
  const hk=page.getByRole('checkbox',{name:/HK Training/}),mep=page.getByRole('checkbox',{name:/MEPC Training/});await hk.waitFor();assert.equal(await hk.isChecked(),true);assert.equal(await mep.isChecked(),false);
  await mep.check();await page.getByLabel('Training permission change reason').fill('Approved synthetic MEPC allocation');await page.getByRole('button',{name:'Save Training permissions'}).click();await page.getByRole('status').filter({hasText:'Training permissions saved.'}).waitFor();
  const sent=await page.evaluate(()=>window.requests.find(c=>c.method==='PUT'));assert.equal(sent.url,'/api/training/administration/SYNTHETIC-FO/categories');assert.deepEqual(sent.data.changes,[{code:'technical_mep',active:true,expected_revision:0}]);assert.equal(sent.data.role,undefined);
  await page.getByText('Assignment and revocation history').click();assert.ok(await page.getByText(/SYNTHETIC-ADMIN/).count());
  const out='docs/retail/screenshots/training-v2';fs.mkdirSync(out,{recursive:true});await page.screenshot({path:path.join(out,'training-categories-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);await page.screenshot({path:path.join(out,'training-categories-mobile.png'),fullPage:true});
  await page.goto(base+'?conflict');await page.getByRole('checkbox',{name:/MEPC Training/}).check();await page.getByLabel('Training permission change reason').fill('Synthetic conflict');await page.getByRole('button',{name:'Save Training permissions'}).click();await page.getByRole('alert').filter({hasText:'changed elsewhere'}).waitFor();
  await page.goto(base+'?denied');await page.getByRole('alert').filter({hasText:'Super Admin access is required'}).waitFor();assert.equal(await page.getByRole('button',{name:'Save Training permissions'}).count(),0);
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();await server.close();}
});
