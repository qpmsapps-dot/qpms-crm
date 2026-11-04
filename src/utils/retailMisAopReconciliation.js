// Read-only MIS reconciliation helpers. Never mutate canonical store or attendance records.
const code = value => String(value ?? '').trim().toUpperCase();
const numberOrNull = value => value === null || value === undefined || value === '' ? null : Number(value);
const validCount = value => value === null || (Number.isFinite(value) && value >= 0);

/**
 * Compare distinct attendance Store Codes with the canonical Retail Store Master.
 * AOP zero is valid; null means unknown. Composite/slash codes are flagged for review,
 * never silently matched to a different identity.
 *
 * @param {Array<{store_code?:string,site_code?:string,class?:string}>} attendance
 * @param {Array<{store_code:string,status?:string,hk_count?:number|null,mepc_count?:number|null}>} stores
 */
export function reconcileRetailAttendanceStores(attendance = [], stores = []) {
  const byCode = new Map();
  for (const store of stores) {
    const key = code(store.store_code);
    if (!key) continue;
    if (!byCode.has(key)) byCode.set(key, []);
    byCode.get(key).push(store);
  }
  const grouped = new Map();
  for (const row of attendance) {
    const key = code(row.store_code ?? row.site_code);
    if (!key) continue;
    const category = code(row.class ?? row.category);
    if (!grouped.has(key)) grouped.set(key, { store_code: key, attendance_rows: 0, classes: new Set() });
    const item = grouped.get(key);
    item.attendance_rows++;
    if (category) item.classes.add(category);
  }
  return [...grouped.values()].map(item => {
    const matches = byCode.get(item.store_code) ?? [];
    const store = matches.length === 1 ? matches[0] : null;
    const hk = store ? numberOrNull(store.hk_count) : null;
    const mepc = store ? numberOrNull(store.mepc_count) : null;
    const issues = [];
    if (item.store_code.includes('/')) issues.push('COMPOSITE_CODE_REVIEW');
    if (!matches.length) issues.push('MISSING_STORE');
    if (matches.length > 1) issues.push('DUPLICATE_STORE_CODE');
    if (store) {
      if (code(store.status) !== 'ACTIVE') issues.push('INACTIVE_STORE');
      if (!validCount(hk) || !validCount(mepc)) issues.push('INVALID_AOP');
      if (item.classes.has('HK') && hk === null) issues.push('MISSING_HK_AOP');
      if (item.classes.has('MEPC') && mepc === null) issues.push('MISSING_MEPC_AOP');
    }
    return { store_code: item.store_code, attendance_rows: item.attendance_rows,
      classes: [...item.classes].sort(), hk_aop: hk, mepc_aop: mepc,
      status: store?.status ?? null, issues };
  }).sort((a, b) => a.store_code.localeCompare(b.store_code));
}
