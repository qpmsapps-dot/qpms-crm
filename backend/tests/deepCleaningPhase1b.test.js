// Synthetic-only tests. No SDK client, dotenv, credentials or remote endpoint.
import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import {createClientDeepCleaningRouter} from '../routes/clientDeepCleaningRoutes.js';
import {
  createClientDeepCleaningSubmission as create,
  createClientDeepCleaningUploadUrl as intent,
  completeClientDeepCleaningUpload as complete,
  submitClientDeepCleaningSubmission as finalize,
  updateClientDeepCleaningDraft as update,
  listClientDeepCleaningSubmissions as history,
  deleteClientDeepCleaningUpload as retire,
  createClientDeepCleaningUploadViewUrl as view,
} from '../services/clientDeepCleaningService.js';
import {actualCleaningDate, cleaningCommand, CLEANING_CONTRACT, CLEANING_RPC} from '../services/deepCleaningIndependentContract.js';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const profile = {id:id(1),auth_user_id:id(2),employee_code:'SYNTHETIC',role:'FO',business:'Reliance Retail',state:'TG',status:'Active',is_active:true};
const store = {id:id(3),store_code:'FR33',store_name:'Synthetic store',state:'TG',status:'Active'};
const draft = {id:id(4),request_id:id(5),retail_store_id:store.id,store_code:store.store_code,
  deep_cleaning_date:'2026-01-01',status:'draft',submitted_by_user_id:profile.auth_user_id,
  metadata:{evidence_format:'paired_v1',contract_version:CLEANING_CONTRACT}};
const input = {store_code:'FR33',deep_cleaning_date:'2026-01-01',request_id:id(5),evidence_format:'paired_v1'};
const path = (type,n) => `deep-cleaning/reliance-retail/FR33/${draft.id}/${type}/${id(n)}.jpg`;
function evidence() {
  return ['before','after','document'].map((type,n)=>({id:id(10+n),submission_id:draft.id,upload_type:type,
    mime_type:'image/jpeg',file_size:10,original_filename:`${type}.jpg`,upload_status:'uploaded',
    uploaded_by_user_id:profile.auth_user_id,storage_bucket:'client-deep-cleaning-uploads',
    storage_path:path(type==='document'?'documents':type,10+n),
    metadata:{contract_version:CLEANING_CONTRACT,...(type==='document'?{}:{pair_id:id(20),pair_order:1})}}));
}
function fixture() {
  const state={draft:structuredClone(draft),uploads:evidence(),stores:[structuredClone(store)],calls:[],objects:true,
    frozen:false,missing:false,wrongVersion:false,lostDraft:false,grantFailure:false,finalizeCount:0};
  const client={
    from(table) {
      const filters=[]; let lo=0,hi=10000;
      const q={select(){return q;},eq(k,v){filters.push(r=>r[k]===v);return q;},
        in(k,v){filters.push(r=>v.includes(r[k]));return q;},ilike(k,v){filters.push(r=>r[k]?.toLowerCase()===v.toLowerCase());return q;},
        order(){return q;},limit(n){hi=n-1;return q;},range(a,b){lo=a;hi=b;return q;},
        insert(){throw Error('Direct insert forbidden');},update(){throw Error('Direct update forbidden');},delete(){throw Error('Direct delete forbidden');},
        maybeSingle(){return q.then(r=>({...r,data:r.data[0]||null}));},
        then(resolve,reject){
          let rows=table==='reliance_retail_store_operational_ownership'?state.stores:
            table==='client_deep_cleaning_submissions'?[state.draft]:
            table==='client_deep_cleaning_uploads'?state.uploads:[];
          rows=rows.filter(r=>filters.every(f=>f(r)));
          return Promise.resolve({data:structuredClone(rows.slice(lo,hi+1)),count:rows.length,error:null}).then(resolve,reject);
        }};
      return q;
    },
    storage:{from(bucket){assert.equal(bucket,'client-deep-cleaning-uploads');return {
      async list(_dir,{search}){return {data:state.objects?[{name:search,metadata:{size:10,mimetype:'image/jpeg'}}]:[],error:null};},
      async createSignedUploadUrl(p){state.calls.push(['grant',p]);return state.grantFailure?{error:Error('synthetic signing failure')}:{data:{signedUrl:'http://127.0.0.1/synthetic-upload'},error:null};},
      async createSignedUrl(){return {data:{signedUrl:'http://127.0.0.1/synthetic-view'},error:null};},
    };}},
    async rpc(name,p) {
      state.calls.push([name,structuredClone(p)]);
      if(state.frozen)return {error:{code:'55000'}};
      if(name.startsWith('rpc_combined_release_'))return {data:null,error:null};
      assert.equal(name,CLEANING_RPC);
      if(state.missing)return {error:{code:'PGRST202'}};
      if(state.rpcError)return {error:{code:state.rpcError}};
      const a=p.p_action, data=p.p_data;
      let record;
      // Simulates receipts for adapter tests. NOT a PostgreSQL lock test.
      if(a==='begin'){
        if(state.created && JSON.stringify(state.created)!==JSON.stringify(data))return {error:{code:'23505'}};
        state.created??=structuredClone(data);
        Object.assign(state.draft,{request_id:data.request_id,deep_cleaning_date:data.deep_cleaning_date});
        record=state.draft;
        if(state.lostDraft){state.lostDraft=false;throw Error('lost draft response');}
      } else if(a==='update'){
        if(data.deep_cleaning_date)state.draft.deep_cleaning_date=data.deep_cleaning_date;
        record=state.draft;
      } else if(a==='intent'){
        if(state.intent && state.intent.metadata.request_id!==data.request_id)return {error:{code:'23505'}};
        state.intent??={id:id(30),...data,storage_bucket:'client-deep-cleaning-uploads',uploaded_by_user_id:profile.auth_user_id,
          upload_status:'pending',metadata:{request_id:data.request_id,pair_id:data.pair_id,pair_order:data.pair_order}};
        record=state.intent;
      } else if(a==='complete'){
        if(!state.objects)return {error:{code:'P0002'}};
        if(data.storage_path!==state.intent.storage_path)return {error:{code:'42501'}};
        state.intent.upload_status='uploaded';record=state.intent;
      } else if(a==='finalize'){
        if(state.draft.status!=='submitted'){
          state.finalizeCount++;
          Object.assign(state.draft,{status:'submitted',submitted_at:state.submittedAt||'2026-01-02T12:00:00Z',final_outcome:'Completed'});
        }
        record=state.draft;
        if(state.lostFinalizeReply){state.lostFinalizeReply=false;throw Error('lost finalization response');}
      } else if(a==='retire')return {error:{code:'40001'}};
      return {data:{contract_version:state.wrongVersion?'old':CLEANING_CONTRACT,record:structuredClone(record)},error:null};
    },
  };
  return {state,client};
}

test('all genuine 1–14 November dates remain actual dates in independent creation and readback',async()=>{
  for(let day=1;day<=14;day++){
    const date=`2026-11-${String(day).padStart(2,'0')}`;
    const {client,state}=fixture();
    state.submittedAt='2026-11-16T04:30:00Z';
    const saved=await create(client,profile,{...input,deep_cleaning_date:date});
    assert.equal(saved.deep_cleaning_date,date);
    assert.equal(state.created.deep_cleaning_date,date);
    const done=await finalize(client,profile,saved.id,{});
    assert.equal(done.deep_cleaning_date,date);
    assert.equal(done.submitted_at,state.submittedAt);
    const retry=await finalize(client,profile,saved.id,{});
    assert.equal(retry.id,done.id);
    assert.equal(retry.submitted_at,done.submitted_at);
    assert.equal(state.finalizeCount,1);
    assert.equal(state.uploads.filter(u=>u.upload_status==='uploaded').length,3);
  }
});
const errorCode=code=>error=>error.code===code;
const photo={request_id:id(31),pair_id:id(20),pair_order:1,upload_type:'before',mime_type:'image/jpeg',file_size:10,filename:'before.jpg'};

test('actual date: India midnight, prior day, impossible and future',()=>{
  const now=new Date('2026-11-30T20:00:00Z');
  assert.equal(actualCleaningDate('2026-11-30',now),'2026-11-30');
  assert.equal(actualCleaningDate('2026-12-01',now),'2026-12-01');
  for(const date of ['2026-12-02','2026-02-30','2026-2-1',null])assert.throws(()=>actualCleaningDate(date,now),errorCode('invalid_deep_cleaning_date'));
});
test('independent create keeps actual date, UUID and paired format without schedule',async()=>{
  const {client,state}=fixture();const saved=await create(client,profile,input);
  assert.equal(saved.deep_cleaning_date,input.deep_cleaning_date);
  const call=state.calls.find(([n])=>n===CLEANING_RPC)[1];
  assert.equal(call.p_action,'begin');assert.equal(call.p_data.evidence_format,'paired_v1');
  assert.equal(call.p_data.request_id,input.request_id);assert.equal(call.p_auth,profile.auth_user_id);
  assert.equal('schedule_id' in call.p_data,false);
});
test('forged payload store UUID and actor cannot override canonical store/auth',async()=>{
  const {client,state}=fixture();await create(client,profile,{...input,retail_store_id:id(999),p_auth:id(999)});
  const p=state.calls[0][1];assert.equal(p.p_data.retail_store_id,store.id);assert.equal(p.p_auth,profile.auth_user_id);
});
test('unauthorized / forged store is rejected before writer',async()=>{
  const {client,state}=fixture();state.stores[0].state='TN';
  await assert.rejects(create(client,profile,input),errorCode('invalid_store'));assert.equal(state.calls.length,0);
});
test('wrong role and inactive profile cannot create',async()=>{
  for(const patch of [{role:'MIS_HK'},{status:'Inactive'}]){
    const {client}=fixture();await assert.rejects(create(client,{...profile,...patch},input));
  }
});
test('missing independent request identity and independent Not Done fail explicitly',async()=>{
  const {client}=fixture();await assert.rejects(create(client,profile,{...input,request_id:null}),errorCode('request_id_required'));
  await assert.rejects(finalize(client,profile,draft.id,{outcome:'Not Done'}),errorCode('cleaning_upgrade_required'));
});

test('explicit scheduled creation retains the legacy RPC even with an optional client request UUID',async()=>{
  const {client,state}=fixture();
  client.rpc=async(name,p)=>{
    state.calls.push([name,p]);
    assert.equal(name,'rpc_retail_cleaning_submission_v1');
    assert.equal(p.p_action,'begin');assert.equal(p.p_auth,profile.auth_user_id);
    assert.equal(p.p_data.request_id,input.request_id);
    return {data:{...draft,schedule_id:id(9),metadata:{source:'retail-cleaning.v1'}}};
  };
  const result=await create(client,profile,{...input,schedule_id:id(9)});
  assert.equal(result.schedule_id,id(9));assert.equal(state.calls.length,1);
});
test('contradictory Phase 1B draft with a schedule cannot invoke a schedule finalizer',async()=>{
  const {client,state}=fixture();state.draft.schedule_id=id(9);
  await assert.rejects(finalize(client,profile,draft.id),errorCode('cleaning_upgrade_required'));assert.equal(state.calls.length,0);
});

test('all unsupported standalone legacy mutations fail closed without direct-write fallback',async()=>{
  for(const version of [undefined,'unknown-contract']) {
    const {client,state}=fixture();state.draft.metadata.contract_version=version;
    for(const action of [
      ()=>update(client,profile,draft.id,{remarks:'retained'}),
      ()=>intent(client,profile,draft.id,{upload_type:'before'}),
      ()=>complete(client,profile,draft.id,{upload_id:id(10)}),
      ()=>retire(client,profile,draft.id,id(10)),
      ()=>finalize(client,profile,draft.id),
    ]) await assert.rejects(action(),errorCode('cleaning_upgrade_required'));
    assert.equal(state.calls.length,0);
  }
});
test('legacy independent draft remains readable but cannot be silently rewritten',async()=>{
  const {client,state}=fixture();delete state.draft.metadata.contract_version;
  const before=structuredClone(state.draft);assert.equal((await history(client,profile)).rows[0].id,draft.id);
  await assert.rejects(update(client,profile,draft.id,{deep_cleaning_date:'2025-12-31'}),errorCode('cleaning_upgrade_required'));
  await assert.rejects(finalize(client,profile,draft.id),errorCode('cleaning_upgrade_required'));
  assert.deepEqual(state.draft,before);assert.equal(state.calls.length,0);
});
test('missing SQL or mismatched response fails closed without direct writes',async()=>{
  for(const property of ['missing','wrongVersion']){
    const {client,state}=fixture();state[property]=true;
    await assert.rejects(create(client,profile,input),errorCode('cleaning_contract_unavailable'));
  }
});
test('lost draft response recovers same request through history and replay',async()=>{
  const {client,state}=fixture();state.lostDraft=true;
  await assert.rejects(create(client,profile,input),/lost draft response/);
  const rows=await history(client,profile);assert.equal(rows.rows[0].request_id,input.request_id);
  assert.equal((await create(client,profile,input)).id,draft.id);
});
test('same draft request with altered actual date conflicts',async()=>{
  const {client}=fixture();await create(client,profile,input);
  await assert.rejects(create(client,profile,{...input,deep_cleaning_date:'2026-01-02'}),errorCode('cleaning_request_conflict'));
});
test('concurrent create adapter requests use the same mock receipt',async()=>{
  const {client}=fixture();const rows=await Promise.all(Array.from({length:8},()=>create(client,profile,input)));
  assert.equal(new Set(rows.map(r=>r.id)).size,1);
});
test('draft update preserves previous actual date and no schedule payload',async()=>{
  const {client,state}=fixture();await update(client,profile,draft.id,{deep_cleaning_date:'2025-12-31'});
  assert.equal(state.draft.deep_cleaning_date,'2025-12-31');assert.equal(state.calls[0][1].p_action,'update');
  await assert.rejects(update(client,profile,draft.id,{store_code:'FORGED'}),errorCode('draft_store_locked'));
});
test('server rejects future/impossible create and update before any writer',async()=>{
  for(const day of ['2999-01-01','2026-02-30']){
    const {client,state}=fixture();
    await assert.rejects(create(client,profile,{...input,deep_cleaning_date:day}),errorCode('invalid_deep_cleaning_date'));
    await assert.rejects(update(client,profile,draft.id,{deep_cleaning_date:day}),errorCode('invalid_deep_cleaning_date'));
    assert.equal(state.calls.length,0);
  }
});
test('intent persists pair identity/order and stable request',async()=>{
  const {client,state}=fixture();const saved=await intent(client,profile,draft.id,photo);
  assert.equal(state.intent.metadata.pair_id,photo.pair_id);assert.equal(state.intent.metadata.pair_order,1);
  assert.equal(state.intent.metadata.request_id,photo.request_id);assert.equal(saved.upload_id,id(30));
});
test('signing failure retains the original intent and later retries it',async()=>{
  const {client,state}=fixture();state.grantFailure=true;
  await assert.rejects(intent(client,profile,draft.id,photo),/signing failure/);
  const first=state.intent.id;state.grantFailure=false;
  const saved=await intent(client,profile,draft.id,photo);assert.equal(saved.upload_id,first);
});
test('failed supporting-document replacement retains prior photos/document',async()=>{
  const {client,state}=fixture();const original=structuredClone(state.uploads);state.grantFailure=true;
  await assert.rejects(intent(client,profile,draft.id,{...photo,upload_type:'document',pair_id:null,pair_order:null}),/signing failure/);
  assert.deepEqual(state.uploads,original);
});
test('lost upload acknowledgement and completion replay keep identity and photos',async()=>{
  const {client,state}=fixture();const grant=await intent(client,profile,draft.id,photo);
  const payload={...photo,...grant,upload_id:grant.upload_id};
  const first=await complete(client,profile,draft.id,payload);
  const again=await complete(client,profile,draft.id,payload);
  assert.equal(first.id,again.id);assert.equal(state.uploads.length,3);
  const retry=await intent(client,profile,draft.id,{...photo,upload_id:grant.upload_id});assert.equal(retry.upload_id,first.id);
});
test('missing uploaded object reports recoverable missing-object code',async()=>{
  const {client,state}=fixture();const grant=await intent(client,profile,draft.id,photo);state.objects=false;
  await assert.rejects(complete(client,profile,draft.id,{...photo,...grant}),errorCode('storage_object_missing'));
  state.objects=true;assert.equal((await complete(client,profile,draft.id,{...photo,...grant})).upload_status,'uploaded');
});
test('wrong completion path is rejected by RPC and remains pending',async()=>{
  const {client,state}=fixture();const grant=await intent(client,profile,draft.id,photo);
  await assert.rejects(complete(client,profile,draft.id,{...photo,...grant,storage_path:'foreign/object'}),errorCode('store_not_authorized'));
  assert.equal(state.intent.upload_status,'pending');
});
test('invalid MIME, excessive size and invalid pair UUID cannot get intent',async()=>{
  for(const patch of [{mime_type:'text/plain'},{file_size:5242881},{pair_id:'not-a-uuid'}]){
    const {client}=fixture();await assert.rejects(intent(client,profile,draft.id,{...photo,...patch}));
  }
});
test('missing / incomplete pair blocks finalization',async()=>{
  for(const mutate of [s=>s.uploads.splice(0,1),s=>s.uploads[1].metadata.pair_id=id(999)]){
    const {client,state}=fixture();mutate(state);
    await assert.rejects(finalize(client,profile,draft.id),errorCode('incomplete_comparison_pair'));
  }
});
test('missing and duplicate supporting documents block finalization',async()=>{
  for(const mutate of [s=>s.uploads.pop(),s=>s.uploads.push({...s.uploads[2],id:id(999)})]){
    const {client,state}=fixture();mutate(state);
    await assert.rejects(finalize(client,profile,draft.id),errorCode('single_supporting_document_required'));
  }
});
test('wrong evidence owner or foreign Storage path blocks finalization',async()=>{
  for(const patch of [{uploaded_by_user_id:id(999)},{storage_path:'foreign/object'},{storage_bucket:'public'}]){
    const {client,state}=fixture();Object.assign(state.uploads[0],patch);
    await assert.rejects(finalize(client,profile,draft.id),errorCode('evidence_not_authorized'));
  }
});
test('pending upload cannot be silently ignored',async()=>{
  const {client,state}=fixture();state.uploads[0].upload_status='pending';
  await assert.rejects(finalize(client,profile,draft.id),errorCode('incomplete_uploads'));
});
test('actual date remains distinct from timestamp through repeated/concurrent finalization',async()=>{
  const {client,state}=fixture();const results=await Promise.all(Array.from({length:8},()=>finalize(client,profile,draft.id)));
  const replay=await finalize(client,profile,draft.id);
  assert.equal(state.finalizeCount,1);assert.equal(new Set(results.map(r=>r.submitted_at)).size,1);
  assert.equal(replay.deep_cleaning_date,'2026-01-01');assert.equal(replay.submitted_at,'2026-01-02T12:00:00Z');
  assert.ok(state.calls.every(([name])=>!name.includes('schedule')));
});
test('lost finalization response replays original record/time without a second completion',async()=>{
  const {client,state}=fixture();state.lostFinalizeReply=true;
  await assert.rejects(finalize(client,profile,draft.id),/lost finalization response/);
  const savedTime=state.draft.submitted_at;
  const replay=await finalize(client,profile,draft.id);
  assert.equal(replay.submitted_at,savedTime);assert.equal(replay.deep_cleaning_date,draft.deep_cleaning_date);
  assert.equal(state.finalizeCount,1);
});
test('submitted evidence update/intent blocked; retirement conflict retains Storage',async()=>{
  const {client,state}=fixture();state.draft.status='submitted';
  await assert.rejects(update(client,profile,draft.id,{deep_cleaning_date:'2025-12-31'}),errorCode('submitted_record_locked'));
  await assert.rejects(intent(client,profile,draft.id,photo),errorCode('submitted_record_locked'));
  state.rpcError='40001';await assert.rejects(retire(client,profile,draft.id,id(10)),errorCode('cleaning_state_changed'));
});
test('owned evidence viewing remains private and foreign parent hidden',async()=>{
  const {client}=fixture();const signed=await view(client,profile,draft.id,id(10));assert.equal(signed.expires_in,600);
  await assert.rejects(view(client,{...profile,auth_user_id:id(999)},draft.id,id(10)),errorCode('submission_not_found'));
});
test('freeze / permission / conflict SQL errors remain failures',async()=>{
  for(const [rpcError,code] of [['55000','combined_release_frozen'],['42501','store_not_authorized'],['23505','cleaning_request_conflict']]){
    const {client,state}=fixture();state.rpcError=rpcError;
    await assert.rejects(create(client,profile,input),errorCode(code));
  }
});
test('HTTP router retains envelopes, rejects missing auth and preserves closed gate',async(t)=>{
  const {client,state}=fixture();const app=express();app.use(express.json());
  app.use('/api/client-deep-cleaning',createClientDeepCleaningRouter({getClient:()=>client,
    requireAuth(req,res,next){if(req.headers.authorization!=='Bearer synthetic'){res.status(401).json({code:'session_expired'});return;}req.profile=profile;next();}}));
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}/api/client-deep-cleaning`;
  const post=async(body,token='synthetic')=>fetch(`${base}/submissions`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify(body)});
  assert.equal((await post(input,'missing')).status,401);
  const ok=await post(input);assert.equal(ok.status,201);assert.equal((await ok.json()).submission.deep_cleaning_date,input.deep_cleaning_date);
  const headers={authorization:'Bearer synthetic','content-type':'application/json'};
  const req=async(method,path,body)=>fetch(`${base}${path}`,{method,headers,...(body?{body:JSON.stringify(body)}:{})});
  const listed=await req('GET','/submissions');assert.equal((await listed.json()).pagination.total,1);
  const detail=await req('GET',`/submissions/${draft.id}`);assert.equal((await detail.json()).submission.uploads.length,3);
  const patched=await req('PATCH',`/submissions/${draft.id}`,{deep_cleaning_date:'2025-12-31'});
  assert.equal((await patched.json()).submission.deep_cleaning_date,'2025-12-31');
  const uploaded=await req('POST',`/submissions/${draft.id}/upload-url`,photo);
  const grant=(await uploaded.json()).upload;assert.equal(grant.upload_id,id(30));
  const confirmed=await req('POST',`/submissions/${draft.id}/uploads/complete`,{...photo,...grant});
  assert.equal((await confirmed.json()).upload.upload_status,'uploaded');
  const preview=await req('GET',`/submissions/${draft.id}/uploads/${id(10)}/view-url`);
  assert.equal((await preview.json()).view.expires_in,600);
  const done=await req('POST',`/submissions/${draft.id}/submit`,{});
  assert.equal((await done.json()).submission.deep_cleaning_date,'2025-12-31');
  const repeated=await req('POST',`/submissions/${draft.id}/submit`,{});
  assert.equal((await repeated.json()).submission.submitted_at,state.draft.submitted_at);
  state.frozen=true;const closed=await post(input);assert.equal(closed.status,503);assert.equal((await closed.json()).code,'combined_release_frozen');
});
