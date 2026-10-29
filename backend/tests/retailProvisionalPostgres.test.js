import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { parseStoreReview } from '../services/retailStoreImportValidation.js';
import { createRetailProvisionalRouter } from '../routes/retailProvisionalRoutes.js';
import { buildProvisionalWorkbook } from '../../src/utils/retailProvisionalExport.js';

test('isolated PostgreSQL and browser: source staging, state security, review, audit, rollback and canonical preservation', { skip: process.env.RETAIL_PROVISIONAL_POSTGRES !== '1', timeout: 240000 }, async t => {
  const root = new URL('../../', import.meta.url), read = path => readFileSync(new URL(path, root), 'utf8');
  const name = 'qpms-provisional-' + randomUUID().slice(0,8);
  const docker = args => execFileSync('docker', args, { encoding:'utf8', maxBuffer:50e6, stdio:['pipe','pipe','pipe'] });
  const sql = (s, role = '') => execFileSync('docker',['exec','-i',name,'psql','-h','127.0.0.1','-U','postgres','-qAt','-v','ON_ERROR_STOP=1'], { input:(role ? `set role ${role};` : '') + s, encoding:'utf8',maxBuffer:50e6,stdio:['pipe','pipe','pipe'] }).trim();
  const q = v => v == null ? 'null' : typeof v === 'boolean' || typeof v === 'number' ? String(v) : "'" + String(typeof v === 'object' ? JSON.stringify(v) : v).replaceAll("'","''") + "'" + (typeof v === 'object' ? '::jsonb' : '');
  const call = (fn,args,role='service_role') => JSON.parse(sql(`select to_jsonb(public.${fn}(${Object.entries(args).map(([k,v]) => `${k}=>${q(v)}`).join(',')}));`,role));
  const client = { rpc: async(fn,args) => { try { return {data:call(fn,args)}; } catch(error) { return {error}; } } };
  const admin='00000000-0000-4000-8000-000000000101', second='00000000-0000-4000-8000-000000000102', mis='00000000-0000-4000-8000-000000000103';
  const review = (actor=admin) => call('rpc_retail_provisional_review',{p_actor:actor});
  const bytes = readFileSync(process.env.RETAIL_STORE_REVIEW_WORKBOOK || new URL('import_sources/Reliance_Retail_Store_Master_Audit_Upload_Review.xlsx',root));
  const parsed = parseStoreReview(bytes,'review.xlsx'); assert.equal(parsed.rows.length,854);
  const seed = JSON.parse(readFileSync(process.env.RETAIL_CANONICAL_FIXTURE || new URL('artifacts/retail-store-aop-upload-20261028/production-before-release.json',root),'utf8')).canonical;
  assert.equal(seed.length,130);
  docker(['run','--detach','--name',name,'--network','none','--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17']);
  let server, vite, browser;
  const output = new URL('artifacts/retail-provisional-test/',root); mkdirSync(output,{recursive:true});
  try {
    for(let i=0;;i++){try{docker(['exec',name,'pg_isready','-h','127.0.0.1','-U','postgres']);break;}catch(e){if(i>80)throw e;await new Promise(r=>setTimeout(r,200));}}
    sql(read('backend/tests/fixtures/retailStoreImportBaseline.sql'));
    sql(read('supabase/migrations_2_0/232_reliance_retail_uploaded_attendance.sql'));
    sql(read('supabase/proposals/retail_store_aop_upload.sql'));
    sql(read('supabase/proposals/retail_bulk_identity_approval.sql'));
    sql(`insert into profiles(id,role,is_active,status,business) values('${admin}','ADMIN',true,'Active',''),('${second}','ADMIN',true,'Active',''),('${mis}','HK MIS',true,'Active','Reliance Retail');`);
    for(const s of seed)sql(`insert into reliance_retail_store_master(id,store_code,store_name,state,status,source_name,metadata) values(${q(s.id)},${q(s.store_code)},${q(s.store_name)},${q(s.state)},${q(s.status)},'isolated identity fixture','{"operational_model":"SUPERVISOR_ONLY"}');`);
    const digest = () => sql(`select md5(coalesce(jsonb_agg(to_jsonb(s) order by id),'[]')::text) from reliance_retail_store_master s;`);
    const fingerprints = () => sql("select md5(string_agg(pg_get_functiondef(oid),'' order by oid)) from pg_proc where proname in ('rpc_confirm_retail_bulk_identity','rpc_confirm_retail_store_import','retail_store_import_admin');");
    const before=digest(), functionsBefore=fingerprints();
    const protectedDigest=()=>sql("select md5(string_agg(t.d,'|' order by t.n)) from (select 'attendance' n,coalesce(jsonb_agg(to_jsonb(x) order by id),'[]')::text d from retail_employee_daily_attendance x union all select 'aop',coalesce(jsonb_agg(to_jsonb(x) order by id),'[]')::text from retail_attendance_aop_versions x union all select 'uploads',coalesce(jsonb_agg(to_jsonb(x) order by id),'[]')::text from retail_attendance_uploads x) t;");
    const protectedBefore=protectedDigest();
    sql('create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[]);');
    sql(read('supabase/proposals/retail_provisional_apply_and_record.sql'));
    assert.equal(sql("select count(*) from supabase_migrations.schema_migrations where version='20261029120000' and cardinality(statements)=1;"),'1');
    assert.equal(sql("select statements[1] from supabase_migrations.schema_migrations where version='20261029120000';"),read('supabase/proposals/retail_provisional_stores.sql').replaceAll('\r\n','\n').trim());
    assert.throws(()=>sql(read('supabase/proposals/retail_provisional_apply_and_record.sql')));
    await t.test('RLS and RPC ACL prevent browser and service table writes; no MIS access without grants',()=>{
      for(const table of ['access','files','rows','proposals','events'])for(const role of ['anon','authenticated','service_role'])assert.throws(()=>sql(`select * from retail_provisional_${table};`,role));
      for(const role of ['anon','authenticated'])assert.throws(()=>call('rpc_retail_provisional_review',{p_actor:admin},role));
      assert.throws(()=>review(mis));sql(`insert into retail_provisional_access values('${mis}','TN');`);
      sql(`update profiles set is_active=false where id='${second}';`);assert.throws(()=>review(second));sql(`update profiles set is_active=true where id='${second}';`);
    });
    const uploadArgs={p_actor:admin,p_filename:'review.xlsx',p_sha256:parsed.checksum,p_original:bytes.toString('base64'),p_rows:parsed.rows};
    let receipt;
    await t.test('854 real source rows, exact bytes, pending states, replay and duplicate preservation',()=>{
      assert.throws(()=>call('rpc_retail_provisional_upload',{...uploadArgs,p_actor:mis}));
      receipt=call('rpc_retail_provisional_upload',uploadArgs);assert.equal(receipt.rows,854);
      assert.equal(call('rpc_retail_provisional_upload',uploadArgs).batch_id,receipt.batch_id);
      let r=review();assert.equal(r.rows.length,854);assert.ok(r.rows.every(x=>x.verification_status==='PENDING_VERIFICATION'));
      assert.equal(sql(`select original_base64 from retail_provisional_files where id='${receipt.batch_id}'`),bytes.toString('base64'));
      for(const x of r.rows){const original=parsed.rows.find(p=>p.source_row===x.source_row);assert.deepEqual(x.source,original);assert.equal(x.row_digest,original.row_digest);}
      assert.ok(r.rows.some(x=>x.duplicate_count>1));assert.ok(review(mis).rows.every(x=>x.source_state==='TN'));
      assert.equal(digest(),before);assert.equal(fingerprints(),functionsBefore);
      writeFileSync(new URL('source-reconciliation.json',output),JSON.stringify({sha256:parsed.checksum,rows:r.rows.length,states:[...new Set(r.rows.map(x=>x.source_state))].map(state=>({state,rows:r.rows.filter(x=>x.source_state===state).length})),canonical_fixture_count:seed.length},null,2));
    });
    const row=review(mis).rows[0], other=review().rows.find(r=>r.source_state!=='TN');
    const changes={...row.review,store_name:'Isolated verified store',operating_status:'Inactive'};
    const propose=(actor=mis,r=row,c=changes,revision=r.revision)=>call('rpc_retail_provisional_propose',{p_actor:actor,p_row:r.id,p_revision:revision,p_changes:c,p_reason:'Verified isolated correction evidence'});
    const decide=(id,actor=admin,approve=true)=>call('rpc_retail_provisional_decide',{p_actor:actor,p_proposal:id,p_approve:approve,p_reason:'Independent approval evidence TEST-1'});
    await t.test('state boundaries, invalid corrections, independent approval, revisions and append-only audit',()=>{
      assert.throws(()=>propose(mis,other));assert.throws(()=>propose(mis,row,{...changes,state:'KA'}));assert.throws(()=>propose(mis,row,{...changes,unexpected:'x'}));
      let p=propose();assert.throws(()=>propose());assert.throws(()=>decide(p,mis));decide(p);
      assert.equal(review().rows.find(r=>r.id===row.id).verification_status,'VERIFIED');assert.equal(digest(),before);
      assert.throws(()=>propose());const changed=review().rows.find(r=>r.id===row.id);p=propose(admin,changed);assert.throws(()=>decide(p,admin));decide(p,second,false);
      assert.ok(review().events.some(e=>e.action==='APPROVE_STAGING'));assert.equal(protectedDigest(),protectedBefore);
      assert.throws(()=>sql('delete from retail_provisional_events;','service_role'));
      assert.throws(()=>sql('delete from retail_provisional_events;'));
      assert.throws(()=>sql("update retail_provisional_rows set source='{}';"));
      assert.throws(()=>sql("update retail_provisional_files set filename='tampered';"));
    });
    await t.test('Excel keeps original strings and review/audit history',async()=>{
      const report=review();const book=await buildProvisionalWorkbook(report);assert.equal(book.getWorksheet('MIS review').rowCount,855);
      assert.ok(book.getWorksheet('Change history').rowCount>1);await book.xlsx.writeFile(new URL('mis-review.xlsx',output).pathname.replace(/^\/([A-Za-z]:)/,'$1'));
    });
    await t.test('browser uploads real workbook through HTTP into real PostgreSQL and reviews proposals',async()=>{
      let httpActor=admin;
      const app=express();app.use(express.json({limit:'1mb'}));
      app.use('/api/reliance-retail/provisional-stores',(req,res,next)=>{req.profile={id:httpActor};next();},createRetailProvisionalRouter({getClient:()=>client}));
      server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
      const {createServer}=await import('vite');const {chromium}=await import('@playwright/test');
      const harness='artifacts/retail-provisional-test/browser.html';
      writeFileSync(new URL(harness,root),'<html><body><div id="root"></div><script type="module">import React from "react";import{createRoot}from"react-dom/client";import View from "/src/pages/reliance-retail/RetailProvisionalStores.jsx";createRoot(document.getElementById("root")).render(React.createElement(View));</script></body></html>');
      vite=await createServer({root:decodeURIComponent(root.pathname).replace(/^\/([A-Za-z]:)/,'$1'),define:{'import.meta.env.VITE_ENABLE_DEMO_AUTH':'"true"','import.meta.env.VITE_APP_MODE':'"demo"','import.meta.env.VITE_SUPABASE_URL':'""','import.meta.env.VITE_SUPABASE_ANON_KEY':'""'},optimizeDeps:{noDiscovery:true,include:['react','react-dom/client','axios','exceljs']},server:{host:'127.0.0.1',port:0},logLevel:'error'});await vite.listen();browser=await chromium.launch({headless:true});
      const page=await browser.newPage();page.setDefaultTimeout(30000);
      await page.addInitScript(()=>sessionStorage.setItem('qpms-crm-backend-token','isolated-test-session'));
      await page.route('**/api/reliance-retail/provisional-stores**',async route=>{const url=new URL(route.request().url());const response=await route.fetch({url:base+url.pathname});await route.fulfill({response});});
      await page.goto(vite.resolvedUrls.local[0]+harness,{waitUntil:'domcontentloaded'});
      await page.getByText('854 source rows in selected scope.',{exact:false}).waitFor();
      await page.getByLabel('Provisional source workbook').setInputFiles({name:'review.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:bytes});
      await page.getByRole('button',{name:'Upload to provisional staging'}).click();await page.getByText(/already recorded; no duplicate upload created/).waitFor();
      await page.getByLabel('Provisional state').selectOption('TN');
      await page.getByLabel('Search provisional stores').fill(row.store_code);
      await page.getByRole('button',{name:'Propose correction'}).first().click();await page.getByLabel('Store name',{exact:true}).fill('Browser proposed correction');await page.getByLabel('Correction reason / evidence').fill('Browser evidence TEST-2');
      await page.getByRole('button',{name:'Submit proposal'}).click();await page.getByText('Correction submitted for independent Admin review.').waitFor();
      const proposal=review().proposals.find(p=>p.changes.store_name==='Browser proposed correction');assert.ok(proposal);
      await page.getByText('Change history',{exact:true}).first().click();
      httpActor=second;
      page.once('dialog',d=>d.accept('Independent browser rejection TEST-2'));await page.getByRole('button',{name:'Reject proposal'}).click();
      await page.getByText('REJECTED · Browser evidence TEST-2').waitFor();
      const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'Export MIS Excel'}).click();assert.equal((await downloaded).suggestedFilename(),'retail-provisional-mis-review.xlsx');
      await page.screenshot({path:new URL('browser.png',output).pathname.replace(/^\/([A-Za-z]:)/,'$1'),fullPage:true});
      // Exercise the actual Store Master route/tab as well as the isolated workflow.
      await vite.close();
      const {preview}=await import('vite');
      const built=await preview({configFile:false,root:decodeURIComponent(root.pathname).replace(/^\/([A-Za-z]:)/,'$1'),build:{outDir:'dist'},preview:{host:'127.0.0.1',port:4198,strictPort:true}});
      vite={close:()=>new Promise(resolve=>built.httpServer.close(resolve))};
      await page.addInitScript(()=>localStorage.setItem('qpms-crm-auth-user',JSON.stringify({id:'synthetic-admin',profileId:'synthetic-profile',name:'Local Test Admin',role:'Admin',rawRole:'Admin',status:'Active',isActive:true,webAccessEnabled:true,authProvider:'demo-fixture',is_demo:true,isDemoReadOnly:true,read_only:false})));
      await page.route('**/api/**',async route=>{
        const url=new URL(route.request().url());
        if(url.pathname.includes('/provisional-stores')) {const response=await route.fetch({url:base+url.pathname});return route.fulfill({response});}
        return route.fulfill({json:{ok:true,rows:[],total:0,zones:[],employees:[],access:{allowed:true,stores:true,dashboard:true}}});
      });
      await page.goto('http://127.0.0.1:4198/reliance-retail/store-master',{waitUntil:'domcontentloaded'});
      try { await page.getByRole('button',{name:'Provisional MIS Review',exact:true}).click(); }
      catch(e) { writeFileSync(new URL('route-failure.txt',output),page.url()+'\n'+await page.locator('body').innerText()); throw e; }
      await page.getByText('854 source rows in selected scope.',{exact:false}).waitFor();
      await page.getByLabel('Provisional state').selectOption('KA');
      await page.getByText('292 source rows in selected scope.',{exact:false}).waitFor();
      await page.screenshot({path:new URL('store-master-route.png',output).pathname.replace(/^\/([A-Za-z]:)/,'$1'),fullPage:true});
      await browser.close();browser=null;await vite.close();vite=null;await new Promise(r=>server.close(r));server=null;
    });
    await t.test('new file version retained, audited withdrawal never deletes evidence or reactivates replay',()=>{
      // Change workbook container metadata to obtain a distinct source version with unchanged rows.
      const otherBytes=Buffer.concat([bytes,Buffer.from('\n')]);
      const {checksum}=parseStoreReview(otherBytes,'version2.xlsx');
      const v=call('rpc_retail_provisional_upload',{...uploadArgs,p_sha256:checksum,p_original:otherBytes.toString('base64')});
      assert.notEqual(v.batch_id,receipt.batch_id);assert.equal(review().files.length,2);
      call('rpc_retail_provisional_withdraw',{p_actor:admin,p_batch:receipt.batch_id,p_reason:'Rollback isolated uploaded version'});
      assert.equal(review().rows.filter(r=>r.withdrawn_at).length,854);assert.equal(call('rpc_retail_provisional_upload',uploadArgs).replayed,true);
      assert.throws(()=>propose(admin,review().rows.find(r=>r.id===row.id)));assert.equal(digest(),before);assert.equal(fingerprints(),functionsBefore);assert.equal(protectedDigest(),protectedBefore);
      writeFileSync(new URL('preservation.json',output),JSON.stringify({canonical_before:before,canonical_after:digest(),protected_before:protectedBefore,protected_after:protectedDigest(),approval_functions_before:functionsBefore,approval_functions_after:fingerprints()},null,2));
    });
  } finally {if(browser)await browser.close();if(vite)await vite.close();if(server)await new Promise(r=>server.close(r));docker(['rm','--force',name]);}
});
