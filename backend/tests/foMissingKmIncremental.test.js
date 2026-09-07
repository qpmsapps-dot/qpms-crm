import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateIncrementalMissingKm } from '../foKmRecalculationService.js';

test('incremental Missing KM excludes distance already represented in payable legs', () => {
  assert.deepEqual(calculateIncrementalMissingKm(10, { alreadyIncludedKm: 6 }), {
    detectedMissingKm: 10,
    alreadyIncludedKm: 6,
    approvalMissingKm: 4,
  });
});

test('already-included distance cannot create negative approval KM', () => {
  assert.deepEqual(calculateIncrementalMissingKm(5, { alreadyIncludedKm: 8 }), {
    detectedMissingKm: 5,
    alreadyIncludedKm: 5,
    approvalMissingKm: 0,
  });
});

test('no overlap keeps the full defensible detected distance incremental', () => {
  assert.equal(calculateIncrementalMissingKm(5.126, {}).approvalMissingKm, 5.13);
});
