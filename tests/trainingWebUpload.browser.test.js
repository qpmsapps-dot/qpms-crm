// Synthetic loopback component validation. No production credentials or data.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';

for(const role of ['MIS_MEPC','Operations Manager'])test('MEPC Web upload '+role+': gate denial, topic/photo/proof, retry identity, resume, read-only roles and mobile layout',{timeout:120000},async()=>{
 const roleTag=role==='MIS_MEPC'?'mis':'om';
 const seed=fs.readFileSync('supabase/migrations_2_0/115_reliance_training_foundation.sql','utf8').split('-- Technical / MEP topics (15).')[1].split("where c.code = 'technical_mep'")[0];
 const topicNames=[...seed.matchAll(/\('([^']+)', '([^']+)'/g)].map(m=>m[2]);assert.equal(topicNames.length,15);
 const seedTopics=topicNames.map((module_name,i)=>({id:i?'topic-'+i:'topic',module_name}));
 const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import Panel from '/src/components/reliance-retail/TrainingWebUpload.jsx';import '/src/index.css';
 const setup={store:{id:'store',store_code:'S1',store_name:'Synthetic Store',state:'TN'},trainer:{id:'fo',full_name:'Synthetic FO'},training_date:'2026-11-27',category:{id:'mep',code:'technical_mep'},types:[{id:'type',name:'Toolbox'}],topics:${JSON.stringify(seedTopics)}};
 let detail={session:{id:'session',submission_source:'Web',status:'draft',can_edit:true,training_date:'2026-11-27'},category:{code:'technical_mep'},store:setup.store,topics:[],evidence:[]},intents={},seq=0,failed=false;
 window.calls=[];
 const request=async c=>{window.calls.push(structuredClone({...c,data:c.data instanceof ArrayBuffer?'BINARY':c.data}));
 if(c.url.endsWith('/web/setup')){if(location.search.includes('gate'))throw {response:{data:{message:'MEPC Web uploads are awaiting release approval.'}}};return {data:{setup}};}
 if(c.url.endsWith('/web/sessions')){if(location.search.includes('lost')&&!failed){failed=true;throw Error('Synthetic lost creation response');}return {data:{id:'session',duplicate_candidates:[]}};}
 if(c.url.endsWith('/topics')&&c.method==='put'){detail.topics=[{id:'st',topic_id:'topic',topic:{module_name:'Electrical Safety'},is_covered:false}];return {data:{}};}
 if(c.url.endsWith('/topics/st')){detail.topics[0].is_covered=true;return {data:{}};}
 if(c.url.endsWith('upload-url')){const id='e'+(++seq);intents[id]=c.data;return {data:{upload:{evidence_id:id,signed_upload_url:'/api/training/sessions/session/evidence/'+id+'/content'}}};}
 if(c.url.endsWith('/content'))return {data:{}};
 if(c.url.endsWith('/complete')){const v={id:c.data.evidence_id,...intents[c.data.evidence_id],metadata:{upload_status:'uploaded'}};detail.evidence.push(v);return {data:{evidence:v}};}
 if(c.url.endsWith('/submit')){detail.session.status='submitted';detail.session.can_edit=false;return {data:detail};}
 return {data:structuredClone(detail)};};
 createRoot(document.getElementById('root')).render(React.createElement(Panel,{profile:{id:'synthetic',role:location.search.includes('readonly')?'Branch Head':${JSON.stringify(role)}},request}));`;
 const envDir=path.resolve('.phase4-test-output/empty-env');fs.mkdirSync(envDir,{recursive:true});
 const server=await createServer({envDir,cacheDir:path.resolve('.phase4-test-output/vite-cache'),plugins:[{name:'web-training-test',resolveId(id){if(id==='virtual:web-training')return '\0web-training';},load(id){if(id==='\0web-training')return entry;},configureServer(s){s.middlewares.use('/__web_training',async(req,res)=>{res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml('/__web_training','<html><head><meta charset="UTF-8"></head><body><div id="root"></div><script type="module" src="/@id/__x00__web-training"></script></body></html>'));});}}],server:{host:'127.0.0.1',port:0,watch:null},logLevel:'error'});
 await server.listen();let browser;
 try{
  browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1100,height:850}});
  await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
  const base='http://127.0.0.1:'+server.httpServer.address().port+'/__web_training';
  const begin=async suffix=>{await page.goto(base+suffix);await page.getByText('Upload MEPC Training report',{exact:true}).click();await page.getByLabel('Store code',{exact:true}).fill('S1');await page.getByLabel('Actual trainer employee code').fill('FO1');await page.getByRole('button',{name:'Verify store and trainer'}).click();};
  await begin('?gate');await page.getByRole('alert').filter({hasText:'awaiting release approval'}).waitFor();assert.equal(await page.getByRole('button',{name:'Create Web draft'}).count(),0);
  await begin('?lost');await page.getByLabel('Training type',{exact:true}).selectOption('type');await page.getByLabel('Electrical Safety',{exact:true}).check();await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Create Web draft'&&!b.disabled));fs.mkdirSync('.phase4-test-output/screenshots',{recursive:true});await page.screenshot({path:'.phase4-test-output/screenshots/mepc-web-'+roleTag+'-setup.png',fullPage:true});await page.getByRole('button',{name:'Create Web draft'}).click();await page.getByRole('alert').filter({hasText:'lost creation response'}).waitFor();
  await page.getByRole('button',{name:'Resume saved report'}).click();await page.getByRole('button',{name:'Retry saved topic selection'}).click();
  const submit=page.getByRole('button',{name:'Submit MEPC Training report',exact:true});assert.equal(await submit.isDisabled(),true);
  await page.getByLabel('Photograph for Electrical Safety').setInputFiles({name:'photo.png',mimeType:'image/png',buffer:Buffer.from('SYNTHETIC PHOTO')});
  await page.getByText('1 verified evidence files.',{exact:false}).waitFor();assert.equal(await submit.isDisabled(),true);
  await page.getByLabel('Completion proof (required)').setInputFiles({name:'proof.pdf',mimeType:'application/pdf',buffer:Buffer.from('SYNTHETIC PROOF')});await page.getByText('2 verified evidence files.',{exact:false}).waitFor();
  assert.equal(await submit.isEnabled(),true);
  const keys=await page.evaluate(()=>window.calls.filter(c=>c.url.endsWith('/web/sessions')).map(c=>c.data.creation_key));assert.equal(keys.length,2);assert.equal(keys[0],keys[1]);
  fs.mkdirSync('.phase4-test-output/screenshots',{recursive:true});await page.screenshot({path:'.phase4-test-output/screenshots/mepc-web-'+roleTag+'-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'.phase4-test-output/screenshots/mepc-web-'+roleTag+'-mobile.png',fullPage:true});
  await submit.click();await page.getByRole('status').filter({hasText:'submitted'}).waitFor();assert.equal(await submit.isDisabled(),true);
  await page.goto(base+'?readonly');assert.equal(await page.getByText('Upload MEPC Training report',{exact:true}).count(),0);
 }finally{await browser?.close();await server.close();}
});
