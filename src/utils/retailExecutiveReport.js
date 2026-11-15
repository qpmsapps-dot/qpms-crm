import { reportingState } from '../../backend/shared/retailAttendance.js';
import { callWindow } from '../pages/reliance-retail/ifmsDashboardModel.js';
import { canonicalActivityStore } from '../../backend/shared/retailModuleReports.js';

export const EXECUTIVE_MODULES = [
  { id: 'attendance', title: 'Attendance', route: '/reliance-retail/attendance', unit: '%', note: 'Credits / applicable mandays' },
  { id: 'thermography', title: 'Thermography', route: '/reliance-retail/thermography', unit: '', note: 'Currently approved in schedule cohort' },
  { id: 'cm', title: 'CM', route: '/reliance-retail/cmpm', unit: '%', note: 'Completed / applicable stores' },
  { id: 'pm', title: 'PM', route: '/reliance-retail/cmpm', unit: '%', note: 'Completed / applicable stores' },
  { id: 'cleaning', title: 'Deep Cleaning', route: '/reliance-retail/deep-cleaning', unit: '%', note: 'Completed / scheduled jobs' },
  { id: 'training', title: 'Training', route: '/reliance-retail/training', unit: '', note: 'HK + MEPC operational sessions' },
];
export const EXECUTIVE_STATES = ['TN', 'KN', 'KL', 'AP-1', 'AP-2', 'TG'];
export const stateName = state => state === 'KN' ? 'KA' : state;
export const number = value => Number.isFinite(value) ? value.toLocaleString('en-IN', { maximumFractionDigits: 1 }) : 'N/A';
const valid = v => Number.isFinite(v) && v >= 0;
export const ratio = (done, total) => valid(done) && valid(total) && total > 0 ? Math.round(done / total * 1000) / 10 : null;
const sum = (rows, key) => rows.every(r => valid(r[key])) ? rows.reduce((n, r) => n + r[key], 0) : null;
export function previousPeriod(from, to) {
  const [year, month] = from.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 2, 1));
  const prefix = d.toISOString().slice(0, 7);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  const day = Number(to?.slice(8, 10));
  return { from: prefix + '-01', to: prefix + '-' + String(Math.min(day, last)).padStart(2, '0'), comparable: Boolean(day && day <= last) };
}
export function scopedStores(report, scope = {}) {
  return (report?.stores || []).filter(s => (!scope.state || reportingState(s.state) === scope.state) && (!scope.store || s.id === scope.store));
}
export function scopedActivity(rows, report, scope = {}) {
  return rows.flatMap(row => {
    const store = canonicalActivityStore(report?.stores || [], row);
    if (!store || scope.state && reportingState(store.state) !== scope.state || scope.store && store.id !== scope.store) return [];
    return [{ ...row, store }];
  });
}
export function cleaningSubmissionCounts(report, scope = {}) {
  const empty = { 'Submitted reports': null, 'Done reports': null, 'Not Done reports': null };
  const source = report?.modules?.cleaning?.submitted_reports;
  if (scope.store || source?.status !== 'ready' || !Array.isArray(source.rows) ||
      scope.from && scope.from !== report.from || scope.to && scope.to !== report.to) return empty;
  const seen = new Set();
  for (const row of source.rows) {
    const state = reportingState(row.state);
    if (!EXECUTIVE_STATES.includes(state) || seen.has(state) ||
        ['submitted', 'done', 'not_done'].some(key => !Number.isSafeInteger(row[key]) || row[key] < 0) ||
        row.submitted !== row.done + row.not_done) return empty;
    seen.add(state);
  }
  const rows = source.rows.filter(row => !scope.state || reportingState(row.state) === scope.state);
  return { 'Submitted reports': sum(rows, 'submitted'), 'Done reports': sum(rows, 'done'), 'Not Done reports': sum(rows, 'not_done') };
}
function sourceRows(report, id, scope) {
  const source = report?.modules?.[id];
  if (source?.status !== 'ready' || !Array.isArray(source.rows)) return null;
  if (scope.store) return null; // The dashboard contract exposes state aggregates, not per-store attendance/training totals.
  return source.rows.filter(r => !scope.state || reportingState(r.state) === scope.state);
}
export function moduleMetric(report, id, scope = {}) {
  const unavailable = reason => ({ id, value: null, ready: false, reason, counts: {}, rows: [] });
  if (id === 'training') {
    const hk = moduleMetric(report, 'soft', scope), mepc = moduleMetric(report, 'technical', scope);
    if (!hk.ready || !mepc.ready || !valid(hk.value) || !valid(mepc.value)) return unavailable('Both authorized Training classes are required for a combined total.');
    return { id, ready: true, value: hk.value + mepc.value, counts: { 'HK sessions': hk.value, 'MEPC sessions': mepc.value }, rows: [] };
  }
  const rows = sourceRows(report, id, scope);
  if (!rows) return unavailable(scope.store ? 'Per-store aggregates are not supplied by this dashboard endpoint. Open the scoped module report.' : report?.modules?.[id]?.reason || 'Authorized report unavailable.');
  const total = field => sum(rows, field);
  const result = { id, ready: true, rows, counts: {}, value: null };
  if (id === 'attendance') {
    result.counts = { 'HK credits': total('hk_actual'), 'HK mandays': total('hk_target'), 'MEPC credits': total('mepc_actual'), 'MEPC mandays': total('mepc_target') };
    const covered = rows.length > 0 && rows.every(r => r.complete === true);
    result.value = covered ? ratio(total('total_actual'), total('total_target')) : null;
    result.hk = covered ? ratio(total('hk_actual'), total('hk_target')) : null;
    result.mepc = covered ? ratio(total('mepc_actual'), total('mepc_target')) : null;
    result.reason = result.value == null ? 'Incomplete approved AOP/reporting coverage or no applicable mandays.' : 'Weighted credits / approved applicable mandays; HK and MEPC policies unchanged.';
  } else if (id === 'cleaning') {
    const scheduled = total('scheduled'), completed = total('completed'), pending = total('pending'), notDone = total('not_completed');
    result.counts = { Scheduled: scheduled, Completed: completed, Pending: pending, 'Recorded Not Done': notDone };
    result.value = valid(completed) && completed <= scheduled ? ratio(completed, scheduled) : null;
    result.segments = [completed, pending, notDone].every(valid) && scheduled >= completed + pending + notDone
      ? [{ name: 'Completed', value: completed, color: '#22b573' }, { name: 'Pending', value: pending, color: '#eab44a' }, { name: 'Recorded Not Done', value: notDone, color: '#eb6b76' }, { name: 'Other recorded', value: scheduled - completed - pending - notDone, color: '#c7d2e1' }] : null;
    result.reason = 'Cancelled schedules excluded. Overdue counts are not supplied; pending does not mean Not Done.';
  } else if (id === 'cm' || id === 'pm') {
    result.counts = { 'Applicable stores': total('eligible'), Completed: total('completed'), Remaining: total('remaining') };
    result.value = total('completed') <= total('eligible') ? ratio(total('completed'), total('eligible')) : null;
    result.reason = report?.from ? callWindow(report.from.slice(0, 7), id, report.to).label + '; remaining is not a recorded Not Done result.' : 'Reporting window unavailable.';
  } else if (id === 'thermography') {
    result.counts = { Scheduled: total('scheduled'), 'Awaiting approval': total('awaiting'), 'Client approved': total('approved'), 'Approval overdue': total('overdue') };
    result.value = total('approved');
    result.comparisonEligible = false;
    result.reason = 'Current recorded statuses for the selected schedule cohort, not status at the historical cutoff. Approval/overdue may have changed later. Historical status comparison unavailable; overdue is a subset of awaiting approval.';
  } else {
    result.value = total('completed');
    result.counts = { Sessions: result.value };
  }
  return result;
}
export function executiveReport(report, scope = {}) {
  return { stores: scopedStores(report, scope), modules: Object.fromEntries(EXECUTIVE_MODULES.map(m => [m.id, moduleMetric(report, m.id, scope)])), states: EXECUTIVE_STATES.map(state => ({ state, stores: scopedStores(report, { ...scope, state }).length, modules: Object.fromEntries(EXECUTIVE_MODULES.map(m => [m.id, moduleMetric(report, m.id, { ...scope, state })])) })) };
}
export function comparison(current, previous, comparable) {
  if (current?.comparisonEligible === false || previous?.comparisonEligible === false) return null;
  if (!comparable || !current?.ready || !previous?.ready || !Number.isFinite(current.value) || !Number.isFinite(previous.value)) return null;
  return Math.round((current.value - previous.value) * 10) / 10;
}
export function sameInventory(current, previous, scope = {}) {
  if (!current || !previous) return false;
  const identities = report => scopedStores(report, scope).map(s => `${s.id}:${reportingState(s.state)}`).sort().join('|');
  return identities(current) === identities(previous);
}
export function reportExceptions(model) {
  return [
    ['thermography', 'Thermography awaiting client approval', model.modules.thermography.counts['Awaiting approval']],
    ['thermography', 'Thermography approval overdue', model.modules.thermography.counts['Approval overdue']],
    ['cleaning', 'Deep Cleaning pending', model.modules.cleaning.counts.Pending],
    ['cleaning', 'Deep Cleaning recorded Not Done', model.modules.cleaning.counts['Recorded Not Done']],
    ['cm', 'CM stores remaining', model.modules.cm.counts.Remaining],
    ['pm', 'PM stores remaining', model.modules.pm.counts.Remaining],
  ].filter(([, , count]) => valid(count) && count > 0).map(([id, label, count]) => ({ id, label, count }));
}
export function executiveConclusion(model, deltas) {
  const achievements = EXECUTIVE_MODULES.filter(m => model.modules[m.id].comparisonEligible !== false && deltas[m.id] > 0).map(m => m.title);
  const gaps = EXECUTIVE_MODULES.filter(m => !model.modules[m.id].ready || model.modules[m.id].value == null).map(m => m.title);
  return { achievements, gaps, exceptions: reportExceptions(model), text: achievements.length ? `Higher comparable reported results: ${achievements.join(', ')}. Review the defined metric and coverage for each module.` : 'No comparable improvement is established by the available reports.' };
}
