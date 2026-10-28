import test from 'node:test';
import assert from 'node:assert/strict';
import XLSX from 'xlsx';
import { readFileSync, existsSync } from 'node:fs';
import { parseStoreReview, validateStoreReview, REVIEW_HEADERS } from '../services/retailStoreImportValidation.js';

const values = ['S1','Store','City','PY','TN','Trends',1,0,0.2,0,0,'2026-04-01','2027-03-31','PY!2','','CANDIDATE','NO','',''];
function workbook(rows = [values]) { const b = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(b, XLSX.utils.aoa_to_sheet([REVIEW_HEADERS,...rows]), 'STORE UPLOAD REVIEW'); return XLSX.write(b,{type:'buffer',bookType:'xlsx'}); }
const parse = rows => parseStoreReview(workbook(rows), 'review.xlsx');
const check = (p, stores = [], options = {}) => validateStoreReview(p, stores, {today:'2026-10-28',...options});
const store = {id:'store-id',store_code:'S1',store_name:'Store',state:'PY',status:'Active'};
const decision = (p, kind, more = {}) => ({id:'decision-id',kind,status:'APPROVED',file_sha256:p.checksum,row_digest:p.rows[0].row_digest,source_row:2,store_code:'S1',approval_ref:'REF-1',reviewer_id:'reviewer',evidence_sha256:'a'.repeat(64),approved_at:'2026-10-28T00:00:00Z',state:'PY',...more});

test('NO and missing approval evidence remain pending', () => {
  assert.equal(check(parse()).identity_ready,0);
  const r = [...values]; r[16]='YES'; r[17]='REF-1';
  assert.equal(check(parse([r])).identity_ready,0);
});
test('independent identity approval never derives approved AOP from components', () => {
  const r = [...values]; r[16]='YES'; r[17]='REF-1'; const p = parse([r]);
  const d = decision(p,'identity',{store_name:'Store',store_status:'Active',operational_model:'SUPERVISOR_ONLY',supervisor_name:'Verified supervisor'});
  const out = check(p,[],{decisions:[d]}); assert.equal(out.identity_ready,1); assert.equal(out.aop_ready,0);
  for (const change of [{file_sha256:'b'.repeat(64)},{row_digest:'b'.repeat(64)},{source_row:3},{status:'REVOKED'},{valid_until:'2026-10-27'},{evidence_sha256:''}]) assert.equal(check(p,[],{decisions:[{...d,...change}]}).identity_ready,0);
  const no = parse(); assert.equal(check(no,[],{decisions:[decision(no,'identity',{...d,file_sha256:no.checksum,row_digest:no.rows[0].row_digest})]}).identity_ready,0);
});
test('canonical identities and PY geography are preserved', () => {
  const out=check(parse(),[store]); assert.equal(out.rows[0].identity_action,'PRESERVE_EXISTING'); assert.equal(out.rows[0].state,'PY'); assert.equal(out.states.find(s=>s.state==='PY').reporting_state,'TN');
  const r=[...values];r[3]='TN'; assert.ok(check(parse([r]),[store]).rows[0].issues.includes('CANONICAL_GEOGRAPHY_CONFLICT'));
  assert.throws(()=>check(parse(),[store,store]),/Duplicate normalized canonical/);
});
test('duplicates, missing names, closed evidence and expired periods are visible', () => {
  const r=[...values];r[1]='';r[14]='Closed';r[11]='2025-04-01';r[12]='2026-01-01';const out=check(parse([r,r]));
  for(const code of ['DUPLICATE_UPLOAD_CODE','MISSING_STORE_NAME','CLOSED_INACTIVE_EVIDENCE','EXPIRED_BUDGET_PERIOD'])assert.ok(out.rows[0].issues.includes(code));
});
test('AOP requires distinct evidence, an existing active identity and no overlapping period', () => {
  const r=[...values];r[16]='YES';r[17]='REF-1'; const p=parse([r]);
  const d=decision(p,'aop',{retail_store_id:'store-id',hk_count:1.25,mepc_count:0,effective_from:'2026-04-01',effective_to:'2027-03-31'});
  assert.equal(check(p,[store],{decisions:[d]}).aop_ready,1);
  assert.equal(check(p,[],{decisions:[d]}).aop_ready,0);
  assert.equal(check(p,[{...store,status:'Inactive'}],{decisions:[d]}).aop_ready,0);
  const aop=[{retail_store_id:'store-id',effective_from:'2027-03-31',effective_to:null}];
  assert.equal(check(p,[store],{decisions:[d],aop}).aop_ready,0);
});
test('KA/KN normalizes geography to KA and reporting to KN; TG is recognized', () => {
  for(const state of ['KA','KN','TG']) { const r=[...values];r[3]=state;r[4]=state;const out=check(parse([r]));assert.equal(out.rows[0].state,state==='KN'?'KA':state);assert.ok(!out.rows[0].issues.includes('INVALID_GEOGRAPHY'));assert.ok(!out.rows[0].issues.includes('REPORTING_STATE_CONFLICT')); }
});
test('a combined old/new code cannot become a new physical identity',()=>{
  const r=[...values];r[0]='TUG5/SLUA';r[16]='YES';r[17]='REF-1';const p=parse([r]);
  const d=decision(p,'identity',{store_code:'TUG5/SLUA',store_name:'Store',store_status:'Active',operational_model:'SUPERVISOR_ONLY',supervisor_name:'Verified'});
  const out=check(p,[],{decisions:[d]});assert.equal(out.identity_ready,0);assert.ok(out.rows[0].issues.includes('COMPOSITE_OR_AMBIGUOUS_STORE_CODE'));
});
test('template formulas and missing headers are rejected', () => {
  const bytes=workbook();const w=XLSX.read(bytes);w.Sheets['STORE UPLOAD REVIEW'].A2={t:'s',v:'S1',f:'"S1"'};
  assert.throws(()=>parseStoreReview(XLSX.write(w,{type:'buffer',bookType:'xlsx'}),'review.xlsx'),/Formula/);
  assert.throws(()=>parseStoreReview(Buffer.from('not a workbook'),'review.xlsx'),/Invalid Excel/);
});
const realWorkbook=process.env.RETAIL_STORE_REVIEW_WORKBOOK||new URL('../../import_sources/Reliance_Retail_Store_Master_Audit_Upload_Review.xlsx',import.meta.url);
test('real review workbook is parsed without activating any candidate', {skip:!existsSync(realWorkbook)}, () => {
  const p=parseStoreReview(readFileSync(realWorkbook),'review.xlsx');
  assert.equal(p.checksum,'642c51949d159b89876476e81879ae9c9b0a7cb8ac7bbfaac69965036f9de78e');assert.equal(p.rows.length,854);
  const result=check(p);assert.equal(result.identity_ready,0);assert.equal(result.aop_ready,0);assert.equal(result.unknown_state_rows,0);
});
