import test from 'node:test';
import assert from 'node:assert/strict';
import {deleteClientDeepCleaningUpload} from '../services/clientDeepCleaningService.js';
import {removeRetiredEvidenceObject} from '../services/retiredEvidenceStorageService.js';
const actor={id:'11111111-1111-4111-8111-111111111111',auth_user_id:'22222222-2222-4222-8222-222222222222',employee_code:'SYNTHETIC',role:'FO',business:'Reliance Retail',status:'Active',is_active:true};
const parent={id:'44444444-4444-4444-8444-444444444444',store_code:'STORE1',status:'draft',submitted_by_user_id:actor.auth_user_id};
const upload={id:'66666666-6666-4666-8666-666666666666',submission_id:parent.id,uploaded_by_user_id:actor.auth_user_id,storage_bucket:'client-deep-cleaning-uploads',storage_path:`deep-cleaning/reliance-retail/STORE1/${parent.id}/before/file.jpg`};
function fixture(mode='success') {
 const events=[];let present=true;let retired=false;let removed=false;
 class Query {
  constructor(table){this.table=table;this.op='read';}
  select(){return this;}eq(){return this;}delete(){this.op='delete';return this;}
  async maybeSingle(){
   if(this.op==='delete')return this.execute();
   if(this.table==='client_deep_cleaning_submissions')return {data:{...parent}};
   if(this.table==='evidence_storage_retirements')return mode==='uncertain'?{error:{message:'unavailable'}}:{data:retired?{bucket:upload.storage_bucket,path:upload.storage_path,evidence_id:upload.id,parent_id:parent.id,owner_id:actor.auth_user_id}:null};
   return {data:present?{...upload}:null};
  }
  execute(){events.push('metadata_delete');if(mode==='submitted')return {error:{code:'23514',message:'Submitted evidence is immutable'}};if(mode==='timeout')return {error:{message:'ambiguous timeout'}};if(mode==='zero')return {data:null};present=false;retired=true;return {data:{...upload}};}
  then(a,b){return Promise.resolve(this.execute()).then(a,b);}
 }
 const client={rpc:async()=>({data:null}),from:t=>new Query(t),storage:{from:()=>({remove:async()=>{events.push('storage_remove');removed=true;return mode==='storage-failure'?{error:{message:'unavailable'}}:{data:[]};}})}};
 return {client,events,get removed(){return removed;},get present(){return present;}};
}
test('P0: finalizer wins after draft read: rejected metadata delete never removes committed object',async()=>{
 const f=fixture('submitted');await assert.rejects(deleteClientDeepCleaningUpload(f.client,actor,parent.id,upload.id));assert.equal(f.removed,false);assert.equal(f.present,true);
});
for(const mode of ['timeout','zero','uncertain'])test(`cleanup fails closed on ${mode} metadata/retirement result`,async()=>{const f=fixture(mode);await assert.rejects(deleteClientDeepCleaningUpload(f.client,actor,parent.id,upload.id));assert.equal(f.removed,false);});
test('abandoned reference is retired before physical cleanup',async()=>{const f=fixture();await deleteClientDeepCleaningUpload(f.client,actor,parent.id,upload.id);assert.deepEqual(f.events,['metadata_delete','storage_remove']);});
test('failed physical cleanup never restores a deleted reference',async()=>{const f=fixture('storage-failure');await assert.rejects(deleteClientDeepCleaningUpload(f.client,actor,parent.id,upload.id));assert.equal(f.present,false);});
for(const bucket of ['training-evidence','client-deep-cleaning-uploads']) {
 for(const field of ['bucket','path','evidence_id','parent_id','owner_id'])test(`${bucket}: cleanup rejects mismatched committed retirement ${field}`,async()=>{
  const row={bucket,path:'private/path',evidence_id:'evidence',parent_id:'session',owner_id:'owner'};row[field]='foreign';let removed=false;
  const query={select(){return this;},eq(){return this;},async maybeSingle(){return {data:row};}};
  const client={from:()=>query,storage:{from:()=>({remove:async()=>{removed=true;return {};}})}};
  await assert.rejects(removeRetiredEvidenceObject(client,{bucket,path:'private/path',evidenceId:'evidence',parentId:'session',ownerId:'owner'}),e=>e.code==='evidence_retirement_unconfirmed');assert.equal(removed,false);
 });
}

