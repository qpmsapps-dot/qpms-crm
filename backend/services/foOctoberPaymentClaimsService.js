import {createHash} from 'node:crypto';
import {employeeKey,hundredths,octoberClaimData,octoberError,octoberRows,OCTOBER_START} from './foOctoberClaimsService.js';

export function paymentFingerprint(rows){
 return createHash('sha256').update(JSON.stringify(rows.map(r=>[r.id,hundredths(r.eligible_km??0),hundredths(r.petrol_amount??0)]).sort((a,b)=>a[0].localeCompare(b[0])))).digest('hex');
}
export const REPORT_CONFIRMATION_PREFIX='REPORT_ONLY_SUPER_ADMIN_CONFIRMATION_V1:';
// This exporter never posts claims, approves expenses, or changes the Admin ledger.
export async function octoberPaymentClaimData(client,filters={}){
 const data=await octoberClaimData(client,filters);
 const attendance=await octoberRows(client,'fo_attendance','id,employee_code,attendance_date,eligible_km,petrol_amount',q=>q.gte('attendance_date','2026-10-01').lte('attendance_date','2026-10-31'));
 const byId=new Map(attendance.map(a=>[a.id,a]));
 if(byId.size!==attendance.length)throw octoberError('Duplicated payment attendance.',409);
 const adjustments=await octoberRows(client,'fo_oct2026_claim_adjustments','employee_code,claim_month,adjustment_type,requested_km,status,reason',q=>q.eq('claim_month',OCTOBER_START),'employee_code');
 const byCode=new Map(adjustments.map(a=>[employeeKey(a.employee_code),a]));
 const selected=data.groups.flatMap(g=>g.rows),claims=[];
 for(let i=0;i<selected.length;i+=100)claims.push(...await octoberRows(client,'fo_travel_expense_claims','id,attendance_id,employee_code,travel_leg_id,claim_type,travel_mode,fare_amount,status,reviewed_at,reviewed_by_auth_user_id,proof_file_url,remarks,created_at',q=>q.in('employee_code',selected.slice(i,i+100).map(r=>r.employee_code))));
 const seen=new Set(),evidence=new Set();
 for(const row of selected){
  const source=attendance.filter(a=>employeeKey(a.employee_code)===row.employee_code);
  if(source.reduce((n,a)=>n+hundredths(a.eligible_km??0),0)!==row.original||source.reduce((n,a)=>n+hundredths(a.petrol_amount??0),0)!==row.petrol)throw octoberError('Payment snapshot changed; retry export.',409);
  row.reportKm=row.original;row.reportOnlyKm=0;row.other=0;row.parkingTicket=0;row.pendingExpenses=0;row.verifiedExpenses=0;row.otherVerified=0;row.parkingTicketVerified=0;
  const adjustment=byCode.get(row.employee_code);
  if(adjustment?.reason?.startsWith(REPORT_CONFIRMATION_PREFIX)){
   let confirmation;try{confirmation=JSON.parse(adjustment.reason.slice(REPORT_CONFIRMATION_PREFIX.length))}catch{throw octoberError('Invalid report-only confirmation.',409)}
   if(adjustment.status!=='PROVISIONAL'||adjustment.adjustment_type!=='ADD_KM'||confirmation.kind!=='branch_head_approved_super_admin_confirmed_pending_audit'||confirmation.financial_posting_authorized!==false||confirmation.attendance_fingerprint!==paymentFingerprint(source)||confirmation.requested_hundredths!==hundredths(adjustment.requested_km))throw octoberError('Report-only confirmation is stale or invalid; verify against posted records before exporting.',409);
   row.reportOnlyKm=hundredths(adjustment.requested_km);row.reportKm+=row.reportOnlyKm;
  }
 }
 const rowsByCode=new Map(selected.map(r=>[r.employee_code,r]));
 for(const claim of claims){
  if(!claim.id||seen.has(claim.id))throw octoberError('Duplicated expense claim source.',409);seen.add(claim.id);
  const row=rowsByCode.get(employeeKey(claim.employee_code)),a=byId.get(claim.attendance_id);
  if(!row)throw octoberError('Ambiguous expense employee.',409);
  if(!a){if(!claim.attendance_id&&String(claim.created_at).slice(0,7)==='2026-10')row.pendingExpenses++;continue;}
  if(employeeKey(a.employee_code)!==row.employee_code)throw octoberError('Expense attendance employee mismatch.',409);
  if(['rejected','cancelled'].includes(claim.status))continue;
  if(claim.status!=='approved'||!claim.reviewed_at||!claim.reviewed_by_auth_user_id){row.pendingExpenses++;continue;}
  const value=hundredths(claim.fare_amount,'Expense amount'),type=String(claim.claim_type||'').toLowerCase(),mode=String(claim.travel_mode||'').toLowerCase();
  const parking=type==='parking'||(mode==='other'&&/^parking claim\b/i.test(claim.remarks||''));
  if(!parking&&!['auto','bus','train','other'].includes(mode))throw octoberError('Approved expense has an unsupported reimbursement mode.',409);
  if(type&&!['parking','transport','ticket','fare'].includes(type))throw octoberError('Approved expense has an unknown claim type.',409);
  // A fare belongs to one claim category only. Travel-leg fare is never added again.
  const category=parking||['ticket','fare'].includes(type)||['bus','train'].includes(mode)?'parkingTicket':'other';
  for(const key of [claim.travel_leg_id&&`leg:${claim.travel_leg_id}:${category}`,claim.proof_file_url&&`proof:${claim.proof_file_url.split('?')[0]}`,!claim.travel_leg_id&&!claim.proof_file_url&&`unlinked:${claim.attendance_id}:${mode}:${type}:${value}`].filter(Boolean)){
   if(evidence.has(key))throw octoberError('Potential duplicate approved expense; reconcile before export.',409);evidence.add(key);
  }
  row[category]+=value;row[category+'Verified']++;row.verifiedExpenses++;
 }
 for(const group of data.groups)group.rows=group.rows.filter(r=>r.reportKm>0);
 data.groups=data.groups.filter(g=>g.rows.length);
 data.totals={attendance_rows:0,employees:0,original:0,reportKm:0,reportOnlyKm:0,petrol:0,other:0,parkingTicket:0,total:0,pendingExpenses:0};
 for(const row of data.groups.flatMap(g=>g.rows)){
  row.total=row.petrol+row.other+row.parkingTicket;
  data.totals.employees++;data.totals.attendance_rows+=row.attendance_days;
  for(const key of ['original','reportKm','reportOnlyKm','petrol','other','parkingTicket','total','pendingExpenses'])data.totals[key]+=row[key];
 }
 return data;
}
