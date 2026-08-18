import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const detailScreen = readFileSync(
  new URL('../../Mobile_FO_V2/lib/hospital_housekeeping/hospital_ticket_detail_screen.dart', import.meta.url),
  'utf8',
);
const controller = readFileSync(
  new URL('../../Mobile_FO_V2/lib/hospital_housekeeping/hospital_controller.dart', import.meta.url),
  'utf8',
);

test('supervisor resolve flow has one user-facing completion remarks prompt', () => {
  const resolveStart = detailScreen.indexOf('Future<void> _resolve');
  const resolveEnd = detailScreen.indexOf('Future<void> _feedback', resolveStart);
  assert.notEqual(resolveStart, -1);
  assert.notEqual(resolveEnd, -1);
  const resolveSource = detailScreen.slice(resolveStart, resolveEnd);

  assert.match(resolveSource, /'Work Completion Remarks'/);
  assert.match(resolveSource, /'Briefly describe the work completed'/);
  assert.doesNotMatch(resolveSource, /'Action taken'/);
  assert.doesNotMatch(resolveSource, /'Resolution remarks'/);
});

test('controller keeps backend action contract while user enters only remarks', () => {
  assert.match(controller, /String actionTaken = 'Work completed'/);
  assert.match(controller, /throw ArgumentError\('Work completion remarks are required\.'\)/);
  assert.match(controller, /'resolution_action': actionTaken\.trim\(\)/);
  assert.match(controller, /'resolution_remarks': remarks\.trim\(\)/);
});

test('remote action applies returned ticket before non-blocking detail refresh', () => {
  assert.match(controller, /_replace\(_mergeDetailTicket\(row, response\)\)/);
  assert.match(controller, /unawaited\(loadDetail\(ticket\.id, force: true\)\)/);
  assert.doesNotMatch(controller, /await loadDetail\(ticket\.id, force: true\)/);
});
