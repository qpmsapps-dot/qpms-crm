// October decision/report utilities. No financial writes are permitted here.
export const OCTOBER_START='2026-10-01';
export const OCTOBER_END='2026-10-31';
export const octoberError=(message,statusCode=422)=>Object.assign(new Error(message),{statusCode});
export const employeeKey=value=>String(value??'').replace(/\s+/g,'').toUpperCase();
export function hundredths(value,label='KM'){
 if(!['string','number'].includes(typeof value)||!/^\d+(?:\.\d{1,2})?$/.test(String(value).trim()))throw octoberError(`${label} must be a nonnegative number with at most two decimal places.`);
 const [whole,decimal='']=String(value).trim().split('.');
 const result=Number(whole)*100+Number(decimal.padEnd(2,'0'));
 if(!Number.isSafeInteger(result))throw octoberError(`${label} is too large.`);
 return result;
}
export async function octoberRows(client,table,columns,apply=q=>q,order='id'){
 const rows=[];
 for(let from=0;from<100000;from+=1000){
  const {data,error}=await apply(client.from(table).select(columns)).order(order).range(from,from+999);
  if(error)throw error;
  if(!Array.isArray(data))throw octoberError('Incomplete report source.',503);
  rows.push(...data);
  if(data.length<1000)return rows;
 }
 throw octoberError('Report exceeds the safe row limit; no partial report was generated.',413);
}
export const octoberRange=q=>q.gte('attendance_date',OCTOBER_START).lte('attendance_date',OCTOBER_END);
export async function octoberReviewRows(client){
 const attendance=await octoberRows(client,'fo_attendance','id,attendance_date,eligible_km,petrol_amount',octoberRange);
 const byAttendance=new Map(attendance.map(r=>[r.id,r]));
 const ids=[...byAttendance.keys()],reviews=[];
 for(let from=0;from<ids.length;from+=100)reviews.push(...await octoberRows(client,'fo_missing_km_reviews','id,attendance_id,employee_code,status,review_type,suggested_missing_km,approved_missing_km,checkout_distance_meters,filtered_gps_km,google_route_km,reason_code,requested_clarification,review_remarks',q=>q.in('attendance_id',ids.slice(from,from+100))));
 const decisions=[];
 for(let from=0;from<reviews.length;from+=100)decisions.push(...await octoberRows(client,'fo_missing_km_admin_decisions','review_id,decision,approved_additional_km,verified_already_included_km,justification,evidence_reference,approved_by,decided_at',q=>q.in('review_id',reviews.slice(from,from+100).map(r=>r.id)),'review_id'));
 const byReview=new Map(decisions.map(r=>[r.review_id,r]));
 return reviews.map(r=>({...r,attendance:byAttendance.get(r.attendance_id),admin_decision:byReview.get(r.id)||null})).sort((a,b)=>a.employee_code.localeCompare(b.employee_code)||a.attendance.attendance_date.localeCompare(b.attendance.attendance_date)||a.id.localeCompare(b.id));
}

export async function octoberClaimData(client,{state='',business='',employee=''}={}){
 const [attendance,profiles,adjustments,report,decisions]=await Promise.all([
  octoberRows(client,'fo_attendance','id,employee_code,attendance_date,eligible_km,petrol_amount',octoberRange),
  octoberRows(client,'profiles','id,employee_code,full_name,state,business'),
  octoberRows(client,'fo_oct2026_claim_adjustments','employee_code,claim_month,adjustment_type,requested_km,status',q=>q.eq('claim_month',OCTOBER_START),'employee_code'),
  octoberRows(client,'fo_oct2026_missing_km_report','attendance_id,employee_code,original_payable_km,original_petrol_amount,review_cases,pending_cases,clarification_cases,admin_approved_cases,admin_approved_km',q=>q,'attendance_id'),
  octoberRows(client,'fo_missing_km_admin_decisions','review_id,attendance_id,employee_code,decision,approved_additional_km,verified_already_included_km,approved_by,decided_at,evidence_reference,justification',q=>q,'review_id'),
 ]);
 const unique=(rows,key)=>{const map=new Map();for(const row of rows){const k=key(row);if(map.has(k))throw octoberError('Ambiguous or duplicated report source. No partial report was generated.',409);map.set(k,row)}return map};
 const byId=unique(attendance,r=>r.id),reportById=unique(report,r=>r.attendance_id);
 if(byId.size!==reportById.size)throw octoberError('October report snapshot changed; retry the export.',409);
 const profileByCode=new Map();
 for(const p of profiles){const key=employeeKey(p.employee_code);if(!key)continue;const prior=profileByCode.get(key);if(prior&&['state','business','full_name'].some(k=>String(prior[k]??'').trim()!==String(p[k]??'').trim()))throw octoberError('Ambiguous employee profile mapping; reconcile before export.',409);profileByCode.set(key,p)}
 const adjustmentByCode=unique(adjustments,r=>employeeKey(r.employee_code));
 const decisionsByAttendance=new Map();
 for(const d of decisions){if(!byId.has(d.attendance_id))continue;const list=decisionsByAttendance.get(d.attendance_id)||[];list.push(d);decisionsByAttendance.set(d.attendance_id,list)}
 const employees=new Map();
 for(const a of attendance){
  const key=employeeKey(a.employee_code),r=reportById.get(a.id);
  if(!key||!r||employeeKey(r.employee_code)!==key||hundredths(a.eligible_km??0)!==hundredths(r.original_payable_km)||hundredths(a.petrol_amount??0)!==hundredths(r.original_petrol_amount))throw octoberError('October source totals changed or contain invalid values; retry the export.',409);
  const ds=decisionsByAttendance.get(a.id)||[],approved=ds.filter(d=>d.decision==='approved_for_reconciliation');
  const approvedCents=approved.reduce((n,d)=>n+hundredths(d.approved_additional_km),0);
  if(approved.length!==Number(r.admin_approved_cases)||approvedCents!==hundredths(r.admin_approved_km))throw octoberError('Admin report snapshot changed; retry the export.',409);
  const row=employees.get(key)||{employee_code:key,attendance_days:0,original:0,petrol:0,reviews:0,pending:0,clarification:0,approved:0,approvedKm:0,decisions:[]};
  row.attendance_days++;row.original+=hundredths(a.eligible_km??0);row.petrol+=hundredths(a.petrol_amount??0);
  row.reviews+=Number(r.review_cases);row.pending+=Number(r.pending_cases);row.clarification+=Number(r.clarification_cases);row.approved+=approved.length;row.approvedKm+=approvedCents;
  row.decisions.push(...ds.map(d=>({...d,attendance_date:a.attendance_date})));employees.set(key,row);
 }
 const groups=new Map();
 for(const row of employees.values()){
  const p=profileByCode.get(row.employee_code)||{},st=String(p.state||'UNMAPPED').trim().toUpperCase(),bs=String(p.business||'UNMAPPED').trim();
  if(state&&st!==state||business&&bs!==business||employee&&!row.employee_code.includes(employeeKey(employee)))continue;
  const a=adjustmentByCode.get(row.employee_code);row.proposed=row.original;row.status=a?.status||'NO ADJUSTMENT';
  if(a&&a.status!=='REJECTED'){const km=hundredths(a.requested_km);if(a.adjustment_type==='SET_TOTAL')row.proposed=km;else if(a.adjustment_type==='ADD_KM')row.proposed+=km;else throw octoberError('Unknown provisional adjustment type.',409)}
  row.name=p.full_name||'';const key=st==='TN'?`${st} / ${bs}`:st;
  const list=groups.get(key)||[];list.push(row);groups.set(key,list);
 }
 const totals={attendance_rows:0,employees:0,original:0,proposed:0,petrol:0,approvedKm:0};
 for(const rows of groups.values())for(const row of rows){totals.employees++;totals.attendance_rows+=row.attendance_days;for(const key of ['original','proposed','petrol','approvedKm'])totals[key]+=row[key]}
 return {groups:[...groups].sort(([a],[b])=>a.localeCompare(b)).map(([name,rows])=>({name,rows:rows.sort((a,b)=>a.employee_code.localeCompare(b.employee_code))})),totals};
}
