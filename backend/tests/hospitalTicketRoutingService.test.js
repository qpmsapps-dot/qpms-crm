import assert from 'node:assert/strict';
import test from 'node:test';

import {
  chooseSupervisorAssignment,
  isShiftActive,
  nimsActiveBlockNames,
  nimsLegacyActiveBlockNames,
  nimsRosterCoverageMatrix,
  parseShiftWindow,
  rosterImportPlan,
} from '../services/hospitalTicketRoutingService.js';

const clientId = 'client-nims';
const blockA = 'speciality-block';
const blockB = 'core-block';
const categoryA = 'category-cleaning';
const departmentA = 'department-surgical';
const day = (time) => new Date(`2026-07-21T${time}+05:30`);
const shift = (label) => parseShiftWindow(label);
const assignment = (overrides = {}) => ({
  id: overrides.id || `assignment-${overrides.userId || 'a'}`,
  clientId,
  userId: overrides.userId || 'supervisor-a',
  userActive: true,
  blockId: blockA,
  departmentId: null,
  categoryId: null,
  shift: shift('8 AM-4 PM'),
  assignmentType: 'primary',
  routingPriority: 100,
  verificationStatus: 'verified',
  isActive: true,
  ...overrides,
});
const context = (overrides = {}) => ({
  clientId,
  blockId: blockA,
  departmentId: departmentA,
  categoryId: categoryA,
  now: day('10:00:00'),
  ...overrides,
});

test('exact block primary assignment is selected during active shift', () => {
  const result = chooseSupervisorAssignment([assignment()], context());
  assert.equal(result.assigned, true);
  assert.equal(result.userId, 'supervisor-a');
});

test('block backup assignment is used when no primary matches', () => {
  const result = chooseSupervisorAssignment([
    assignment({ userId: 'backup-a', assignmentType: 'backup' }),
  ], context());
  assert.equal(result.assigned, true);
  assert.equal(result.userId, 'backup-a');
});

test('department and category assignments have precedence over broad block rules', () => {
  const result = chooseSupervisorAssignment([
    assignment({ userId: 'block-primary', routingPriority: 50 }),
    assignment({ userId: 'department-category', departmentId: departmentA, categoryId: categoryA, routingPriority: 10 }),
  ], context());
  assert.equal(result.userId, 'department-category');
});

test('inactive, draft, expired and out-of-shift assignments are skipped', () => {
  const result = chooseSupervisorAssignment([
    assignment({ userId: 'inactive-user', userActive: false }),
    assignment({ userId: 'draft-rule', verificationStatus: 'draft' }),
    assignment({ userId: 'expired-rule', effectiveTo: '2026-07-21T03:00:00Z' }),
    assignment({ userId: 'night-rule', shift: shift('8 PM-8 AM') }),
  ], context());
  assert.equal(result.assigned, false);
  assert.equal(result.reason, 'no_verified_active_shift_assignment');
});

test('overnight 8 PM-8 AM shift works before and after midnight with end exclusive', () => {
  const overnight = shift('8 PM-8 AM');
  assert.equal(isShiftActive(overnight, day('22:00:00')), true);
  assert.equal(isShiftActive(overnight, day('02:00:00')), true);
  assert.equal(isShiftActive(overnight, day('08:00:00')), false);
  assert.equal(isShiftActive(overnight, day('19:59:00')), false);
});

test('multiple matches are resolved deterministically by priority, type, specificity and user id', () => {
  const result = chooseSupervisorAssignment([
    assignment({ userId: 'supervisor-z', routingPriority: 20 }),
    assignment({ userId: 'supervisor-a', routingPriority: 20 }),
    assignment({ userId: 'supervisor-b', routingPriority: 30, departmentId: departmentA }),
  ], context());
  assert.equal(result.userId, 'supervisor-a');
});

test('Core and Extra Mural daytime remain gaps without verified mappings', () => {
  const matrix = nimsRosterCoverageMatrix();
  const core = matrix.find((row) => row.block === 'Core Block');
  const extra = matrix.find((row) => row.block === 'Extra Mural');
  assert.equal(core.windows.find((row) => row.window === '8 AM-12 Noon').status, 'gap');
  assert.equal(extra.windows.find((row) => row.window === '12 Noon-2 PM').status, 'gap');
});

test('official V2 Emergency and Radiation blocks are active while legacy blocks remain supported', () => {
  for (const block of ['Core Block', 'Admin Block', 'Millennium Block', 'Radiation Block', 'Speciality Block', 'Emergency Block']) {
    assert.equal(nimsActiveBlockNames.includes(block), true);
  }
  for (const legacyBlock of ['OPD Block', 'Oncology Block', 'Extra Mural']) {
    assert.equal(nimsActiveBlockNames.includes(legacyBlock), true);
    assert.equal(nimsLegacyActiveBlockNames.includes(legacyBlock), true);
  }
});

test('Emergency and Radiation inherit all-block night routing support', () => {
  const matrix = nimsRosterCoverageMatrix();
  for (const block of ['Emergency Block', 'Radiation Block']) {
    const row = matrix.find((item) => item.block === block);
    assert.equal(row.windows.find((window) => window.window === '8 PM-8 AM').status, 'primary');
  }
});

test('Admin OPD and Oncology 4 PM-8 PM remain gaps while night all-block coverage works', () => {
  const matrix = nimsRosterCoverageMatrix();
  for (const block of ['Admin Block', 'OPD Block', 'Oncology Block']) {
    const row = matrix.find((item) => item.block === block);
    assert.equal(row.windows.find((window) => window.window === '4 PM-8 PM').status, 'gap');
    assert.equal(row.windows.find((window) => window.window === '8 PM-8 AM').status, 'primary');
  }
});

test('Trauma roster responsibilities are not active selectable blocks', () => {
  assert.equal(nimsActiveBlockNames.includes('Trauma Block'), false);
  const plan = rosterImportPlan();
  assert.ok(plan.ambiguousBlocks.some((row) => row.block === 'Trauma Block'));
});

test('roster import plan is draft, rerunnable, and reports unmatched users', () => {
  const blocksByName = new Map(nimsActiveBlockNames.map((name) => [name.toLowerCase(), { id: name.toLowerCase() }]));
  const plan = rosterImportPlan({ blocksByName });
  assert.ok(plan.rows.length > 0);
  assert.ok(plan.rows.every((row) => row.verificationStatus === 'draft'));
  assert.equal(plan.rows.some((row) => row.isAutoAssignable), false);
  assert.ok(plan.unmatchedUsers.includes('M. Praveen'));
});
