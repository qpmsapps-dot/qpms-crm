import test from 'node:test';
import assert from 'node:assert/strict';
import {applyIdentityBulkReview,identityReviewValues,identityReviewSummary} from '../shared/retailIdentitySubmission.js';
const a={row:{id:'a'},store_code:'KA1',store_name:'Confirmed KA',state:'KA'},b={row:{id:'b'},store_code:'TG1',store_name:'Confirmed TG',state:'TG'},c={row:{id:'c'},store_code:'KL1',store_name:'Confirmed KL',state:'KL'};
test('bulk review never infers status and changes only selected drafts',()=>{
 const original={c:{operating_status:'Inactive',reason:'Existing KL draft'}},before=structuredClone(original);
 assert.deepEqual(identityReviewValues(a,original),{operating_status:'',reason:''});
 assert.throws(()=>applyIdentityBulkReview([a,b],original,{operating_status:'',reason:'Source-backed reason'}),/Choose Active or Inactive/);
 const next=applyIdentityBulkReview([a,b],original,{operating_status:'Active',reason:' Confirmed Version 2 evidence reviewed '});assert.deepEqual(original,before);assert.deepEqual(next.c,before.c);assert.equal(next.a.operating_status,'Active');assert.equal(next.b.reason,'Confirmed Version 2 evidence reviewed');
});
test('individual status/reason overrides are reflected in state-wise confirmation, with incomplete rows held separately',()=>{
 const drafts=applyIdentityBulkReview([a,b,c],{},{operating_status:'Active',reason:'Confirmed source evidence'});drafts.b={...drafts.b,operating_status:'Inactive',reason:'TG source closure evidence'};drafts.c={...drafts.c,reason:''};
 const summary=identityReviewSummary([a,b,c],drafts);assert.equal(summary.selected,3);assert.deepEqual(summary.valid.map(r=>r.row.id),['a','b']);assert.equal(summary.invalid_rows,1);assert.equal(summary.invalid[0].field,'reason');assert.equal(summary.invalid[0].store_code,'KL1');assert.ok(summary.groups.some(g=>g.state==='TG'&&g.operating_status==='Inactive'&&g.count===1));assert.equal(identityReviewValues(b,drafts).reason,'TG source closure evidence');
});
