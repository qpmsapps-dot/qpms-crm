export function identitySubmissionIssues(row,reason){
 const issues=[];
 if(String(reason??'').trim().length<3)issues.push({field:'reason',code:'REVIEW_REASON_REQUIRED',message:'Enter the maker source-review reason (at least 3 characters).'});
 if(!String(row.store_name??'').trim())issues.push({field:'store_name',code:'OFFICIAL_NAME_REQUIRED',message:'Official store name is required.'});
 if(!['Active','Inactive'].includes(row.operating_status))issues.push({field:'operating_status',code:'OPERATING_STATUS_REQUIRED',message:'Select an explicit operating status: Active or Inactive.'});

 return issues;
}

export function identityReviewValues(item,drafts={}){
 const id=item.row?.id||item.row_id||item.id,draft=drafts[id]||{};
 return {operating_status:draft.operating_status??'',reason:String(draft.reason??'')};
}
export function applyIdentityBulkReview(items,drafts,{operating_status,reason}){
 if(!['Active','Inactive'].includes(operating_status))throw Error('Choose Active or Inactive before applying bulk values.');
 if(String(reason??'').trim().length<3)throw Error('Enter a source-backed maker review reason before applying bulk values.');
 const next={...drafts};for(const item of items){const id=item.row?.id||item.row_id||item.id;next[id]={...next[id],operating_status,reason:String(reason).trim()};}return next;
}
export function identityReviewSummary(items,drafts={}){
 const groups=new Map(),valid=[],invalid=[];
 for(const item of items){const id=item.row?.id||item.row_id||item.id,values=identityReviewValues(item,drafts),issues=identitySubmissionIssues({store_name:drafts[id]?.store_name??item.store_name,...values},values.reason),status=['Active','Inactive'].includes(values.operating_status)?values.operating_status:'Not set',key=item.state+'|'+status,group=groups.get(key)||{state:item.state,operating_status:status,count:0};group.count++;groups.set(key,group);if(issues.length)invalid.push(...issues.map(issue=>({row_id:id,store_code:item.store_code,state:item.state,...issue})));else valid.push(item);}
 return {selected:items.length,valid,invalid,invalid_rows:new Set(invalid.map(r=>r.row_id)).size,groups:[...groups.values()].sort((a,b)=>a.state.localeCompare(b.state)||a.operating_status.localeCompare(b.operating_status))};
}
