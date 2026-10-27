import test from 'node:test';import assert from 'node:assert/strict';import {loadKmEvidence} from '../services/foKmEvidenceService.js';
test('legacy identity support does not admit OR grammar, malformed whitespace or Unicode identities',async()=>{
 for(const employee_code of [' QPMS TN 100','QPMS TN 100 ','QPMS  TN 100','QPMS,TN100','QPMS(TN100)','QPMS"TN100','QPMS\tTN100','QPMS\nTN100','QPMS TN💰']){
  const client={from(table){assert.equal(table,'fo_attendance');return{select(){return this;},eq(){return this;},async single(){return{data:{id:'a',employee_code},error:null};}};}};
  await assert.rejects(loadKmEvidence(client,'a'),{code:'km_identity_invalid'});
 }
});
