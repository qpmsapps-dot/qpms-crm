const finite = n => n !== null && n !== undefined && n !== '' && Number.isFinite(Number(n));
const km = n => finite(n) ? Number(n).toFixed(2) : 'Unknown';
// Request mode is only a UI preference; the backend/database still authorize posting.
export const supportedKmDryRun = (environment = {}) => environment.VITE_KM_RECONCILIATION_POSTING_ENABLED !== 'true';

function previewMessage(row) {
  if (['failed', 'deferred', 'no_attendance'].includes(row.status)) return `${row.date}: ${row.message || row.status}`;
  const legs = row.legs || [], unresolved = row.unresolved || [];
  const values = legs.map(l => l.payable_km).filter(finite);
  const calculated = values.length ? values.reduce((sum, n) => sum + Number(n), 0) : null;
  const lines = [
    `${row.date}: Recalculated eligible KM: ${km(calculated)}${unresolved.length ? ' (partial; unresolved legs remain)' : ''}.`,
    `Existing payable: ${km(row.existingPayableKm)} km; supported missing: ${km(row.additionalKm)} km; projected payable: ${km(row.finalPayableKm)} km; supported additional petrol: ₹${km(row.additionalAmount)}.`,
    `Evidence: ${Array.isArray(row.sourceRowIds) ? row.sourceRowIds.length : 'Unknown'} GPS rows; ${legs.length} travel leg(s).`,
    ...legs.map(l => `• ${String(l.type || 'Travel leg').replaceAll('_', ' ')}: ${km(l.payable_km)} eligible km; ${l.source || 'No source'}; ${l.evidence_status || l.reason || l.status || 'Evidence status unavailable'}.`),
  ];
  if (row.effectiveEnd) lines.push(`End Day evidence: ${row.effectiveEnd.source || 'Unavailable'}; captured ${row.effectiveEnd.captured_at || 'unavailable'}; ${row.effectiveEnd.status || 'status unavailable'}.`);
  if (row.baselineKnown === false) lines.push('Existing KM inclusion is unresolved; no additional KM is supported until it can be established.');
  lines.push(unresolved.length ? `Unresolved legs (${unresolved.length}): ${unresolved.map(l => `${String(l.type || 'Travel leg').replaceAll('_', ' ')} — ${l.evidence_status || l.reason || 'requires review'}`).join('; ')}.` : 'Unresolved legs: none.');
  return lines.join('\n');
}

export async function runSupportedKmPeriod({ employee, dates, endpoint, request, dryRun = true, onProgress = () => {} }) {
  if (typeof dryRun !== 'boolean') throw new TypeError('dryRun must be a Boolean.');
  const rows = [];
  for (const date of dates) {
    onProgress(`${dryRun ? 'Previewing' : 'Recalculating'} ${date} (${rows.length + 1}/${dates.length})…`);
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await request(endpoint, { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ employee_code: employee, from_date: date, to_date: date, dry_run: dryRun }) });
      const body = await response.json();
      if (!response.ok) throw Error(body.message || 'Recalculation failed.');
      if (!Array.isArray(body.results)) throw Error('Calculation response is incomplete; no result is assumed.');
      rows.push(...(body.results.length ? body.results : [{ date, status: 'no_attendance', message: 'No attendance found; no calculation performed.' }]));
    } catch (error) { rows.push({ date, status: 'failed', message: error.name === 'AbortError' ? dryRun ? 'Preview timed out; no posting was requested.' : 'Timed out — posting outcome must be verified before retry; retries are idempotent.' : error.message }); }
    finally { clearTimeout(timeout); }
  }
  const unexpectedPosting = dryRun && rows.some(r => r.financial_posted === true || r.updated === true || r.status === 'posted');
  const ok = !unexpectedPosting && rows.every(r => !['failed', 'deferred'].includes(r.status));
  const message = unexpectedPosting ? 'Preview verification failed: the server reported a saved change. Stop and verify the receipt before retrying.' : dryRun ? ['Preview Only — no KM credited', ...rows.map(previewMessage)].join('\n\n') : rows.map(r => r.financial_posted
    ? `${r.date}: Recalculation completed. Existing payable ${km(r.existingPayableKm)} km; additional ${km(r.additionalKm)} km; updated ${km(r.finalPayableKm)} km; additional petrol ₹${km(r.additionalAmount)}.`
    : `${r.date}: ${r.status === 'unchanged' ? 'Recalculation completed — no additional KM found. Existing payable unchanged.' : r.message || r.status}. ${r.unresolved?.length ? `${r.unresolved.length} unresolved leg(s).` : ''}`).join('\n');
  return { ok, mode: dryRun ? 'preview' : 'posting', results: rows, message };
}
