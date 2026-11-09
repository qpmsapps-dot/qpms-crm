import { summarizeVerifiedCleaningSchedules } from './retailStatePerformance.js';
export const recordedFoName = row => row?.fo_name || row?.submitted_by_name || row?.submitted_by_employee_name || row?.performed_by_name || row?.metadata?.executor_name || '';
export const recordedFoCode = row => row?.submitted_by_employee_code || row?.employee_code || row?.metadata?.executor_employee_code || '';
export const recordedStatus = row => row?.status || row?.display_status || 'Not recorded';
export const cleaningPhotoCount = row => Number.isFinite(row?.before_count) && Number.isFinite(row?.after_count) ? row.before_count + row.after_count : null;
export function cleaningView(report, historical, {
  status = '',
  query = ''
} = {}) {
  const sourceSchedules = [...(report?.schedules || []), ...(historical?.schedules || [])];
  const sourceWork = [...(report?.submissions || []), ...(historical?.submissions || [])];
  const scheduleById = new Map(sourceSchedules.map(row => [row.id, row]));
  const joined = sourceWork.map(row => ({
    ...row,
    schedule: scheduleById.get(row.schedule_id),
    scheduled_date: row.scheduled_date || scheduleById.get(row.schedule_id)?.scheduled_date
  }));
  const term = query.trim().toLocaleLowerCase();
  const matches = row => !term || [row.store?.store_code, row.store?.store_name, recordedFoName(row), recordedFoCode(row), row.not_done_reason].filter(Boolean).join(' ').toLocaleLowerCase().includes(term);
  const linked = plan => joined.filter(row => row.schedule_id === plan.id || plan.submission_ids?.includes(row.id));
  const statusMatches = (row, plan) => !status || row.status === status || row.display_status === status || plan?.display_status === status;
  const schedules = sourceSchedules.filter(plan => (matches(plan) || linked(plan).some(matches)) && (statusMatches(plan) || linked(plan).some(row => statusMatches(row))));
  const work = joined.filter(row => matches(row) && statusMatches(row, row.schedule));
  const summary = summarizeVerifiedCleaningSchedules(schedules);
  const operational = schedules.filter(row => row.source_kind !== 'IFMS_EXCEL');
  return {
    schedules,
    work,
    summary,
    overdue: operational.filter(row => row.overdue === true && row.display_status === 'Scheduled').length,
    statuses: [...new Set([...sourceSchedules.flatMap(row => [row.display_status, row.status]), ...sourceWork.map(row => row.status)].filter(Boolean))].sort()
  };
}
