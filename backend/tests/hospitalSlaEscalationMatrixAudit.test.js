import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  appScopeForHospitalUser,
  appScopeForNotification,
} from '../services/hospitalTicketPushService.js';
import { validateHospitalAction } from '../services/hospitalTicketWorkflowService.js';

const migration061 = readFileSync(
  new URL('../../supabase/migrations_2_0/061_hospital_escalation_acceptance_sla_2_minutes.sql', import.meta.url),
  'utf8',
);
const migration064 = readFileSync(
  new URL('../../supabase/migrations_2_0/064_nims_hospital_resolution_sla_20_minutes.sql', import.meta.url),
  'utf8',
);
const service = readFileSync(
  new URL('../services/hospitalTicketService.js', import.meta.url),
  'utf8',
);
const slaService = readFileSync(
  new URL('../services/hospitalTicketSlaService.js', import.meta.url),
  'utf8',
);
const workflow = readFileSync(
  new URL('../services/hospitalTicketWorkflowService.js', import.meta.url),
  'utf8',
);
const mobile = {
  api: readFileSync(new URL('../../Mobile_FO_V2/lib/hospital_housekeeping/hospital_ticket_api.dart', import.meta.url), 'utf8'),
  push: readFileSync(new URL('../../Mobile_FO_V2/lib/hospital_housekeeping/hospital_push_service.dart', import.meta.url), 'utf8'),
  shell: readFileSync(new URL('../../Mobile_FO_V2/lib/hospital_housekeeping/hospital_shell.dart', import.meta.url), 'utf8'),
  login: readFileSync(new URL('../../Mobile_FO_V2/lib/auth/login_screen.dart', import.meta.url), 'utf8'),
};

const t0 = Date.parse('2026-08-21T10:00:00.000Z');
const minute = 60 * 1000;
const acceptanceWindowMinutes = 20;

const rolesByLevel = {
  1: 'housekeeping_supervisor',
  2: 'operations_executive',
  3: 'facility_manager',
  4: 'project_head',
};

const statusesByLevel = {
  1: 'awaiting_supervisor_acceptance',
  2: 'escalated_operations_executive',
  3: 'escalated_facility_manager',
  4: 'escalated_project_head',
};

const defaultUsers = [
  hospitalUser('supervisor-1', 'housekeeping_supervisor'),
  hospitalUser('ops-1', 'operations_executive'),
  hospitalUser('facility-1', 'facility_manager'),
  hospitalUser('project-1', 'project_head'),
];

function hospitalUser(id, roleCode, active = true) {
  return {
    id,
    auth_user_id: `auth-${id}`,
    client_id: 'nims-client',
    profile_type: 'internal',
    role_code: roleCode,
    is_active: active,
  };
}

function iso(offsetMinutes) {
  return new Date(t0 + offsetMinutes * minute).toISOString();
}

function pickOwner(users, roleCode) {
  return users.find((user) =>
    user.client_id === 'nims-client' &&
    user.profile_type === 'internal' &&
    user.role_code === roleCode &&
    user.is_active === true) || null;
}

function baseTicket(overrides = {}) {
  return {
    id: 'ticket-1',
    ticket_no: 'QPMS-HK-2026-000001',
    client_id: 'nims-client',
    priority: 'low',
    status_code: 'awaiting_supervisor_acceptance',
    current_escalation_level_no: 1,
    current_escalation_level: 'supervisor',
    current_assignee_user_id: null,
    current_assignee_role: null,
    acceptance_status: 'awaiting',
    acceptance_due_at: iso(acceptanceWindowMinutes),
    acceptance_timeout_at: null,
    supervisor_sla_due_at: iso(20),
    operations_sla_due_at: null,
    facility_manager_sla_due_at: null,
    project_head_sla_due_at: null,
    escalation_due_at: null,
    final_escalation: false,
    sla_status: 'running',
    escalation_count: 0,
    version: 1,
    notifications: [],
    events: [],
    ...overrides,
  };
}

function enterLevel(ticket, users, fromLevel, now, reason) {
  let nextLevel = fromLevel + 1;
  let owner = null;
  while (nextLevel <= 4) {
    owner = pickOwner(users, rolesByLevel[nextLevel]);
    if (owner) break;
    nextLevel += 1;
  }
  if (!owner) {
    ticket.acceptance_status = ticket.acceptance_status === 'awaiting'
      ? 'timed_out'
      : ticket.acceptance_status;
    ticket.acceptance_due_at = null;
    ticket.escalation_due_at = null;
    ticket.sla_status = 'blocked';
    ticket.version += 1;
    ticket.events.push('higher_escalation_assignment_missing');
    return ticket;
  }

  const acceptanceDue = new Date(now + acceptanceWindowMinutes * minute).toISOString();
  const workDue = new Date(now + 20 * minute).toISOString();
  ticket.notifications.forEach((row) => {
    if (row.action_status === 'active') row.action_status = 'timed_out';
  });
  ticket.status_code = statusesByLevel[nextLevel];
  ticket.current_escalation_level_no = nextLevel;
  ticket.current_escalation_level = rolesByLevel[nextLevel];
  ticket.current_assignee_user_id = owner.id;
  ticket.current_assignee_role = owner.role_code;
  ticket.acceptance_status = 'awaiting';
  ticket.acceptance_due_at = acceptanceDue;
  ticket.escalation_due_at = acceptanceDue;
  ticket.sla_status = 'running';
  ticket.escalation_count += 1;
  ticket.version += 1;
  ticket.final_escalation = nextLevel === 4;
  if (nextLevel === 2) {
    ticket.supervisor_sla_due_at = null;
    ticket.operations_sla_due_at = workDue;
  }
  if (nextLevel === 3) ticket.facility_manager_sla_due_at = workDue;
  if (nextLevel === 4) ticket.project_head_sla_due_at = workDue;
  ticket.events.push(nextLevel === 4 ? 'project_head_assigned' : 'ticket_escalated');
  ticket.notifications.push({
    recipient_user_id: owner.id,
    recipient: owner,
    notification_type: nextLevel === 2 && ['supervisor_acceptance_timeout', 'no_on_duty_supervisor'].includes(reason)
      ? 'supervisor_acceptance_timeout'
      : 'sla_escalation',
    current_owner_role: owner.role_code,
    escalation_level: nextLevel,
    action_status: 'active',
    action_expires_at: acceptanceDue,
    metadata: { app_scope: 'myqpms_internal', acceptance_due_at: acceptanceDue },
  });
  return ticket;
}

function acceptCurrentLevel(ticket, actorId, now) {
  if (ticket.acceptance_status !== 'awaiting') return ticket;
  if (!ticket.acceptance_due_at || Date.parse(ticket.acceptance_due_at) <= now) return ticket;
  ticket.acceptance_status = 'accepted';
  ticket.accepted_by_user_id = actorId;
  ticket.current_assignee_user_id = actorId;
  const level = ticket.current_escalation_level_no;
  if (level === 1) {
    ticket.status_code = 'accepted';
    ticket.escalation_due_at = ticket.supervisor_sla_due_at;
  }
  if (level === 2) ticket.escalation_due_at = ticket.operations_sla_due_at;
  if (level === 3) ticket.escalation_due_at = ticket.facility_manager_sla_due_at;
  if (level === 4) ticket.escalation_due_at = ticket.project_head_sla_due_at;
  ticket.sla_status = level === 4 ? 'final_owner' : 'running';
  ticket.notifications.forEach((row) => {
    if (row.recipient_user_id === actorId && row.action_status === 'active') row.action_status = 'accepted';
  });
  ticket.events.push('escalation_acceptance_accepted');
  ticket.version += 1;
  return ticket;
}

function processWorkSla(ticket, users, now) {
  if (['resolved_awaiting_confirmation', 'closed', 'cancelled'].includes(ticket.status_code)) return ticket;
  if (ticket.acceptance_status === 'awaiting') return ticket;
  if (ticket.final_escalation) return ticket;
  const dueAt = ticket.escalation_due_at ||
    ticket.supervisor_sla_due_at ||
    ticket.operations_sla_due_at ||
    ticket.facility_manager_sla_due_at ||
    ticket.project_head_sla_due_at;
  if (!dueAt || Date.parse(dueAt) > now) return ticket;
  const level = ticket.current_escalation_level_no || 1;
  if (level >= 4) {
    ticket.final_escalation = true;
    ticket.sla_status = 'final_owner';
    ticket.version += 1;
    return ticket;
  }
  return enterLevel(ticket, users, level, now, `${rolesByLevel[level]}_sla_missed`);
}

function processAcceptance(ticket, users, now) {
  if (['resolved_awaiting_confirmation', 'closed', 'cancelled'].includes(ticket.status_code)) return ticket;
  if (ticket.acceptance_status !== 'awaiting') return ticket;
  if (!ticket.acceptance_due_at || Date.parse(ticket.acceptance_due_at) > now) return ticket;
  const level = ticket.status_code === 'awaiting_supervisor_acceptance'
    ? 1
    : ticket.current_escalation_level_no;
  if (level >= 4) {
    ticket.acceptance_status = 'timed_out';
    ticket.acceptance_timeout_at = new Date(now).toISOString();
    ticket.acceptance_due_at = null;
    ticket.escalation_due_at = null;
    ticket.sla_status = 'blocked';
    ticket.final_escalation = true;
    ticket.notifications.forEach((row) => {
      if (row.action_status === 'active') row.action_status = 'timed_out';
    });
    ticket.events.push('project_head_acceptance_overdue');
    ticket.version += 1;
    return ticket;
  }
  return enterLevel(ticket, users, level, now, `${rolesByLevel[level]}_acceptance_timeout`);
}

function runTwice(ticket, users, now) {
  processAcceptance(ticket, users, now);
  processAcceptance(ticket, users, now);
  return ticket;
}

function ticketAtLevel(level, dueOffset) {
  if (level === 1) return baseTicket({ acceptance_due_at: iso(dueOffset) });
  const owner = defaultUsers.find((user) => user.role_code === rolesByLevel[level]);
  return baseTicket({
    status_code: statusesByLevel[level],
    current_escalation_level_no: level,
    current_escalation_level: rolesByLevel[level],
    current_assignee_user_id: owner.id,
    current_assignee_role: owner.role_code,
    acceptance_status: 'awaiting',
    acceptance_due_at: iso(dueOffset),
    escalation_due_at: iso(dueOffset),
    notifications: [{
      recipient_user_id: owner.id,
      recipient: owner,
      notification_type: level === 2 ? 'supervisor_acceptance_timeout' : 'sla_escalation',
      current_owner_role: owner.role_code,
      escalation_level: level,
      action_status: 'active',
      action_expires_at: iso(dueOffset),
      metadata: { app_scope: 'myqpms_internal', acceptance_due_at: iso(dueOffset) },
    }],
  });
}

function resultRow({ scenario, ticket, users = defaultUsers, timeOffset, accepted = false, acceptAtOffset = null, acceptUserId = null, expectedNextRole }) {
  if (accepted) acceptCurrentLevel(ticket, acceptUserId || ticket.current_assignee_user_id, t0 + acceptAtOffset * minute);
  processAcceptance(ticket, users, t0 + timeOffset * minute);
  const activeNotification = ticket.notifications.at(-1);
  const actualRole = activeNotification?.recipient?.role_code || ticket.current_assignee_role || null;
  const actualApp = activeNotification ? appScopeForNotification(activeNotification) : null;
  const pass = expectedNextRole === null
    ? ticket.notifications.filter((row) => row.action_status === 'active').length === 0 || ticket.current_assignee_role === null
    : actualRole === expectedNextRole && actualApp === 'myqpms_internal';
  return {
    scenario,
    currentRole: rolesByLevel[ticket.current_escalation_level_no] || ticket.current_assignee_role,
    time: new Date(t0 + timeOffset * minute).toISOString().slice(11, 19),
    accepted,
    expectedNextRole,
    actualRole,
    actualStatus: ticket.status_code,
    actualAcceptanceDueAt: ticket.acceptance_due_at,
    notifications: ticket.notifications.length,
    events: ticket.events.length,
    pass,
  };
}

test('20-minute acceptance SLA scenarios pass deterministically without real waits', () => {
  const rows = [
    resultRow({
      scenario: 'Supervisor T+19:59',
      ticket: baseTicket({ acceptance_due_at: new Date(t0 + 1199000).toISOString() }),
      timeOffset: 19.98,
      expectedNextRole: null,
    }),
    resultRow({
      scenario: 'Supervisor T+20:00',
      ticket: baseTicket(),
      timeOffset: 20,
      expectedNextRole: 'operations_executive',
    }),
    resultRow({
      scenario: 'Supervisor accepted T+1:30',
      ticket: baseTicket({
        current_assignee_user_id: 'supervisor-1',
        current_assignee_role: 'housekeeping_supervisor',
      }),
      accepted: true,
      acceptAtOffset: 1.5,
      acceptUserId: 'supervisor-1',
      timeOffset: 21,
      expectedNextRole: null,
    }),
    resultRow({
      scenario: 'Operations T+39:59',
      ticket: enterLevel(baseTicket(), defaultUsers, 1, t0 + 20 * minute, 'supervisor_acceptance_timeout'),
      timeOffset: 39.98,
      expectedNextRole: 'operations_executive',
    }),
    resultRow({
      scenario: 'Operations T+40:00',
      ticket: enterLevel(baseTicket(), defaultUsers, 1, t0 + 20 * minute, 'supervisor_acceptance_timeout'),
      timeOffset: 40,
      expectedNextRole: 'facility_manager',
    }),
    resultRow({
      scenario: 'Operations accepted T+30:00',
      ticket: enterLevel(baseTicket(), defaultUsers, 1, t0 + 20 * minute, 'supervisor_acceptance_timeout'),
      accepted: true,
      acceptAtOffset: 30,
      acceptUserId: 'ops-1',
      timeOffset: 41,
      expectedNextRole: 'operations_executive',
    }),
    resultRow({
      scenario: 'Facility T+59:59',
      ticket: enterLevel(baseTicket(), defaultUsers, 2, t0 + 40 * minute, 'operations_executive_acceptance_timeout'),
      timeOffset: 59.98,
      expectedNextRole: 'facility_manager',
    }),
    resultRow({
      scenario: 'Facility T+60:00',
      ticket: enterLevel(baseTicket(), defaultUsers, 2, t0 + 40 * minute, 'operations_executive_acceptance_timeout'),
      timeOffset: 60,
      expectedNextRole: 'project_head',
    }),
    resultRow({
      scenario: 'Facility accepted before T+60',
      ticket: enterLevel(baseTicket(), defaultUsers, 2, t0 + 40 * minute, 'operations_executive_acceptance_timeout'),
      accepted: true,
      acceptAtOffset: 50,
      acceptUserId: 'facility-1',
      timeOffset: 61,
      expectedNextRole: 'facility_manager',
    }),
  ];

  for (const row of rows) assert.equal(row.pass, true, JSON.stringify(row));
  assert.equal(rows[4].actualAcceptanceDueAt, iso(60));
  assert.equal(rows[7].actualAcceptanceDueAt, iso(80));
});

test('high-priority NIMS tickets use 20-minute unresolved-work SLA per operational level', () => {
  const ticket = baseTicket({
    priority: 'high',
    current_assignee_user_id: 'supervisor-1',
    current_assignee_role: 'housekeeping_supervisor',
  });

  acceptCurrentLevel(ticket, 'supervisor-1', t0 + 1 * minute);
  for (const at of [10, 15, 19]) {
    processWorkSla(ticket, defaultUsers, t0 + at * minute);
    assert.equal(ticket.current_assignee_role, 'housekeeping_supervisor', `unexpected escalation at ${at} minutes`);
    assert.equal(ticket.notifications.length, 0);
  }

  processWorkSla(ticket, defaultUsers, t0 + 20 * minute);
  assert.equal(ticket.current_assignee_role, 'operations_executive');
  assert.equal(ticket.status_code, 'escalated_operations_executive');
  assert.equal(ticket.notifications.at(-1).recipient.role_code, 'operations_executive');
  assert.equal(ticket.operations_sla_due_at, iso(40));

  acceptCurrentLevel(ticket, 'ops-1', t0 + 21 * minute);
  processWorkSla(ticket, defaultUsers, t0 + 39 * minute);
  assert.equal(ticket.current_assignee_role, 'operations_executive');
  assert.equal(ticket.notifications.at(-1).recipient.role_code, 'operations_executive');

  processWorkSla(ticket, defaultUsers, t0 + 40 * minute);
  assert.equal(ticket.current_assignee_role, 'facility_manager');
  assert.equal(ticket.status_code, 'escalated_facility_manager');
  assert.equal(ticket.notifications.at(-1).recipient.role_code, 'facility_manager');
  assert.equal(ticket.facility_manager_sla_due_at, iso(60));

  acceptCurrentLevel(ticket, 'facility-1', t0 + 41 * minute);
  processWorkSla(ticket, defaultUsers, t0 + 59 * minute);
  assert.equal(ticket.current_assignee_role, 'facility_manager');
  assert.equal(ticket.notifications.at(-1).recipient.role_code, 'facility_manager');

  processWorkSla(ticket, defaultUsers, t0 + 60 * minute);
  assert.equal(ticket.current_assignee_role, 'project_head');
  assert.equal(ticket.status_code, 'escalated_project_head');
  assert.equal(ticket.notifications.at(-1).recipient.role_code, 'project_head');
  assert.equal(ticket.final_escalation, true);
});

test('resolved tickets before the 20-minute supervisor deadline do not escalate', () => {
  const ticket = baseTicket({
    priority: 'high',
    current_assignee_user_id: 'supervisor-1',
    current_assignee_role: 'housekeeping_supervisor',
  });
  acceptCurrentLevel(ticket, 'supervisor-1', t0 + 1 * minute);
  ticket.status_code = 'resolved_awaiting_confirmation';
  ticket.escalation_due_at = null;

  processWorkSla(ticket, defaultUsers, t0 + 20 * minute);

  assert.equal(ticket.current_assignee_role, 'housekeeping_supervisor');
  assert.equal(ticket.notifications.length, 0);
});

test('Project Head has no invented higher role and final timeout is one-shot', () => {
  const projectTicket = enterLevel(baseTicket(), defaultUsers, 3, t0 + 60 * minute, 'facility_manager_acceptance_timeout');
  processAcceptance(projectTicket, defaultUsers, t0 + 79.98 * minute);
  assert.equal(projectTicket.acceptance_status, 'awaiting');
  assert.equal(projectTicket.current_assignee_role, 'project_head');

  runTwice(projectTicket, defaultUsers, t0 + 80 * minute);
  assert.equal(projectTicket.current_assignee_role, 'project_head');
  assert.equal(projectTicket.status_code, 'escalated_project_head');
  assert.equal(projectTicket.acceptance_status, 'timed_out');
  assert.equal(projectTicket.sla_status, 'blocked');
  assert.equal(projectTicket.events.filter((event) => event === 'project_head_acceptance_overdue').length, 1);
});

test('unavailable roles skip upward through the intended hierarchy', () => {
  const noSupervisor = enterLevel(baseTicket(), defaultUsers, 1, t0, 'no_on_duty_supervisor');
  assert.equal(noSupervisor.current_assignee_role, 'operations_executive');
  assert.equal(noSupervisor.acceptance_due_at, iso(20));

  const noOps = defaultUsers.filter((user) => user.role_code !== 'operations_executive');
  const skippedOps = enterLevel(baseTicket(), noOps, 1, t0 + 20 * minute, 'supervisor_acceptance_timeout');
  assert.equal(skippedOps.current_assignee_role, 'facility_manager');
  assert.equal(skippedOps.status_code, 'escalated_facility_manager');
  assert.equal(skippedOps.acceptance_due_at, iso(40));

  const noFacility = defaultUsers.filter((user) => user.role_code !== 'facility_manager');
  const skippedFacility = enterLevel(baseTicket(), noFacility, 2, t0 + 40 * minute, 'operations_executive_acceptance_timeout');
  assert.equal(skippedFacility.current_assignee_role, 'project_head');
  assert.equal(skippedFacility.status_code, 'escalated_project_head');
  assert.equal(skippedFacility.acceptance_due_at, iso(60));
});

test('final statuses and duplicate processor runs are safe', () => {
  for (const status of ['resolved_awaiting_confirmation', 'closed', 'cancelled']) {
    const ticket = baseTicket({ status_code: status, acceptance_due_at: iso(20) });
    processAcceptance(ticket, defaultUsers, t0 + 10 * minute);
    assert.equal(ticket.notifications.length, 0);
    assert.equal(ticket.events.length, 0);
  }

  for (const [fromLevel, expectedRole, at] of [
    [1, 'operations_executive', 20],
    [2, 'facility_manager', 40],
    [3, 'project_head', 60],
  ]) {
    const ticket = ticketAtLevel(fromLevel, at);
    const previousNotificationCount = ticket.notifications.length;
    runTwice(ticket, defaultUsers, t0 + at * minute);
    assert.equal(ticket.current_assignee_role, expectedRole);
    assert.equal(ticket.notifications.filter((row) => row.action_status === 'active').length, 1);
    assert.equal(ticket.notifications.at(-1).recipient.role_code, expectedRole);
    assert.equal(ticket.notifications.length, previousNotificationCount + 1);
  }
});

test('SQL and backend contracts implement the focused acceptance chain', () => {
  assert.match(migration061, /select interval '2 minutes'/);
  assert.match(migration061, /hospital_escalation_acceptance_window/);
  assert.match(migration064, /hospital_escalation_acceptance_window/);
  assert.match(migration064, /interval '20 minutes'/);
  assert.match(migration064, /hospital_ticket_client_sla_overrides/);
  assert.match(migration064, /alter table public\.hospital_ticket_client_sla_overrides enable row level security/i);
  assert.match(migration064, /revoke all on table public\.hospital_ticket_client_sla_overrides from public, anon, authenticated/i);
  assert.match(migration064, /grant select, insert, update, delete on table public\.hospital_ticket_client_sla_overrides to service_role/i);
  assert.match(migration064, /hospital_ticket_sla_minutes_for_client/);
  assert.match(migration064, /hospital_ticket_acceptance_window_for_client/);
  assert.match(migration064, /bfb5d707-1a4e-451d-af1f-11b7c0aeeb66/);
  assert.match(migration064, /NIMS_HYDERABAD/);
  assert.doesNotMatch(migration064, /client_name\s+ilike/i);
  assert.match(migration064, /create or replace function public\.rpc_create_hospital_contact_ticket/);
  assert.match(migration064, /add column if not exists facility_manager_sla_due_at/);
  assert.match(migration064, /public\.hospital_ticket_sla_minutes_for_client\(v_ticket\.client_id, v_ticket\.priority, v_next_level\)/);
  assert.match(migration064, /v_acceptance_due_at := now\(\) \+ public\.hospital_ticket_acceptance_window_for_client\(v_contact\.client_id\)/);
  assert.doesNotMatch(migration064, /insert into public\.hospital_ticket_sla_matrix/i);
  assert.doesNotMatch(migration064, /update public\.hospital_ticket_sla_matrix/i);
  assert.doesNotMatch(migration064, /create or replace function public\.hospital_ticket_role_for_level/i);
  assert.doesNotMatch(migration064, /create or replace function public\.hospital_supervisor_acceptance_window/i);
  assert.doesNotMatch(migration064, /create or replace function public\.hospital_escalation_acceptance_window/i);
  assert.doesNotMatch(migration064, /make_interval\(mins => public\.hospital_ticket_sla_minutes\(/);
  assert.match(migration061, /acceptance_status = 'awaiting'/);
  assert.match(migration061, /acceptance_due_at = v_acceptance_due/);
  assert.match(migration061, /escalation_due_at = v_acceptance_due/);
  assert.doesNotMatch(migration061, /sla_status = 'awaiting_acceptance'/);
  assert.match(migration061, /create or replace function public\.rpc_process_hospital_ticket_sla\(/);
  assert.match(migration061, /perform public\.hospital_ticket_escalate_to_acceptance_level\(v_ticket\.id, 1, 'supervisor_acceptance_timeout', p_now\)/);
  assert.match(migration061, /perform public\.hospital_ticket_escalate_to_acceptance_level\(v_ticket\.id, v_level, v_ticket\.current_assignee_role \|\| '_acceptance_timeout', p_now\)/);
  assert.match(migration061, /select public\.rpc_process_hospital_ticket_sla_day2_only\(p_now, p_operations_sla_minutes\)/);
  assert.match(migration061, /v_work_due := p_now \+ make_interval\(mins => public\.hospital_ticket_sla_minutes/);
  assert.match(migration061, /public\.hospital_pick_ticket_owner\(v_ticket\.client_id, v_next_role\)/);
  assert.match(migration061, /while v_next_level <= 4 loop/);
  assert.match(migration061, /project_head_acceptance_overdue/);
  assert.match(migration061, /coalesce\(acceptance_status,'not_required'\) <> 'awaiting'/);
  assert.match(migration061, /'app_scope','myqpms_internal'/);
  assert.doesNotMatch(migration061, /Client_Ticketing_App/);

  assert.match(service, /rpc_accept_hospital_escalation_ticket/);
  assert.match(service, /\['accept', 'take_over'\]\.includes\(effectiveAction\)/);
  assert.match(slaService, /client\.rpc\('rpc_process_hospital_ticket_sla'/);
  assert.match(workflow, /role === 'operations_executive' && status === 'escalated_operations_executive'/);
  assert.match(workflow, /role === 'facility_manager' && status === 'escalated_facility_manager'/);
  assert.match(workflow, /role === 'project_head' && status === 'escalated_project_head'/);

  for (const role of ['housekeeping_supervisor', 'operations_executive', 'facility_manager', 'project_head']) {
    assert.equal(appScopeForHospitalUser(hospitalUser(`${role}-1`, role)), 'myqpms_internal');
  }
  assert.equal(appScopeForNotification({ notification_type: 'incoming_supervisor_ticket' }), 'myqpms_internal');
  assert.equal(appScopeForNotification({ notification_type: 'supervisor_acceptance_timeout' }), 'myqpms_internal');
  assert.equal(appScopeForNotification({ notification_type: 'sla_escalation' }), 'myqpms_internal');
});

test('Mobile_FO_V2 internal role/session routing still covers escalation roles', () => {
  for (const role of ['operations_executive', 'facility_manager', 'project_head']) {
    assert.match(mobile.api, new RegExp(`'${role}' => HospitalDemoRole\\.`));
  }
  assert.match(mobile.login, /HospitalTicketApi\.discoverCurrentInternalSession/);
  assert.match(mobile.shell, /HospitalPushService\.registerAuthenticatedDevice/);
  assert.match(mobile.push, /static const appScope = 'myqpms_internal'/);
  assert.match(mobile.api, /'\/api\/hospital-tickets'/);
  assert.match(mobile.push, /'\/api\/hospital-tickets\/me\/push-devices'/);

  assert.deepEqual(validateHospitalAction({ role: 'operations_executive', status: 'escalated_operations_executive', action: 'accept' }), []);
  assert.deepEqual(validateHospitalAction({ role: 'facility_manager', status: 'escalated_facility_manager', action: 'accept' }), []);
  assert.deepEqual(validateHospitalAction({ role: 'project_head', status: 'escalated_project_head', action: 'accept' }), []);
  assert.deepEqual(validateHospitalAction({ role: 'operations_executive', status: 'escalated_operations_executive', action: 'take_over' }), []);
  assert.deepEqual(validateHospitalAction({ role: 'facility_manager', status: 'escalated_facility_manager', action: 'take_over' }), []);
  assert.deepEqual(validateHospitalAction({ role: 'project_head', status: 'escalated_project_head', action: 'take_over' }), []);
});
