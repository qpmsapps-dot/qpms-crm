const text=value=>String(value??'').trim();
export function identitySubmissionEligible(item){
 if(item.canonical_id||!text(item.store_name)||(item.blocking_identity_issues||[]).length||(item.technical_issues||[]).length)return false;
 if(item.review_status==='READY_FOR_IDENTITY_REVIEW')return true;
 // AOP expiry/exception-sheet evidence is not a Store Code collision. The maker
 // must still choose status explicitly and a different checker must approve it.
 return item.review_status==='IDENTITY_REVIEW_REQUIRED'&&(item.issues||[]).includes('EXCEPTION_SHEET_REVIEW')&&!(item.issues||[]).some(i=>['MISSING_STORE_NAME','CANONICAL_NAME_CONFLICT','SOURCE_REVIEW_NOTE'].includes(i));
}
// Shared ownership evidence is explicitly entered by the maker and still needs
// independent approval. It never creates or assigns an operational FO account.
export function identityBatchFields(item,{drafts={},supervisor='',supervisorByState={}}={}){
 const draft=drafts[item.row.id]||{};
 return {store_name:text(draft.store_name??item.store_name),supervisor_name:text(supervisor)||text(draft.supervisor_name??item.source_supervisor)||text(supervisorByState[item.state])};
}
export function identityBatchPlan(items,options={}){
 const eligible=[],ownership=[],invalid=[];
 for(const item of items){const fields=identityBatchFields(item,options);if(!identitySubmissionEligible(item)||!fields.store_name)invalid.push(item);else eligible.push(item);}
 return {eligible,ownership,invalid,ownership_states:[...new Set(ownership.map(i=>i.state))].map(state=>({state,count:ownership.filter(i=>i.state===state).length}))};
}
