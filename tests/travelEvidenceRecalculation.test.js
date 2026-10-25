import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evidenceDates, runTravelEvidencePeriod, gpsEvidenceDisplay } from '../src/utils/travelEvidenceRecalculation.js';

test('uses exact selected range with bounded sequential requests, progress and partial failures', async () => {
  const calls = [], updates = []; let running = 0;
  const result = await runTravelEvidencePeriod({ employee: 'QPMSKL3762', from: '2026-10-22', to: '2026-10-24', endpoint: '/evidence', onProgress: p => updates.push(p), request: async (url, options) => {
    running++; assert.equal(running, 1); const body = JSON.parse(options.body); calls.push(body); await Promise.resolve(); running--;
    return { ok: body.date !== '2026-10-23', json: async () => body.date === '2026-10-23' ? { ok: false, message: 'GPS timeout, not zero logs' } : { ok: true, date: body.date, status: body.date === '2026-10-22' ? 'protected' : 'partial', calculated_travel_km: 20 } };
  } });
  assert.deepEqual(calls.map(r => r.date), ['2026-10-22', '2026-10-23', '2026-10-24']);
  assert(calls.every(r => r.employee_code === 'QPMSKL3762' && Object.keys(r).length === 2));
  assert.deepEqual(result.rows.map(r => r.status), ['protected', 'failed', 'partial']); assert.equal(result.completed, 3);
  assert(updates.some(p => p.rows.some(r => r.status === 'loading'))); assert.equal(result.running, false);
});
test('invalid/oversized ranges never issue a request', async () => {
  for (const [from, to] of [['2026-02-30', '2026-03-01'], ['2026-10-24', '2026-10-01'], ['2026-09-01', '2026-10-24']]) assert.throws(() => evidenceDates(from, to));
});
test('stopping an evidence run prevents later dates and does not send a save request', async () => {
  const controller = new AbortController(), calls = [];
  const result = await runTravelEvidencePeriod({ employee: 'QPMSKL3762', from: '2026-10-22', to: '2026-10-24', endpoint: '/evidence', signal: controller.signal, onProgress() {}, request: async (_, options) => {
    calls.push(JSON.parse(options.body)); controller.abort(); return { ok: true, json: async () => ({ ok: true, date: '2026-10-22', status: 'partial' }) };
  } });
  assert.equal(calls.length, 1); assert.equal(result.stopped, true); assert.equal(result.completed, 1);
});
test('GPS failures and pending retrieval are not rendered as zero; genuine empty results are zero', () => {
  assert.match(gpsEvidenceDisplay('failed', 0), /retrieval failed/); assert.equal(gpsEvidenceDisplay('loading', 0), 'Loading…'); assert.equal(gpsEvidenceDisplay('loaded', 0), 0);
});
test('employee loading never POSTs review refresh; explicit recalculation uses the shared authenticated pipeline', () => {
  const source = readFileSync(new URL('../src/pages/FOActivities.jsx', import.meta.url), 'utf8');
  const loader = source.slice(source.indexOf('const loadSelectedEmployeeRange ='), source.indexOf('const selectedOfficer =', source.indexOf('const loadSelectedEmployeeRange =')));
  assert.doesNotMatch(loader, /employee-missing-km-reviews\/refresh|method: "POST"/);
  assert.match(source, /async function recalculateSelectedOfficerKm/);
  assert.match(source, /runSupportedKmPeriod\([\s\S]*request:authenticatedFetch/);
  assert.match(source, /routeLogsState=\{selectedRouteLogsState\}/);
  assert.doesNotMatch(source, /import (TravelEvidenceDialog|ManualKmRefreshDialog|OctoberKmRecoveryDialog)/);
});
