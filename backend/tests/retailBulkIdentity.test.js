import test from'node:test';import assert from'node:assert/strict';import XLSX from'xlsx';
import{parseBulkIdentityDecisions,validateBulkIdentityDecisions,confirmBulkIdentity}from'../services/retailBulkIdentityService.js';
const actor={id:'00000000-0000-4000-8000-000000000001',role:'ADMIN',is_active:true};
const d={source_row:2,store_code:'KL1',decision:'Approve Identity',store_name:'Official',store_status:'Active',approval_ref:'REF',reviewer_id:actor.id,evidence_sha256:'a'.repeat(64),operational_model:'SUPERVISOR_ONLY',supervisor_name:'Verified supervisor',file_sha256:'b'.repeat(64),row_digest:'c'.repeat(64)};
const b={checksum:d.file_sha256,review:{rows:[{source_row:2,store_code:'KL1',state:'KL',canonical_id:null,row_digest:d.row_digest,store_name:'Official',approval:'YES',approval_ref:'REF',issues:[]}]}};
test('explicit row-bound identity only approval validates and rejects source/reviewer/status drift',()=>{
 assert.equal(validateBulkIdentityDecisions([d],b,actor).approved,1);
 for(const change of [{file_sha256:'x'},{row_digest:'x'},{source_row:3},{reviewer_id:'other'},{store_status:''},{supervisor_name:''},{approval_ref:''}])assert.throws(()=>validateBulkIdentityDecisions([{...d,...change}],b,actor));
 assert.throws(()=>validateBulkIdentityDecisions([d,d],b,actor),/Duplicate/);
 assert.throws(()=>validateBulkIdentityDecisions([d],{...b,review:{rows:[{...b.review.rows[0],canonical_id:'existing'}]}},actor),/protected/);
 assert.throws(()=>validateBulkIdentityDecisions([d],{...b,review:{rows:[{...b.review.rows[0],approval:'NO'}]}},actor),/YES/);
 assert.throws(()=>validateBulkIdentityDecisions([d],{...b,review:{rows:[{...b.review.rows[0],issues:['PRIOR_DUPLICATE_PHYSICAL_IDENTITY_UNRESOLVED']}]}},actor),/Resolve/);
});
test('blank spreadsheet decisions do not become approvals and new write gate defaults closed',async()=>{
 const w=XLSX.utils.book_new();XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet([['Source row','Store Code','Decision','Corrected official name','Operating status','Evidence reference','Reviewer profile ID','Evidence SHA-256','Ownership model','Supervisor name','Final file SHA-256','Final row digest'],[2,'KL1','','Official','Active','REF',actor.id,'a'.repeat(64),'SUPERVISOR_ONLY','Real',d.file_sha256,d.row_digest]]),'Identity decisions');
 assert.throws(()=>parseBulkIdentityDecisions(XLSX.write(w,{type:'buffer',bookType:'xlsx'}),'decisions.xlsx'),/blank rows remain pending/);
 await assert.rejects(()=>confirmBulkIdentity(null,actor,{},{}),/setup/);
});
