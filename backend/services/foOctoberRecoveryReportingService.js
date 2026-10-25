import { recoveryPages, roundKm } from './foOctoberRecoveryEvidenceService.js';
import { octoberRecoveryClaimRows } from './foOctoberRecoveryClaimRows.js';

// Read activation is independent of write activation. Missing/unreadable ledger
// is an error once enabled, never silently interpreted as no approved credits.
export async function loadApprovedOctoberRecoveries(client, codes, from, to, environment = process.env) {
  const octoberEnabled=environment.KM_OCTOBER_RECOVERY_REPORTING_ENABLED==='true' && to>='2026-10-01' && from<='2026-10-31';
  const sharedEnabled=environment.KM_INCREMENTAL_REPORTING_ENABLED==='true';
  if(!octoberEnabled&&!sharedEnabled)return [];
  const all = [], unique = [...new Set(codes.map(c => String(c).toUpperCase()).filter(Boolean))];
  for (let i = 0; i < unique.length; i += 100) if(octoberEnabled)all.push(...await recoveryPages(() => client.from('fo_october_km_recoveries').select('*').in('employee_code', unique.slice(i, i + 100)).eq('status', 'approved').gte('attendance_date', from).lte('attendance_date', to).order('id')));
  if(sharedEnabled)for(let i=0;i<unique.length;i+=100){
    const credits=await recoveryPages(()=>client.from('fo_km_incremental_credits').select('*').in('employee_code',unique.slice(i,i+100)).gte('attendance_date',from).lte('attendance_date',to).order('id'));
    all.push(...credits.map(c=>({id:c.id,employee_code:c.employee_code,attendance_date:c.attendance_date,applied_to_attendance:c.applied_to_attendance,status:'approved',
      approved_additional_km:c.added_km,additional_amount:c.amount,travel_rate:c.rate,travel_mode:c.evidence.travel_mode,
      original_payable_km:c.evidence.original_payable_km,resulting_payable_km:c.evidence.resulting_payable_km,
      original_claim_amount:c.evidence.original_claim_amount,resulting_claim_amount:c.evidence.resulting_claim_amount,
      before_state:c.evidence.before_state,approved_by:c.actor||c.trigger_source,approved_at:c.created_at,created_at:c.created_at,
      recovery_reason:'Evidence-supported KM reconciliation',journey_start:c.started_at,journey_end:c.ended_at})));
  }
  return all;
}
export function recoveryTotals(rows = []) {
  const unique = [...new Map(rows.filter(r => r.status === 'approved' && r.id && !r.applied_to_attendance).map(r => [r.id, r])).values()];
  return { recovered_km: roundKm(unique.reduce((n, r) => n + Number(r.approved_additional_km), 0)), additional_amount: roundKm(unique.reduce((n, r) => n + Number(r.additional_amount), 0)), records: unique };
}
export function overlayRecoveryRows(attendances, recoveries) {
  const result = attendances.map(a => ({ ...a, recovery_approved_km: 0, recovery_additional_amount: 0, recovery_records: [] }));
  const byDay = new Map();
  for (const r of recoveryTotals(recoveries).records) { const key = `${r.employee_code}:${r.attendance_date}`; const list = byDay.get(key) || []; list.push(r); byDay.set(key, list); }
  for (const [key, records] of byDay) {
    let target = result.find(a => `${String(a.employee_code).toUpperCase()}:${a.attendance_date}` === key);
    if (!target) {
      // Explicit financial report row, not an attendance session or fake End Day.
      target = { id: null, recovery_only: true, employee_code: records[0].employee_code, attendance_date: records[0].attendance_date, status: 'Recovery adjustment', total_approved_km: 0, petrol_amount: 0, travel_mode: records[0].travel_mode, metadata: {} };
      result.push(target);
    }
    const totals = recoveryTotals(records); Object.assign(target, { recovery_approved_km: totals.recovered_km, recovery_additional_amount: totals.additional_amount, recovery_records: records });
  }
  return result;
}
export function attachRangeRecovery(dataset, rows) {
  const totals = recoveryTotals(rows); dataset.recovery_adjustments = rows;
  dataset.recovery_summary = { ...totals, existing_payable_km: dataset.period_summary.canonical_payable_km,
    final_payable_km: roundKm(dataset.period_summary.canonical_payable_km + totals.recovered_km), final_claim_amount: roundKm(dataset.period_summary.canonical_petrol_amount + totals.additional_amount) };
  const byDate = new Map(); for (const r of totals.records) { const items = byDate.get(r.attendance_date) || []; items.push(r); byDate.set(r.attendance_date, items); }
  for (const [date, items] of byDate) {
    let target = dataset.daily_summary.find(r => r.attendance_date === date);
    if (!target) { target = { attendance_date: date, attendance_id: null, attendance_ids: [], status: 'Recovery adjustment', recovery_only: true, payable_km: 0, petrol_amount: 0, kilometer: 0, distance_amount: 0, total_amount: 0, amount: 0 }; dataset.daily_summary.push(target); }
    const t = recoveryTotals(items); target.existing_payable_km = target.payable_km; target.recovered_km = t.recovered_km; target.recovery_records = items;
    for (const key of ['payable_km', 'kilometer']) target[key] = roundKm(Number(target[key] || 0) + t.recovered_km);
    for (const key of ['petrol_amount', 'distance_amount', 'total_amount', 'amount']) target[key] = roundKm(Number(target[key] || 0) + t.additional_amount);
  }
  for (const key of ['canonical_payable_km', 'kilometer']) dataset.period_summary[key] = roundKm(Number(dataset.period_summary[key] || 0) + totals.recovered_km);
  for (const key of ['canonical_petrol_amount', 'distance_amount', 'total_amount']) dataset.period_summary[key] = roundKm(Number(dataset.period_summary[key] || 0) + totals.additional_amount);
  return dataset;
}
const headers = ['Employee Code','Employee Name','Attendance Date','Existing Payable KM','Recovered KM','Final Payable KM','Travel Rate','Additional Amount','Final Claim Amount','Recovery Reason','Approved By','Approval Status'];
export function recoveryCsv(rows) {
  const cell = value => `"${String(value ?? '').replace(/^\s*[=+@\-]/, "'$&").replaceAll('"','""')}"`;
  return '\uFEFF' + [headers, ...octoberRecoveryClaimRows(rows).map(row=>headers.map(header=>row[header]))].map(row => row.map(cell).join(',')).join('\r\n');
}
