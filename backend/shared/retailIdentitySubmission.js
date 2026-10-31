export function identitySubmissionIssues(row,reason){
 const issues=[];
 if(String(reason??'').trim().length<3)issues.push({field:'reason',code:'REVIEW_REASON_REQUIRED',message:'Enter the maker source-review reason (at least 3 characters).'});
 if(!String(row.store_name??'').trim())issues.push({field:'store_name',code:'OFFICIAL_NAME_REQUIRED',message:'Official store name is required.'});
 if(!['Active','Inactive'].includes(row.operating_status))issues.push({field:'operating_status',code:'OPERATING_STATUS_REQUIRED',message:'Select an explicit operating status: Active or Inactive.'});
 if(!String(row.supervisor_name??'').trim())issues.push({field:'supervisor_name',code:'OWNERSHIP_EVIDENCE_REQUIRED',message:'Genuine supervisor-only ownership evidence is required.'});
 return issues;
}
