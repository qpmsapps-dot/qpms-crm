import { reportingState, validDate } from '../../../backend/shared/retailAttendance.js';

export const REPORTING_STATES = Object.freeze([
  { code: 'TN', label: 'Tamil Nadu' }, { code: 'KN', label: 'Karnataka' },
  { code: 'KL', label: 'Kerala' }, { code: 'AP-1', label: 'Andhra Pradesh - 1' },
  { code: 'AP-2', label: 'Andhra Pradesh - 2' }, { code: 'TG', label: 'Telangana' },
]);
/** @typedef {{state:string, presentPct:number, normal:number, notNormal:number, eligible:number, scheduled:number, completed:number, remaining:number}} OperationsRow */
/** @returns {OperationsRow[]} Unavailable metrics remain empty until a compatible adapter exists. */
export function emptyOperations() {
  return REPORTING_STATES.map(({ code }) => ({ state: code, presentPct: 0, normal: 0, notNormal: 0, eligible: 0, scheduled: 0, completed: 0, remaining: 0 }));
}
// Reuse the authoritative reporting mapping; geographic records remain unchanged.
export function reportingRows(rows) {
  return rows.map(row => ({ ...row, state: reportingState(row.state) })).filter(row => REPORTING_STATES.some(state => state.code === row.state));
}
export function selectRows(rows, global = '', local = '') {
  return rows.filter(row => (!global || row.state === global) && (!local || row.state === local));
}
export const sum = (rows, field) => rows.reduce((total, row) => total + (Number.isFinite(row[field]) ? row[field] : 0), 0);
export const percent = (value, denominator) => denominator > 0 ? Math.round(value / denominator * 100) : 0;
const displayDate = date => new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
function monthBounds(month) {
  const start = validDate(`${month}-01`);
  const [year, number] = month.split('-').map(Number);
  return { start, end: `${month}-${new Date(Date.UTC(year, number, 0)).getUTCDate()}` };
}
export function reportingPeriod(month, today) {
  const { start, end } = monthBounds(month);
  validDate(today);
  const cutoff = today < start ? null : today < end ? today : end;
  return { start, end: cutoff, label: cutoff ? `${displayDate(start)} – ${displayDate(cutoff)}` : `${displayDate(start)} – ${displayDate(end)} · Upcoming month` };
}
export function callWindow(month, kind, today) {
  const bounds = monthBounds(month);
  const start = kind === 'cm' ? bounds.start : `${month}-16`;
  const end = kind === 'cm' ? `${month}-15` : bounds.end;
  validDate(today);
  return { start, end, endLabel: displayDate(end), label: `${displayDate(start)} – ${displayDate(end)}`, status: today < start ? 'Upcoming' : today <= end ? 'In progress' : 'Window closed · overdue if remaining' };
}
