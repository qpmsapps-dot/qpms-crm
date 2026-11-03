import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
export async function runOos12Checks({q,one,id,admin,read,pg,port,t}){
 const sql=read('supabase/migrations/20261102135809_retail_oos12_transition_engine.sql');
 const baseline=(await q("select proname,md5(prosrc) digest from pg_proc where proname in ('retail_mis_service_command','rpc_retail_service_command','rpc_retail_mis_oos_import','rpc_retail_service_snapshot') order by proname")).rows;
 const legacyRows=(await q('select to_jsonb(o) row from retail_service_orders o order by id')).rows;
 const originalGate=(await one('select oos_writes_enabled value from retail_mis_controls where singleton')).value;
 await assert.rejects(q(sql.replace(/commit;\s*$/i,'select missing_oos12_rollback();commit;')),/missing_oos12_rollback/);await q('rollback');
 assert.equal((await one("select to_regclass('public.retail_oos12_orders') name")).name,null);
 await t.test('Storage policies require an owner-capable path and exact preinstalled policies are accepted',async()=>{
  const block=sql.match(/do \$storage_owner\$[\s\S]*?end;\$storage_owner\$;/)[0];
  await q('create role oos_test_policy_installer');await q('grant usage on schema storage to oos_test_policy_installer');await q('grant trigger on storage.objects to oos_test_policy_installer');
  await q('set role oos_test_policy_installer');await assert.rejects(q(block),/owner|permission/);await q('reset role');
  await q(block);await q('set role oos_test_policy_installer');await q(block);await q('reset role');
 });
 await q(sql);await q(read('supabase/verification/retail_oos12_postinstall_read_only.sql'));
 const commercial=id(501),finance=id(502),branch=id(503),operations=id(504),generic=id(505),outside=id(506),unscoped=id(507),self=id(508);
 for(const [actor,role,state] of [[commercial,'Commercial','TN'],[finance,'Finance','TN'],[branch,'Branch Head','TN'],[operations,'Operations Manager','TN'],[generic,'Admin','TN'],[outside,'Commercial','KL'],[unscoped,'Commercial',null],[self,'MIS_OOS',null]]){
  await q('insert into auth.users values($1,$2)',[actor,'isolated-unchanged']);await q("insert into profiles(id,auth_user_id,employee_code,role,business,web_access_enabled) values($1,$1,$2,$3,'Reliance Retail',true)",[actor,'LOCAL_'+actor,role]);
  if(state)await q("insert into retail_provisional_access values($1,$2,$3)",[actor,state,['Commercial','Finance'].includes(role)?'reviewer':'editor']);
 }
 await q("select rpc_retail_mis_user_save($1,$2,$2,$3,'MIS_OOS',array['TN'],'Isolated real MIS actor fixture',0,'{}')",[admin,self,'LOCAL_'+self]);
 const flags=async()=>one('select enabled,revision from retail_oos_workflow_catalog where version=2');
 const importQ=async(reference='V2-TEST',revision=0,source='source-1',actor=admin,version=2,storeIds=[id(20)])=>{
  const bytes=Buffer.from(source);return (await one('select rpc_retail_oos12_import($1,$2,$3,$4,$5) result',[actor,createHash('sha256').update(bytes).digest('hex'),'local.xlsx',bytes.toString('base64'),JSON.stringify([{quotation_number:reference,store_ids:storeIds,expected_revision:revision,expected_workflow_version:version,items:[{store_id:id(20),description:'Local item',quantity:'1.00',unit_rate:'9007199254740993.01',total_amount:'9007199254740993.01',quotation_header:{quotation_date:'2026-10-01',totals:{total_amount:'9007199254740993.01'}}}]}])])).result;
 };
 const get=async oid=>one('select * from retail_oos12_orders where id=$1',[oid]);
 const stages=['OOS12_QUOTATION_SHARED','OOS12_PO_PENDING_COMMERCIAL','OOS12_PO_RECEIVED','OOS12_FUND_RAISED','OOS12_FUND_DELIVERED','OOS12_FUND_RECEIVED','OOS12_WIP','OOS12_WORK_DONE','OOS12_DOCUMENT_SUBMITTED','OOS12_DOCUMENT_RECEIVED','OOS12_JMS_CREATED','OOS12_INVOICE_RAISED'];
 const fields=stage=>({...({2:{po_number:'000PO',po_date:'2026-10-01',po_received_date:'2026-10-01'},3:{confirmation_ref:'PO confirmation'},4:{fund_request_ref:'Request',fund_request_date:'2026-10-02',fund_request_amount:'9007199254740993.01'},5:{payment_ref:'PAY-1',payment_date:'2026-10-03',payment_amount:'9007199254740993.01'},6:{receipt_ref:'Receipt',receipt_date:'2026-10-04'},7:{handover_ref:'Handover',handover_date:'2026-10-05'},8:{work_completion_ref:'Complete',completion_date:'2026-10-06'},9:{documents_ref:'Docs',submission_date:'2026-10-07'},10:{acknowledgement_ref:'Ack',received_date:'2026-10-08'},11:{jms_number:'000JMS',jms_date:'2026-10-09'},12:{invoice_number:'000INV',invoice_date:'2026-10-10',invoice_amount:'9007199254740993.01'}}[stage]),confirming_person_name:'Offline Test Person',confirming_department:({2:'Commercial',3:'Commercial',4:'OOS-MIS',5:'Finance',6:'Branch Head',7:'Branch Head',8:'Operations',9:'OOS-MIS',10:'Commercial',11:'Commercial',12:'Commercial'})[stage],confirmation_date:'2026-10-01',confirmation_reference:'OFFLINE-REF'});
 const prepare=async(actor,o)=> (await one("select rpc_retail_oos12_evidence_prepare($1,$2,$3,'proof.pdf','application/pdf',17) result",[actor,o.id,o.revision])).result;
 const finalize=async(actor,e)=>{await q("insert into storage.objects(bucket_id,name,metadata) values('retail-oos12-evidence',$1,$2)",[e.path,{size:17,mimetype:'application/pdf'}]);return (await one('select rpc_retail_oos12_evidence_object($1,$2,true) result',[actor,e.id])).result;};
 const transition=async(actor,o,evidence=[],opts={})=>(await one('select rpc_retail_oos12_transition($1,$2,$3,$4,$5,$6,$7,$8) result',[actor,o.id,opts.action||stages[o.stage],opts.revision??o.revision,opts.request||randomUUID(),opts.fields??fields(o.stage+1)??{},evidence,opts.remarks??'Genuine local test transition'])).result;
 let oid;
 await t.test('postinstall detects direct grants, disabled immutability and policy weakening',async()=>{
  const verify=read('supabase/verification/retail_oos12_postinstall_read_only.sql');
  for(const [change,restore,pattern] of [
   ['grant select on retail_oos12_orders to authenticated','revoke select on retail_oos12_orders from authenticated',/grants drift/],
   ['alter table retail_oos12_events disable trigger retail_oos12_events_immutable','alter table retail_oos12_events enable trigger retail_oos12_events_immutable',/trigger drift/],
   ['alter policy retail_oos12_private_read on storage.objects using(true)',"alter policy retail_oos12_private_read on storage.objects using(bucket_id<>'retail-oos12-evidence')",/storage policy drift/]
  ]){await q(change);await assert.rejects(q(verify),pattern);await q('rollback');await q(restore);await q(verify);}
 });
 await t.test('v2 installation rolls back atomically and defaults disabled with no specialist grants',async()=>{
  assert.equal((await flags()).enabled,false);assert.equal((await one('select count(*)::int n from retail_oos12_orders')).n,0);
  await assert.rejects(importQ(),/workflow version changed/);await assert.rejects(q("select rpc_retail_oos12_activate($1,true,'Not authorized',0)",[generic]),/operator/);
  await q("delete from retail_provisional_access where actor_id=$1",[finance]);assert.equal((await flags()).enabled,false);
  await q("select rpc_retail_oos12_activate($1,true,'Isolated test activation only',0)",[admin]);assert.equal((await flags()).enabled,true);
  await assert.rejects(q("select rpc_retail_oos12_activate($1,false,'Stale activation',0)",[admin]),/changed/);
 });
 await t.test('authenticated roles require existing explicit state permission; Admin never becomes reviewer',async()=>{
  for(const actor of [admin,generic,unscoped,outside])assert.equal((await one("select retail_oos12_authority($1,'TN','commercial') ok",[actor])).ok,false);
  assert.equal((await one("select retail_oos12_authority($1,'TN','commercial') ok",[commercial])).ok,false);
  assert.equal((await one("select retail_oos12_authority($1,'PY','mis') ok",[admin])).ok,true);
  assert.equal((await one("select retail_oos12_authority($1,'TN','finance') ok",[commercial])).ok,false);
  await assert.rejects(importQ('FORBIDDEN',0,'denied',commercial),/scope|authority/);
  oid=(await importQ()).receipts[0].order.id;assert.equal((await get(oid)).workflow_version,2);
  await assert.rejects(q("insert into retail_service_orders(kind,reference,state,store_ids,status,details,created_by) values('OOS','V2-TEST','TN',array[$1::uuid],'QUOTED','{}',$2)",[id(20),admin]),/another workflow/);
 });
 await t.test('rework and source replay preserve original financial precision, ageing and immutable history',async()=>{
  const original=await get(oid);await importQ('V2-TEST',1,'source-2');const replay=await importQ('V2-TEST',1,'source-2');assert.equal(replay.receipts[0].replayed,true);
  const revised=await get(oid);assert.equal(revised.rework_count,1);assert.equal(revised.status_entered_at.toISOString(),original.status_entered_at.toISOString());assert.deepEqual(revised.original_items,original.original_items);assert.equal(revised.details.items[0].unit_rate,'9007199254740993.01');
  await assert.rejects(importQ('V2-TEST',1,'source-3'),/revision changed/);
 });
 await t.test('missing/forged evidence, skipped/backward actions and unrelated fields never mutate an order',async()=>{
  const o=await get(oid);await assert.rejects(transition(admin,o),/evidence/);await assert.rejects(transition(admin,o,[randomUUID()]),/evidence/);
  await assert.rejects(transition(admin,o,[],{action:stages[2]}),/forward/);await assert.rejects(transition(admin,o,[],{action:stages[0]}),/forward/);
  await assert.rejects(transition(commercial,o),/scope|authority/);await assert.rejects(transition(admin,o,[],{fields:{...fields(2),invoice_amount:'5'}}),/Unrelated/);
  assert.equal((await get(oid)).revision,o.revision);
 });
 await t.test('private evidence must match actual stored size/MIME, actor, order and current revision',async()=>{
  const o=await get(oid),e=await prepare(admin,o);await assert.rejects(transition(admin,o,[e.id]),/finalized/);
  await assert.rejects(transition(admin,o,[e.id,e.id]),/Unique mandatory/);
  await assert.rejects(q('select rpc_retail_oos12_evidence_object($1,$2,true)',[admin,e.id]),/metadata mismatch/);
  await assert.rejects(q("insert into storage.objects(bucket_id,name,metadata) values('retail-oos12-evidence',$1,'{\"size\":99,\"mimetype\":\"application/pdf\"}')",[e.path]),/intent required/);
  await finalize(admin,e);await assert.rejects(q('select rpc_retail_oos12_evidence_object($1,$2,true)',[commercial,e.id]),/scope|authority/);
  await assert.rejects(q("update storage.objects set metadata='{}' where name=$1",[e.path]),/cannot be changed/);await assert.rejects(q('delete from storage.objects where name=$1',[e.path]),/cannot be changed/);
 });
 await t.test('OOS-MIS records all eleven forward transitions with offline confirmations, evidence and immutable audit',async()=>{
  const actors=Object.fromEntries(Array.from({length:11},(_,i)=>[i+2,self]));
  for(let stage=2;stage<=12;stage++){
   const o=await get(oid),actor=actors[stage];assert.equal(o.stage,stage-1);
   const caps=(await one('select rpc_retail_oos12_capabilities($1) result',[actor])).result;assert.deepEqual(caps.actions[o.id],[stages[stage-1]]);
   const wrong=generic;await assert.rejects(transition(wrong,o),/scope|authority/);
   const e=await prepare(actor,o);await finalize(actor,e);
   await assert.rejects(transition(actor,o,[e.id],{fields:{}}),/Required field/);
   const key=Object.keys(fields(stage)).find(k=>k.endsWith('date'));
   if(key)await assert.rejects(transition(actor,o,[e.id],{fields:{...fields(stage),[key]:'2026-02-30'}}),/date|range/i);
   if(stage===12)await assert.rejects(transition(actor,o,[e.id],{fields:{...fields(stage),invoice_amount:'1.001'}}),/decimal/);
   const request=randomUUID(),first=await transition(actor,o,[e.id],{request}),repeat=await transition(actor,o,[e.id],{request});assert.equal(first.order.stage,stage);assert.equal(repeat.replayed,true);
   await assert.rejects(transition(actor,o,[e.id],{request,remarks:'different request payload'}),/reused/);
   await assert.rejects(transition(actor,await get(oid),[e.id],{action:stages[stage-2]}),/forward/);
  }
  const o=await get(oid);assert.equal(o.details.invoice_amount,'9007199254740993.01');assert.equal(o.details.po_date,'2026-10-01');assert.equal(o.stage,12);
  await assert.rejects(transition(admin,o),/forward/);assert.equal((await one('select count(*)::int n from retail_oos12_events where order_id=$1',[oid])).n,13);
  const actorEvents=(await q("select actor_id,evidence->>'system_actor_role' role,evidence->>'confirmation_authenticity' authenticity from retail_oos12_events where order_id=$1 and action like 'OOS12_%'",[oid])).rows;assert.equal(actorEvents.length,11);assert.ok(actorEvents.every(e=>e.actor_id===self&&e.role==='OOS-MIS'&&e.authenticity==='MIS_SUBMITTED_UNVERIFIED'));
  const beforeRework=await get(oid);await importQ('V2-TEST',beforeRework.revision,'progressed-rework',self);const afterRework=await get(oid);assert.equal(afterRework.stage,12);assert.equal(afterRework.status_entered_at.toISOString(),beforeRework.status_entered_at.toISOString());assert.deepEqual(afterRework.original_items,beforeRework.original_items);
  await assert.rejects(q("update retail_oos12_events set action='REWORK' where order_id=$1",[oid]),/immutable/i);await assert.rejects(q('delete from retail_oos12_events where order_id=$1',[oid]),/immutable/i);
 });
 await t.test('specialists see only scoped v2 orders; generic Admin and legacy APIs cannot see v2',async()=>{
  const visible=(await one('select rpc_retail_oos_register($1) result',[admin])).result;assert.ok(visible.rows.some(o=>o.workflow_version===2));assert.equal(visible.rows.find(o=>o.workflow_version===2).workflow_version,2);assert.ok(!JSON.stringify(visible).includes('original_base64'));
  assert.equal(visible.rows.find(o=>o.workflow_version===2).original_po_date,'2026-10-01');assert.equal(visible.rows.find(o=>o.workflow_version===2).status_entered_at,visible.rows.find(o=>o.workflow_version===2).history.find(e=>e.action==='OOS12_INVOICE_RAISED').created_at);
  await assert.rejects(q('select rpc_retail_oos_register($1)',[generic]),/scope/);await assert.rejects(q('select rpc_retail_oos12_history($1,$2)',[outside,oid]),/scope/);
  const legacy=(await one('select rpc_retail_service_snapshot($1) result',[generic])).result;assert.ok(!legacy.orders.some(o=>o.id===oid));
  await q('set role authenticated');await assert.rejects(q('select * from retail_oos12_orders'),/permission/);await assert.rejects(q('select rpc_retail_oos12_transition($1,$2,$3,1,$4,\'{}\',\'{}\',\'Forged request\')',[admin,oid,stages[1],randomUUID()]),/permission/);await q('reset role');
 });
 await t.test('private OOS evidence denies anonymous/authenticated access even with a broad unrelated policy',async()=>{
  await q('grant select on storage.objects to anon');await q('create policy local_broad_read on storage.objects for select to public using(true)');
  for(const role of ['anon','authenticated']){await q('set role '+role);assert.equal((await one("select count(*)::int n from storage.objects where bucket_id='retail-oos12-evidence'")).n,0);await q('reset role');}
  await q('drop policy local_broad_read on storage.objects');await q('revoke select on storage.objects from anon');
 });
 await t.test('offline confirmation is required, immutable and never represented as independent approval',async()=>{
  const orderId=(await importQ('OFFLINE',0,'offline-source')).receipts[0].order.id,o=await get(orderId),proof=await prepare(admin,o);await finalize(admin,proof);
  const missing={...fields(2)};delete missing.confirming_person_name;await assert.rejects(transition(admin,o,[proof.id],{fields:missing}),/Required field/);
  await assert.rejects(transition(admin,o,[proof.id],{fields:{...fields(2),confirming_department:'Finance'}}),/department/);
  await transition(admin,o,[proof.id],{fields:{...fields(2),po_received_date:'2026-10-02'}});const projection=(await one('select rpc_retail_oos_register($1) result',[admin])).result.rows.find(row=>row.id===orderId);assert.equal(projection.original_po_date,'2026-10-02');assert.equal(projection.details.po_date,'2026-10-01');const event=await one('select * from retail_oos12_events where order_id=$1 and action=$2',[orderId,stages[1]]);
  assert.equal(event.actor_id,admin);assert.equal(event.evidence.confirmation_authenticity,'MIS_SUBMITTED_UNVERIFIED');assert.equal(event.evidence.system_actor_role,'Admin');assert.equal(event.evidence.system_actor_capacity,'OOS-MIS');assert.equal(event.evidence.fields.confirming_person_name,'Offline Test Person');
  for(const actor of [commercial,finance,branch,operations,generic])await assert.rejects(transition(actor,await get(orderId)),/scope|authority/);
 });
 await t.test('concurrent sessions: one revision wins; identical request replays with one event',async()=>{
  const orderId=(await importQ('RACE',0,'race-source')).receipts[0].order.id,o=await get(orderId),e=await prepare(admin,o);await finalize(admin,e);
  const connect=async()=>{const c=new pg.Client({host:'127.0.0.1',port,user:'postgres',password:'local-test-only',database:'postgres'});await c.connect();return c;};
  const a=await connect(),b=await connect(),request=randomUUID();const args=[admin,o.id,stages[1],o.revision,request,fields(2),[e.id],'Concurrent exact request'];const query='select rpc_retail_oos12_transition($1,$2,$3,$4,$5,$6,$7,$8) result';
  try{const both=await Promise.all([a.query(query,args),b.query(query,args)]);assert.equal(both.filter(x=>x.rows[0].result.replayed).length,1);
   const r=(await importQ('RACE-2',0,'race-source-2')).receipts[0].order.id,ro=await get(r),re=await prepare(admin,ro);await finalize(admin,re);
   const base=[admin,r,stages[1],ro.revision,null,fields(2),[re.id],'Concurrent different request'];const outcomes=await Promise.allSettled([a.query(query,[...base.slice(0,4),randomUUID(),...base.slice(5)]),b.query(query,[...base.slice(0,4),randomUUID(),...base.slice(5)])]);assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);assert.equal(outcomes.filter(x=>x.status==='rejected'&&x.reason.code==='40001').length,1);
  }finally{await a.end();await b.end();}
 });
 await t.test('six-state MIS create/edit/deactivate and OOS-only TN/PY authorization are audited atomically',async()=>{
  const actors=[];
  for(const [i,role] of ['MIS_HK','MIS_MEPC','MIS_OOS'].entries()){
   const actor=id(520+i);actors.push(actor);await q('insert into auth.users values($1,$2)',[actor,'unchanged-password']);
   await q("insert into profiles(id,auth_user_id,employee_code,role,business) values($1,$1,$2,'FO','Reliance Retail')",[actor,'LOCAL_MIS_'+i]);
   const save=(states,revision,patch={},who=admin)=>one('select rpc_retail_mis_user_save($1,$2,$2,$3,$4,$5,$6,$7,$8) result',[who,actor,'LOCAL_MIS_'+i,role,states,'Owner-selected isolated user assignment',revision,patch]);
   await assert.rejects(save(['TN'],0,{},generic),/Super Admin/);
   await assert.rejects(save(['PY'],0),/Explicit/);assert.equal((await one('select role from profiles where id=$1',[actor])).role,'FO');
   const saved=(await save(['TN','KA'],0)).result;assert.equal(saved.role,role);assert.equal(saved.designation,({MIS_HK:'HK-MIS',MIS_MEPC:'MEPC-MIS',MIS_OOS:'OOS-MIS'})[role]);
   assert.equal((await one("select retail_mis_allowed($1,'oos','PY') ok",[actor])).ok,role==='MIS_OOS');
   assert.equal((await one("select retail_mis_allowed($1,'stores','PY') ok",[actor])).ok,false);
   await assert.rejects(save(['KL'],0),/changed/);await assert.rejects(save(['KL'],1,{auth_user_id:generic}),/Unsupported/);
   await save(['TN'],1,{full_name:'Edited MIS profile',is_active:false,status:'Inactive'});assert.equal((await one("select retail_mis_allowed($1,'oos','TN') ok",[actor])).ok,false);
   await save(['TN'],2,{is_active:true,status:'Active'});
   assert.equal((await one('select encrypted_password from auth.users where id=$1',[actor])).encrypted_password,'unchanged-password');
   assert.equal((await one("select count(*)::int n from retail_mis_audit where target_id=$1 and action='MIS_USER_EDIT'",[actor])).n,3);
  }
  const oosActor=actors[2],mixed=(await importQ('TN-PY-MIXED',0,'mixed-source',oosActor,2,[id(20),id(21)])).receipts[0].order;
  assert.equal(mixed.state,'TN');assert.equal((await one('select state from reliance_retail_store_master where id=$1',[id(21)])).state,'PY');
  assert.equal((await one('select retail_oos12_order_allowed($1,$2) ok',[oosActor,mixed.id])).ok,true);
  await q("update retail_mis_assignments set states=array['KA'] where profile_id=$1",[oosActor]);assert.equal((await one('select retail_oos12_order_allowed($1,$2) ok',[oosActor,mixed.id])).ok,false);
  await assert.rejects(transition(oosActor,await get(mixed.id)),/scope/);
  await q('delete from retail_mis_assignments where profile_id=any($1::uuid[])',[actors]);
 });
 await t.test('revocation, disabled v2 gate and existing legacy gate fail closed without affecting legacy records',async()=>{
  const oldCount=(await one('select count(*)::int n from retail_service_orders')).n;
  await q('update retail_mis_controls set oos_writes_enabled=false');await assert.rejects(transition(admin,await get(oid)),/disabled/);await assert.rejects(importQ('CLOSED-LEGACY-GATE',0,'closed-source'),/unavailable/);await q('update retail_mis_controls set oos_writes_enabled=true');
  await q("select rpc_retail_oos12_activate($1,false,'Stop isolated v2 writes',1)",[admin]);await assert.rejects(importQ('V2-TEST',2,'source-4'),/disabled/);
  const legacy=await importQ('LEGACY-AFTER-V2-OFF',0,'legacy-source',admin,1);assert.ok(legacy.receipts.length);assert.equal((await one('select count(*)::int n from retail_service_orders')).n,oldCount+1);
  await q("update profiles set is_active=false where id=$1",[commercial]);await assert.rejects(q('select rpc_retail_oos12_history($1,$2)',[commercial,oid]),/scope/);
  assert.deepEqual((await q("select proname,md5(prosrc) digest from pg_proc where proname in ('retail_mis_service_command','rpc_retail_service_command','rpc_retail_mis_oos_import','rpc_retail_service_snapshot') order by proname")).rows,baseline);
  assert.deepEqual((await q('select to_jsonb(o) row from retail_service_orders o where id=any($1::uuid[]) order by id',[legacyRows.map(x=>x.row.id)])).rows,legacyRows);assert.equal((await one('select oos_writes_enabled value from retail_mis_controls where singleton')).value,originalGate);
  // Restore only synthetic fixture assignment so the parent zero-MIS regression remains meaningful.
  await q('delete from retail_mis_assignments where profile_id=$1',[self]);
 });
}
