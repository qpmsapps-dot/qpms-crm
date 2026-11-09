import test from 'node:test';
import assert from 'node:assert/strict';
import { cleaningView, cleaningPhotoCount, recordedFoName } from '../src/utils/deepCleaningView.js';
const store = {
  id: 'store',
  store_code: 'S1',
  store_name: 'Synthetic Store',
  state: 'TN'
};
const report = {
  schedules: [{
    id: 'a',
    store,
    reporting_state: 'TN',
    display_status: 'Completed',
    submission_ids: ['work']
  }, {
    id: 'b',
    store,
    reporting_state: 'TN',
    display_status: 'Scheduled',
    overdue: true
  }, {
    id: 'c',
    store,
    reporting_state: 'TN',
    display_status: 'Cancelled'
  }],
  submissions: [{
    id: 'work',
    schedule_id: 'a',
    store,
    status: 'submitted',
    fo_name: 'Synthetic FO',
    before_count: 2,
    after_count: 1
  }]
};
test('operational KPIs exclude cancelled and Excel reported work', () => {
  const v = cleaningView(report, {
    schedules: [{
      ...report.schedules[0],
      id: 'excel',
      source_kind: 'IFMS_EXCEL'
    }]
  });
  assert.equal(v.summary.total.scheduled, 2);
  assert.equal(v.summary.total.completed, 1);
  assert.equal(v.summary.total.pending, 1);
  assert.equal(v.overdue, 1);
});
test('FO search and submitted status consistently scope schedules and work', () => {
  const v = cleaningView(report, {}, {
    query: 'Synthetic FO',
    status: 'submitted'
  });
  assert.equal(v.work.length, 1);
  assert.equal(v.schedules.length, 1);
  assert.equal(v.summary.total.percentage, 100);
});
test('scheduled filter does not manufacture submitted work or failures', () => {
  const v = cleaningView(report, {}, {
    status: 'Scheduled'
  });
  assert.equal(v.work.length, 0);
  assert.equal(v.summary.total.completed, 0);
  assert.equal(v.overdue, 1);
});
test('zero schedules have no manufactured percentage; missing counts stay unavailable', () => {
  assert.equal(cleaningView({}, {}).summary.total.percentage, null);
  assert.equal(cleaningPhotoCount({}), null);
  assert.equal(cleaningPhotoCount(report.submissions[0]), 3);
  assert.equal(recordedFoName({}), '');
});
test('unlinked completed schedules are not counted as verified completions', () => {
  const v = cleaningView({
    schedules: [{
      ...report.schedules[0],
      submission_ids: []
    }],
    submissions: []
  }, {});
  assert.equal(v.summary.total.completed, 0);
  assert.equal(v.summary.total.pending, 1);
});
