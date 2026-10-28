import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync, spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import XLSX from 'xlsx';
import express from 'express';
import {createRetailAttendanceRouter} from '../routes/retailAttendanceRoutes.js';
import {parseAttendanceWorkbook,validateAttendanceRows,previewRetailAttendance,commitRetailAttendance,retailAttendanceReport,retailAttendanceHistory} from '../services/retailAttendanceService.js';
import {dailyTarget} from '../shared/retailAttendance.js';
import {attendanceExportRows} from '../../src/utils/retailAttendanceExport.js';

const quote=value=>value==null?'NULL':"'"+String(value).replaceAll("'","''")+"'";
const admin={id:'00000000-0000-4000-8000-000000000001',role:'ADMIN',is_active:true};
const stores=[{id:'00000000-0000-4000-8000-000000000002',store_code:'S1',store_name:'Synthetic TN',state:'TN',status:'Active'},{id:'00000000-0000-4000-8000-000000000003',store_code:'S2',store_name:'Synthetic PY',state:'PY',status:'Active'}];
const row={employee_code:'E1',employee_name:'Synthetic employee',store_code:'S1',attendance_date:'2026-09-28',original_status:'P',class:'House Keeping',source_row:2};
function workbook(rows){const b=XLSX.utils.book_new();XLSX.utils.book_append_sheet(b,XLSX.utils.aoa_to_sheet([['EP No','EP Name','Site Code','Att. Date','Att. Status','Class','Source evidence'],...rows]),'Attend Status Temp Report');return XLSX.write(b,{type:'buffer',bookType:'xlsx'});}

test('Phase 1: excluded classes do not block valid rows, multi-site daily cap and duplicate conflicts retain provenance',()=>{
  const out=validateAttendanceRows([row,{...row,class:'Goods Receiving',source_row:3}],stores);
  assert.equal(out.valid.length,1);assert.equal(out.excluded.length,1);assert.equal(out.rejected.length,0);
  const halves=validateAttendanceRows([{...row,original_status:'HD'},{...row,store_code:'S2',source_row:3,original_status:'H-HD'}],stores);
  assert.equal(halves.valid.length,2);assert.equal(halves.valid.reduce((n,r)=>n+r.credit,0),1);
  const conflict=validateAttendanceRows([row,{...row,store_code:'S2',source_row:3}],stores);
  assert.equal(conflict.valid.length,0);assert.equal(conflict.rejected.length,2);
  const duplicate=validateAttendanceRows([row,{...row,source_row:3}],stores);
  assert.equal(duplicate.rejected.length,2);
});
test('Phase 1: weekly-off planning cycle examples and approved shifted anchor never imply actual employee absence',()=>{
  for(const [day,expected] of [[8,7],[15,13]])assert.equal(Array.from({length:day},(_,i)=>dailyTarget(1,`2026-09-${String(i+1).padStart(2,'0')}`,'MEPC')).reduce((a,b)=>a+b),expected);
  assert.equal(dailyTarget(1,'2026-09-07','MEPC','2026-09-03'),1);
  assert.equal(dailyTarget(1,'2026-09-09','MEPC','2026-09-03'),0);
});
test('Phase 1: source columns and formula evidence survive parsing',()=>{
  const p=parseAttendanceWorkbook(workbook([['E1','Employee','S1','2026-09-28','P','House Keeping','original note']]),'source.xlsx');
  assert.equal(p.headers.length,7);assert.equal(p.rows[0].raw_cells[6],'original note');assert.equal(p.rows[0].source_row,2);
});

test('Phase 1 real isolated PostgreSQL: upload, preview, import, report, corrections, concurrency and audit', {skip:process.env.RETAIL_ATTENDANCE_POSTGRES!=='1',timeout:180000},async t=>{
  const name='qpms-retail-phase1-'+randomUUID().slice(0,8);
  const docker=args=>execFileSync('docker',args,{encoding:'utf8',stdio:['pipe','pipe','pipe'],maxBuffer:100*1024*1024});
  function sql(statement,role=''){return execFileSync('docker',['exec','-i',name,'psql','-U','postgres','-d','postgres','-qAt','-v','ON_ERROR_STOP=1'],{input:(role?'set role '+role+';\n':'')+statement,encoding:'utf8',maxBuffer:100*1024*1024,stdio:['pipe','pipe','pipe']}).trim();}
  function records(statement){const output=sql('select coalesce(jsonb_agg(to_jsonb(q)),\'[]\'::jsonb) from ('+statement+') q;','service_role');return JSON.parse(output);}
  // Test adapter runs real SQL through a network-disabled PostgreSQL container. It does not mock persistence.
  class Query{
    constructor(table){this.table=table;this.filters=[];this.columns='*';this.mode='read';this.singular=false;}
    select(columns='*'){this.columns=columns;return this;}eq(k,v){this.filters.push(k+'='+quote(v));return this;}is(k,v){this.filters.push(k+' is '+(v===null?'null':quote(v)));return this;}
    in(k,values){this.filters.push(values.length?k+' in ('+values.map(quote).join(',')+')':'false');return this;}
    order(k,o={}){this.sort=k+(o.ascending===false?' desc':' asc');return this;}range(a,b){this.offset=a;this.limitCount=b-a+1;return this;}limit(n){this.limitCount=n;return this;}
    insert(v){this.mode='insert';this.value=v;return this;}update(v){this.mode='update';this.value=v;return this;}
    single(){this.singular=true;return this;}maybeSingle(){this.singular=true;return this;}
    then(resolve,reject){try{const jsonValue=v=>v&&typeof v==='object'?quote(JSON.stringify(v))+'::jsonb':quote(v);const where=this.filters.length?' where '+this.filters.join(' and '):'';let statement;
      if(this.mode==='read')statement='select '+this.columns+' from public.'+this.table+where+(this.sort?' order by '+this.sort:'')+(this.limitCount!=null?' limit '+this.limitCount:'')+(this.offset?' offset '+this.offset:'');
      else{const keys=Object.keys(this.value);const mutation=this.mode==='insert'?'insert into public.'+this.table+'('+keys.join(',')+') values ('+keys.map(k=>jsonValue(this.value[k])).join(',')+')':'update public.'+this.table+' set '+keys.map(k=>k+'='+jsonValue(this.value[k])).join(',')+where;
        const result=sql('with q as ('+mutation+' returning '+this.columns+") select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) from q;",'service_role');const rows=JSON.parse(result);return Promise.resolve({data:this.singular?rows[0]||null:rows}).then(resolve,reject);}
      const rows=records(statement);return Promise.resolve({data:this.singular?rows[0]||null:rows}).then(resolve,reject);
    }catch(error){return Promise.resolve({data:null,error}).then(resolve,reject);}}
  }
  const client={from:table=>new Query(table),rpc:async(name,args)=>{try{const pairs=Object.entries(args).map(([k,v])=>k+'=>'+(Array.isArray(v)?k==='p_store_ids'?"array["+v.map(quote).join(',')+"]::uuid[]":quote(JSON.stringify(v))+'::jsonb':typeof v==='boolean'?String(v):quote(v)));const call='public.'+name+'('+pairs.join(',')+')';const output=sql(name==='rpc_retail_attendance_conflicts'?"select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from "+call+' r;':'select to_jsonb('+call+');','service_role');return{data:JSON.parse(output)};}catch(error){return{error};}}};
  docker(['run','--detach','--name',name,'--network','none','--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17']);
  try{
    let ready=false;for(let n=0;n<60;n++){try{docker(['exec',name,'pg_isready','-U','postgres']);ready=true;break;}catch{await new Promise(r=>setTimeout(r,250));}}assert.ok(ready);
    sql(`create role anon;create role authenticated;create role service_role bypassrls;create table public.profiles(id uuid primary key,role text,designation text,department text,is_active boolean);create table public.reliance_retail_store_master(id uuid primary key,store_code text,store_name text,state text,status text);grant select on public.profiles,public.reliance_retail_store_master to service_role;insert into public.profiles values('${admin.id}','ADMIN',null,null,true);`);
    for(const s of stores)sql(`insert into public.reliance_retail_store_master values(${Object.values(s).map(quote).join(',')});`);
    sql(readFileSync(new URL('../../supabase/migrations_2_0/232_reliance_retail_uploaded_attendance.sql',import.meta.url),'utf8'));
    let initial;
    await t.test('real service preview retains every source row; all valid dates imported despite excluded/unmatched rows',async()=>{
      const bytes=workbook([['E1','Synthetic employee','S1','2026-09-28','P','House Keeping','keep me'],['E2','Synthetic employee','S2','2026-09-29','HD','MEPC','PY evidence'],['G1','Excluded','S1','2026-09-28','P','Goods Receiving','excluded raw'],['U1','Unknown','UNKNOWN','2026-09-29','P','MEPC','unmatched raw']]);
      initial=await previewRetailAttendance(client,admin,bytes,'multi-date.xlsx');assert.equal(initial.can_commit,true);assert.equal(initial.valid_rows,2);assert.equal(initial.excluded_rows,1);assert.equal(initial.rejected_rows,1);assert.deepEqual(initial.dates,['2026-09-28','2026-09-29']);
      await commitRetailAttendance(client,admin,{id:initial.id,replace:false,reason:'',preview_key:initial.preview_key});
      assert.equal(records('select * from public.retail_employee_daily_attendance').length,2);
      const replay=await previewRetailAttendance(client,admin,bytes,'multi-date.xlsx');assert.equal(replay.idempotent,true);assert.equal(replay.id,initial.id);
      const history=await retailAttendanceHistory(client,admin,{id:initial.id});assert.equal(history.raw_source.rows.length,4);assert.equal(history.raw_source.rows[0].raw_cells[6],'keep me');
      await assert.rejects(()=>retailAttendanceHistory(client,{id:'00000000-0000-4000-8000-000000000099',role:'HK MIS',business:'Reliance Retail',state:'TN'},{}),{statusCode:403});
    });
    await t.test('latest imported date, PY geographic preservation, AOP N/A and export reconciliation',async()=>{
      const report=await retailAttendanceReport(client,admin,{view:'daily'});assert.equal(report.cutoff,'2026-09-29');assert.equal(report.total.total_actual,.5);assert.equal(report.employee_counts.unique_employees,1);assert.equal(report.employee_counts.employee_days,1);assert.equal(report.total.overall_pct,null);assert.equal(report.total.shortfall,null);assert.equal(report.stores.find(s=>s.store_code==='S2').source_state,'PY');assert.equal(report.states[0].state,'TN');assert.equal(attendanceExportRows(report,'consolidated')[1][6],.5);
    });
    await t.test('half-day multi-site attendance totals 1; direct over-credit is refused by PostgreSQL',async()=>{
      const p=await previewRetailAttendance(client,admin,workbook([['SPLIT','Split','S1','2026-09-29','HD','House Keeping','first half'],['SPLIT','Split','S2','2026-09-29','HD','House Keeping','second half']]),'split.xlsx');assert.equal(p.valid_rows,2);assert.equal(p.affected_records.length,0);await commitRetailAttendance(client,admin,{id:p.id,replace:false,preview_key:p.preview_key});assert.equal(Number(records("select sum(credit) as n from public.retail_employee_daily_attendance where employee_code='SPLIT' and superseded_at is null")[0].n),1);const report=await retailAttendanceReport(client,admin,{view:'daily'});assert.equal(report.employee_counts.employee_days,2);assert.equal(report.total.total_actual,1.5);
      assert.throws(()=>sql(`insert into public.retail_employee_daily_attendance(attendance_date,employee_code,employee_name,retail_store_id,store_code_snapshot,class,original_status,credit,batch_id,source_row) values('2026-09-29','SPLIT','Split','${stores[0].id}','S1','HK','HD',.5,'${p.id}',5);`,'service_role'));
    });
    await t.test('correction reason required, stale preview denied, superseded rows retained and current values accurate',async()=>{
      const correction=workbook([['E1','Synthetic employee','S1','2026-09-28','HD','House Keeping','corrected source']]);
      const a=await previewRetailAttendance(client,admin,correction,'corrected.xlsx');assert.equal(a.affected_records.length,1);
      await assert.rejects(()=>commitRetailAttendance(client,admin,{id:a.id,replace:false,preview_key:a.preview_key}));
      const b=await previewRetailAttendance(client,admin,workbook([['E1','Synthetic employee','S1','2026-09-28','A','House Keeping','new correction']]),'new-correction.xlsx');
      await commitRetailAttendance(client,admin,{id:a.id,replace:true,reason:'Verified corrected source',preview_key:a.preview_key});
      await assert.rejects(()=>commitRetailAttendance(client,admin,{id:b.id,replace:true,reason:'Stale',preview_key:b.preview_key}));
      const rows=records("select credit,superseded_at from public.retail_employee_daily_attendance where employee_code='E1'");assert.equal(rows.length,2);assert.equal(rows.filter(r=>!r.superseded_at)[0].credit,.5);
      assert.throws(()=>sql(`update public.retail_attendance_uploads set filename='tampered' where id='${a.id}';`,'service_role'));
      assert.throws(()=>sql("update public.retail_employee_daily_attendance set superseded_at=null where employee_code='E1' and superseded_at is not null;",'service_role'));
    });
    await t.test('failed replacement rolls back supersession and preserves committed baseline',async()=>{
      const bad=await previewRetailAttendance(client,admin,workbook([['E1','Synthetic employee','S1','2026-09-28','P','House Keeping','invalidated fixture']]),'rollback.xlsx');
      sql(`update public.retail_attendance_uploads set payload=jsonb_set(payload,'{0,source_row}','0') where id='${bad.id}';`);
      await assert.rejects(()=>commitRetailAttendance(client,admin,{id:bad.id,replace:true,reason:'Rollback check',preview_key:bad.preview_key}));
      assert.equal(records("select credit from public.retail_employee_daily_attendance where employee_code='E1' and superseded_at is null")[0].credit,.5);
    });
    await t.test('two independent PostgreSQL sessions cannot exceed a daily credit of 1',async()=>{
      const run=statement=>new Promise((resolve,reject)=>{const child=spawn('docker',['exec','-i',name,'psql','-U','postgres','-d','postgres','-qAt','-v','ON_ERROR_STOP=1']);let error='';child.stderr.on('data',b=>error+=b);child.on('error',reject);child.on('close',code=>code?reject(new Error(error)):resolve());child.stdin.end(statement);});
      const insert=(store,status,credit)=>"insert into public.retail_employee_daily_attendance(attendance_date,employee_code,employee_name,retail_store_id,store_code_snapshot,class,original_status,credit,batch_id,source_row) values('2026-09-29','RACE','Concurrent test','"+store.id+"','"+store.store_code+"','HK','"+status+"',"+credit+",'"+initial.id+"',6);";
      const a=run('begin;set role service_role;'+insert(stores[0],'HD',.5)+'select pg_sleep(.3);commit;');
      const b=run('begin;set role service_role;'+insert(stores[1],'P',1)+'commit;');
      const results=await Promise.allSettled([a,b]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.match(results.find(r=>r.status==='rejected').reason.message,/cannot exceed 1/);
      assert.ok(Number(records("select sum(credit) as n from public.retail_employee_daily_attendance where employee_code='RACE' and superseded_at is null")[0].n)<=1);
    });
    await t.test('October reference workbook imports every supported date with unmatched and excluded source rows retained',async()=>{
      const archived=JSON.parse(readFileSync(new URL('../../artifacts/retail-attendance-aop-review-20261022/read-only-source.json',import.meta.url),'utf8')).reliance_retail_store_master;
      sql('insert into public.reliance_retail_store_master(id,store_code,store_name,state,status) values '+archived.map(s=>'('+[s.id,s.store_code,s.store_name,s.state,s.status].map(quote).join(',')+')').join(',')+';');
      const bytes=readFileSync(new URL('../../artifacts/reliance-attendance-reference/attendance-sample.xlsx',import.meta.url));
      const preview=await previewRetailAttendance(client,admin,bytes,'october-reference.xlsx');assert.equal(preview.valid_rows,7100);assert.equal(preview.rejected_rows,260);assert.equal(preview.excluded_rows,20);assert.equal(preview.dates.length,20);
      await commitRetailAttendance(client,admin,{id:preview.id,replace:false,preview_key:preview.preview_key});
      assert.equal(Number(records("select count(*) as n from public.retail_employee_daily_attendance where batch_id='"+preview.id+"'")[0].n),7100);
      const report=await retailAttendanceReport(client,admin,{view:'daily'});assert.equal(report.cutoff,'2026-10-20');assert.equal(report.total.overall_pct,null);assert.equal(report.total.shortfall,null);
      const ledger=records("select sum(credit) as n from public.retail_employee_daily_attendance where superseded_at is null and attendance_date='2026-10-20'");assert.equal(report.total.total_actual,Number(ledger[0].n));
    });
    await t.test('local HTTP upload -> preview -> commit -> dashboard -> history uses real PostgreSQL',async()=>{
      const app=express();app.use(express.json());
      app.use('/attendance',(req,res,next)=>{if(req.get('x-isolated-test-session')!=='synthetic-admin')return res.status(401).json({message:'Test authentication required'});req.profile=admin;next();},createRetailAttendanceRouter({getClient:()=>client,environment:{RETAIL_ATTENDANCE_ENABLED:'true'}}));
      const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
      try{
        const base='http://127.0.0.1:'+server.address().port+'/attendance';
        assert.equal((await fetch(base+'/summary')).status,401);
        const headers={'x-isolated-test-session':'synthetic-admin'};
        const bytes=workbook([['HTTP','HTTP fixture','S1','2026-09-29','P','House Keeping','full HTTP flow']]);
        const response=await fetch(base+'/preview',{method:'POST',headers:{...headers,'content-type':'application/octet-stream','x-file-name':'http-fixture.xlsx'},body:bytes});assert.equal(response.status,200);const p=(await response.json()).preview;assert.equal(p.can_commit,true);
        const commit=await fetch(base+'/commit',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({id:p.id,preview_key:p.preview_key,replace:false})});assert.equal(commit.status,200);
        const report=(await(await fetch(base+'/summary?cutoff=2026-09-29&view=daily',{headers})).json()).report;
        const total=Number(records("select sum(credit) as n from public.retail_employee_daily_attendance where attendance_date='2026-09-29' and superseded_at is null")[0].n);assert.equal(report.total.total_actual,total);assert.equal(attendanceExportRows(report,'consolidated')[1][6],total);
        const history=(await(await fetch(base+'/history?id='+p.id,{headers})).json()).history;assert.equal(history.status,'committed');assert.equal(history.raw_source.rows[0].raw_cells[6],'full HTTP flow');
        const retry=await fetch(base+'/commit',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({id:p.id,preview_key:p.preview_key,replace:false})});assert.equal(retry.status,200);assert.equal(records("select * from public.retail_employee_daily_attendance where employee_code='HTTP'").length,1);
        if(process.env.RETAIL_ATTENDANCE_BROWSER==='1') {
          const {preview}=await import('vite');const {chromium}=await import('@playwright/test');const {resolve}=await import('node:path');
          const frontend=await preview({configFile:false,root:process.cwd(),build:{outDir:resolve('artifacts/retail-attendance-phase1-20261028/web-build')},preview:{host:'127.0.0.1',port:4192,strictPort:true}});
          let browser;
          try{
            browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:900},acceptDownloads:true});
            await page.addInitScript(()=>{localStorage.setItem('qpms-crm-auth-user',JSON.stringify({id:'synthetic-admin',profileId:'synthetic-profile',name:'Local Test Admin',role:'Admin',rawRole:'Admin',status:'Active',isActive:true,webAccessEnabled:true,authProvider:'demo-fixture',is_demo:true,isDemoReadOnly:true,read_only:false}));sessionStorage.setItem('qpms-crm-backend-token','synthetic-local-test-token');});
            await page.route('**/api/**',async route=>{const u=new URL(route.request().url());if(u.pathname.includes('/attendance/')){const response=await route.fetch({url:base+u.pathname.split('/attendance')[1]+u.search,headers:{...route.request().headers(),...headers}});return route.fulfill({response});}return route.fulfill({json:{}});});
            await page.goto('http://127.0.0.1:4192/reliance-retail/attendance');await page.getByRole('button',{name:'Upload Day Attendance'}).click();
            await page.getByLabel('Attendance Excel file').setInputFiles({name:'browser-real.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:workbook([['BROWSER','Browser fixture','S1','2026-10-21','P','House Keeping','browser to real PostgreSQL']])});
            await page.getByRole('button',{name:'Validate and Preview'}).click();await page.getByRole('button',{name:'Confirm Import'}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
            await page.waitForFunction(()=>globalThis.document.querySelector('input[aria-label="Attendance cutoff date"]')?.value==='2026-10-21');await page.getByRole('tab',{name:'Daily View'}).click();
            await page.getByRole('heading',{name:'Daily Attendance (2026-10-21)',exact:true}).waitFor();
            const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Export',exact:true}).click();const download=await downloadPromise;
            const ExcelJS=(await import('exceljs')).default;const exported=new ExcelJS.Workbook();await exported.xlsx.readFile(await download.path());assert.equal(exported.getWorksheet('Attendance').lastRow.getCell(7).value,1);
            assert.equal(records("select credit from public.retail_employee_daily_attendance where employee_code='BROWSER' and superseded_at is null")[0].credit,1);
            await page.screenshot({path:'artifacts/retail-attendance-phase1-20261028/real-postgres-browser.png',fullPage:true});
            console.log('REAL_BROWSER_POSTGRES_FLOW=PASS; saved credit=1; latest date=2026-10-21; exported total=1');
          }finally{if(browser)await browser.close();frontend.httpServer.closeAllConnections?.();await new Promise(resolve=>frontend.httpServer.close(resolve));}
        }
      }finally{await new Promise(resolve=>server.close(resolve));}
    });
    await t.test('RLS / privileges deny untrusted direct reads and writes',()=>{
      assert.throws(()=>sql('select * from public.retail_employee_daily_attendance;','authenticated'));
      assert.throws(()=>sql(`select public.rpc_commit_retail_attendance_upload('${initial.id}','${admin.id}',false,null,null);`,'anon'));
    });
  }finally{docker(['rm','--force',name]);}
});
