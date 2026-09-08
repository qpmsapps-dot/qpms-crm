import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateIncrementalMissingKm,
  classifyMissingKmApprovalRetry,
  missingKmApprovedAmount,
  missingKmManualApprovalUpperBound,
  validateMissingKmManualApproval,
} from '../foKmRecalculationService.js';

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

const review = {
  rate_per_km: 8,
  filtered_gps_km: 6.5,
  google_route_km: 8.25,
  suggested_missing_km: 0,
  metadata: { detected_missing_km: 7.2, incremental_determination: 'requires_review' },
};
const admin = { role: 'Admin', employee_code: 'ADMIN01', full_name: 'Admin User' };

test('clarification-required review accepts an explicit Admin manual approval', () => {
  assert.deepEqual(
    validateMissingKmManualApproval(review, {
      approved_missing_km: 5,
      remarks: 'Reviewed route and confirmed unpaid distance.',
    }, admin),
    {
      approvedKm: 5,
      remarks: 'Reviewed route and confirmed unpaid distance.',
      rate: 8,
      upperBoundKm: 8.25,
    },
  );
});

test('manual approval amount uses server-side Car and Bike rates', () => {
  assert.equal(missingKmApprovedAmount(5, 8), 40);
  assert.equal(missingKmApprovedAmount(5, 4), 20);
});

test('manual approval rejects unauthorized, invalid, excessive, and unknown-mode decisions', () => {
  assert.throws(
    () => validateMissingKmManualApproval(review, { approved_missing_km: 5, remarks: 'Reviewed.' }, { ...admin, role: 'Branch Head' }),
    /Only an Admin/,
  );
  assert.throws(
    () => validateMissingKmManualApproval(review, { approved_missing_km: -1, remarks: 'Reviewed.' }, admin),
    /non-negative/,
  );
  assert.throws(
    () => validateMissingKmManualApproval(review, { approved_missing_km: 9, remarks: 'Reviewed.' }, admin),
    /cannot exceed/,
  );
  assert.throws(
    () => validateMissingKmManualApproval({ ...review, rate_per_km: null }, { approved_missing_km: 5, remarks: 'Reviewed.' }, admin),
    /transport mode rate is unavailable/,
  );
});

test('manual approval requires reviewer identity and remarks', () => {
  assert.throws(
    () => validateMissingKmManualApproval(review, { approved_missing_km: 5, remarks: '' }, admin),
    /remarks are required/,
  );
  assert.throws(
    () => validateMissingKmManualApproval(review, { approved_missing_km: 5, remarks: 'Reviewed.' }, { role: 'Admin' }),
    /reviewer identity/,
  );
});

test('same approval retry is idempotent and a changed amount requires adjustment review', () => {
  const approved = { status: 'approved', approved_missing_km: 5 };
  assert.equal(
    classifyMissingKmApprovalRetry(approved, { approved_missing_km: 5 }),
    'same_value_retry',
  );
  assert.equal(
    classifyMissingKmApprovalRetry(approved, { approved_missing_km: 5.5 }),
    'financial_adjustment',
  );
});
