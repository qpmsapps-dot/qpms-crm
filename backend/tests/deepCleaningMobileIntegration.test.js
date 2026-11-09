import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import http from 'node:http';
import express from 'express';
import { createClientDeepCleaningRouter } from '../routes/clientDeepCleaningRoutes.js';
import {
  assertScheduledCleaningEvidence, createClientDeepCleaningSubmission,
  submitClientDeepCleaningSubmission, loadOwnedSubmission,
  createClientDeepCleaningUploadUrl, createClientDeepCleaningUploadViewUrl,
  updateClientDeepCleaningDraft, buildClientDeepCleaningStoragePath,
} from '../services/clientDeepCleaningService.js';
import { cleaningFilters, listDeliveredCleaningSchedules } from '../services/retailCleaningDeliveryService.js';

const fo = { id: '11111111-1111-4111-8111-111111111111', auth_user_id: '22222222-2222-4222-8222-222222222222', employee_code: 'FO1', role: 'FO', business: 'Reliance Retail', status: 'Active', is_active: true };
const pair = '33333333-3333-4333-8333-333333333333';
const draft = () => ({ id: '44444444-4444-4444-8444-444444444444', schedule_id: '55555555-5555-4555-8555-555555555555', retail_store_id: 'store', store_code: 'STORE1', deep_cleaning_date: '2026-11-06', status: 'draft', submitted_by_user_id: fo.auth_user_id, metadata: { source: 'retail-cleaning.v1', evidence_format: 'paired_v1' } });
const evidence = () => ['before', 'after', 'document'].map((kind, i) => ({ id: `u${i}`, submission_id: draft().id, upload_type: kind, upload_status: 'uploaded', uploaded_by_user_id: fo.auth_user_id, storage_bucket: 'client-deep-cleaning-uploads', storage_path: buildClientDeepCleaningStoragePath({ submission: draft(), uploadType: kind, mimeType: kind === 'document' ? 'application/pdf' : 'image/jpeg', id: `u${i}` }), mime_type: kind === 'document' ? 'application/pdf' : 'image/jpeg', file_size: 10, metadata: kind === 'document' ? {} : { pair_id: pair, pair_order: 1 } }));

class Query {
  constructor(rows) { this.rows = rows; this.filters = []; }
  select() { return this; } order() { return this; }
  eq(k,v) { this.filters.push(r => r[k] === v); return this; }
  in(k,v) { this.filters.push(r => v.includes(r[k])); return this; }
  async maybeSingle() { return { data: this.matches()[0] || null }; }
  matches() { return this.rows.filter(r => this.filters.every(f => f(r))); }
  then(resolve,reject) { return Promise.resolve({ data: this.matches() }).then(resolve,reject); }
}
function fixture({ row = draft(), uploads = evidence() } = {}) {
  const calls = []; const intents = new Map();
  const client = {
    from(table) { return new Query(table === 'client_deep_cleaning_submissions' ? [row] : uploads); },
    async rpc(name,args) {
      if(name==='rpc_combined_release_begin'||name==='rpc_combined_release_end')return {data:null};
      calls.push({name,args});
      if (name === 'rpc_retail_cleaning_delivery_v1') {
        if (args.p_auth !== fo.auth_user_id) return {error:{code:'42501'}};
        return {data:{contract_version:'retail-cleaning.v1',rows:[{...row,state:'KL',geographic_state:'KL',scheduled_date:'2026-11-06',permitted_actions:['view','execute']}]}};
      }
      if (name === 'rpc_retail_cleaning_submission_v1') {
        assert.equal(args.p_actor, fo.id); assert.equal(args.p_auth, fo.auth_user_id);
        if (args.p_action === 'begin') return {data: row};
        if (args.p_action === 'finalize') {
          row.status = 'submitted'; row.final_outcome = args.p_data.outcome;
          row.not_done_reason = args.p_data.not_done_reason;
        }
        return {data: row};
      }
      if (name === 'rpc_client_cleaning_upload_intent_v1') {
        if (!intents.has(args.p_request)) intents.set(args.p_request, {id:args.p_request, storage_bucket:'client-deep-cleaning-uploads', storage_path:args.p_upload.storage_path, upload_type:args.p_upload.upload_type, mime_type:args.p_upload.mime_type});
        return {data: intents.get(args.p_request)};
      }
      throw Error('Unexpected RPC: '+name);
    },
    storage: {from(bucket) { assert.equal(bucket,'client-deep-cleaning-uploads'); return {
      async list(_directory,{search}) { return {data:[{name:search,metadata:{size:10}}]}; },
      async createSignedUploadUrl() { return {data:{signedUrl:'https://synthetic.invalid/upload'}}; },
      async createSignedUrl() { return {data:{signedUrl:'https://synthetic.invalid/private'}}; },
    }; }},
  };
  return {client,calls,row,intents};
}

test('schedule delivery binds authenticated UUIDs, ignores supplied FO/store scope, and paginates', async () => {
  let seen; const rows = Array.from({length:51}, (_,i) => ({id:`s${i}`,store_code:'STORE1',store_name:'Synthetic Store',geographic_state:'KL',status:'Planned'}));
  const result = await listDeliveredCleaningSchedules({rpc:async(name,args)=>{assert.equal(name,'rpc_retail_cleaning_delivery_v1');seen=args;return {data:{contract_version:'retail-cleaning.v1',rows}};}},fo,{month:'2026-11',page:2,limit:50,employee_code:'OTHER',fo_profile_id:'OTHER',stores:['OTHER']});
  assert.equal(result.rows.length,1); assert.equal(result.pagination.total,51);
  assert.equal(seen.p_actor,fo.id); assert.equal(seen.p_auth,fo.auth_user_id); assert.equal(seen.p_stores,null);
  assert.equal(result.rows[0].geographic_state,'KL');
});
test('India range uses India midnight; invalid filters and incompatible delivery fail closed', async () => {
  assert.equal(cleaningFilters({},new Date('2026-11-05T18:30:00Z')).from,'2026-11-06');
  assert.throws(()=>cleaningFilters({month:'2026-13'}));
  await assert.rejects(listDeliveredCleaningSchedules({rpc:async()=>({data:{rows:[]}})},fo,{}),e=>e.code==='incompatible_schedule_contract');
  await assert.rejects(listDeliveredCleaningSchedules({rpc:async()=>({error:{code:'42501'}})},fo,{}),e=>e.statusCode===403);
});
test('scheduled draft creation uses installed begin RPC and authenticated identity', async () => {
  const f=fixture(); const result=await createClientDeepCleaningSubmission(f.client,fo,{schedule_id:f.row.schedule_id,submitted_by_user_id:'OTHER'});
  assert.equal(result.schedule_id,f.row.schedule_id); assert.equal(f.calls[0].args.p_auth,fo.auth_user_id);
});
for (const [name,remove,code] of [['before','before','before_upload_required'],['after','after','after_upload_required'],['supporting document','document','single_supporting_document_required']]) {
  test(`Done without ${name} is rejected before finalization`,async()=>{
    const f=fixture({uploads:evidence().filter(u=>u.upload_type!==remove)});
    await assert.rejects(submitClientDeepCleaningSubmission(f.client,fo,f.row.id,{outcome:'Completed'}),e=>e.code===code);
    assert.equal(f.calls.filter(c=>c.args.p_action==='finalize').length,0);
  });
}
test('Done requires exactly one separate document, complete pairs and no pending uploads',()=>{
  assert.throws(()=>assertScheduledCleaningEvidence({...draft(),uploads:[...evidence(),{...evidence()[2],id:'extra'}]}),e=>e.code==='single_supporting_document_required');
  assert.throws(()=>assertScheduledCleaningEvidence({...draft(),uploads:[...evidence(),{upload_status:'pending'}]}),e=>e.code==='incomplete_uploads');
  const rows=evidence(); rows[1].metadata.pair_id='different';
  assert.throws(()=>assertScheduledCleaningEvidence({...draft(),uploads:rows}),e=>e.code==='incomplete_comparison_pair');
});
test('Done with all verified evidence preserves schedule/store/FO and replays only the same terminal outcome',async()=>{
  const f=fixture(); const result=await submitClientDeepCleaningSubmission(f.client,fo,f.row.id,{outcome:'Completed'});
  assert.equal(result.final_outcome,'Completed'); assert.equal(result.schedule_id,draft().schedule_id); assert.equal(result.store_code,'STORE1'); assert.equal(result.submitted_by_user_id,fo.auth_user_id);
  await submitClientDeepCleaningSubmission(f.client,fo,f.row.id,{outcome:'Completed'});
  assert.equal(f.calls.filter(c=>c.args.p_action==='finalize').length,1);
  await assert.rejects(submitClientDeepCleaningSubmission(f.client,fo,f.row.id,{outcome:'Not Done',not_done_reason:'Closed'}),e=>e.code==='outcome_already_saved');
});
test('Not Done requires a trimmed reason and no photo/document evidence',async()=>{
  const f=fixture({uploads:[]});
  await assert.rejects(submitClientDeepCleaningSubmission(f.client,fo,f.row.id,{outcome:'Not Done',not_done_reason:'   '}),e=>e.code==='not_done_reason_required');
  const result=await submitClientDeepCleaningSubmission(f.client,fo,f.row.id,{outcome:'Not Done',not_done_reason:'  Store closed  '});
  assert.equal(result.final_outcome,'Not Done'); assert.equal(result.not_done_reason,'Store closed'); assert.equal(result.uploads.length,0);
  const reopened=await loadOwnedSubmission(f.client,fo,result.id,{includeUploads:true}); assert.equal(reopened.not_done_reason,'Store closed');
});
test('another FO cannot read, finalize or obtain private evidence for the owner',async()=>{
  const f=fixture(); const other={...fo,auth_user_id:'another-auth',id:'another-profile'};
  for(const call of [()=>loadOwnedSubmission(f.client,other,f.row.id),()=>submitClientDeepCleaningSubmission(f.client,other,f.row.id,{outcome:'Completed'}),()=>createClientDeepCleaningUploadViewUrl(f.client,other,f.row.id,'u0')]) await assert.rejects(call(),e=>e.code==='submission_not_found');
});
test('scheduled store and date cannot be moved by the client',async()=>{
  const f=fixture();for(const payload of [{store_code:'OTHER'},{deep_cleaning_date:'2026-11-07'}])await assert.rejects(updateClientDeepCleaningDraft(f.client,fo,f.row.id,payload),e=>e.code==='scheduled_fields_locked');
});
test('lost upload intent response reuses request identity/path and private bucket',async()=>{
  const f=fixture();const payload={upload_type:'before',filename:'before.jpg',mime_type:'image/jpeg',file_size:10,pair_id:pair,pair_order:1,request_id:'66666666-6666-4666-8666-666666666666'};
  const first=await createClientDeepCleaningUploadUrl(f.client,fo,f.row.id,payload);const retry=await createClientDeepCleaningUploadUrl(f.client,fo,f.row.id,payload);
  assert.equal(first.upload_id,retry.upload_id);assert.equal(first.storage_path,retry.storage_path);assert.equal(f.intents.size,1);assert.equal(first.storage_bucket,'client-deep-cleaning-uploads');
});
test('owned private image viewing verifies object before a short-lived signed URL',async()=>{
  const f=fixture();const result=await createClientDeepCleaningUploadViewUrl(f.client,fo,f.row.id,'u0');
  assert.equal(result.expires_in,600);assert.equal(result.signed_url,'https://synthetic.invalid/private');
});
test('no legacy finalizer or direct schedule table dependency in the new delivery boundary',()=>{
  const service=readFileSync(new URL('../services/clientDeepCleaningService.js',import.meta.url),'utf8');
  assert.ok(!service.includes('rpc_finalize_client_deep_cleaning_schedule'));
  const delivery=readFileSync(new URL('../services/retailCleaningDeliveryService.js',import.meta.url),'utf8');
  assert.ok(!delivery.includes(".from('client_deep_cleaning_schedules')"));
});
test('authenticated HTTP schedule/outcome contract preserves body, denies another FO and rejects blank reason',async()=>{
  const f=fixture({uploads:[]});const app=express();app.use(express.json());
  app.use('/api/client-deep-cleaning',createClientDeepCleaningRouter({getClient:()=>f.client,requireAuth(req,res,next){
    if(!req.headers.authorization)return res.status(401).json({message:'Authentication required'});
    req.profile=req.headers.authorization==='Bearer synthetic-owner'?fo:{...fo,auth_user_id:'other-auth'};next();
  }}));
  const server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}/api/client-deep-cleaning`;
  try {
    assert.equal((await fetch(base+'/schedules')).status,401);
    assert.equal((await fetch(base+'/schedules',{headers:{authorization:'Bearer synthetic-other'}})).status,403);
    const owner={authorization:'Bearer synthetic-owner','content-type':'application/json'};
    const list=await (await fetch(base+'/schedules?month=2026-11',{headers:owner})).json();
    assert.equal(list.contract_version,'retail-cleaning.v1');assert.equal(list.rows[0].store_code,'STORE1');
    const url=base+`/submissions/${f.row.id}/submit`;
    assert.equal((await fetch(url,{method:'POST',headers:owner,body:JSON.stringify({outcome:'Not Done',not_done_reason:' '})})).status,400);
    const saved=await (await fetch(url,{method:'POST',headers:owner,body:JSON.stringify({outcome:'Not Done',not_done_reason:' Store closed '})})).json();
    assert.equal(saved.submission.final_outcome,'Not Done');assert.equal(saved.submission.not_done_reason,'Store closed');
  } finally { server.closeAllConnections();await new Promise(resolve=>server.close(resolve)); }
});
test('pending database patch pins the inspected function and adds only reviewed evidence invariants',()=>{
  const original=readFileSync(new URL('../../artifacts/deep-cleaning-integration/installed-finalizer-baseline.sql',import.meta.url),'utf8').replaceAll('\r','').trim();
  const sql=readFileSync(new URL('../../supabase/pending_review/20261106_deep_cleaning_required_document.sql',import.meta.url),'utf8');
  const fingerprint=createHash('md5').update(original).digest('hex');
  assert.ok(sql.includes(fingerprint));
  assert.ok(sql.includes("if outcome='Completed' and ("));
  assert.ok(sql.includes("upload_type in ('document','checklist')"));
  assert.ok(sql.includes("Exactly one supporting document required"));
  assert.ok(sql.includes("if s.schedule_id is not null and s.status='submitted' then"));
  const grants=sql.match(/grant\s+[^;]+;/gi)||[];
  assert.deepEqual(grants.map(s=>s.toLowerCase()),['grant select on public.evidence_storage_retirements to service_role;']);
  assert.match(sql,/alter table public\.evidence_storage_retirements enable row level security/i);
  assert.ok(!/disable\s+row\s+level/i.test(sql));
  const additions=sql.slice(sql.indexOf("  if outcome='Completed' and (\n   select count(*)"),sql.indexOf("  update public.client_deep_cleaning_submissions set status='submitted'"));
  assert.equal(sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.rpc_retail_cleaning_submission_v1'),sql.indexOf('-- Prevent an evidence deletion')).replace(additions,'').trim().replace(/;$/, ''),original);
});
