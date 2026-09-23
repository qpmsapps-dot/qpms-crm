import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  canViewHospitalTicket,
  isActiveHospitalTicket,
} from '../services/hospitalTicketAuthService.js';
import { allowedActionsForTicket } from '../services/hospitalTicketService.js';
import { validateHospitalAction } from '../services/hospitalTicketWorkflowService.js';

const migration = readFileSync(
  new URL('../../supabase/migrations_2_0/103_nims_ticket_visibility_operational_acceptance.sql', import.meta.url),
  'utf8',
);
const service = readFileSync(new URL('../services/hospitalTicketService.js', import.meta.url), 'utf8');

function actor(role, id, clientId = 'nims-client') {
  return {
    user: {
      id,
      auth_user_id: `auth-${id}`,
      client_id: clientId,
      profile_type: 'internal',
      role_code: role,
      is_active: true,
      metadata: {},
    },
    scopes: [{
      client_id: clientId,
      scope_type: 'block',
      block_id: 'block-a',
      can_view: true,
      can_update: true,
    }],
  };
}

function ticket(status_code, values = {}) {
  return {
    id: `ticket-${status_code}`,
    client_id: 'nims-client',
    block_id: 'block-b',
    location_id: 'location-b',
    status_code,
    current_assignee_user_id: null,
    current_assignee_role: null,
    supervisor_user_id: null,
    acceptance_status: 'awaiting',
    version: 1,
    ...values,
  };
}

test('Facility Manager has complete NIMS visibility and tenant isolation', () => {
  const facility = actor('facility_manager', 'facility-user');
  for (const status of [
    'open',
    'assigned',
    'accepted',
    'in_progress',
    'escalated_operations_executive',
    'escalated_facility_manager',
    'escalated_project_head',
    'resolved_awaiting_confirmation',
    'closed',
    'cancelled',
  ]) {
    assert.equal(canViewHospitalTicket(facility, ticket(status)), true, status);
  }
  assert.equal(canViewHospitalTicket(facility, ticket('open', { client_id: 'other-client' })), false);
});

test('Operations Executive and both Supervisors see all active tickets across ownership and escalation', () => {
  const actors = [
    actor('operations_executive', 'operations-user'),
    actor('housekeeping_supervisor', 'supervisor-a'),
    actor('housekeeping_supervisor', 'supervisor-b'),
  ];
  const active = [
    ticket('open'),
    ticket('assigned', { current_assignee_user_id: 'supervisor-a', current_assignee_role: 'housekeeping_supervisor', supervisor_user_id: 'supervisor-a' }),
    ticket('accepted', { current_assignee_user_id: 'supervisor-b', current_assignee_role: 'housekeeping_supervisor', supervisor_user_id: 'supervisor-b' }),
    ticket('escalated_operations_executive', { current_assignee_user_id: 'operations-user', current_assignee_role: 'operations_executive' }),
    ticket('escalated_facility_manager', { current_assignee_user_id: 'facility-user', current_assignee_role: 'facility_manager' }),
    ticket('escalated_project_head', { current_assignee_user_id: 'project-user', current_assignee_role: 'project_head' }),
    ticket('resolved_awaiting_confirmation'),
  ];
  for (const currentActor of actors) {
    for (const currentTicket of active) {
      assert.equal(canViewHospitalTicket(currentActor, currentTicket), true, `${currentActor.user.id}:${currentTicket.status_code}`);
    }
    assert.equal(canViewHospitalTicket(currentActor, ticket('closed')), false);
    assert.equal(canViewHospitalTicket(currentActor, ticket('cancelled')), false);
  }
});

test('Supervisor acceptance is exposed at every open escalation level only while operationally unowned', () => {
  const supervisor = actor('housekeeping_supervisor', 'supervisor-a');
  for (const status of [
    'open',
    'assigned',
    'awaiting_supervisor_acceptance',
    'escalated_operations_executive',
    'escalated_facility_manager',
    'escalated_project_head',
  ]) {
    const currentTicket = ticket(status);
    assert.deepEqual(validateHospitalAction({ role: 'housekeeping_supervisor', status, action: 'accept' }), []);
    assert.ok(allowedActionsForTicket(supervisor, currentTicket).includes('accept'), status);
    assert.ok(!allowedActionsForTicket(supervisor, { ...currentTicket, supervisor_user_id: 'supervisor-b' }).includes('accept'), status);
  }
  assert.equal(isActiveHospitalTicket(ticket('closed')), false);
  assert.equal(isActiveHospitalTicket(ticket('cancelled')), false);
  assert.ok(!allowedActionsForTicket(supervisor, ticket('resolved_awaiting_confirmation')).includes('accept'));
});

test('shared visibility does not grant another Supervisor or manager ownership actions', () => {
  const owned = ticket('in_progress', {
    current_assignee_user_id: 'supervisor-a',
    current_assignee_role: 'housekeeping_supervisor',
    supervisor_user_id: 'supervisor-a',
    accepted_by_user_id: 'supervisor-a',
    acceptance_status: 'accepted',
  });
  const otherSupervisor = actor('housekeeping_supervisor', 'supervisor-b');
  const facility = actor('facility_manager', 'facility-user');

  assert.equal(canViewHospitalTicket(otherSupervisor, owned), true);
  assert.equal(canViewHospitalTicket(facility, owned), true);
  for (const action of ['accept', 'start_work', 'progress', 'request_assistance', 'resolve', 'reassign_supervisor']) {
    assert.equal(allowedActionsForTicket(otherSupervisor, owned).includes(action), false, action);
    assert.equal(allowedActionsForTicket(facility, owned).includes(action), false, action);
  }
});

test('operational acceptance RPC is atomic, tenant-scoped, single-owner, and preserves escalation audit state', () => {
  assert.match(service, /rpc_accept_hospital_operational_ticket/);
  assert.match(migration, /from public\.hospital_tickets[\s\S]*where id=p_ticket_id[\s\S]*for update/);
  assert.match(migration, /v_ticket\.client_id <> v_actor\.client_id/);
  assert.match(migration, /and supervisor_user_id is null/);
  assert.match(migration, /Ticket has already been accepted by another Supervisor/);
  assert.match(migration, /current_assignee_user_id=case when v_is_escalated then current_assignee_user_id else v_actor\.id end/);
  assert.match(migration, /current_escalation_level=case when v_is_escalated then current_escalation_level else 'supervisor' end/);
  assert.match(migration, /supervisor_accepted_after_escalation/);
  assert.match(migration, /hospital_record_assignment_history/);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.hospital_ticket_(events|notifications)/i);
});

test('RLS ticket reads use the same role-based visibility without weakening tenant isolation', () => {
  assert.match(migration, /create or replace function public\.hospital_can_access_ticket/);
  assert.match(migration, /u\.client_id=t\.client_id/);
  assert.match(migration, /u\.role_code='facility_manager'/);
  assert.match(migration, /u\.role_code in \('housekeeping_supervisor','operations_executive'\)/);
  assert.match(migration, /t\.status_code not in \('closed','cancelled'\)/);
  assert.match(migration, /using \(public\.hospital_can_access_ticket\(id\)\)/);
});
