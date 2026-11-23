// Temporary, read-only November 2026 state-level attendance targets from Central MIS.
// Remove this module and its single backend reporting call once verified store AOP totals replace it.
// No migration, stored calculation, attendance mutation or fabricated store AOP is involved.
import { monthDates, reportingState, STATE_OPTIONS, validDate } from './retailAttendance.js';

export const NOVEMBER_2026_STATE_AOP = Object.freeze({
  'AP-1': Object.freeze({ HK: 162.05, MEPC: 30 }),
  'AP-2': Object.freeze({ HK: 274, MEPC: 47 }),
  'KL': Object.freeze({ HK: 219, MEPC: 54 }),
  'KN': Object.freeze({ HK: 558, MEPC: 107 }),
  'TG': Object.freeze({ HK: 197, MEPC: 30.98 }),
  'TN': Object.freeze({ HK: 296.5, MEPC: 56 }),
});

export const NOVEMBER_STATE_AOP_SOURCE = 'nov_2026_central_mis_temporary';
const round = value => Math.round((value + Number.EPSILON) * 1e8) / 1e8;
const blank = state => ({
  state, hk_aop: 0, mepc_aop: 0, hk_actual: 0, mepc_actual: 0,
  hk_target: 0, mepc_target: 0, missing_dates: [], missing_aop: [],
});
const finish = row => {
  for (const field of ['hk_aop', 'mepc_aop', 'hk_actual', 'mepc_actual', 'hk_target', 'mepc_target']) row[field] = round(row[field]);
  row.total_aop = round(row.hk_aop + row.mepc_aop);
  row.total_actual = round(row.hk_actual + row.mepc_actual);
  row.total_target = round(row.hk_target + row.mepc_target);
  row.complete = row.missing_dates.length === 0;
  row.hk_pct = row.complete && row.hk_target > 0 ? row.hk_actual / row.hk_target * 100 : null;
  row.mepc_pct = row.complete && row.mepc_target > 0 ? row.mepc_actual / row.mepc_target * 100 : null;
  row.overall_pct = row.complete && row.total_target > 0 ? row.total_actual / row.total_target * 100 : null;
  row.shortfall = row.complete ? round(row.total_target - row.total_actual) : null;
  row.over_target = row.complete && row.total_actual > row.total_target;
  return row;
};

// Returns null outside November: normal approved-store AOP reporting remains unchanged.
// Attendance is always the authorized, already-imported store attendance source.
// The state denominator is never divided across stores (which would invent store budgets).
export function novemberStateAttendanceSummary({ stores = [], attendance = [], cutoff, view = 'mtd' }) {
  validDate(cutoff);
  if (!cutoff.startsWith('2026-11-')) return null;
  if (!['daily', 'mtd'].includes(view)) throw new Error('Invalid attendance view.');
  const dates = view === 'daily' ? [cutoff] : monthDates(cutoff);
  const dateSet = new Set(dates);
  const storeStates = new Map(stores.map(store => [store.id, reportingState(store.state)]));
  const stateNames = [...new Set(storeStates.values())].filter(state => Object.hasOwn(NOVEMBER_2026_STATE_AOP, state))
    .sort((a,b) => STATE_OPTIONS.indexOf(a) - STATE_OPTIONS.indexOf(b));
  const source = new Map();
  for (const row of attendance) {
    const state = storeStates.get(row.retail_store_id);
    if (!state || !dateSet.has(row.attendance_date) || !['HK', 'MEPC'].includes(row.class)) continue;
    const key = `${state}:${row.attendance_date}`;
    const day = source.get(key) || { hk_actual: 0, mepc_actual: 0, classes: new Set() };
    if (row.class === 'HK') day.hk_actual += Number(row.credit) || 0;
    else day.mepc_actual += Number(row.credit) || 0;
    day.classes.add(row.class);
    source.set(key, day);
  }
  const states = stateNames.map(state => {
    const aop = NOVEMBER_2026_STATE_AOP[state];
    const row = blank(state);
    row.hk_aop = aop.HK;
    row.mepc_aop = aop.MEPC;
    // Weekly offs reduce only the aggregate MTD *required* man-days.
    // They are not assigned to the 7th/14th/21st: different employees can
    // take weekly off on different dates, and actual attendance counts every day.
    const calendarDays = dates.length;
    // Central MIS rule: the first 7 calendar days count as 7 eligible days;
    // day 8 counts as 7, day 14 as 13, day 15 as 13, day 21 as 19, day 22 as 19.
    // This is a cumulative allowance, not a staff leave schedule.
    const eligibleMepcDays = view === 'daily' ? 1 : calendarDays - Math.floor((calendarDays - 1) / 7);
    row.hk_target = aop.HK * calendarDays;
    row.mepc_target = aop.MEPC * eligibleMepcDays;
    for (const date of dates) {
      const actual = source.get(`${state}:${date}`);
      row.hk_actual += actual?.hk_actual || 0;
      row.mepc_actual += actual?.mepc_actual || 0;
      // All dates retain a normal daily AOP; missing class evidence is not
      // inferred to be a weekly off or an employee absence.
      // One accepted class per state/day is minimum evidence, not proof that
      // the originating workbook contained every store/employee.
      if ((aop.HK > 0 && !actual?.classes.has('HK')) ||
          (aop.MEPC > 0 && !actual?.classes.has('MEPC'))) row.missing_dates.push(date);
    }
    return finish(row);
  });
  const total = blank('Grand Total');
  for (const state of states) {
    for (const key of ['hk_aop','mepc_aop','hk_actual','mepc_actual','hk_target','mepc_target']) total[key] += state[key];
    total.missing_dates = [...new Set([...total.missing_dates, ...state.missing_dates])].sort();
  }
  return { states, total: finish(total), state_aop_source: NOVEMBER_STATE_AOP_SOURCE };
}
