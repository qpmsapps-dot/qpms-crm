import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canonicalEndDayCompletionMatches,
  historicalIndiaDateStart,
  runBoundedEndDayRecoveryAttempt,
} from '../services/foEndDayKmRecoveryService.js';

const attendanceId = 'a8d170e6-cbb4-4788-928d-6eb9999d51e2';

test('historical recovery includes bounded prior dates', () => {
  assert.equal(historicalIndiaDateStart('2026-10-09', 7), '2026-10-02');
});

test('completion requires exact attendance, persisted status and run evidence', () => {
  const complete = {
    attendance_id: attendanceId,
    updated: true,
    dry_run: false,
    route_sync_status: 'canonical_v2_persisted',
    calculation_run_id: '11111111-1111-4111-8111-111111111111',
    input_digest: 'a'.repeat(64),
  };
  assert.equal(canonicalEndDayCompletionMatches(complete, attendanceId), true);
  assert.equal(canonicalEndDayCompletionMatches({ ...complete, attendance_id: '' }, attendanceId), false);
  assert.equal(canonicalEndDayCompletionMatches({ ...complete, route_sync_status: 'pending_canonical_end_day_recalculation' }, attendanceId), false);
  assert.equal(canonicalEndDayCompletionMatches({ ...complete, calculation_run_id: null }, attendanceId), false);
});

test('bounded recovery retries transient failures and stops after success', async () => {
  let calls = 0;
  const outcome = await runBoundedEndDayRecoveryAttempt(async () => {
    calls += 1;
    if (calls === 1) throw Object.assign(new Error('transient'), { retryable: true });
    return { ok: true };
  }, { maxAttempts: 3, retryDelaysMs: [0, 0, 0], wait: async () => {} });
  assert.equal(calls, 2);
  assert.equal(outcome.attempts, 2);
});

test('bounded recovery does not retry approval or unresolved-evidence failures', async () => {
  let calls = 0;
  await assert.rejects(
    runBoundedEndDayRecoveryAttempt(async () => {
      calls += 1;
      throw Object.assign(new Error('approval required'), { code: 'km_v2_financial_approval_required' });
    }, { maxAttempts: 3, retryDelaysMs: [0, 0, 0], wait: async () => {} }),
    (error) => error.code === 'km_v2_financial_approval_required' && error.recoveryAttempts === 1,
  );
  assert.equal(calls, 1);
});
