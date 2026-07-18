import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canViewHospitalTicket,
  hospitalAllowedActions,
  isActiveHospitalUser,
  normalizeHospitalRole,
  scopeAllows,
} from '../services/hospitalTicketAuthService.js';
import {
  normalizeHospitalTicketCreate,
  slaMinutes,
  validateHospitalAction,
  validateHospitalTicketCreate,
} from '../services/hospitalTicketWorkflowService.js';
import {
  clientCanSeeHospitalEvent,
  clientHospitalEventView,
  hospitalSlaState,
  hospitalTicketForActor,
  hospitalTicketIdentifierColumn,
} from '../services/hospitalTicketService.js';

const activeUser = (role, id = 'user-a') => ({
  id,
  auth_user_id: `auth-${id}`,
  client_id: 'client-a',
  role_code: role,
  is_active: true,
});
const blockScope = (blockId, permissions = {}) => ({
  client_id: 'client-a',
  scope_type: 'block',
  block_id: blockId,
  can_view: true,
  can_create: false,
  can_update: false,
  ...permissions,
});

test('role normalization preserves distinct hospital roles', () => {
  assert.equal(normalizeHospitalRole('Housekeeping Supervisor'), 'housekeeping_supervisor');
  assert.equal(normalizeHospitalRole('Operations Executive'), 'operations_executive');
  assert.equal(normalizeHospitalRole('Facility Manager'), 'facility_manager');
});

test('inactive or unknown hospital users are rejected', () => {
  assert.equal(isActiveHospitalUser(activeUser('doctor')), true);
  assert.equal(isActiveHospitalUser({ ...activeUser('doctor'), is_active: false }), false);
  assert.equal(isActiveHospitalUser(activeUser('admin')), false);
});

test('Block A client and Supervisor cannot access Block B', () => {
  const ticketB = { client_id: 'client-a', block_id: 'block-b', location_id: 'location-b' };
  for (const role of ['doctor', 'housekeeping_supervisor']) {
    const actor = { user: activeUser(role), scopes: [blockScope('block-a', { can_create: true, can_update: true })] };
    assert.equal(canViewHospitalTicket(actor, ticketB), false);
  }
});

test('client-wide Operations and Facility roles see both blocks', () => {
  for (const role of ['operations_executive', 'facility_manager']) {
    const actor = { user: activeUser(role), scopes: [{ client_id: 'client-a', scope_type: 'client', can_view: true }] };
    assert.equal(canViewHospitalTicket(actor, { client_id: 'client-a', block_id: 'block-a' }), true);
    assert.equal(canViewHospitalTicket(actor, { client_id: 'client-a', block_id: 'block-b' }), true);
  }
});

test('creation scope is independent from view scope', () => {
  const scopes = [blockScope('block-a', { can_create: false })];
  assert.equal(scopeAllows(scopes, { clientId: 'client-a', blockId: 'block-a', permission: 'view' }), true);
  assert.equal(scopeAllows(scopes, { clientId: 'client-a', blockId: 'block-a', permission: 'create' }), false);
});

test('ticket creation validates canonical fields and priority', () => {
  const payload = normalizeHospitalTicketCreate({ block_id: 'b', location_id: 'l', category_id: 'c', priority: 'High', title: ' Wet floor ', description: ' Near ICU ', idempotency_key: 'request-1' });
  assert.deepEqual(validateHospitalTicketCreate(payload), []);
  assert.equal(payload.priority, 'high');
  assert.ok(validateHospitalTicketCreate({ ...payload, idempotencyKey: '' }).length > 0);
});

test('ticket detail selects UUIDs by id and ticket numbers without a UUID cast', () => {
  assert.equal(hospitalTicketIdentifierColumn('5f6eb87f-e9ed-4f4c-a557-4cf5ce68d8a8'), 'id');
  assert.equal(hospitalTicketIdentifierColumn('QPMS-HK-2026-000001'), 'ticket_no');
});

test('client responses omit internal identifiers and internal-only timeline updates', () => {
  const actor = { user: activeUser('doctor') };
  actor.user.profile_type = 'client';
  const view = hospitalTicketForActor(actor, {
    id: 'ticket-a',
    ticket_no: 'QPMS-HK-2026-000001',
    idempotency_key: 'private-retry-key',
    current_assignee_user_id: 'internal-user-id',
    metadata: { internal: true },
  });
  assert.equal(view.ticket_no, 'QPMS-HK-2026-000001');
  assert.equal('idempotency_key' in view, false);
  assert.equal('current_assignee_user_id' in view, false);
  assert.equal('metadata' in view, false);
  assert.equal(clientCanSeeHospitalEvent({ event_type: 'progress_update', event_data: {} }), false);
  assert.equal(clientCanSeeHospitalEvent({ event_type: 'progress_update', event_data: { is_client_visible: true } }), true);
  assert.equal('event_data' in clientHospitalEventView({ event_type: 'ticket_created', event_data: {}, actor_user_id: 'actor' }), false);
});

test('status transitions reject arbitrary frontend statuses', () => {
  assert.deepEqual(validateHospitalAction({ role: 'housekeeping_supervisor', status: 'assigned', action: 'accept' }), []);
  assert.ok(validateHospitalAction({ role: 'doctor', status: 'assigned', action: 'accept' }).length > 0);
  assert.ok(validateHospitalAction({ role: 'housekeeping_supervisor', status: 'closed', action: 'progress', payload: { remarks: 'x' } }).length > 0);
  assert.ok(validateHospitalAction({ role: 'doctor', status: 'assigned', action: 'progress', payload: { remarks: 'x' } }).length > 0);
  assert.deepEqual(validateHospitalAction({ role: 'operations_executive', status: 'escalated_operations_executive', action: 'progress', payload: { remarks: 'x' } }), []);
});

test('resolution and feedback validation enforce production requirements', () => {
  assert.ok(validateHospitalAction({ role: 'housekeeping_supervisor', status: 'in_progress', action: 'resolve', payload: {} }).length === 2);
  assert.deepEqual(validateHospitalAction({ role: 'housekeeping_supervisor', status: 'in_progress', action: 'resolve', payload: { resolution_action: 'Mopped', resolution_remarks: 'Dry and inspected' } }), []);
  assert.ok(validateHospitalAction({ role: 'doctor', status: 'resolved_awaiting_confirmation', action: 'feedback', payload: { rating: 2, satisfaction_status: 'not_satisfied', comments: '' } }).length > 0);
});

test('SLA configuration defaults safely and supports UAT overrides', () => {
  assert.deepEqual(slaMinutes({}), { supervisor: 20, operations: 30 });
  assert.deepEqual(slaMinutes({ HOSPITAL_SUPERVISOR_SLA_MINUTES: '1', HOSPITAL_OPERATIONS_SLA_MINUTES: '2' }), { supervisor: 1, operations: 2 });
});

test('SLA state is server-derived', () => {
  const now = new Date('2026-07-16T10:00:00Z');
  assert.equal(hospitalSlaState({ status_code: 'assigned', supervisor_sla_due_at: '2026-07-16T10:04:00Z' }, now).state, 'near_breach');
  assert.equal(hospitalSlaState({ status_code: 'assigned', supervisor_sla_due_at: '2026-07-16T09:59:00Z' }, now).state, 'breached');
  assert.equal(hospitalSlaState({ status_code: 'reopened', supervisor_sla_due_at: '2026-07-16T09:59:00Z' }, now).state, 'breached');
});

test('client and internal action lists stay separated', () => {
  assert.ok(hospitalAllowedActions(activeUser('doctor')).includes('create_ticket'));
  assert.ok(!hospitalAllowedActions(activeUser('doctor')).includes('resolve'));
  assert.ok(hospitalAllowedActions(activeUser('facility_manager')).includes('resolve'));
});
