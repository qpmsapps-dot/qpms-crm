const km = n => n == null ? 'Unknown' : Number(n).toFixed(2);
export async function runSupportedKmPeriod({ employee, dates, endpoint, request, onProgress = () => {} }) {
  const rows = [];
  for (const date of dates) {
    onProgress(`Recalculating ${date} (${rows.length + 1}/${dates.length})…`);
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await request(endpoint, { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ employee_code: employee, from_date: date, to_date: date }) });
      const body = await response.json();
      if (!response.ok) throw Error(body.message || 'Recalculation failed.');
      rows.push(...(body.results.length ? body.results : [{ date, status: 'unchanged', message: 'No attendance found; nothing added.' }]));
    } catch (error) { rows.push({ date, status: 'failed', message: error.name === 'AbortError' ? 'Timed out — posting outcome must be verified before retry; retries are idempotent.' : error.message }); }
    finally { clearTimeout(timeout); }
  }
  const ok = rows.every(r => !['failed', 'deferred'].includes(r.status));
  const message = rows.map(r => r.financial_posted
    ? `${r.date}: Recalculation completed. Existing payable ${km(r.existingPayableKm)} km; additional ${km(r.additionalKm)} km; updated ${km(r.finalPayableKm)} km; additional petrol ₹${km(r.additionalAmount)}.`
    : `${r.date}: ${r.status === 'unchanged' ? 'Recalculation completed — no additional KM found. Existing payable unchanged.' : r.message || r.status}. ${r.unresolved?.length ? `${r.unresolved.length} unresolved leg(s).` : ''}`).join('\n');
  return { ok, results: rows, message };
}
