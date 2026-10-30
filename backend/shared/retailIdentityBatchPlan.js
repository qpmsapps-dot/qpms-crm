const text=value=>String(value??'').trim();
// Shared ownership evidence is explicitly entered by the maker and still needs
// independent approval. It never creates or assigns an operational FO account.
export function identityBatchFields(item,{drafts={},supervisor='',supervisorByState={}}={}){
 const draft=drafts[item.row.id]||{};
 return {store_name:text(draft.store_name??item.store_name),supervisor_name:text(supervisor)||text(draft.supervisor_name??item.source_supervisor)||text(supervisorByState[item.state])};
}
export function identityBatchPlan(items,options={}){
 const eligible=[],ownership=[],invalid=[];
 for(const item of items){const fields=identityBatchFields(item,options);if(item.review_status!=='READY_FOR_IDENTITY_REVIEW'||item.canonical_id||!fields.store_name)invalid.push(item);else if(!fields.supervisor_name)ownership.push(item);else eligible.push(item);}
 return {eligible,ownership,invalid,ownership_states:[...new Set(ownership.map(i=>i.state))].map(state=>({state,count:ownership.filter(i=>i.state===state).length}))};
}
