import assert from 'node:assert/strict';
import test from 'node:test';
import { REPORTING_STATES, reportingRows, emptyOperations, selectRows, percent, callWindow, reportingPeriod } from '../src/pages/reliance-retail/ifmsDashboardModel.js';

test('six reporting states reuse existing aliases and consolidate source records without mutation', () => {
  assert.deepEqual(REPORTING_STATES.map(row => row.label), ['Tamil Nadu','Karnataka','Kerala','Andhra Pradesh - 1','Andhra Pradesh - 2','Telangana']);
  const input = [{state:'PY'},{state:'TN'},{state:'Puducherry'},{state:'KA'},{state:'Karnataka'},{state:'TS'}];
  const rows = reportingRows(input);
  assert.equal(selectRows(rows, 'TN').length, 3);
  assert.equal(selectRows(rows, '', 'KN').length, 2);
  assert.equal(input[0].state, 'PY');
  assert.equal(selectRows(rows, 'TN', 'KN').length, 0);
});
test('empty scope has six rows, independent filters and no invalid percentages', () => {
  const rows = emptyOperations();
  assert.equal(rows.length, 6);
  assert.equal(selectRows(rows, '', 'TN').length, 1);
  assert.equal(selectRows(rows).length, 6);
  assert.equal(selectRows(rows, 'TN', '').length, 1);
  assert.equal(percent(0, 0), 0);
  assert.equal(percent(3, 4), 75);
  assert.ok(rows.every(row => Object.entries(row).every(([key, value]) => key === 'state' || value === 0)));
});
test('MTD cuts off today, historical months use month end and future months have no elapsed days', () => {
  assert.equal(reportingPeriod('2026-10','2026-10-27').end, '2026-10-27');
  assert.equal(reportingPeriod('2024-02','2026-10-27').end, '2024-02-29');
  assert.equal(reportingPeriod('2025-02','2026-10-27').end, '2025-02-28');
  assert.equal(reportingPeriod('2026-11','2026-10-27').end, null);
});
test('CM and PM deadlines handle boundaries without implying completion', () => {
  assert.equal(callWindow('2026-10','cm','2026-10-01').status, 'In progress');
  assert.equal(callWindow('2026-10','cm','2026-10-15').end, '2026-10-15');
  assert.match(callWindow('2026-10','cm','2026-10-16').status, /overdue if remaining/);
  assert.equal(callWindow('2026-10','pm','2026-10-15').status, 'Upcoming');
  assert.equal(callWindow('2026-10','pm','2026-10-16').status, 'In progress');
  for (const [month, last] of [['2024-02','29'],['2025-02','28'],['2026-04','30'],['2026-10','31']]) {
    assert.equal(callWindow(month,'pm',`${month}-16`).end, `${month}-${last}`);
  }
  assert.doesNotMatch(callWindow('2026-09','cm','2026-10-27').status, /Completed/);
});
