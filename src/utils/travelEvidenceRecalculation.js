export function evidenceDates(from, to) {
  const valid = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (!valid(from) || !valid(to) || from > to) throw Error('Select a valid employee date range.');
  const count = (Date.parse(to) - Date.parse(from)) / 86400000 + 1;
  if (count > 31) throw Error('Select at most 31 calendar days per evidence recalculation.');
  return Array.from({ length: count }, (_, index) => new Date(Date.parse(from) + index * 86400000).toISOString().slice(0, 10));
}

export async function runTravelEvidencePeriod({ employee, from, to, endpoint, request, onProgress, signal }) {
  const dates = evidenceDates(from, to), rows = [];
  if (!employee) throw Error('Select an employee before recalculating travel evidence.');
  for (const date of dates) {
    if (signal?.aborted) break;
    onProgress({ running: true, completed: rows.length, total: dates.length, rows: [...rows, { date, status: 'loading' }] });
    try {
      const response = await request(endpoint, {
        method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_code: employee, date }),
      });
      const result = await response.json();
      if (!response.ok || result.ok !== true) throw Error(result.message || 'Evidence request failed. Nothing was saved.');
      rows.push(result);
    } catch (error) {
      rows.push({ date, status: 'failed', message: error.name === 'AbortError' ? 'Stopped. No financial values were saved.' : error.message });
      if (signal?.aborted) break;
    }
    onProgress({ running: true, completed: rows.length, total: dates.length, rows: [...rows] });
  }
  const state = { running: false, completed: rows.length, total: dates.length, rows, stopped: signal?.aborted === true };
  onProgress(state);
  return state;
}

export function gpsEvidenceDisplay(status, value) {
  if (status === 'failed') return 'Unavailable — retrieval failed';
  if (status !== 'loaded') return status === 'loading' ? 'Loading…' : 'Not loaded';
  return value;
}
