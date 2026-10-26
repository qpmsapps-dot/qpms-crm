import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import express from 'express';
import { createClientTicketingManagementRouter } from '../routes/clientTicketingManagementRoutes.js';
import { requireClientManagement,validateDraftInput,saveManagementDraft,loadManagementDraft,draftConfigurationReadiness } from '../services/clientTicketingManagementService.js';
const actor='11111111-1111-4111-8111-111111111111',domain='22222222-2222-4222-8222-222222222222';
const admin={is_active:true,role:'Admin'};

test('draft readiness reports missing setup and never grants activation',()=>{
  const summary=draftConfigurationReadiness({});
  assert.equal(summary.checks.length,8);assert.ok(summary.checks.every(c=>!c.configured));
  assert.equal(summary.activation_ready,false);assert.equal(summary.state,'draft_only');
});
test('draft readiness distinguishes whole-tower scopes from specific locations',()=>{
  const summary=draftConfigurationReadiness({blocks:[{id:'a',block_name:'A1'},{id:'b',block_name:'B1'}],
    staff:[{id:'s',role_code:'housekeeping_supervisor'}],
    scopes:[{hospital_ticket_user_id:'s',scope_type:'block',block_id:'a',can_view:true,can_update:true},
      {hospital_ticket_user_id:'s',scope_type:'location',location_id:'one-location',can_view:true,can_update:true}],
    categories:[{category_code:'HOUSEKEEPING'},{category_code:'UNAPPROVED'}]});
  assert.deepEqual(summary.block_coverage.map(b=>b.configured),[true,false]);
  assert.equal(summary.location_scope_count,1);assert.equal(summary.unsupported_categories,1);
  assert.equal(summary.activation_ready,false);
});
test('Residential category API accepts only the supported Housekeeping contract',()=>{
  const valid={code:'HOUSEKEEPING',name:'Housekeeping',priority:'medium',supervisor_sla_minutes:20,operations_sla_minutes:20};
  assert.deepEqual(validateDraftInput('category',valid),valid);
  for(const change of [{code:'ELECTRICAL',name:'Electrical'},{name:'Unapproved service'}])assert.throws(()=>validateDraftInput('category',{...valid,...change}),{statusCode:400});
});
test('staff API supports explicit same-role additive scopes without accepting unknown modes',()=>{
  const input={employee_code:'SYNTHETIC',role_code:'housekeeping_supervisor',scope_type:'block',block_id:domain,scope_mode:'add'};
  assert.equal(validateDraftInput('staff',input).scope_mode,'add');
  assert.throws(()=>validateDraftInput('staff',{...input,scope_mode:'all'}),{statusCode:400});
  const sql=readFileSync(new URL('../../supabase/migrations_2_0/234_residential_ticketing_draft_management.sql',import.meta.url),'utf8');
  assert.match(sql,/if coalesce\(p_payload->>'scope_mode','replace'\)='replace' then\s+update public.hospital_ticket_user_scopes/);
  assert.match(sql,/Adding a scope cannot change the existing staff role/);
  assert.match(sql,/v_user.client_id<>p_client/);
});
test('only active platform administrators can manage drafts',()=>{
  for(const role of ['Admin','QPMS Admin','Developer','DEV'])requireClientManagement({role,is_active:true,status:'Active'});
  for(const p of [null,{role:'Admin',is_active:false},{role:'Admin',is_active:true,status:'Inactive'},{role:'IT Admin',is_active:true},{role:'Supervisor',is_active:true},{role:'Facility Manager',is_active:true},{role:'COO',is_active:true}])assert.throws(()=>requireClientManagement(p),{statusCode:403});
});
test('activation fields, unknown resources, cross-client IDs and invalid configuration reject before RPC',()=>{
  for(const input of [{code:'X',name:'Synthetic',business_vertical_id:actor,is_active:true},{code:'X',name:'Synthetic',business_vertical_id:actor,phone_only_risk_accepted:true}])assert.throws(()=>validateDraftInput('client',input),{statusCode:400});
  assert.throws(()=>validateDraftInput('activate',{}),{statusCode:400});
  assert.throws(()=>validateDraftInput('floor',{code:'F1',name:'Floor',block_id:'bad-id'}),{statusCode:400});
  assert.throws(()=>validateDraftInput('staff',{employee_code:'SYNTHETIC',role_code:'admin',scope_type:'client'}),{statusCode:400});
  assert.throws(()=>validateDraftInput('staff',{employee_code:'SYNTHETIC',role_code:'facility_manager',scope_type:'block'}),{statusCode:400});
  assert.throws(()=>validateDraftInput('category',{code:'C1',name:'Synthetic',priority:'high'}),{statusCode:400});
  assert.throws(()=>validateDraftInput('location',{code:'L1',name:'Synthetic',block_id:domain,location_type:'unit'}),{statusCode:400});
});
test('staff and contact setup preserves identities; no credentials or activation accepted',()=>{
  assert.deepEqual(validateDraftInput('staff',{employee_code:'SYNTHETIC',role_code:'operations_executive',scope_type:'client'}),{employee_code:'SYNTHETIC',role_code:'operations_executive',scope_type:'client'});
  assert.equal(validateDraftInput('contact',{full_name:'Synthetic Test Contact',mobile:'+91 9000000000'}).mobile,'9000000000');
  assert.throws(()=>validateDraftInput('contact',{full_name:'Synthetic',mobile:'not-mobile'}),{statusCode:400});
});
test('tower, floor, staff scope and Client Person inputs remain draft-only',()=>{
  assert.deepEqual(validateDraftInput('block',{code:'T1',name:'Tower 1'}),{code:'T1',name:'Tower 1'});
  assert.deepEqual(validateDraftInput('floor',{code:'F1',name:'Floor 1',block_id:domain}),{code:'F1',name:'Floor 1',block_id:domain});
  assert.deepEqual(validateDraftInput('staff',{employee_code:'SYNTHETIC',role_code:'housekeeping_supervisor',scope_type:'block',block_id:domain,scope_mode:'add'}),{employee_code:'SYNTHETIC',role_code:'housekeeping_supervisor',scope_type:'block',block_id:domain,scope_mode:'add'});
  assert.deepEqual(validateDraftInput('contact',{full_name:'Authorized Client Person',mobile:'9000000000',designation:'Committee Member'}),{full_name:'Authorized Client Person',mobile:'9000000000',designation:'Committee Member'});
});
test('draft writes delegate to a single service-only atomic RPC with trusted actor and client',async()=>{
  let call;const db={rpc:async(name,params)=>{call={name,params};return{data:{id:domain}};}};
  await saveManagementDraft(db,admin,actor,domain,'block',{code:'B1',name:'Synthetic Block'});
  assert.equal(call.name,'rpc_save_residential_ticketing_draft');assert.equal(call.params.p_actor,actor);assert.equal(call.params.p_client,domain);
  await assert.rejects(()=>saveManagementDraft(db,admin,actor,domain,'block',{code:'B1',name:'Synthetic',client_id:actor}),{statusCode:400});
});
test('Hospital clients are read-only even for platform Admin direct draft request',async()=>{
  const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{id:domain,business_type:'hospital',is_active:true}})};
  await assert.rejects(()=>loadManagementDraft({from:()=>q},admin,domain),{statusCode:403});
});
test('HTTP direct bypass denied before a database call',async()=>{
  const app=express();app.use(express.json());let queried=false;
  app.use('/drafts',createClientTicketingManagementRouter({getClient:()=>{queried=true;throw Error('No DB allowed');}}));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  try{const r=await fetch(`http://127.0.0.1:${server.address().port}/drafts`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({is_active:true})});assert.equal(r.status,403);assert.equal(queried,false);}finally{await new Promise(r=>server.close(r));}
});
test('prepared database contract locks drafts, rejects Hospital/cross-client writes and never activates or sends',()=>{
  const sql=readFileSync(new URL('../../supabase/migrations_2_0/234_residential_ticketing_draft_management.sql',import.meta.url),'utf8');
  for(const pattern of [/for update/,/v_client.business_type<>'residential'/,/v_client.is_active/,/v_user.client_id<>p_client/,/Invalid client floor/,/auth_user_id=p_actor/,/SAVE_TICKETING_DRAFT/,/from public,anon,authenticated/,/to service_role/])assert.match(sql,pattern);
  assert.doesNotMatch(sql,/set is_active\s*=\s*true|insert into public.hospital_tickets|inviteUser|sendFirebase|create table/i);
});

test('prepared staff mapping rejects inactive-status profiles and never converts Client Persons into internal staff',()=>{
  const sql=readFileSync(new URL('../../supabase/migrations_2_0/234_residential_ticketing_draft_management.sql',import.meta.url),'utf8');
  const staff=sql.slice(sql.indexOf("elsif p_resource='staff' then"),sql.indexOf("elsif p_resource='contact' then"));
  assert.match(staff,/lower\(coalesce\(v_profile.status,''\)\)<>'active'/);
  assert.match(staff,/v_user.profile_type<>'internal'/);
  assert.match(staff,/v_user.client_id<>p_client/);
  assert.doesNotMatch(staff,/set\s+(?:client_id|profile_type|is_active)\s*=/i);
});

test('Admin HTTP contract forwards only trusted actor and path client and rejects activation before RPC',async()=>{
  const app=express();app.use(express.json());const calls=[];
  app.use((req,res,next)=>{req.profile=admin;req.authUser={id:actor};next();});
  app.use('/drafts',createClientTicketingManagementRouter({getClient:()=>({rpc:async(name,params)=>{calls.push({name,params});return{data:{client_id:domain,active:false}};}})}));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const post=(path,body)=>fetch(`http://127.0.0.1:${server.address().port}/drafts${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  try{
    const valid=await post(`/${domain}/block`,{code:'B1',name:'Synthetic Block'});
    assert.equal(valid.status,200);assert.equal((await valid.json()).result.active,false);
    assert.equal(calls.length,1);assert.equal(calls[0].params.p_actor,actor);assert.equal(calls[0].params.p_client,domain);
    for(const [path,body] of [[`/${domain}/block`,{code:'B1',name:'Synthetic',client_id:actor}],[`/${domain}/activate`,{}],[`/${domain}/contact`,{full_name:'Synthetic',mobile:'9000000000',is_active:true}]]){
      assert.equal((await post(path,body)).status,400);
    }
    assert.equal(calls.length,1);
  }finally{await new Promise(r=>server.close(r));}
});

test('Admin HTTP contract reports database denial/conflict/unavailable without false success or raw server details',async()=>{
  for(const [code,status] of [['23505',409],['42501',403],['PGRST202',503],['XX000',500]]){
    const app=express();app.use(express.json());app.use((req,res,next)=>{req.profile=admin;req.authUser={id:actor};next();});
    app.use('/drafts',createClientTicketingManagementRouter({getClient:()=>({rpc:async()=>({error:{code,message:status>=500?'SYNTHETIC_PRIVATE_SERVER_DETAIL':'Synthetic validation denial'}})})}));
    const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
    try{
      const response=await fetch(`http://127.0.0.1:${server.address().port}/drafts/${domain}/block`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:'B1',name:'Synthetic'})});
      const body=await response.json();assert.equal(response.status,status);assert.equal(body.ok,false);assert.equal(body.code,code);
      assert.doesNotMatch(JSON.stringify(body),/SYNTHETIC_PRIVATE_SERVER_DETAIL/);
    }finally{await new Promise(r=>server.close(r));}
  }
});
