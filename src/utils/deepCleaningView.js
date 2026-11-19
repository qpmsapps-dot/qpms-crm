import { summarizeVerifiedCleaningSchedules } from './retailStatePerformance.js';
import { summarizeCleaningReports } from '../../backend/shared/retailModuleReports.js';
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
  const joined = sourceWork.map(row => {
    const schedule=scheduleById.get(row.schedule_id)||sourceSchedules.find(plan=>plan.submission_ids?.includes(row.id));
    const link=schedule?.metadata;
    const verified=['cleaning-match.v2','cleaning-match.manual.v2'].includes(link?.verified_link_contract)&&link.verified_submission_id===row.id&&link.verified_linked_at;
    return {...row,schedule,scheduled_date:row.scheduled_date||schedule?.scheduled_date,
      audit_trail:[...(row.audit_trail||[]),...(verified?[{id:schedule.id+'-verified-link',action:link.manual_reason?'Authorized manual schedule link: '+link.manual_reason:'Verified exact store/date schedule match',actor_profile_id:link.verified_actor_profile_id,created_at:link.verified_linked_at}]:[])]};
  });
  const term = query.trim().toLocaleLowerCase();
  const matches = row => !term || [row.store?.store_code, row.store?.store_name, recordedFoName(row), recordedFoCode(row), row.not_done_reason].filter(Boolean).join(' ').toLocaleLowerCase().includes(term);
  const linked = plan => joined.filter(row => row.schedule_id === plan.id || plan.submission_ids?.includes(row.id));
  const statusMatches = (row, plan) => !status || row.status === status || row.display_status === status || plan?.display_status === status || (status==='Completed' && String(row.status).toLowerCase()==='submitted');
  const schedules = sourceSchedules.filter(plan => (matches(plan) || linked(plan).some(matches)) && (statusMatches(plan) || linked(plan).some(row => statusMatches(row))));
  const work = joined.filter(row => !row.linked_only && matches(row) && statusMatches(row, row.schedule));
  const scheduledSummary = summarizeVerifiedCleaningSchedules(schedules);
  const matchedSchedules=schedules.map(row=>String(row.display_status||row.status).toLowerCase()==='completed'&&!row.submission_ids?.length?{...row,display_status:'Scheduled'}:row);
  const completion = summarizeCleaningReports(work,report?.schedules===null?null:matchedSchedules);
  const summary = {...scheduledSummary,total:{...scheduledSummary.total,...completion.total,report_completed:completion.total.completed,completed:completion.total.scheduled_completed},
    rows:scheduledSummary.rows.map(row=>({...row,...completion.rows.find(state=>state.state===row.state),report_completed:completion.rows.find(state=>state.state===row.state)?.completed||0,completed:completion.schedule_available?(completion.rows.find(state=>state.state===row.state)?.scheduled_completed??0):null,
      ...(completion.schedule_available?{}:{scheduled:null,pending:null,other:null,percentage:null})}))};
  const operational = schedules.filter(row => row.source_kind !== 'IFMS_EXCEL');
  return {
    schedules,
    work,
    linkedWork:joined.filter(row=>row.linked_only),
    summary,
    overdue: operational.filter(row => row.overdue === true && row.display_status === 'Scheduled').length,
    statuses: [...new Set([...sourceSchedules.flatMap(row => [row.display_status, row.status]), ...sourceWork.map(row => row.status)].filter(Boolean))].sort()
  };
}
