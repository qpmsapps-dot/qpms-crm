import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync,existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { parseStoreReview,validateStoreReview } from '../services/retailStoreImportValidation.js';
import { storeImportAdmin,confirmStoreImport,previewStoreImport } from '../services/retailStoreImportService.js';
import { previewRetailAttendance,commitRetailAttendance } from '../services/retailAttendanceService.js';
import { previewStoreAttendanceRecovery,confirmStoreAttendanceRecovery } from '../services/retailStoreAttendanceRecovery.js';
import XLSX from 'xlsx';
import { REVIEW_HEADERS } from '../services/retailStoreImportValidation.js';
import express from 'express';
import { createRetailStoreImportRouter } from '../routes/retailStoreImportRoutes.js';

const q=v=>v==null?'null':"'"+String(v).replaceAll("'","''")+"'";
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
test('Store import requires active Admin role and closed write gate',async()=>{
  for(const role of ['HK MIS','COO','MD','DEVELOPER'])assert.throws(()=>storeImportAdmin({id:'1',role,is_active:true}),/Admin/);
  await assert.rejects(()=>confirmStoreImport(null,{id:'1',role:'ADMIN',is_active:true},{},{}),/awaiting review/);
});
test('isolated PostgreSQL: approved independent scopes, replay, stale preview, RLS, rollback, real workbook', {skip:process.env.RETAIL_STORE_IMPORT_POSTGRES!=='1',timeout:180000},async t=>{
 const name='qpms-store-import-'+randomUUID().slice(0,8);
 const docker=args=>execFileSync('docker',args,{encoding:'utf8',stdio:['pipe','pipe','pipe'],maxBuffer:50e6});
 const sql=(s,role='')=>execFileSync('docker',['exec','-i',name,'psql','-U','postgres','-qAt','-v','ON_ERROR_STOP=1'],{input:(role?'set role '+role+';':'')+s,encoding:'utf8',stdio:['pipe','pipe','pipe'],maxBuffer:50e6}).trim();
 const actor='00000000-0000-4000-8000-000000000101';
 const rpc=s=>JSON.parse(sql('select '+s+';','service_role'));
 // Supabase-shaped adapter backed by actual PostgreSQL statements, not mocked persistence.
 const literal=v=>typeof v==='boolean'?String(v):typeof v==='number'?String(v):v&&typeof v==='object'?q(JSON.stringify(v))+'::jsonb':q(v);
 class Query {
  constructor(table){this.table=table;this.conditions=[];this.columns='*';}
  select(v){this.columns=v;return this;}eq(k,v){this.conditions.push(k+'='+literal(v));return this;}is(k,v){this.conditions.push(k+' is '+literal(v));return this;}
  order(k,o={}){this.sort=k+(o.ascending===false?' desc':' asc');return this;}limit(n){this.n=n;return this;}range(a,b){this.offset=a;this.n=b-a+1;return this;}
  single(){this.one=true;return this;}maybeSingle(){this.one=true;return this;}insert(v){this.mode='insert';this.value=v;return this;}update(v){this.mode='update';this.value=v;return this;}
  then(resolve,reject){try{const where=this.conditions.length?' where '+this.conditions.join(' and '):'';let statement;
   if(this.mode){const keys=Object.keys(this.value);statement=this.mode==='insert'?`insert into public.${this.table}(${keys.join(',')}) values(${keys.map(k=>literal(this.value[k])).join(',')})`:`update public.${this.table} set ${keys.map(k=>k+'='+literal(this.value[k])).join(',')}${where}`;statement+=` returning ${this.columns}`;}
   else statement=`select ${this.columns} from public.${this.table}${where}${this.sort?' order by '+this.sort:''}${this.n!=null?' limit '+this.n:''}${this.offset?' offset '+this.offset:''}`;
   const rows=JSON.parse(sql(`with q as (${statement}) select coalesce(jsonb_agg(to_jsonb(q)),'[]') from q;`,'service_role'));return Promise.resolve({data:this.one?rows[0]||null:rows}).then(resolve,reject);
  }catch(error){return Promise.resolve({error}).then(resolve,reject);}}
 }
 const client={from:table=>new Query(table),rpc:async(name,args)=>{try{const call='public.'+name+'('+Object.entries(args).map(([k,v])=>k+'=>'+literal(v)).join(',')+')';return {data:rpc(name==='rpc_retail_attendance_conflicts'?`(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from ${call} x)`:`to_jsonb(${call})`)};}catch(error){return {error};}}};
 const profile={id:actor,role:'ADMIN',is_active:true,status:'Active'};
 const source=()=>rpc(`public.rpc_retail_store_import_source('${actor}')`);
 const book=(code,state='TG',approval='YES')=>{const b=XLSX.utils.book_new();XLSX.utils.book_append_sheet(b,XLSX.utils.aoa_to_sheet([REVIEW_HEADERS,[code,'Synthetic '+code,'City',state,state,'Trends',2,0,0.1,0,0,'2026-04-01','2027-03-31',state+'!2','','CANDIDATE',approval,'REF-1','']]),'STORE UPLOAD REVIEW');return parseStoreReview(XLSX.write(b,{type:'buffer',bookType:'xlsx'}),'test.xlsx');};
 const approve=(p,kind,decision)=>sql(`insert into retail_store_import_approvals(kind,status,file_sha256,row_digest,source_row,store_code,approval_ref,reviewer_id,evidence_sha256,approved_at,decision) values(${q(kind)},'APPROVED',${q(p.checksum)},${q(p.rows[0].row_digest)},2,${q(p.rows[0].store_code)},'REF-1','${actor}',${q('a'.repeat(64))},now()-interval '1 minute',${q(JSON.stringify(decision))}::jsonb);`);
 const stage=p=>{const s=source();const review=validateStoreReview(p,s.stores,{aop:s.aop,decisions:s.decisions});const id=randomUUID(),key=randomUUID();sql(`insert into retail_store_import_batches(id,checksum,filename,original_base64,uploaded_by,preview_key,baseline_stamp,review) values('${id}',${q(p.checksum)},'test.xlsx','test','${actor}','${key}',${q(s.stamp)},${q(JSON.stringify(review))}::jsonb);`,'service_role');return {id,key,review};};
 const confirm=(b,identity=true,aop=false)=>rpc(`public.rpc_confirm_retail_store_import('${actor}','${b.id}','${b.key}',${identity},${aop})`);
 docker(['run','--detach','--name',name,'--network','none','--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17']);
 try{
  let ready=false;for(let i=0;i<60;i++){try{docker(['exec',name,'pg_isready','-h','127.0.0.1','-U','postgres']);ready=true;break;}catch{await new Promise(r=>setTimeout(r,250));}}assert.ok(ready);
  sql(read('backend/tests/fixtures/retailStoreImportBaseline.sql'));
  sql(read('supabase/migrations_2_0/232_reliance_retail_uploaded_attendance.sql'));
  sql(`insert into profiles(id,role,is_active,status) values('${actor}','ADMIN',true,'Active');`);
  const before=sql('select count(*) from reliance_retail_store_master;');sql(read('supabase/proposals/retail_store_aop_upload.sql'));assert.equal(sql('select count(*) from reliance_retail_store_master;'),before);
  await t.test('RLS, ACL and Admin role required at database boundary',()=>{
   for(const table of ['retail_store_import_approvals','retail_store_import_batches','retail_store_import_events'])for(const role of ['anon','authenticated'])assert.throws(()=>sql(`select * from ${table};`,role));
   assert.throws(()=>sql(`select public.rpc_retail_store_import_source('${actor}');`,'authenticated'));
   assert.throws(()=>sql("insert into retail_store_import_approvals default values;",'service_role'));
   sql(`update profiles set role='COO' where id='${actor}';`);assert.throws(()=>source());sql(`update profiles set role='ADMIN' where id='${actor}';`);
  });
  let imported;
  await t.test('TG explicit approved identity adds once, preserving AOP independence and replay receipt',()=>{
   const p=book('TG-TEST');approve(p,'identity',{state:'TG',store_name:'Synthetic TG-TEST',store_status:'Active',operational_model:'SUPERVISOR_ONLY',supervisor_name:'Verified supervisor'});
   const b=stage(p);assert.equal(b.review.identity_ready,1);assert.equal(b.review.aop_ready,0);const r=confirm(b);assert.equal(r.stores.length,1);assert.equal(source().aop.length,0);assert.deepEqual(confirm(b),r);imported={b,r};
  });
  await t.test('NO rows cannot activate even with registry evidence',()=>{
   const p=book('TG-NO','TG','NO');approve(p,'identity',{state:'TG',store_name:'Synthetic TG-NO',store_status:'Active',operational_model:'SUPERVISOR_ONLY',supervisor_name:'Verified'});const b=stage(p);assert.equal(b.review.identity_ready,0);assert.throws(()=>confirm(b),/No approved rows/);
  });
  await t.test('registry drift invalidates preview before any mutation',()=>{
   const p=book('TG-STALE');approve(p,'identity',{state:'TG',store_name:'Synthetic TG-STALE',store_status:'Active',operational_model:'SUPERVISOR_ONLY',supervisor_name:'Verified'});const b=stage(p);sql(`update retail_store_import_approvals set status='REVOKED' where store_code='TG-STALE';`);assert.throws(()=>confirm(b),/changed/);assert.equal(source().stores.filter(s=>s.store_code==='TG-STALE').length,0);
  });
  await t.test('independent effective-dated AOP uses explicit approved totals and rolls back with audit retained',()=>{
   const p=book('TG-TEST');const store=source().stores.find(s=>s.store_code==='TG-TEST');
   // Different original file identity: new reviewed approval reference for AOP scope.
   p.checksum='b'.repeat(64);
   approve(p,'aop',{state:'TG',retail_store_id:store.id,hk_count:2.5,mepc_count:.25,effective_from:'2026-04-01',effective_to:'2027-03-31'});
   const b=stage(p);assert.equal(b.review.aop_ready,1);const r=confirm(b,false,true);assert.equal(r.aop_ids.length,1);assert.equal(source().aop[0].hk_count,2.5);
   const rb=rpc(`public.rpc_rollback_retail_store_import('${actor}','${b.id}','Approved isolated rollback check')`);assert.equal(rb.status,'rolled_back');assert.equal(source().aop.length,0);assert.equal(sql(`select count(*) from retail_store_import_events where batch_id='${b.id}';`),'2');
  });
  const realWorkbook=process.env.RETAIL_STORE_REVIEW_WORKBOOK||new URL('../../import_sources/Reliance_Retail_Store_Master_Audit_Upload_Review.xlsx',import.meta.url);
  await t.test('real workbook stages only pending rows and original canonical IDs remain unchanged',{skip:!existsSync(realWorkbook)},()=>{
   const p=parseStoreReview(readFileSync(realWorkbook),'review.xlsx');const b=stage(p);assert.equal(b.review.total_rows,854);assert.equal(b.review.identity_ready,0);assert.equal(b.review.aop_ready,0);assert.throws(()=>confirm(b),/No approved rows/);
   assert.equal(source().stores.find(s=>s.store_code==='TG-TEST').id,imported.r.stores[0].id);
  });
  await t.test('service stores exact original bytes, returns fresh keys and retries the same file without duplicate batches',async()=>{
   const bytes=readFileSync(realWorkbook);const a=await previewStoreImport(client,profile,bytes,'real-review.xlsx');const b=await previewStoreImport(client,profile,bytes,'real-review.xlsx');assert.equal(a.id,b.id);assert.notEqual(a.preview_key,b.preview_key);assert.equal(a.can_confirm,false);
   assert.equal(sql(`select original_base64 from retail_store_import_batches where id='${a.id}';`),bytes.toString('base64'));
  });
  await t.test('HTTP Admin upload validates real workbook; non-Admin and closed activation are refused',async()=>{
   const app=express();app.use(express.json());app.use('/store-import',(req,res,next)=>{if(!req.get('x-test-admin'))return res.status(401).json({message:'Test session required'});req.profile={...profile,role:req.get('x-test-role')||'ADMIN'};next();},createRetailStoreImportRouter({getClient:()=>client,environment:{}}));
   const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
   try{const base='http://127.0.0.1:'+server.address().port+'/store-import';const bytes=readFileSync(realWorkbook);const headers={'x-test-admin':'1','content-type':'application/octet-stream','x-file-name':'review.xlsx'};
    assert.equal((await fetch(base+'/preview',{method:'POST',headers:{...headers,'x-test-role':'HK MIS'},body:bytes})).status,403);
    assert.equal((await fetch(base+'/history')).status,401);
    const response=await fetch(base+'/preview',{method:'POST',headers,body:bytes});assert.equal(response.status,200);const data=await response.json();assert.equal(data.preview.total_rows,854);assert.equal(data.preview.can_confirm,false);assert.equal(data.activation_enabled,false);
    assert.equal((await fetch(base+'/confirm',{method:'POST',headers:{'x-test-admin':'1','content-type':'application/json'},body:JSON.stringify({id:data.preview.id,preview_key:data.preview.preview_key,identity:true,aop:true})})).status,409);
    if(process.env.RETAIL_STORE_IMPORT_BROWSER==='1'){
     const {createServer}=await import('vite');const {chromium}=await import('@playwright/test');const fs=await import('node:fs/promises');
     await fs.mkdir('artifacts/retail-store-aop-upload-20261028',{recursive:true});const harness='artifacts/retail-store-aop-upload-20261028/browser.html';
     await fs.writeFile(harness,'<html><body><div id="root"></div><script type="module">import "/src/index.css";import React from "react";import{createRoot}from"react-dom/client";import{StoreImportButton}from"/src/components/reliance-retail/StoreImportDialog.jsx";createRoot(document.getElementById("root")).render(React.createElement(StoreImportButton,{onImported:()=>{}}));</script></body></html>');
     const vite=await createServer({optimizeDeps:{entries:[harness]},define:{'import.meta.env.VITE_ENABLE_DEMO_AUTH':'"true"','import.meta.env.VITE_SUPABASE_URL':'""','import.meta.env.VITE_SUPABASE_ANON_KEY':'""'},server:{host:'127.0.0.1',port:0}});await vite.listen();const browser=await chromium.launch({headless:true});
     try{const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(20000);await page.addInitScript(()=>sessionStorage.setItem('qpms-crm-backend-token','isolated-test-session'));await page.route('**/api/reliance-retail/store-import/**',async route=>{const suffix=new URL(route.request().url()).pathname.split('/store-import')[1];const response=await route.fetch({url:base+suffix,headers:{...route.request().headers(),'x-test-admin':'1'}});await route.fulfill({response});});
      await page.goto(vite.resolvedUrls.local[0]+harness);await page.getByRole('button',{name:'Upload Store Master & AOP'}).click();await page.getByLabel('Store Master and AOP Excel file').setInputFiles({name:'review.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:bytes});await page.getByRole('button',{name:'Validate and Preview'}).click();await page.getByText(/854 source rows/).waitFor();assert.equal(await page.getByRole('button',{name:'Confirm Import'}).isDisabled(),true);await page.getByLabel('Filter store conflicts').fill('U1KA');assert.equal(await page.getByRole('cell',{name:'U1KA',exact:true}).count(),2);await page.screenshot({path:'artifacts/retail-store-aop-upload-20261028/browser-review.png',fullPage:true});
     }finally{await browser.close();await vite.close();}
    }
   }finally{await new Promise(r=>server.close(r));}
  });
  await t.test('approved additions recover only previously unmatched attendance; replay cannot double count',async()=>{
   const w=XLSX.utils.book_new();XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet([['EP No','EP Name','Site Code','Att. Date','Att. Status','Class'],['REC-E1','Synthetic','TG-TEST','2026-10-27','P','MEPC'],['REC-E2','Synthetic','TG-RECOVER','2026-10-27','P','MEPC']]),'Attendance');
   const original=await previewRetailAttendance(client,profile,XLSX.write(w,{type:'buffer',bookType:'xlsx'}),'original.xlsx');assert.equal(original.valid_rows,1);assert.equal(original.rejected_rows,1);await commitRetailAttendance(client,profile,{id:original.id,preview_key:original.preview_key,replace:false});
   const p=book('TG-RECOVER');approve(p,'identity',{state:'TG',store_name:'Synthetic TG-RECOVER',store_status:'Active',operational_model:'SUPERVISOR_ONLY',supervisor_name:'Verified'});const b=stage(p);confirm(b);
   const args={store_batch_id:b.id,attendance_batch_id:original.id};const recovery=await previewStoreAttendanceRecovery(client,profile,args);assert.equal(recovery.valid_rows,1);assert.equal(recovery.can_commit,true);
   await assert.rejects(()=>confirmStoreAttendanceRecovery(client,profile,recovery,{}),/separate preview approval/);
   const env={RETAIL_STORE_ATTENDANCE_REPROCESS_ENABLED:'true'};await confirmStoreAttendanceRecovery(client,profile,recovery,env);await confirmStoreAttendanceRecovery(client,profile,recovery,env);
   assert.equal(sql("select sum(credit) from retail_employee_daily_attendance where employee_code='REC-E2' and superseded_at is null;"),'1.0');
   const replay=await previewStoreAttendanceRecovery(client,profile,args);assert.equal(replay.id,recovery.id);assert.equal(replay.idempotent,true);
  });
  await t.test('identity rollback is compensating, evidence immutable, repeated rollback idempotent',()=>{
   assert.throws(()=>rpc(`public.rpc_rollback_retail_store_import('${actor}','${imported.b.id}','Referenced identity must stay preserved')`),/referenced/);
   const p=book('TG-ROLLBACK');approve(p,'identity',{state:'TG',store_name:'Synthetic TG-ROLLBACK',store_status:'Active',operational_model:'SUPERVISOR_ONLY',supervisor_name:'Verified'});const b=stage(p);confirm(b);
   const call=`public.rpc_rollback_retail_store_import('${actor}','${b.id}','Approved isolated identity rollback')`;assert.equal(rpc(call).status,'rolled_back');assert.equal(rpc(call).status,'rolled_back');assert.equal(source().stores.find(s=>s.store_code==='TG-ROLLBACK').status,'Inactive');
   assert.throws(()=>sql(`delete from retail_store_import_batches where id='${b.id}';`));assert.throws(()=>sql(`update retail_store_import_events set action='tampered';`));
  });
 }finally{docker(['rm','--force',name]);}
});
