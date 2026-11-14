import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {gateCombinedMutationRoutes,withCombinedReleaseOperation} from '../services/combinedReleaseGate.js';
import {removeRetiredEvidenceObject} from '../services/retiredEvidenceStorageService.js';
test('normal evidence uploads do not call release controls and preserve actual work failures',async()=>{
 const client={rpc(){throw Error('Release RPC must not run');}};
 for(const route of ['storage:cleaning-upload-grant','storage:training-content']){
  assert.equal(await withCombinedReleaseOperation(client,'actor',route,async()=>42),42);
  await assert.rejects(withCombinedReleaseOperation(client,'actor',route,async()=>{throw Object.assign(Error('Owned object denied'),{code:'42501'});}),{code:'42501'});
 }
});
test('normal router retains original handlers; unrelated gate still denies',async()=>{
 const router={};assert.equal(gateCombinedMutationRoutes(router,{normalOperations:true}),router);
 let ran=false;await assert.rejects(withCombinedReleaseOperation({rpc:async()=>({error:{code:'55000'}})},'actor','unrelated:write',async()=>{ran=true;}),{code:'combined_release_frozen'});assert.equal(ran,false);
});
test('review migration keeps freeze controller, financial objects and RLS untouched',()=>{
 const sql=fs.readFileSync(new URL('./fixtures/retail_normal_operations_independent.reference.sql',import.meta.url),'utf8');
 assert.ok(sql.includes('normal_retail_freeze_dependency_retired'));
 assert.ok(!/update\s+qpms_release.control|disable\s+trigger|disable\s+row\s+level|alter\s+policy|fo_km|financial_writes_enabled/i.test(sql));
 assert.ok(sql.includes("m is null or (qpms_release.mis_module(m)"));
 assert.ok(sql.includes("'^cleaning:phase1b:(begin|update|intent|complete|retire|finalize)$'"));
});

function retirementFixture(bucket,overrides={}) {
 const identity={bucket,path:'owned/path.jpg',evidenceId:'evidence',parentId:'parent',ownerId:'owner'};
 const row={bucket,path:identity.path,evidence_id:identity.evidenceId,parent_id:identity.parentId,owner_id:identity.ownerId,...overrides};
 const calls=[];let removeError=null;
 const client={from(table){assert.equal(table,'evidence_storage_retirements');const q={select(){return q;},eq(){return q;},async maybeSingle(){return {data:row};}};return q;},async rpc(name){calls.push(name);return {error:{code:'55000'}};},storage:{from(actual){assert.equal(actual,bucket);return {async remove(paths){assert.deepEqual(paths,[identity.path]);calls.push('remove');return {error:removeError};}};}}};
 return {client,identity,calls,failRemove(){removeError=Error('Storage unavailable');}};
}
test('both normal buckets clean only committed tombstones without release RPCs; retries retain identity',async()=>{
 for(const bucket of ['client-deep-cleaning-uploads','training-evidence']){
  const f=retirementFixture(bucket);await removeRetiredEvidenceObject(f.client,f.identity);await removeRetiredEvidenceObject(f.client,f.identity);assert.deepEqual(f.calls,['remove','remove']);
 }
});
test('missing or mismatched retirement preserves objects, owners and active intents',async()=>{
 for(const bad of [{owner_id:'foreign'},{parent_id:'foreign'},{evidence_id:'foreign'},{path:'foreign'}]){
  const f=retirementFixture('training-evidence',bad);await assert.rejects(removeRetiredEvidenceObject(f.client,f.identity),{code:'evidence_retirement_unconfirmed'});assert.deepEqual(f.calls,[]);
 }
 const f=retirementFixture('training-evidence');f.client.from=()=>{const q={select(){return q;},eq(){return q;},maybeSingle:async()=>({data:null})};return q;};
 await assert.rejects(removeRetiredEvidenceObject(f.client,f.identity),{code:'evidence_retirement_unconfirmed'});assert.deepEqual(f.calls,[]);
});
test('other retired buckets retain existing freeze admission',async()=>{
 const f=retirementFixture('unrelated-private');await assert.rejects(removeRetiredEvidenceObject(f.client,f.identity),{code:'combined_release_frozen'});assert.deepEqual(f.calls,['rpc_combined_release_begin']);
});
test('storage failure after confirmed retirement stays retryable without deleting audit metadata',async()=>{
 const f=retirementFixture('training-evidence');f.failRemove();await assert.rejects(removeRetiredEvidenceObject(f.client,f.identity),{code:'storage_delete_failed'});assert.deepEqual(f.calls,['remove']);
});
