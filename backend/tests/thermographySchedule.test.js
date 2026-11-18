import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import ExcelJS from 'exceljs';
import {thermoFixture} from './helpers/thermographyFixture.js';
import {parseSchedule,scheduleRpc,scheduleUpload} from '../services/thermographySchedule.js';
import {thermoServiceFixture} from './helpers/thermographyServiceFixture.js';

async function workbook(rows,format='@'){
 const book=new ExcelJS.Workbook(),s=book.addWorksheet('Schedule');s.addRow(['Store Code','Scheduled Date']);s.getColumn(1).numFmt=format;s.getColumn(2).numFmt='dd-mm-yyyy';for(const row of rows)s.addRow(row);return Buffer.from(await book.xlsx.writeBuffer());
}
test('two-column Excel parser preserves text/leading zeros, formatted numeric codes, dates and repeated stores on different dates',async()=>{
 const rows=parseSchedule(await workbook([['0012',new Date('2026-11-19T00:00:00Z')],['A12','20-11-2026'],['0012','21-11-2026']]),'any filename.xlsx','2026-11');
 assert.deepEqual(rows.map(r=>[r.store_code,r.scheduled_date,r.error]),[['0012','2026-11-19',null],['A12','2026-11-20',null],['0012','2026-11-21',null]]);
 assert.equal(parseSchedule(await workbook([[12,'19-11-2026']],'0000'),'schedule.xlsx','2026-11')[0].store_code,'0012');
 const invalid=parseSchedule(await workbook([['0012','31-11-2026'],['0012','01-12-2026'],['0012','19-11-2026'],['0012','19-11-2026'],[{formula:'1+1',result:2},'20-11-2026']]),'schedule.xlsx','2026-11');
 assert.ok(invalid.every((r,i)=>i===2||r.error));assert.match(invalid[3].error,/Duplicate/);assert.match(invalid[4].error,/Formulas/);
 await assert.rejects(async()=>parseSchedule(await workbook([]),'schedule.xlsx','2026-11'),/no inspection/);
});
test('actual SQL import: canonical mapping, preview, mandatory exception reason, idempotency and conflicts never overwrite',async()=>{
 const h=await thermoServiceFixture();try{
  const month=h.today.slice(0,7),day=month+'-01',bytes=await workbook([['0012',day.split('-').reverse().join('-')],['0012',(month+'-02').split('-').reverse().join('-')]]);
  const headers={'x-schedule-filename':'arbitrary.xlsx','x-schedule-month':month},preview=await scheduleUpload(h.client,h.profile,'preview',bytes,headers);
  assert.equal(preview.valid,2);assert.equal(preview.rejected,0);assert.equal(preview.rows[0].store_id,h.ids.store);assert.equal(preview.rows[0].state,'TN');assert.equal(preview.rows[0].store_name,'SYNTHETIC TN STORE');
  headers['x-request-id']=randomUUID();headers['x-preview-digest']=preview.preview_digest;
  if(preview.requires_reason)await assert.rejects(scheduleUpload(h.client,h.profile,'import',bytes,headers),/reason required/);
  headers['x-upload-reason']='Synthetic%20late%20validation';const imported=await scheduleUpload(h.client,h.profile,'import',bytes,headers);assert.equal(imported.count,2);
  assert.deepEqual(await scheduleUpload(h.client,h.profile,'import',bytes,headers),imported);assert.equal((await h.db.query('select count(*)::int n from retail_thermography_inspections')).rows[0].n,2);
  assert.equal((await scheduleRpc(h.client,h.profile,'history'))[0].count,2);assert.equal((await scheduleRpc(h.client,h.other,'history')).length,0);
  const conflict=await scheduleUpload(h.client,h.profile,'preview',bytes,headers);assert.equal(conflict.rejected,2);
  await assert.rejects(scheduleUpload(h.client,h.profile,'import',bytes,{...headers,'x-request-id':randomUUID()}),/Preview changed/);
  await assert.rejects(h.call(h.ids.admin,'schedule',{store_id:h.ids.store,date:day,request_id:randomUUID()}),/already scheduled/);
  const id=imported.inspections[0].id;await h.db.query("update profiles set role='Admin' where id=$1",[h.ids.admin]);
  await assert.rejects(h.db.query("select rpc_retail_thermography_command($1,'Completed',null,$2,null,1,$3)",[h.ids.admin,id,randomUUID()]),/report contract|managed|Thermography/i);
  assert.equal((await h.row(id)).status,'Scheduled');
  assert.equal((await h.db.query("select has_function_privilege('authenticated','rpc_retail_thermography_schedule(uuid,text,jsonb)','execute') allowed")).rows[0].allowed,false);
  assert.equal((await h.db.query("select has_table_privilege('authenticated','retail_thermography_schedule_imports','select') allowed")).rows[0].allowed,false);
 }finally{await h.db.close();}
});
test('actual SQL denies HK, inactive/cross-business users, cross-state imports, ambiguity and unsupported actions; AP partitions remain distinct',async()=>{
 const f=await thermoFixture();try{
  const rpc=(actor,action,data={})=>f.db.query('select rpc_retail_thermography_schedule($1,$2,$3::jsonb) result',[actor,action,JSON.stringify(data)]).then(r=>r.rows[0].result);
  const data={month:f.today.slice(0,7),filename:'schedule.xlsx',sha256:'a'.repeat(64),rows:[{row:2,store_code:'0099',scheduled_date:f.today}]};
  assert.equal((await rpc(f.ids.mepc,'preview',data)).rejected,1);
  await assert.rejects(rpc(f.ids.hk,'preview',data),/access required/);await assert.rejects(rpc(f.ids.central,'preview',data),/MEPC MIS/);await assert.rejects(rpc(f.ids.mepc,'delete',data),/Unsupported/);
  const ap1=randomUUID(),ap2=randomUUID();await f.db.query("insert into reliance_retail_store_master(id,store_code,store_name,state) values($1,'AP01','AP1 synthetic','AP-1'),($2,'AP02','AP2 synthetic','AP-2')",[ap1,ap2]);
  await f.db.query("update retail_mis_assignments set states=array['TN','AP-1'] where profile_id=$1",[f.ids.mepc]);
  const preview=await rpc(f.ids.mepc,'preview',{...data,rows:[{row:2,store_code:'AP01',scheduled_date:f.today},{row:3,store_code:'AP02',scheduled_date:f.today},{row:4,store_code:'0012',scheduled_date:f.today}]});
  assert.deepEqual(preview.rows.map(r=>[r.state,!!r.error]),[['AP-1',false],[null,true],['TN',false]]);
  for(const [month,expected] of [['2026-03','2026-02-28'],['2028-03','2028-02-29'],['2026-05','2026-04-30']]){
   const p=await rpc(f.ids.mepc,'preview',{...data,month,rows:[{row:2,store_code:'0012',scheduled_date:month+'-01'}]});assert.equal(p.expected_upload_date,expected);
  }
  await f.db.query("insert into reliance_retail_store_master(id,store_code,store_name,state) values($1,'ap01','ambiguous synthetic','AP-1')",[randomUUID()]);
  assert.match((await rpc(f.ids.mepc,'preview',{...data,rows:[{row:2,store_code:'AP01',scheduled_date:f.today}]})).rows[0].error,/ambiguous/);
  for(const update of ["business='Other'","business='Reliance Retail',is_active=false"]){await f.db.query('update profiles set '+update+' where id=$1',[f.ids.mepc]);await assert.rejects(rpc(f.ids.mepc,'preview',data),/access required/);}
 }finally{await f.db.close();}
});
