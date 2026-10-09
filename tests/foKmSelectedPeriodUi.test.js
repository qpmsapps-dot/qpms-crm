import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  employeeRangeRecalculationPresentation,
  KM_RECALCULATION_MAINTENANCE_MESSAGE,
  runWithAbortTimeout,
} from '../src/utils/foKmRecalculationUi.js';

test('maintenance response is blocked and uses the approved unchanged-values message', () => {
  const result = employeeRangeRecalculationPresentation({
    ok: false,
    outcome: 'maintenance_blocked',
    code: 'KM_FINANCIAL_WRITES_MAINTENANCE',
  });
  assert.equal(result.ok, false);
  assert.equal(result.shouldRefresh, false);
  assert.equal(result.message, KM_RECALCULATION_MAINTENANCE_MESSAGE);
});

test('partial and complete failures are never presented as complete success', () => {
  const partial = employeeRangeRecalculationPresentation({
    outcome: 'partial_success', eligible: 3, updated: 2, failed: 1,
  });
  assert.equal(partial.ok, false);
  assert.equal(partial.shouldRefresh, true);
  assert.match(partial.message, /1 failed/i);

  const failed = employeeRangeRecalculationPresentation({
    outcome: 'complete_failure', eligible: 3, updated: 0, failed: 3,
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.shouldRefresh, false);
  assert.match(failed.message, /failed for all 3/i);

  const requestFailure = employeeRangeRecalculationPresentation({
    ok: false, outcome: 'request_failed', message: 'Backend unavailable.',
  });
  assert.equal(requestFailure.ok, false);
  assert.equal(requestFailure.outcome, 'request_failed');
  assert.equal(requestFailure.message, 'Backend unavailable.');
});

test('bounded request aborts on timeout and a later retry can succeed', async () => {
  let aborted = false;
  await assert.rejects(
    runWithAbortTimeout(
      (signal) => {
        signal.addEventListener('abort', () => { aborted = true; }, { once: true });
        return new Promise(() => {});
      },
      { timeoutMs: 5, timeoutCode: 'TEST_TIMEOUT', timeoutMessage: 'timed out' },
    ),
    { code: 'TEST_TIMEOUT' },
  );
  assert.equal(aborted, true);

  const retried = await runWithAbortTimeout(
    async () => 'retry-ok',
    { timeoutMs: 50, timeoutCode: 'TEST_TIMEOUT' },
  );
  assert.equal(retried, 'retry-ok');
});

test('button path keeps authentication and always clears UI in-flight/loading state', async () => {
  const frontend = await readFile(new URL('../src/pages/FOActivities.jsx', import.meta.url), 'utf8');
  const server = await readFile(new URL('../backend/server.js', import.meta.url), 'utf8');
  const functionStart = frontend.indexOf('async function recalculateSelectedOfficerKm()');
  const functionEnd = frontend.indexOf('async function recalculateTemporarySwitchKmForOfficer', functionStart);
  const body = frontend.slice(functionStart, functionEnd);

  assert.match(body, /runWithAbortTimeout\([\s\S]*?authenticatedFetch/);
  assert.match(body, /loadSelectedEmployeeRange\(\{ signal, throwOnError: true \}\)/);
  assert.match(body, /finally\s*\{[\s\S]*?kmRecalcInFlightRef\.current\.delete\(recalcKey\)[\s\S]*?setKmRecalcBusy\(false\)/);
  assert.match(server, /app\.post\('\/api\/fo\/km\/recalculate-employee-range',\s*requireSupabaseJwt,\s*requireFoKmBatchRecalculationPermission/);
  assert.match(server, /outcome:\s*'maintenance_blocked'/);
  assert.match(server, /outcome:\s*'already_running'/);
});
