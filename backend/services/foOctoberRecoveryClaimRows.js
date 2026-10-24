// Platform-neutral daily projection shared by server CSV and browser Excel.
// Request snapshots must not be summed as separate employee/day claims.
const safe = value => String(value ?? '').replace(/^\s*[=+@\-]/, "'$&");
const number = value => value === null || value === undefined || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null;
const round = value => Math.round(value * 100) / 100;
export function octoberRecoveryClaimRows(records = [], employeeName = '') {
  const days = new Map();
  for (const row of new Map(records.filter(r=>r.id).map(r=>[r.id,r])).values()) {
    const key=`${row.employee_code}:${row.attendance_date}`;const rows=days.get(key)||[];rows.push(row);days.set(key,rows);
  }
  return [...days.values()].sort((a,b)=>`${a[0].employee_code}:${a[0].attendance_date}`.localeCompare(`${b[0].employee_code}:${b[0].attendance_date}`)).map(rows=>{
    // Positive additive credits make the original payable snapshot monotonic.
    // PostgreSQL transaction-start timestamps can be out of commit order.
    const approved=rows.filter(r=>r.status==='approved').sort((a,b)=>Number(a.original_payable_km)-Number(b.original_payable_km)||String(a.id).localeCompare(String(b.id)));
    const pending=rows.filter(r=>r.status==='pending'), relevant=approved.length?approved:pending.length?pending:rows;
    const first=relevant[0],baseKm=number(first.original_payable_km),baseAmount=number(first.original_claim_amount),km=round(approved.reduce((n,r)=>n+Number(r.approved_additional_km),0)),amount=round(approved.reduce((n,r)=>n+Number(r.additional_amount),0));
    const rates=[...new Set(relevant.map(r=>Number(r.travel_rate)))];
    return {'Employee Code':safe(first.employee_code),'Employee Name':safe(first.employee_name||employeeName),'Attendance Date':first.attendance_date,
      'Existing Payable KM':baseKm??'Unknown','Recovered KM':km,'Final Payable KM':baseKm===null?'Unknown':round(baseKm+km),
      'Travel Rate':rates.length===1?rates[0]:`Mixed: ${rates.join(', ')}`,'Additional Amount':amount,
      'Final Claim Amount':baseAmount===null?'Unknown':round(baseAmount+amount),
      'Recovery Reason':safe([...new Set(relevant.map(r=>r.recovery_reason))].join('; ')),
      'Approved By':safe([...new Set(approved.map(r=>r.approved_by))].join('; ')),
      'Approval Status':approved.length?'Approved':pending.length?'Pending':'Rejected'};
  });
}
