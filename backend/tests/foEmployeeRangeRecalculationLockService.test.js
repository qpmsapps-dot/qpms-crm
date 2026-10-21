import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmployeeRangeRecalculationRegistry } from '../services/foEmployeeRangeRecalculationLockService.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test('employee-range registry rejects a duplicate while the underlying operation is active', async () => {
  const registry = createEmployeeRangeRecalculationRegistry();
  const pending = deferred();
  const first = registry.start('EMP|2026-10-01|2026-10-07', () => pending.promise);
  const duplicate = registry.start('EMP|2026-10-01|2026-10-07', async () => 'duplicate');

  assert.equal(first.acquired, true);
  assert.equal(duplicate.acquired, false);
  assert.equal(registry.size(), 1);

  pending.resolve('done');
  assert.equal(await first.promise, 'done');
  assert.equal(registry.size(), 0);
});

test('caller timeout does not unlock an underlying operation that is still active', async () => {
  const registry = createEmployeeRangeRecalculationRegistry();
  const pending = deferred();
  const first = registry.start('EMP|RANGE', () => pending.promise);

  await assert.rejects(
    Promise.race([
      first.promise,
      new Promise((resolve, reject) => setTimeout(() => reject(new Error('caller timeout')), 5)),
    ]),
    /caller timeout/,
  );
  assert.equal(registry.has('EMP|RANGE'), true);
  assert.equal(registry.start('EMP|RANGE', async () => 'duplicate').acquired, false);

  pending.resolve('settled');
  await first.promise;
  assert.equal(registry.has('EMP|RANGE'), false);
});

test('rejected or internally timed-out operations release the lock and allow retry', async () => {
  const registry = createEmployeeRangeRecalculationRegistry();
  const failure = new Error('operation timeout');
  failure.code = 'OPERATION_TIMEOUT';
  const first = registry.start('EMP|RETRY', async () => { throw failure; });

  await assert.rejects(first.promise, { code: 'OPERATION_TIMEOUT' });
  assert.equal(registry.has('EMP|RETRY'), false);

  const retry = registry.start('EMP|RETRY', async () => 'ok');
  assert.equal(retry.acquired, true);
  assert.equal(await retry.promise, 'ok');
  assert.equal(registry.size(), 0);
});
