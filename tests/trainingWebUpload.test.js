import test from 'node:test';
import assert from 'node:assert/strict';
import {uploadWebTrainingEvidence,webTrainingReady,webTrainingUploader} from '../src/utils/trainingWebUpload.js';
import {canAccessRoute} from '../src/utils/authRoles.js';
const photo=new File(['synthetic'],'photo.png',{type:'image/png'});
test('Operations Manager upload navigation does not grant HK reporting or another module',()=>{
  const profile={role:'Operations Manager',rawRole:'Operations Manager',business:'Reliance Retail'};
  assert.equal(canAccessRoute(profile,'/reliance-retail/training-upload'),true);
  assert.equal(canAccessRoute(profile,'/reliance-retail/training'),false);
  for(const role of ['FO','KAM','Branch Head','MIS_HK'])assert.equal(canAccessRoute({...profile,role,rawRole:role},'/reliance-retail/training-upload'),false);
  assert.equal(canAccessRoute({...profile,business:'Airport'},'/reliance-retail/training-upload'),false);
});
test('Web upload retries reuse content/topic identity; bytes alone never qualify as verified',async()=>{
  const calls=[];
  const request=async c=>{calls.push(c);return c.url.endsWith('upload-url')?{data:{upload:{evidence_id:'e',signed_upload_url:'/api/training/sessions/s/evidence/e/content'}}}:{data:{evidence:{metadata:{upload_status:'uploaded'}}}};};
  for(let i=0;i<2;i++)assert.equal(await uploadWebTrainingEvidence(request,'s',photo,'topic'),'e');
  assert.equal(calls[0].data.upload_key,calls[3].data.upload_key);
  assert.deepEqual(calls.map(c=>c.method),['post','put','post','post','put','post']);
  await assert.rejects(()=>uploadWebTrainingEvidence(async c=>c.url.endsWith('upload-url')?request(c):{data:{}},'s',photo,'topic'),/not confirmed/);
});
test('malicious upload URL, invalid size and non-photo topic evidence are rejected',async()=>{
  let calls=0;const request=async()=>{calls++;return {data:{upload:{evidence_id:'e',signed_upload_url:'https://external.invalid'}}};};
  await assert.rejects(()=>uploadWebTrainingEvidence(request,'s',photo,'topic'),/grant is invalid/);assert.equal(calls,1);
  calls=0;await assert.rejects(()=>uploadWebTrainingEvidence(request,'s',new File(['x'],'proof.pdf',{type:'application/pdf'}),'topic'));
  await assert.rejects(()=>uploadWebTrainingEvidence(request,'s',new File([],'empty.png',{type:'image/png'}),'topic'));assert.equal(calls,0);
});
test('readiness is MEPC Web-only, editable, covered, verified topic and completion evidence',()=>{
  const value={session:{submission_source:'Web',status:'draft',can_edit:true},category:{code:'technical_mep'},topics:[{id:'t',is_covered:true}],evidence:[{evidence_type:'topic_photo',training_session_topic_id:'t',metadata:{upload_status:'uploaded'}},{evidence_type:'additional_document',metadata:{upload_status:'uploaded'}}]};
  assert.equal(webTrainingReady(value),true);
  for(const changed of [{...value,topics:[]},{...value,topics:[{id:'t',is_covered:false}]},{...value,session:{...value.session,can_edit:false}},{...value,category:{code:'hk'}},{...value,evidence:value.evidence.map(e=>({...e,metadata:{upload_status:'pending'}}))}])assert.equal(webTrainingReady(changed),false);
  for(const role of ['MIS_HK','Branch Head','KAM','FO'])assert.equal(webTrainingUploader({role}),false);
});
