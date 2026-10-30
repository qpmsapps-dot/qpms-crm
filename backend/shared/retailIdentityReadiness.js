import {classifyUnifiedRow} from './retailUnifiedClassification.js';
import {storeKey} from './retailAttendance.js';

// A review queue, never an approval manifest. Optional operational mappings do
// not gate identity review; existing source-bound activation remains authoritative.
export function identityReadiness(snapshot,sourceRows=snapshot.rows){
 const stores=snapshot.stores||[],states=new Set(stores.map(s=>s.state));
 const queue=sourceRows.filter(r=>!r.withdrawn_at).map(row=>{
  const source=row.raw?row:row.source||row,state=row.source_state||row.state||source.state;
  const code=storeKey(row.store_code||source.store_code),canonical=stores.find(s=>storeKey(s.store_code)===code);
  const flags=classifyUnifiedRow(row);
  const name=row.review?.store_name||source.review?.store_name||source.store_name||'';
  const identityFlags=flags.issues.filter(i=>['CANONICAL_NAME_CONFLICT','EXCEPTION_SHEET_REVIEW','SOURCE_REVIEW_NOTE','MISSING_STORE_NAME'].includes(i));
  const status=canonical?'EXISTING_CANONICAL':flags.blocking_identity_issues.length||flags.technical_issues.length?'BLOCKED_IDENTITY_CONFLICT':!name||identityFlags.length?'IDENTITY_REVIEW_REQUIRED':'READY_FOR_IDENTITY_REVIEW';
  states.add(state);
  return {row_id:row.id||null,source_row:row.source_row,store_code:code,state,store_name:name,canonical_id:canonical?.id||null,review_status:status,...flags,original_verification_status:row.verification_status||'PENDING_VERIFICATION',approval_decision:null,source_sha256:row.source_sha256||snapshot.files?.find(f=>f.id===row.batch_id)?.sha256||null,row_digest:row.row_digest,version:row.version||null};
 });
 const state_counts=[...states].filter(Boolean).sort().map(state=>{
  const canonical=stores.filter(s=>s.state===state),rows=queue.filter(r=>r.state===state);
  const distinct=items=>new Set(items.map(r=>r.store_code).filter(Boolean)).size;
  return {state,canonical_stores:canonical.length,active_canonical_stores:canonical.filter(s=>s.status==='Active').length,provisional_source_rows:rows.length,provisional_codes:distinct(rows),identity_pending_codes:distinct(rows.filter(r=>!r.canonical_id)),identity_review_ready_codes:distinct(rows.filter(r=>r.review_status==='READY_FOR_IDENTITY_REVIEW')),conflicted_codes:distinct(rows.filter(r=>r.actual_conflict_issues.length)),blocking_identity_codes:distinct(rows.filter(r=>r.blocking_identity_issues.length))};
 });
 return {queue,state_counts};
}
