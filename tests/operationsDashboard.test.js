import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EMPTY_OPERATIONS_SUMMARY,
  activityPreviewFileKind,
  nextPreviewIndex,
  operationsSummaryQuery,
  previewMenuState,
  shouldAcceptSummaryResponse,
} from '../src/utils/operationsDashboard.js';

test('filtered summary query carries every applied filter without UTC conversion', () => {
  const query = operationsSummaryQuery({
    dateFrom: '2026-07-01', dateTo: '2026-07-14', state: 'KL', business: 'HDFC', status: 'Active',
  });
  assert.match(query, /date_from=2026-07-01/);
  assert.match(query, /date_to=2026-07-14/);
  assert.match(query, /state=KL/);
});

test('rapid filter responses accept only the latest request', () => {
  assert.equal(shouldAcceptSummaryResponse(1, 2), false);
  assert.equal(shouldAcceptSummaryResponse(2, 2), true);
});

test('failed and empty summary state cannot retain previous totals', () => {
  assert.equal(EMPTY_OPERATIONS_SUMMARY.payable_km, 0);
  assert.equal(EMPTY_OPERATIONS_SUMMARY.petrol_amount, 0);
});

test('activity gallery arrows stay within the selected card file range', () => {
  assert.equal(nextPreviewIndex(0, 14, 1), 1);
  assert.equal(nextPreviewIndex(13, 14, 1), 13);
  assert.equal(nextPreviewIndex(1, 14, -1), 0);
});

test('three-dot menu toggles one card and opening another replaces it', () => {
  assert.equal(previewMenuState(null, 'card-a'), 'card-a');
  assert.equal(previewMenuState('card-a', 'card-b'), 'card-b');
  assert.equal(previewMenuState('card-a', 'card-a'), null);
});

test('preview distinguishes images, PDFs and unsupported documents', () => {
  assert.equal(activityPreviewFileKind({ file_type: 'image/jpeg' }), 'image');
  assert.equal(activityPreviewFileKind({ file_name: 'report.pdf' }), 'pdf');
  assert.equal(activityPreviewFileKind({ file_name: 'sheet.xlsx' }), 'document');
});
