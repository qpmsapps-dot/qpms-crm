// Reporting only. Never derives attendance credit, payable time or financial data.
export const TIME_COLUMNS = Object.freeze({ in_time: 'In Time', out_time: 'Out Time', man_hours: 'Man Hours' });
export function attendanceTimeSource(headers, values, formulas = {}) {
  const result = { version: 1, fields: {} };
  for (const [key, label] of Object.entries(TIME_COLUMNS)) {
    const indexes = headers.flatMap((h, i) => String(h).trim() === label ? [i] : []);
    const i = indexes[0];
    result.fields[key] = { available: indexes.length === 1, raw: indexes.length === 1 ? values[i] ?? '' : null,
      formula: indexes.length === 1 && Object.hasOwn(formulas, i) };
  }
  return Object.values(result.fields).some(field => field.available) ? result : undefined;
}

// Excel numeric times are fractions of a day, never decimal hours. Durations can
// exceed 24h; punches cannot. Date serials and locale-ambiguous text fail closed.
export function attendanceSeconds(raw, duration = false) {
  if (raw == null || typeof raw === 'string' && !raw.trim()) return { blank: true };
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw < 0 || raw >= (duration ? 7 : 1)) return { invalid: true };
    const seconds = Math.round(raw * 86400);
    return seconds < (duration ? 604800 : 86400) ? { seconds } : { invalid: true };
  }
  if (typeof raw !== 'string') return { invalid: true };
  const match = /^(\d{1,3}):([0-5]\d)(?::([0-5]\d))?(?:\s*(AM|PM))?$/i.exec(raw.trim());
  if (!match) return { invalid: true };
  let hours = Number(match[1]);
  if (match[4]) {
    if (duration || hours < 1 || hours > 12) return { invalid: true };
    hours = hours % 12 + (match[4].toUpperCase() === 'PM' ? 12 : 0);
  }
  if (hours >= (duration ? 168 : 24)) return { invalid: true };
  return { seconds: hours * 3600 + Number(match[2]) * 60 + Number(match[3] || 0) };
}

export function classifyAttendanceException(source) {
  const issues = [], result = { missing_checkout: false, below_9_hours: false, issues };
  const fields = source?.version === 1 ? source.fields : null;
  const read = (key, duration) => {
    const field = fields?.[key];
    if (!field?.available) { issues.push(`Unavailable ${key}`); return { unavailable: true }; }
    if (field.formula) { issues.push(`Formula in ${key}`); return { invalid: true }; }
    const value = attendanceSeconds(field.raw, duration);
    if (value.invalid) issues.push(`Invalid ${key}`);
    return value;
  };
  const start = read('in_time'), end = read('out_time'), hours = read('man_hours', true);
  result.missing_available = !start.unavailable && !end.unavailable && !start.invalid && !end.invalid;
  result.below_available = result.missing_available && !hours.unavailable && !hours.invalid;
  if (!result.missing_available) return result;
  if ((start.blank || end.blank) && hours.seconds > 0) issues.push('Man Hours recorded without both punches');
  if (start.blank && !end.blank) { issues.push('Checkout without check-in'); result.below_available = false; }
  if (!start.blank && end.blank) result.missing_checkout = true;
  if (!start.blank && !end.blank && result.below_available) {
    if (hours.blank) { issues.push('Missing man_hours for punched record'); result.below_available = false; }
    else {
      result.below_9_hours = hours.seconds < 9 * 3600;
      const elapsed = (end.seconds - start.seconds + 86400) % 86400;
      // Man Hours remains authoritative for this exception; disagreements are
      // separately visible, not silently recalculated from punch times.
      if (elapsed !== hours.seconds) issues.push('Punch duration differs from Man Hours');
    }
  }
  return result;
}

export function summarizeAttendanceExceptions(rows, { from, to, classes = ['HK', 'MEPC'] }) {
  const dates = [];
  for (let date = from; date <= to;) {
    dates.push(date);
    date = new Date(Date.parse(date + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
  }
  const seen = new Set(), details = [], groups = {};
  for (const kind of classes) groups[kind] = { missing_checkout: 0, below_9_hours: 0, missing_unavailable: 0, below_unavailable: 0, dates: new Set(), records: 0 };
  for (const row of rows) {
    if (row.superseded_at || row.attendance_date < from || row.attendance_date > to || !groups[row.class]) continue;
    const key = JSON.stringify([row.employee_code, row.retail_store_id, row.attendance_date]);
    if (seen.has(key)) continue;
    seen.add(key);
    const group = groups[row.class], result = classifyAttendanceException(row.time_source);
    if (row.time_source_issue) result.issues.push(row.time_source_issue);
    group.records++; group.dates.add(row.attendance_date);
    for (const metric of ['missing_checkout', 'below_9_hours']) if (result[metric]) group[metric]++;
    if (!result.missing_available) group.missing_unavailable++;
    if (!result.below_available) group.below_unavailable++;
    if (result.missing_checkout || result.below_9_hours || result.issues.length) details.push({ ...row, ...result });
  }
  const categories = Object.fromEntries(Object.entries(groups).map(([kind, group]) => {
    const missing_dates = dates.filter(date => !group.dates.has(date));
    return [kind, { records: group.records, missing_dates, missing_unavailable: group.missing_unavailable, below_unavailable: group.below_unavailable,
      known_missing_checkout: group.missing_checkout, known_below_9_hours: group.below_9_hours,
      missing_checkout: missing_dates.length || group.missing_unavailable ? null : group.missing_checkout,
      below_9_hours: missing_dates.length || group.below_unavailable ? null : group.below_9_hours }];
  }));
  const total = key => Object.values(categories).some(g => g[key] === null) ? null : Object.values(categories).reduce((n, g) => n + g[key], 0);
  return { from, to, categories, missing_checkout: total('missing_checkout'), below_9_hours: total('below_9_hours'),
    flagged_records: details.filter(r => r.issues.length).length, details };
}
