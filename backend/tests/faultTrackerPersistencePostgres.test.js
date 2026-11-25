// Synthetic disposable loopback PostgreSQL only. No dotenv/server, credentials,
// Supabase connection or production writes. Exercises the actual migration/RPCs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {nativeThermographyPostgres} from './helpers/nativeThermographyPostgres.js';
import {RETAIL_FAULT_STAGES as stages} from '../shared/retailFaultWorkflow.js';
import {scopedFaultTrackerReport} from '../services/faultTrackerStoreScope.js';
import {retainFaultTrackerUpdates,faultImportIdentity} from '../services/faultTrackerPersistence.js';
import {scopedFaultExportRows} from '../../src/utils/faultTrackerExport.js';

test('retained IFMS history across snapshots, transactions, races and state scope',{skip:process.env.RUN_IFMS_PERSISTENCE_POSTGRES!=='1'},async t=>{
 process.env.THERMOGRAPHY_NATIVE_OUTPUT_DIR=resolve('artifacts/ifms-persistence-validation');
 const cluster=await nativeThermographyPostgres();
 const {admin,connect}=cluster;
 const q=(sql,args=[])=>admin.query(sql,args);
 const rpc=async(name,args,connection=admin)=>(await connection.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result;
 const actor=randomUUID(),auth=randomUUID(),store=randomUUID(),otherStore=randomUUID();
 let first,current;
 const source=(number='T-1',code='0012',age=10)=>({ticket_no:number,store_code:code,stage:'IN_PROGRESS',stage_group:'In Progress',remarks:'Excel remark',ageing_days:age,raw_row:{Status:'IN_PROGRESS',Remarks:'Excel remark'},metadata:{},is_active:true});
 const upload=(rows,file='Corrective.xlsx',connection=admin)=>rpc('rpc_fault_tracker_import',[actor,JSON.stringify(rows),file,'Pending Tickets',JSON.stringify({file_sha256:'synthetic'})],connection);
 const ticket=async(batch,number='T-1',code='0012')=>(await q('select id from fault_tracker_tickets where import_batch_id=$1 and ticket_no=$2 and store_code=$3',[batch.id,number,code])).rows[0].id;
 const retained=async(id,connection=admin)=>(await rpc('rpc_fault_tracker_retained_updates',[[id]],connection))[0];
 const save=(id,stage,remarks,version,request=randomUUID(),connection=admin)=>rpc('rpc_retail_fault_update',[actor,id,stage,remarks,version,request],connection);
 try{
  t.diagnostic('Disposable '+(await q('select version() v')).rows[0].v);
  await q(`create role anon;create role authenticated;create role service_role bypassrls;
   create table profiles(id uuid primary key,auth_user_id uuid,employee_code text,role text,status text,is_active boolean,full_name text,display_name text,email text,state text);
   create table reliance_retail_store_master(id uuid primary key,store_code text,state text,status text);
   create table access_modules(id uuid,code text);
   create function retail_mis_allowed(uuid,text,text,boolean) returns boolean language sql as $$select $3 is null or $3='TN'$$;`);
  const baseline=fs.readFileSync(new URL('../../supabase/migrations_2_0/018_fault_tracker_persistence.sql',import.meta.url),'utf8');
  for(const table of ['fault_tracker_import_batches','fault_tracker_tickets','fault_tracker_ticket_updates']){
   const sql=baseline.match(new RegExp('create table if not exists public\\.'+table+' \\([\\s\\S]*?\\n\\);'))?.[0];
   assert.ok(sql);await q(sql);
  }
  const original=fs.readFileSync(new URL('../../supabase/migrations/20261117110000_retail_fault_vendor_pending_stages.sql',import.meta.url),'utf8').replaceAll('\r','');
  for(const match of original.matchAll(/create or replace function public\.(rpc_retail_fault_update|retail_mis_fault_update)\([\s\S]*?end;\$\$;/g))await q(match[0]);
  await q(`revoke all on function rpc_retail_fault_update(uuid,uuid,text,text,timestamptz,uuid),retail_mis_fault_update(uuid,uuid,text,text,timestamptz,uuid) from public,anon,authenticated,service_role;
   grant execute on function rpc_retail_fault_update(uuid,uuid,text,text,timestamptz,uuid) to service_role;`);
  await q('insert into profiles values($1,$2,$3,$4,$5,true,$6,null,null,$7)',[actor,auth,'TEST-ADMIN','Admin','Active','Synthetic admin','TN']);
  await q("insert into reliance_retail_store_master values($1,'0012','TN','Active'),($2,'12','KA','Active')",[store,otherStore]);
  await q(fs.readFileSync(new URL('../../supabase/migrations/20261125120000_fault_tracker_ifms_persistence.sql',import.meta.url),'utf8'));

  await t.test('all 14 stages and empty remarks survive repeated and duplicate uploads; source snapshots stay untouched',async()=>{
   first=await upload([source()]);let id=await ticket(first);
   for(const stage of stages){
    const before=await retained(id);await save(id,stage,'',before.updated_at);
    current=await upload([source('T-1','0012',22)]);
    id=await ticket(current);const row=await retained(id);
    assert.equal(row.stage,stage);assert.equal(row.remarks,'');assert.equal(row.source_stage,'IN_PROGRESS');
    assert.equal((await q('select ageing_days,stage,remarks,raw_row from fault_tracker_tickets where id=$1',[id])).rows[0].ageing_days,22);
    assert.equal((await q('select stage from fault_tracker_tickets where id=$1',[id])).rows[0].stage,'IN_PROGRESS');
   }
   assert.equal((await q('select count(*)::int n from fault_tracker_ticket_updates')).rows[0].n,14);
   assert.equal((await retained(await ticket(first))).stage,'IOT','history remains linked to original snapshot and resolves consistently');
  });
  await t.test('13 legacy affected identities recover from verified FK history without rewriting snapshots',async()=>{
   const legacy=await upload(Array.from({length:13},(_,i)=>source('LEGACY-'+i)));
   for(let i=0;i<13;i++){
    const id=await ticket(legacy,'LEGACY-'+i);
    await q("insert into fault_tracker_ticket_updates(ticket_id,updated_by_auth_user_id,updated_by_employee_code,update_type,new_stage,remarks,metadata,created_at) values($1,$2,'TEST-ADMIN','STAGE_OR_REMARKS',$3,'',$4,'2026-11-23T09:00:00Z')",[id,auth,i<10?stages[4]:'CAMC',{actor_profile_id:actor,retail_request_id:randomUUID(),retail_workflow_version:1}]);
   }
   const reimport=await upload(Array.from({length:13},(_,i)=>source('LEGACY-'+i,'0012',99)));
   let recovered=0;
   for(let i=0;i<13;i++){
    const row=await retained(await ticket(reimport,'LEGACY-'+i));
    assert.equal(row.stage,i<10?stages[4]:'CAMC');assert.equal(row.remarks,'');recovered++;
   }
   assert.equal(recovered,13);
   assert.equal((await q('select count(*)::int n from fault_tracker_tickets where import_batch_id=$1 and stage=$2',[reimport.id,'IN_PROGRESS'])).rows[0].n,13);
  });
  await t.test('multiple manual remarks changes retain exact text, clearing and latest ordering',async()=>{
   const id=await ticket(current);let row=await retained(id);
   await save(id,stages[4],'  preserve whitespace  ',row.updated_at);row=await retained(id);
   assert.equal(row.remarks,'  preserve whitespace  ');
   await save(id,stages[4],'',row.updated_at);row=await retained(id);
   await assert.rejects(()=>save(id,stages[3],'stale',row.verified_updates[0].created_at),e=>e.code==='40001');
   current=await upload([source('T-1','0012',30)]);assert.equal((await retained(await ticket(current))).remarks,'');
  });
  await t.test('new, reopened and same-number other-store tickets never borrow another identity',async()=>{
   await upload([source('NEW')]); // T-1 absent, then reopened by a later pending dump.
   current=await upload([source('T-1'),source('T-1','12'),source('NEW')]);
   assert.equal((await retained(await ticket(current))).stage,stages[4]);
   assert.equal((await retained(await ticket(current,'T-1','12'))).stage,'IN_PROGRESS');
   assert.equal((await retained(await ticket(current,'NEW'))).remarks,'Excel remark');
   const unrelated=await q("insert into fault_tracker_import_batches(source_name) values('Other Source') returning id");
   const foreign=await q("insert into fault_tracker_tickets(import_batch_id,ticket_no,store_code,stage) values($1,'T-1','0012','Foreign source') returning id",[unrelated.rows[0].id]);
   assert.equal((await retained(foreign.rows[0].id)).stage,'Foreign source');
   assert.notEqual(faultImportIdentity(source('T-1','0012')),faultImportIdentity(source('T-1','12')));
  });
  await t.test('idempotent retry across snapshots replays; changed payload/actor fails',async()=>{
   const id=await ticket(current),before=await retained(id),request=randomUUID();
   await save(id,stages[2],'Saved',before.updated_at,request);
   const next=await upload([source()]),nextId=await ticket(next);
   assert.equal((await save(nextId,stages[2],'Saved',before.updated_at,request)).replayed,true);
   await assert.rejects(()=>save(nextId,stages[2],'Changed',before.updated_at,request),e=>e.code==='40001');
   const another=randomUUID();
   await q("insert into profiles(id,auth_user_id,employee_code,role,status,is_active) values($1,$2,'ANOTHER','Admin','Active',true)",[another,randomUUID()]);
   await assert.rejects(()=>rpc('rpc_retail_fault_update',[another,nextId,stages[2],'Saved',before.updated_at,request]),e=>e.code==='40001');
   current=next;
  });
  await t.test('concurrent saves through different snapshot IDs accept one and reject the stale command',async()=>{
   const c1=await connect(),c2=await connect(),id=await ticket(current),oldId=await ticket(first),before=await retained(id);
   const results=await Promise.allSettled([save(id,stages[3],'Race A',before.updated_at,randomUUID(),c1),save(oldId,stages[5],'Race B',before.updated_at,randomUUID(),c2)]);
   assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
   assert.equal(results.find(r=>r.status==='rejected').reason.code,'40001');
   const row=await retained(id);assert.ok(['Race A','Race B'].includes(row.remarks));
  });
  await t.test('imports and saves overlap without losing updates or publishing partial rows',async()=>{
   const c1=await connect(),c2=await connect(),reader=await connect();
   const id=await ticket(current),before=await retained(id),count=(await q('select count(*)::int n from fault_tracker_import_batches')).rows[0].n;
   await c1.query('begin');const uncommitted=await upload([source('T-1','0012',45),source('OTHER')],'Overlapping.xlsx',c1);
   assert.equal((await reader.query('select count(*)::int n from fault_tracker_import_batches')).rows[0].n,count);
   await save(id,stages[4],'Concurrent manual',before.updated_at,randomUUID(),c2);
   await c1.query('commit');const row=await retained(await ticket(uncommitted));assert.equal(row.remarks,'Concurrent manual');
   // A second importer waits on source publication, while manual edits remain independent.
   await c1.query('begin');await upload([source()],'Concurrent A.xlsx',c1);
   const waiting=upload([source('T-1','0012',51)],'Concurrent B.xlsx',c2);
   await c1.query('commit');current=await waiting;
   assert.equal((await retained(await ticket(current))).stage,stages[4]);
   assert.equal((await retained(await ticket(current))).remarks,'Concurrent manual');
   const n=(await q('select count(*)::int n from fault_tracker_import_batches')).rows[0].n;
   await assert.rejects(()=>upload([source(),source()]),e=>e.code==='23505');
   assert.equal((await q('select count(*)::int n from fault_tracker_import_batches')).rows[0].n,n,'failed import rolls back batch too');
  });
  await t.test('unverified, wrong-store pinned or wrong-source history cannot override verified history',async()=>{
   const id=await ticket(current),before=await retained(id);
   for(const metadata of [{retail_workflow_version:1},{retail_workflow_version:1,actor_profile_id:actor,retail_request_id:randomUUID(),ifms_identity:['Reliance Retail IFMS','T-1','0012',otherStore]}]){
    await q("insert into fault_tracker_ticket_updates(ticket_id,updated_by_auth_user_id,updated_by_employee_code,update_type,new_stage,remarks,metadata) values($1,$2,'TEST-ADMIN','STAGE_OR_REMARKS','OEM','Forged',$3)",[id,auth,metadata]);
   }
   assert.equal((await retained(id)).manual_update_id,before.manual_update_id);
  });
  await t.test('state-wise dashboard, detail, stage filters and existing Excel export share retained values',async()=>{
   current=await upload([source(),source('KA-ONLY','12')]);
   const client={rpc:async(name,args)=>{try{return {data:await rpc(name,Object.values(args))};}catch(error){return {error};}},from(table){
    assert.match(table,/^[a-z_]+$/);const where=[],args=[],order=[];let limit='',offset='';
    const query={select(){return query;},eq(k,v){assert.match(k,/^[a-z_]+$/);args.push(v);where.push(`${k}=$${args.length}`);return query;},order(k,o={}){assert.match(k,/^[a-z_]+$/);order.push(k+(o.ascending===false?' desc':' asc')+(o.nullsFirst===false?' nulls last':''));return query;},limit(n){limit=' limit '+Number(n);return query;},range(a,b){limit=' limit '+(b-a+1);offset=' offset '+a;return query;},maybeSingle(){query.single=true;return query;},then(ok,bad){return q(`select * from ${table} ${where.length?'where '+where.join(' and '):''} ${order.length?'order by '+order.join(','):''}${limit}${offset}`,args).then(r=>({data:query.single?r.rows[0]||null:r.rows})).then(ok,bad);}};return query;
   }};
   const stateCode=s=>({TN:'TN',KA:'KN',KN:'KN'}[s]||s),authorization={readAll:false,isAdmin:false,stateCode};
   const profile={id:actor,role:'MIS',state:'TN',is_active:true,status:'Active'};
   const report=await scopedFaultTrackerReport(client,profile,{import_batch_id:current.id,stage:stages[4]},authorization);
   assert.equal(report.total,1);assert.equal(report.tickets[0].remarks,'Concurrent manual');
   assert.equal(report.tickets[0].stage,stages[4]);assert.equal(report.tickets[0].can_update,false);
   const detail=await scopedFaultTrackerReport(client,profile,{import_batch_id:current.id,ticket_id:report.tickets[0].id},authorization);
   assert.equal(detail.tickets[0].stage,report.tickets[0].stage);
   await assert.rejects(()=>scopedFaultTrackerReport(client,profile,{import_batch_id:current.id,ticket_no:'KA-ONLY'},authorization),e=>e.statusCode===404);
   const exported=scopedFaultExportRows(report.tickets.map(r=>({ticketNumber:r.ticket_no,storeId:r.canonical_store_code,ifmsStage:r.stage,remarks:r.remarks})));
   assert.ok(JSON.stringify(exported).includes(stages[4]));assert.ok(!JSON.stringify(exported).includes('KA-ONLY'));
   assert.deepEqual((await q("select has_function_privilege('anon','public.rpc_fault_tracker_retained_updates(uuid[])','execute') a,has_function_privilege('authenticated','public.rpc_fault_tracker_import(uuid,jsonb,text,text,jsonb)','execute') b,has_function_privilege('service_role','public.retail_mis_fault_update(uuid,uuid,text,text,timestamptz,uuid)','execute') c")).rows[0],{a:false,b:false,c:false});
   const service=await connect(true);
   const imported=await upload([source('SERVICE')],'Service.xlsx',service);
   assert.equal((await retained(await ticket(imported,'SERVICE'),service)).stage,'IN_PROGRESS');
   await assert.rejects(()=>retainFaultTrackerUpdates({rpc:async()=>({error:{code:'42883'}})},[{id:'x'}]),e=>e.statusCode===503);
   await assert.rejects(async()=>rpc('retail_mis_fault_update',[actor,await ticket(current,'KA-ONLY','12'),stages[0],'',new Date(),randomUUID()]),e=>e.code==='42501');
  });
 }finally{await cluster.close();}
});
