import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync,spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
const sqlFile=p=>readFileSync(new URL('../sql/'+p,import.meta.url),'utf8');
test('real PostgreSQL: October ledger constraints, RLS/ACL, concurrency and no financial posting',{skip:process.env.OCTOBER_CLAIMS_POSTGRES!=='1',timeout:180000},async t=>{
 const name='qpms-october-release-'+randomUUID().slice(0,8);
 const docker=args=>execFileSync('docker',args,{encoding:'utf8',stdio:['pipe','pipe','pipe']});
 const sql=(text,role='')=>execFileSync('docker',['exec','-i',name,'psql','-U','postgres','-qAt','-v','ON_ERROR_STOP=1'],{input:(role?'set role '+role+';\n':'')+text,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
 const a='00000000-0000-4000-8000-000000000001',r='00000000-0000-4000-8000-000000000002',actor='00000000-0000-4000-8000-000000000003';
 const insert=(id=r,km='1.10',included='0',attendance=a)=>`insert into public.fo_missing_km_admin_decisions values('${id}','${attendance}','FO1','approved_for_reconciliation',${km},${included},'Synthetic verified evidence only','synthetic-reference','${actor}',now());`;
 docker(['run','--detach','--name',name,'--network','none','--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17']);
 try{
  let ready=false;for(let n=0;n<100;n++){try{docker(['exec',name,'pg_isready','-h','127.0.0.1','-U','postgres']);ready=true;break}catch{await new Promise(r=>setTimeout(r,200))}}assert.ok(ready);
  sql(`create role anon;create role authenticated;create role service_role bypassrls;create table public.fo_attendance(id uuid primary key,employee_code text,attendance_date date,eligible_km numeric(12,2),petrol_amount numeric(12,2));create table public.fo_missing_km_reviews(id uuid primary key,attendance_id uuid references public.fo_attendance(id),employee_code text,status text,suggested_missing_km numeric(12,2));create table public.fo_oct2026_claim_adjustments(employee_code text primary key);grant select,update on public.fo_attendance,public.fo_missing_km_reviews to service_role;insert into public.fo_attendance values('${a}','FO1','2026-10-01',10.25,35);insert into public.fo_missing_km_reviews values('${r}','${a}','FO1','pending',2.34);`);
  sql(sqlFile('20261104_october_missing_km_admin_decisions.sql'));
  const migration=sqlFile('20261104_october_missing_km_release_hardening.sql');sql(migration);sql(migration);
  const before=sql('select row_to_json(a) from public.fo_attendance a;');
  await t.test('anonymous/authenticated have no direct ledger access, service role has append-only privileges',()=>{
   for(const role of ['anon','authenticated'])assert.throws(()=>sql('select * from public.fo_missing_km_admin_decisions;',role));
   assert.equal(sql("select has_table_privilege('service_role','public.fo_missing_km_admin_decisions','SELECT') and has_table_privilege('service_role','public.fo_missing_km_admin_decisions','INSERT') and not has_table_privilege('service_role','public.fo_missing_km_admin_decisions','UPDATE') and not has_table_privilege('service_role','public.fo_missing_km_admin_decisions','DELETE');"),'t');
   assert.equal(sql("select relrowsecurity from pg_class where oid='public.fo_missing_km_admin_decisions'::regclass;"),'t');
   assert.equal(sql("select has_table_privilege('service_role','public.fo_oct2026_claim_adjustments','SELECT');"),'t');
  });
  await t.test('negative, excessive and mismatched evidence is rejected by the database',()=>{
   for(const[amount,included]of [['-1','0'],['3','0'],['1','-1'],['1','11'],['1','null']])assert.throws(()=>sql(insert(r,amount,included),'service_role'));
   sql(`update public.fo_attendance set attendance_date='2026-09-30' where id='${a}';`);assert.throws(()=>sql(insert(),'service_role'));sql(`update public.fo_attendance set attendance_date='2026-10-01' where id='${a}';`);
   sql(`update public.fo_missing_km_reviews set status='approved' where id='${r}';`);assert.throws(()=>sql(insert(),'service_role'));sql(`update public.fo_missing_km_reviews set status='pending' where id='${r}';`);
   assert.equal(sql('select count(*) from public.fo_missing_km_admin_decisions;'),'0');
  });
  await t.test('concurrent duplicate decisions create exactly one immutable decision',async()=>{
   const run=()=>new Promise(resolve=>{const p=spawn('docker',['exec','-i',name,'psql','-U','postgres','-qAt','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']});p.stdout.resume();p.stderr.resume();p.on('close',code=>resolve(code));p.stdin.end('set role service_role;'+insert())});
   const codes=await Promise.all([run(),run()]);assert.equal(codes.filter(c=>c===0).length,1);assert.equal(sql('select count(*) from public.fo_missing_km_admin_decisions;'),'1');
   assert.throws(()=>sql('update public.fo_missing_km_admin_decisions set approved_additional_km=2;','service_role'));
   assert.throws(()=>sql('delete from public.fo_missing_km_admin_decisions;','service_role'));
  });
  assert.equal(sql('select row_to_json(a) from public.fo_attendance a;'),before);
 }finally{docker(['rm','--force',name])}
});
