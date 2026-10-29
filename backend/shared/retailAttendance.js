// Pure shared reporting engine, packaged with the backend and bundled by the web app.
// No payroll, FO attendance, KM or reimbursement writes.
// Attendance .xlsx upload only: 15 MiB inclusive (UI labels this as 15 MB).
export const ATTENDANCE_MAX_FILE_BYTES = 15 * 1024 * 1024;
export const STATUS_CREDITS = Object.freeze({ A: 0, T: 0, H: 0, 'NO-SHOW': 0, 'H-P': 1, P: 1, 'H-HD': 0.5, HD: 0.5 });
export const STATE_OPTIONS = ['AP-1', 'AP-2', 'KL', 'KN', 'TG', 'TN'];
export const storeKey = value => String(value ?? '').trim().toUpperCase();
export function stateLabel(value) {
  const key = storeKey(value).replace(/\s+/g, ' ');
  return ({ KA: 'KN', KARNATAKA: 'KN', 'KERALA': 'KL', 'TAMIL NADU': 'TN', TELANGANA: 'TG', TS: 'TG', PUDUCHERRY: 'PY', PONDICHERRY: 'PY' })[key] || key;
}
// Reporting consolidation only; geographic identities and access scopes stay intact.
export function reportingState(value) {
  const geographic = stateLabel(value);
  return geographic === 'PY' ? 'TN' : geographic;
}
export function attendanceCredit(value) {
  const key = storeKey(value).replace(/\s*[-–]\s*/g, '-');
  if (!Object.hasOwn(STATUS_CREDITS, key)) throw new Error(`Unknown Attendance Status: ${value ?? ''}`);
  return STATUS_CREDITS[key];
}
export function attendanceClass(value) {
  const key = storeKey(value).replace(/\s+/g, ' ');
  if (key === 'HOUSE KEEPING') return 'HK';
  if (key === 'MEPC') return 'MEPC';
  throw new Error('Missing or unknown Class; expected House Keeping or MEPC.');
}
export function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value)) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) ||
      new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new Error('Missing or invalid attendance date; use YYYY-MM-DD or an Excel date cell.');
  return value;
}
export function indiaToday(now = new Date()) { return new Date(now.getTime() + 330 * 60000).toISOString().slice(0, 10); }
export function monthDates(cutoff) {
  validDate(cutoff);
  return Array.from({ length: Number(cutoff.slice(8)) }, (_, i) => `${cutoff.slice(0, 7)}-${String(i + 1).padStart(2, '0')}`);
}
// Aggregate planning cycle only. Never infer an individual employee's absence/off-day from this target.
// The established month-based default gives day 8 = 7 and day 15 = 13 eligible planning days.
export function dailyTarget(aop, date, kind, cycleAnchor = date.slice(0,7) + '-01') {
  validDate(date);
  if (!['HK','MEPC'].includes(kind)) throw new Error('Invalid manpower class.');
  if (aop == null || aop === '' || !Number.isFinite(Number(aop)) || Number(aop) < 0) throw new Error('Invalid approved AOP count.');
  validDate(cycleAnchor);
  const elapsed = Math.floor((Date.parse(date) - Date.parse(cycleAnchor)) / 86400000);
  const cycleDay = ((elapsed % 7) + 7) % 7;
  return Number(aop) * (kind === 'MEPC' && cycleDay === 6 ? 0 : 1);
}
export function percentage(actual, target) { return target === 0 ? null : actual / target * 100; }
const rounded = value => Math.round((value + Number.EPSILON) * 1e8) / 1e8;
function finalize(row) {
  for (const field of ['hk_aop', 'mepc_aop', 'hk_actual', 'mepc_actual', 'hk_target', 'mepc_target']) row[field] = rounded(row[field]);
  row.total_aop = rounded(row.hk_aop + row.mepc_aop);
  row.total_actual = rounded(row.hk_actual + row.mepc_actual);
  row.total_target = rounded(row.hk_target + row.mepc_target);
  row.complete = row.missing_dates.length === 0 && row.missing_aop.length === 0;
  row.hk_pct = row.complete ? percentage(row.hk_actual, row.hk_target) : null;
  row.mepc_pct = row.complete ? percentage(row.mepc_actual, row.mepc_target) : null;
  row.overall_pct = row.complete ? percentage(row.total_actual, row.total_target) : null;
  row.shortfall = !row.complete ? null : rounded(row.total_target - row.total_actual);
  row.over_target = row.missing_aop.length === 0 && row.total_actual > row.total_target;
  return row;
}
const empty = extra => ({ hk_aop: 0, mepc_aop: 0, hk_actual: 0, mepc_actual: 0, hk_target: 0, mepc_target: 0, missing_dates: [], missing_aop: [], ...extra });
export function summarizeAttendance({ stores, attendance, aop, cutoff, view = 'mtd', state = '' }) {
  const dates = view === 'daily' ? [validDate(cutoff)] : monthDates(cutoff);
  const visible = stores.filter(s => !state || reportingState(s.state) === reportingState(state));
  const byStore = new Map();
  for (const row of attendance) {
    const key = `${row.retail_store_id}:${row.attendance_date}`;
    const entry = byStore.get(key) || { HK: 0, MEPC: 0, classes: new Set() };
    entry[row.class] += Number(row.credit);
    entry.classes.add(row.class);
    byStore.set(key, entry);
  }
  const configurations = new Map();
  for (const row of aop) {
    const values = configurations.get(row.retail_store_id) || [];
    values.push(row); configurations.set(row.retail_store_id, values);
  }
  const details = visible.map(store => {
    const result = empty({ id: store.id, store_code: store.store_code, store_name: store.store_name, state: reportingState(store.state), source_state: store.state });
    for (const date of dates) {
      const configs = (configurations.get(store.id) || []).filter(v => v.effective_from <= date && (!v.effective_to || date <= v.effective_to));
      let hkTarget = null; let mepcTarget = null;
      const hk = configs.filter(c => (!c.aop_class || c.aop_class === 'HK') && c.hk_count != null);
      const mepc = configs.filter(c => (!c.aop_class || c.aop_class === 'MEPC') && c.mepc_count != null);
      if (hk.length !== 1 || mepc.length !== 1) result.missing_aop.push(date);
      if (hk.length === 1) { hkTarget = dailyTarget(hk[0].hk_count,date,'HK'); result.hk_target += hkTarget; if(date===cutoff) result.hk_aop=Number(hk[0].hk_count); }
      if (mepc.length === 1) { mepcTarget = dailyTarget(mepc[0].mepc_count,date,'MEPC',mepc[0].mepc_cycle_anchor || date.slice(0,7)+'-01'); result.mepc_target += mepcTarget; if(date===cutoff) result.mepc_aop=Number(mepc[0].mepc_count); }
      const actual = byStore.get(`${store.id}:${date}`);
      if ((hkTarget > 0 && !actual?.classes.has('HK')) || (mepcTarget > 0 && !actual?.classes.has('MEPC')) || (!actual && (hk.length !== 1 || mepc.length !== 1))) result.missing_dates.push(date);
      if (actual) { result.hk_actual += actual.HK; result.mepc_actual += actual.MEPC; }
    }
    return finalize(result);
  });
  const states = new Map();
  const total = empty({ state: 'Grand Total' });
  for (const row of details) {
    const group = states.get(row.state) || empty({ state: row.state });
    for (const target of [group, total]) {
      for (const key of ['hk_aop', 'mepc_aop', 'hk_actual', 'mepc_actual', 'hk_target', 'mepc_target']) target[key] += row[key];
      target.missing_dates = [...new Set([...target.missing_dates, ...row.missing_dates])].sort();
      target.missing_aop = [...new Set([...target.missing_aop, ...row.missing_aop])].sort();
    }
    states.set(row.state, group);
  }
  return { cutoff, view, hk_replacement_count: null, replacement_mapping_status: 'Unavailable: source does not identify replacement relationships.', mepc_target_policy: 'Aggregate 7-day planning cycle (day 8: 7 eligible days; day 15: 13). Not an employee weekly-off roster. Approved cycle anchors override the month-start planning default.', states: [...states.values()].map(finalize).sort((a, b) => a.state.localeCompare(b.state)), stores: details, total: finalize(total) };
}
