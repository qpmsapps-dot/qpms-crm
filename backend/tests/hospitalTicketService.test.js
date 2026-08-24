import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  canViewHospitalTicket,
  createHospitalAuthMiddleware,
  hospitalAllowedActions,
  isActiveHospitalUser,
  isAdminApplicationRole,
  normalizeHospitalRole,
  resolveAdminHospitalActor,
  scopeAllows,
} from '../services/hospitalTicketAuthService.js';
import {
  hospitalEscalationRoleForLevel,
  hospitalEscalationLevels,
  normalizeHospitalTicketCreate,
  normalizedHospitalSlaPriority,
  prioritySlaMinutes,
  slaMinutes,
  validateHospitalAction,
  validateHospitalTicketCreate,
} from '../services/hospitalTicketWorkflowService.js';
import {
  clientCanSeeHospitalEvent,
  clientHospitalEventView,
  buildHospitalLifecycleNotificationRows,
  getHospitalTicket,
  hospitalLifecycleNotificationDedupeKey,
  hospitalDashboard,
  hospitalSlaState,
  hospitalTicketForActor,
  hospitalTicketIdentifierColumn,
  listHospitalNotifications,
  listHospitalTickets,
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
  assert.equal(normalizeHospitalRole('Project Head'), 'project_head');
  assert.equal(normalizeHospitalRole('ADMIN'), 'admin');
  assert.equal(isAdminApplicationRole('Admin'), true);
  assert.equal(isAdminApplicationRole('QPMS Admin'), false);
});

test('inactive or unknown hospital users are rejected', () => {
  assert.equal(isActiveHospitalUser(activeUser('doctor')), true);
  assert.equal(isActiveHospitalUser(activeUser('project_head')), true);
  assert.equal(isActiveHospitalUser(activeUser('admin')), true);
  assert.equal(isActiveHospitalUser({ ...activeUser('doctor'), is_active: false }), false);
  assert.equal(isActiveHospitalUser(activeUser('developer')), false);
});

test('ticket lifecycle notifications cover useful client milestones without assignment spam', () => {
  const actor = { user: activeUser('doctor', 'client-user') };
  const baseTicket = {
    id: 'ticket-1',
    ticket_no: 'QPMS-HK-2026-000041',
    raised_by_user_id: 'client-user',
    priority: 'high',
    version: 1,
    reopen_count: 0,
    current_assignee_role: 'housekeeping_supervisor',
    current_escalation_level_no: 1,
  };

  const created = buildHospitalLifecycleNotificationRows({
    action: 'ticket_created',
    actor,
    afterTicket: { ...baseTicket, status_code: 'awaiting_supervisor_acceptance' },
  });
  assert.equal(created.length, 1);
  assert.equal(created[0].notification_type, 'ticket_created');
  assert.equal(created[0].recipient_user_id, 'client-user');
  assert.equal(created[0].metadata.app_scope, 'qpms_client');

  const accepted = buildHospitalLifecycleNotificationRows({
    action: 'accept',
    actor: { user: activeUser('housekeeping_supervisor', 'supervisor-user') },
    beforeTicket: { ...baseTicket, status_code: 'awaiting_supervisor_acceptance', version: 1 },
    afterTicket: { ...baseTicket, status_code: 'accepted', version: 2 },
  });
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].notification_type, 'ticket_accepted');

  const workStarted = buildHospitalLifecycleNotificationRows({
    action: 'start_work',
    actor: { user: activeUser('housekeeping_supervisor', 'supervisor-user') },
    beforeTicket: { ...baseTicket, status_code: 'accepted', version: 2 },
    afterTicket: { ...baseTicket, status_code: 'in_progress', version: 3 },
  });
  assert.equal(workStarted.length, 1);
  assert.equal(workStarted[0].notification_type, 'work_started');

  const noAssignmentSpam = buildHospitalLifecycleNotificationRows({
    action: 'reassign_supervisor',
    actor: { user: activeUser('operations_executive', 'ops-user') },
    beforeTicket: { ...baseTicket, status_code: 'accepted', version: 4 },
    afterTicket: { ...baseTicket, status_code: 'accepted', version: 5 },
  });
  assert.equal(noAssignmentSpam.length, 0);

  const resolved = buildHospitalLifecycleNotificationRows({
    action: 'resolve',
    actor: { user: activeUser('housekeeping_supervisor', 'supervisor-user') },
    beforeTicket: { ...baseTicket, status_code: 'in_progress', version: 5 },
    afterTicket: { ...baseTicket, status_code: 'resolved_awaiting_confirmation', version: 6 },
  });
  assert.equal(resolved.length, 0);
});

test('client not-satisfied feedback sends client reopen confirmation and allows next work cycle', () => {
  const ticket = {
    id: 'ticket-1',
    ticket_no: 'QPMS-HK-2026-000041',
    raised_by_user_id: 'client-user',
    priority: 'high',
    current_assignee_role: 'housekeeping_supervisor',
    current_escalation_level_no: 1,
  };

  const reopened = buildHospitalLifecycleNotificationRows({
    action: 'feedback',
    actor: { user: activeUser('doctor', 'client-user') },
    beforeTicket: { ...ticket, status_code: 'resolved_awaiting_confirmation', version: 6, reopen_count: 0 },
    afterTicket: { ...ticket, status_code: 'reopened', version: 7, reopen_count: 1 },
  });
  assert.equal(reopened.length, 1);
  assert.equal(reopened[0].notification_type, 'ticket_reopened_client');
  assert.match(reopened[0].body, /reopened/);

  const firstWorkKey = hospitalLifecycleNotificationDedupeKey({
    ticketId: 'ticket-1',
    recipientUserId: 'client-user',
    notificationType: 'work_started',
    version: 3,
    cycle: 0,
  });
  const secondWorkKey = hospitalLifecycleNotificationDedupeKey({
    ticketId: 'ticket-1',
    recipientUserId: 'client-user',
    notificationType: 'work_started',
    version: 9,
    cycle: 1,
  });
  assert.notEqual(firstWorkKey, secondWorkKey);
});

test('manual reassignment notifies only the new assigned internal user', () => {
  const rows = buildHospitalLifecycleNotificationRows({
    action: 'manual_reassignment',
    actor: { user: activeUser('operations_executive', 'ops-user') },
    targetUserId: 'supervisor-user',
    beforeTicket: {
      id: 'ticket-1',
      ticket_no: 'QPMS-HK-2026-000041',
      raised_by_user_id: 'client-user',
      status_code: 'accepted',
      version: 4,
      reopen_count: 0,
      priority: 'medium',
      current_assignee_role: 'operations_executive',
      current_escalation_level_no: 2,
    },
    afterTicket: {
      id: 'ticket-1',
      ticket_no: 'QPMS-HK-2026-000041',
      raised_by_user_id: 'client-user',
      status_code: 'accepted',
      version: 5,
      reopen_count: 0,
      priority: 'medium',
      current_assignee_role: 'housekeeping_supervisor',
      current_escalation_level_no: 1,
    },
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].recipient_user_id, 'supervisor-user');
  assert.equal(rows[0].notification_type, 'ticket_assigned_internal');
  assert.equal(rows[0].metadata.app_scope, 'myqpms_internal');
});

test('notification list enriches complaint thumbnails with one attachment query', async () => {
  const attachmentInCalls = [];
  const actor = {
    user: activeUser('doctor', 'client-user'),
    scopes: [blockScope('block-a')],
  };
  const notificationRows = [
    {
      id: 'notification-1',
      ticket_id: 'ticket-1',
      recipient_user_id: 'client-user',
      notification_type: 'ticket_accepted',
      title: 'Ticket Accepted',
      body: 'Accepted by QPMS.',
      read_at: null,
      created_at: '2026-08-13T10:00:00Z',
      ticket: {
        id: 'ticket-1',
        ticket_no: 'QPMS-HK-2026-000041',
        client_id: 'client-a',
        block_id: 'block-a',
        priority: 'high',
        status_code: 'accepted',
        block: { block_name: 'Block A' },
        floor_name: '3rd Floor',
      },
    },
    {
      id: 'notification-2',
      ticket_id: 'ticket-1',
      recipient_user_id: 'client-user',
      notification_type: 'work_started',
      title: 'Work Started',
      body: 'Work started.',
      read_at: null,
      created_at: '2026-08-13T10:05:00Z',
      ticket: {
        id: 'ticket-1',
        ticket_no: 'QPMS-HK-2026-000041',
        client_id: 'client-a',
        block_id: 'block-a',
        priority: 'high',
        status_code: 'in_progress',
        block: { block_name: 'Block A' },
        floor_name: '3rd Floor',
      },
    },
  ];
  const attachmentRows = [
    {
      id: 'attachment-1',
      ticket_id: 'ticket-1',
      attachment_type: 'complaint_photo',
      storage_bucket: 'hospital-ticket-attachments',
      storage_path: 'ticket-1/photo.jpg',
      original_filename: 'photo.jpg',
      mime_type: 'image/jpeg',
      size_bytes: 1234,
      is_client_visible: true,
      created_at: '2026-08-13T09:59:00Z',
    },
  ];
  const client = {
    from(table) {
      if (table === 'hospital_ticket_notifications') return query(notificationRows);
      if (table === 'hospital_ticket_attachments') {
        return {
          select() { return this; },
          in(column, values) {
            attachmentInCalls.push({ column, values });
            return this;
          },
          eq() { return this; },
          order() { return this; },
          then(resolve) {
            return Promise.resolve({ data: attachmentRows, error: null }).then(resolve);
          },
        };
      }
      return query([]);
    },
    storage: {
      from(bucket) {
        return {
          async createSignedUrl(path, seconds) {
            return {
              data: { signedUrl: `https://signed.example/${bucket}/${path}?ttl=${seconds}` },
              error: null,
            };
          },
        };
      },
    },
  };

  const rows = await listHospitalNotifications(client, actor);
  assert.equal(rows.length, 2);
  assert.equal(attachmentInCalls.length, 1);
  assert.deepEqual(attachmentInCalls[0], {
    column: 'ticket_id',
    values: ['ticket-1'],
  });
  assert.equal(rows[0].before_image_url, 'https://signed.example/hospital-ticket-attachments/ticket-1/photo.jpg?ttl=300');
});

test('notification list query matches current ticket schema and incoming statuses', () => {
  const source = readFileSync(
    new URL('../services/hospitalTicketService.js', import.meta.url),
    'utf8',
  );
  const helper = source.slice(
    source.indexOf('export async function listHospitalNotifications'),
    source.indexOf('export async function listHospitalTickets'),
  );
  assert.match(helper, /exact_landmark_snapshot/);
  assert.doesNotMatch(helper, /exact_landmark,/);
  assert.doesNotMatch(helper, /ticket\.exact_landmark\s/);
  assert.doesNotMatch(helper, /\.eq\('action_status', 'active'\)/);
  assert.match(source, /incoming_supervisor_ticket/);
  assert.match(source, /action_status/);
});

test('full ticket lifecycle notification sequence supports reopen cycles without spam', () => {
  const clientActor = { user: activeUser('doctor', 'client-user') };
  const supervisorActor = { user: activeUser('housekeeping_supervisor', 'supervisor-user') };
  const ticket = {
    id: 'ticket-1',
    ticket_no: 'QPMS-HK-2026-000041',
    raised_by_user_id: 'client-user',
    priority: 'high',
    current_assignee_role: 'housekeeping_supervisor',
    current_escalation_level_no: 1,
  };

  const rows = [
    ...buildHospitalLifecycleNotificationRows({
      action: 'ticket_created',
      actor: clientActor,
      afterTicket: { ...ticket, status_code: 'awaiting_supervisor_acceptance', version: 1, reopen_count: 0 },
    }),
    ...buildHospitalLifecycleNotificationRows({
      action: 'accept',
      actor: supervisorActor,
      beforeTicket: { ...ticket, status_code: 'awaiting_supervisor_acceptance', version: 1, reopen_count: 0 },
      afterTicket: { ...ticket, status_code: 'accepted', version: 2, reopen_count: 0 },
    }),
    ...buildHospitalLifecycleNotificationRows({
      action: 'start_work',
      actor: supervisorActor,
      beforeTicket: { ...ticket, status_code: 'accepted', version: 2, reopen_count: 0 },
      afterTicket: { ...ticket, status_code: 'in_progress', version: 3, reopen_count: 0 },
    }),
    ...buildHospitalLifecycleNotificationRows({
      action: 'resolve',
      actor: supervisorActor,
      beforeTicket: { ...ticket, status_code: 'in_progress', version: 3, reopen_count: 0 },
      afterTicket: { ...ticket, status_code: 'resolved_awaiting_confirmation', version: 4, reopen_count: 0 },
    }),
    ...buildHospitalLifecycleNotificationRows({
      action: 'feedback',
      actor: clientActor,
      beforeTicket: { ...ticket, status_code: 'resolved_awaiting_confirmation', version: 4, reopen_count: 0 },
      afterTicket: { ...ticket, status_code: 'reopened', version: 5, reopen_count: 1 },
    }),
    ...buildHospitalLifecycleNotificationRows({
      action: 'start_work',
      actor: supervisorActor,
      beforeTicket: { ...ticket, status_code: 'reopened', version: 5, reopen_count: 1 },
      afterTicket: { ...ticket, status_code: 'in_progress', version: 6, reopen_count: 1 },
    }),
    ...buildHospitalLifecycleNotificationRows({
      action: 'resolve',
      actor: supervisorActor,
      beforeTicket: { ...ticket, status_code: 'in_progress', version: 6, reopen_count: 1 },
      afterTicket: { ...ticket, status_code: 'resolved_awaiting_confirmation', version: 7, reopen_count: 1 },
    }),
    ...buildHospitalLifecycleNotificationRows({
      action: 'feedback',
      actor: clientActor,
      beforeTicket: { ...ticket, status_code: 'resolved_awaiting_confirmation', version: 7, reopen_count: 1 },
      afterTicket: { ...ticket, status_code: 'closed', version: 8, reopen_count: 1 },
    }),
  ];

  assert.deepEqual(rows.map((row) => row.notification_type), [
    'ticket_created',
    'ticket_accepted',
    'work_started',
    'ticket_reopened_client',
    'work_started',
  ]);
  assert.equal(rows.every((row) => row.recipient_user_id === 'client-user'), true);
  assert.equal(rows.every((row) => row.metadata.app_scope === 'qpms_client'), true);
  assert.equal(new Set(rows.map((row) => row.dedupe_key)).size, rows.length);
  assert.equal(rows.filter((row) => row.notification_type === 'work_started').length, 2);
  assert.equal(rows.filter((row) => row.notification_type === 'ticket_accepted').length, 1);
});

test('Block A client and Supervisor cannot access Block B', () => {
  const ticketB = { client_id: 'client-a', block_id: 'block-b', location_id: 'location-b' };
  for (const role of ['doctor', 'housekeeping_supervisor']) {
    const actor = { user: activeUser(role), scopes: [blockScope('block-a', { can_create: true, can_update: true })] };
    assert.equal(canViewHospitalTicket(actor, ticketB), false);
  }
});

test('client-wide escalation roles see only their current actionable owner level', () => {
  const supervisorTicket = {
    client_id: 'client-a',
    block_id: 'block-a',
    status_code: 'awaiting_supervisor_acceptance',
    current_assignee_role: 'housekeeping_supervisor',
  };
  const operationsTicket = {
    client_id: 'client-a',
    block_id: 'block-b',
    status_code: 'escalated_operations_executive',
    current_assignee_role: 'operations_executive',
    current_assignee_user_id: 'ops-user',
  };
  const facilityTicket = {
    client_id: 'client-a',
    block_id: 'block-b',
    status_code: 'escalated_facility_manager',
    current_assignee_role: 'facility_manager',
    current_assignee_user_id: 'facility-user',
  };
  const projectTicket = {
    client_id: 'client-a',
    block_id: 'block-b',
    status_code: 'escalated_project_head',
    current_assignee_role: 'project_head',
    current_assignee_user_id: 'project-user',
  };
  const clientScope = { client_id: 'client-a', scope_type: 'client', can_view: true };

  assert.equal(canViewHospitalTicket({ user: activeUser('housekeeping_supervisor', 'sup-user'), scopes: [clientScope] }, supervisorTicket), true);
  assert.equal(canViewHospitalTicket({ user: activeUser('operations_executive', 'ops-user'), scopes: [clientScope] }, supervisorTicket), false);
  assert.equal(canViewHospitalTicket({ user: activeUser('facility_manager', 'facility-user'), scopes: [clientScope] }, supervisorTicket), false);
  assert.equal(canViewHospitalTicket({ user: activeUser('project_head', 'project-user'), scopes: [clientScope] }, supervisorTicket), false);

  assert.equal(canViewHospitalTicket({ user: activeUser('operations_executive', 'ops-user'), scopes: [clientScope] }, operationsTicket), true);
  assert.equal(canViewHospitalTicket({ user: activeUser('facility_manager', 'facility-user'), scopes: [clientScope] }, operationsTicket), false);
  assert.equal(canViewHospitalTicket({ user: activeUser('facility_manager', 'facility-user'), scopes: [clientScope] }, facilityTicket), true);
  assert.equal(canViewHospitalTicket({ user: activeUser('project_head', 'project-user'), scopes: [clientScope] }, facilityTicket), false);
  assert.equal(canViewHospitalTicket({ user: activeUser('project_head', 'project-user'), scopes: [clientScope] }, projectTicket), true);
  assert.equal(canViewHospitalTicket({ user: activeUser('operations_executive', 'other-ops'), scopes: [clientScope] }, operationsTicket), false);
});

test('creation scope is independent from view scope', () => {
  const scopes = [blockScope('block-a', { can_create: false })];
  assert.equal(scopeAllows(scopes, { clientId: 'client-a', blockId: 'block-a', permission: 'view' }), true);
  assert.equal(scopeAllows(scopes, { clientId: 'client-a', blockId: 'block-a', permission: 'create' }), false);
});

test('ticket creation validates canonical fields and priority', () => {
  const payload = normalizeHospitalTicketCreate({ block_id: 'b', floor_id: 'f', location_id: 'l', category_id: 'c', priority: 'High', title: ' Wet floor ', description: ' Near ICU ', idempotency_key: 'request-1' });
  assert.deepEqual(validateHospitalTicketCreate(payload), []);
  assert.equal(payload.priority, 'high');
  assert.ok(validateHospitalTicketCreate({ ...payload, idempotencyKey: '' }).length > 0);
});

test('ticket creation accepts complete hierarchy plus optional landmark', () => {
  const payload = normalizeHospitalTicketCreate({
    block_id: 'block-a',
    floor_id: 'floor-a',
    department_id: 'department-a',
    location_id: 'location-a',
    exact_landmark: '  Opposite Nursing Station near Lift 2  ',
    category_id: 'category-a',
    priority: 'Medium',
    title: 'Wet floor',
    description: 'Wet floor near nursing station',
    idempotency_key: 'request-2',
  });

  assert.equal(payload.floorId, 'floor-a');
  assert.equal(payload.locationId, 'location-a');
  assert.equal(payload.exactLandmark, 'Opposite Nursing Station near Lift 2');
  assert.deepEqual(validateHospitalTicketCreate(payload), []);
});

test('ticket creation rejects landmark-only requests without floor and area', () => {
  const payload = normalizeHospitalTicketCreate({
    block_id: 'block-a',
    category_id: 'category-a',
    priority: 'medium',
    title: 'Wet floor',
    description: 'Wet floor',
    idempotency_key: 'request-3',
  });

  assert.deepEqual(validateHospitalTicketCreate(payload), [
    'Floor is required.',
    'Area / Ward is required.',
  ]);
  assert.ok(validateHospitalTicketCreate({ ...payload, floorId: 'floor-a', exactLandmark: 'Near Lift' }).includes('Area / Ward is required.'));
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
    assignee: {
      id: 'supervisor-user-id',
      display_name: 'PHASE 2D UAT Supervisor',
      role_code: 'housekeeping_supervisor',
      employee_code: 'EMP-1',
      phone: '9999999999',
    },
  });
  assert.equal(view.ticket_no, 'QPMS-HK-2026-000001');
  assert.equal('idempotency_key' in view, false);
  assert.equal('current_assignee_user_id' in view, false);
  assert.equal('metadata' in view, false);
  assert.deepEqual(view.assignee, {
    display_name: 'PHASE 2D UAT Supervisor',
    role_code: 'housekeeping_supervisor',
  });
  assert.equal(clientCanSeeHospitalEvent({ event_type: 'progress_update', event_data: {} }), false);
  assert.equal(clientCanSeeHospitalEvent({ event_type: 'progress_update', event_data: { is_client_visible: true } }), true);
  assert.equal('event_data' in clientHospitalEventView({ event_type: 'ticket_created', event_data: {}, actor_user_id: 'actor' }), false);
});

test('status transitions reject arbitrary frontend statuses', () => {
  assert.deepEqual(validateHospitalAction({ role: 'housekeeping_supervisor', status: 'awaiting_supervisor_acceptance', action: 'accept' }), []);
  assert.deepEqual(validateHospitalAction({ role: 'housekeeping_supervisor', status: 'assigned', action: 'accept' }), []);
  assert.ok(validateHospitalAction({ role: 'doctor', status: 'assigned', action: 'accept' }).length > 0);
  assert.ok(validateHospitalAction({ role: 'housekeeping_supervisor', status: 'closed', action: 'progress', payload: { remarks: 'x' } }).length > 0);
  assert.ok(validateHospitalAction({ role: 'doctor', status: 'assigned', action: 'progress', payload: { remarks: 'x' } }).length > 0);
  assert.deepEqual(validateHospitalAction({ role: 'doctor', status: 'assigned', action: 'cancel', payload: { reason_code: 'duplicate_complaint' } }), []);
  assert.ok(validateHospitalAction({ role: 'doctor', status: 'resolved_awaiting_confirmation', action: 'cancel', payload: { reason_code: 'duplicate_complaint' } }).length > 0);
  assert.deepEqual(validateHospitalAction({ role: 'operations_executive', status: 'escalated_operations_executive', action: 'progress', payload: { remarks: 'x' } }), []);
  assert.ok(validateHospitalAction({ role: 'housekeeping_supervisor', status: 'awaiting_supervisor_acceptance', action: 'progress', payload: { remarks: 'x' } }).length > 0);
  assert.deepEqual(validateHospitalAction({ role: 'admin', status: 'escalated_operations_executive', action: 'take_over' }), []);
  assert.deepEqual(validateHospitalAction({ role: 'admin', status: 'escalated_operations_executive', action: 'escalate_facility' }), []);
  assert.deepEqual(validateHospitalAction({ role: 'admin', status: 'in_progress', action: 'resolve', payload: { resolution_action: 'Mopped', resolution_remarks: 'Dry and inspected' } }), []);
  assert.ok(validateHospitalAction({ role: 'admin', status: 'closed', action: 'progress', payload: { remarks: 'x' } }).length > 0);
});

test('resolution and feedback validation enforce production requirements', () => {
  assert.ok(validateHospitalAction({ role: 'housekeeping_supervisor', status: 'in_progress', action: 'resolve', payload: {} }).length === 2);
  assert.deepEqual(validateHospitalAction({ role: 'housekeeping_supervisor', status: 'in_progress', action: 'resolve', payload: { resolution_action: 'Mopped', resolution_remarks: 'Dry and inspected' } }), []);
  assert.ok(validateHospitalAction({ role: 'doctor', status: 'resolved_awaiting_confirmation', action: 'feedback', payload: { rating: 2, satisfaction_status: 'not_satisfied', comments: '' } }).length > 0);
  assert.ok(validateHospitalAction({ role: 'doctor', status: 'assigned', action: 'cancel', payload: { reason_code: 'other', reason_text: '' } }).length > 0);
  assert.deepEqual(validateHospitalAction({ role: 'hospital_management', status: 'in_progress', action: 'cancel', payload: { reason_code: 'other', reason_text: 'Duplicate ticket raised by ward clerk.' } }), []);
});

test('SLA configuration exposes the priority escalation matrix', () => {
  assert.deepEqual(slaMinutes({}), {
    supervisor: 20,
    operations: 15,
    matrix: { critical: 10, high: 10, medium: 15, low: 20 },
  });
  assert.deepEqual(slaMinutes({ HOSPITAL_SUPERVISOR_SLA_MINUTES: '1', HOSPITAL_OPERATIONS_SLA_MINUTES: '2' }), {
    supervisor: 1,
    operations: 2,
    matrix: { critical: 10, high: 10, medium: 15, low: 20 },
  });
  assert.equal(normalizedHospitalSlaPriority('high'), 'critical');
  assert.equal(prioritySlaMinutes('critical'), 10);
  assert.equal(prioritySlaMinutes('medium'), 15);
  assert.equal(prioritySlaMinutes('low'), 20);
  assert.deepEqual(hospitalEscalationLevels().map((level) => level.role), [
    'housekeeping_supervisor',
    'operations_executive',
    'facility_manager',
    'project_head',
    'hospital_dean',
  ]);
  assert.equal(hospitalEscalationRoleForLevel(4).label, 'Project Head');
  assert.equal(hospitalEscalationRoleForLevel(5).label, 'Hospital Dean');
});

test('SLA state is server-derived', () => {
  const now = new Date('2026-07-16T10:00:00Z');
  assert.equal(hospitalSlaState({ status_code: 'assigned', supervisor_sla_due_at: '2026-07-16T10:04:00Z' }, now).state, 'near_breach');
  assert.equal(hospitalSlaState({ status_code: 'assigned', supervisor_sla_due_at: '2026-07-16T09:59:00Z' }, now).state, 'breached');
  assert.equal(hospitalSlaState({ status_code: 'reopened', supervisor_sla_due_at: '2026-07-16T09:59:00Z' }, now).state, 'breached');
  assert.equal(hospitalSlaState({ status_code: 'escalated_facility_manager', escalation_due_at: '2026-07-16T10:10:00Z' }, now).state, 'healthy');
  assert.equal(hospitalSlaState({ status_code: 'escalated_facility_manager', facility_manager_sla_due_at: '2026-07-16T10:10:00Z' }, now).state, 'healthy');
  assert.equal(hospitalSlaState({ status_code: 'escalated_project_head', project_head_sla_due_at: '2026-07-16T09:59:00Z', final_escalation: true }, now).final_escalation, true);
  assert.equal(hospitalSlaState({ status_code: 'resolved_awaiting_confirmation', escalation_due_at: '2026-07-16T09:59:00Z' }, now).state, 'not_applicable');
  assert.equal(hospitalSlaState({ status_code: 'closed', escalation_due_at: '2026-07-16T09:59:00Z' }, now).state, 'not_applicable');
  assert.equal(hospitalSlaState({ status_code: 'cancelled', escalation_due_at: '2026-07-16T09:59:00Z' }, now).state, 'not_applicable');
});

test('client and internal action lists stay separated', () => {
  assert.ok(hospitalAllowedActions(activeUser('doctor')).includes('create_ticket'));
  assert.ok(hospitalAllowedActions(activeUser('doctor')).includes('cancel'));
  assert.ok(!hospitalAllowedActions(activeUser('doctor')).includes('resolve'));
  assert.ok(hospitalAllowedActions(activeUser('facility_manager')).includes('resolve'));
  assert.ok(hospitalAllowedActions(activeUser('admin')).includes('take_over'));
  assert.ok(hospitalAllowedActions(activeUser('admin')).includes('resolve'));
  assert.ok(!hospitalAllowedActions(activeUser('admin')).includes('create_ticket'));
});

function query(data, error = null) {
  return {
    select() { return this; },
    eq() { return this; },
    in() { return this; },
    is() { return this; },
    order() { return this; },
    limit() { return this; },
    async maybeSingle() {
      return { data: Array.isArray(data) ? data[0] || null : data, error };
    },
    then(resolve) {
      return Promise.resolve({ data, error }).then(resolve);
    },
  };
}

test('ticket list returns newest tickets first with stable ticket number ties', async () => {
  const actor = {
    user: activeUser('housekeeping_supervisor', 'supervisor-user'),
    scopes: [{ client_id: 'client-a', scope_type: 'client', can_view: true }],
  };
  const tickets = [
    {
      id: 'ticket-48',
      ticket_no: 'QPMS-HK-2026-000048',
      client_id: 'client-a',
      block_id: 'block-a',
      status_code: 'awaiting_supervisor_acceptance',
      current_assignee_role: 'housekeeping_supervisor',
      raised_at: '2026-08-24T10:00:00Z',
      created_at: '2026-08-24T10:00:00Z',
    },
    {
      id: 'ticket-50',
      ticket_no: 'QPMS-HK-2026-000050',
      client_id: 'client-a',
      block_id: 'block-a',
      status_code: 'awaiting_supervisor_acceptance',
      current_assignee_role: 'housekeeping_supervisor',
      raised_at: '2026-08-24T10:02:00Z',
      created_at: '2026-08-24T10:02:00Z',
    },
    {
      id: 'ticket-49',
      ticket_no: 'QPMS-HK-2026-000049',
      client_id: 'client-a',
      block_id: 'block-a',
      status_code: 'awaiting_supervisor_acceptance',
      current_assignee_role: 'housekeeping_supervisor',
      raised_at: '2026-08-24T10:01:00Z',
      created_at: '2026-08-24T10:01:00Z',
    },
  ];
  const client = {
    from(table) {
      if (table === 'hospital_tickets') return query(tickets);
      if (table === 'hospital_ticket_attachments') return query([]);
      return query([]);
    },
  };

  const rows = await listHospitalTickets(client, actor, {});

  assert.deepEqual(rows.map((row) => row.ticket_no), [
    'QPMS-HK-2026-000050',
    'QPMS-HK-2026-000049',
    'QPMS-HK-2026-000048',
  ]);
});

test('authenticated Admin profile does not auto-provision an unsupported Hospital role', async () => {
  const writes = [];
  const client = {
    from(table) {
      if (table === 'profiles') {
        return query({
          id: 'profile-admin',
          auth_user_id: 'auth-admin',
          employee_code: 'ADM-1',
          display_name: 'App Admin',
          email: 'admin@example.com',
          role: 'Admin',
          status: 'Active',
          is_active: true,
        });
      }
      if (table === 'hospital_clients') {
        return query([{ id: 'client-a', client_code: 'NIMS', client_name: 'NIMS', is_active: true }]);
      }
      if (table === 'hospital_ticket_users') {
        return {
          upsert(row, options) {
            writes.push({ table, row, options });
            return {
              select() {
                return query({
                  id: 'admin-hospital-user',
                  ...row,
                });
              },
            };
          },
        };
      }
      if (table === 'hospital_ticket_user_scopes') {
        return {
          select() {
            return {
              eq() { return this; },
              is() { return this; },
              async maybeSingle() { return { data: null, error: null }; },
            };
          },
          insert(row) {
            writes.push({ table, row });
            return {
              select() {
                return query([{ id: 'scope-admin', ...row }]);
              },
            };
          },
        };
      }
      return query(null);
    },
  };
  const actor = await resolveAdminHospitalActor({
    serviceClient: client,
    authUser: { id: 'auth-admin', email: 'admin@example.com' },
    request: { headers: {}, query: {}, body: {} },
  });
  assert.equal(actor, null);
  assert.equal(writes.length, 0);
});

test('ordinary FO profile does not resolve Hospital admin actor', async () => {
  const client = {
    from(table) {
      if (table === 'profiles') {
        return query({
          id: 'profile-fo',
          auth_user_id: 'auth-fo',
          role: 'FO',
          status: 'Active',
          is_active: true,
        });
      }
      return query([]);
    },
  };
  const actor = await resolveAdminHospitalActor({
    serviceClient: client,
    authUser: { id: 'auth-fo', email: 'fo@example.com' },
    request: { headers: {}, query: {}, body: {} },
  });
  assert.equal(actor, null);
});

test('hospital auth middleware still rejects unauthenticated requests', async () => {
  const middleware = createHospitalAuthMiddleware({ anonClient: {}, serviceClient: {} });
  const response = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
    },
  };
  let nextCalled = false;
  await middleware({ headers: {}, query: {}, body: {} }, response, () => {
    nextCalled = true;
  });
  assert.equal(response.statusCode, 401);
  assert.equal(response.body.code, 'authentication_required');
  assert.equal(nextCalled, false);
});

test('Admin hospital fallback does not overwrite selected client access from profiles role', async () => {
  const writes = [];
  const client = {
    from(table) {
      if (table === 'profiles') {
        return query({
          id: 'profile-admin',
          auth_user_id: 'auth-admin',
          display_name: 'App Admin',
          email: 'admin@example.com',
          role: 'admin',
          status: 'active',
          is_active: true,
        });
      }
      if (table === 'hospital_clients') {
        return query([
          { id: 'client-a', client_code: 'A', client_name: 'A Hospital', is_active: true },
          { id: 'client-b', client_code: 'B', client_name: 'B Hospital', is_active: true },
        ]);
      }
      if (table === 'hospital_ticket_users') {
        return {
          upsert(row) {
            writes.push(row);
            return { select: () => query({ id: 'admin-hospital-user', ...row }) };
          },
        };
      }
      if (table === 'hospital_ticket_user_scopes') {
        return {
          select() {
            return {
              eq() { return this; },
              is() { return this; },
              async maybeSingle() { return { data: null, error: null }; },
            };
          },
          insert(row) {
            return { select: () => query([{ id: 'scope-admin', ...row }]) };
          },
        };
      }
      return query(null);
    },
  };
  const actor = await resolveAdminHospitalActor({
    serviceClient: client,
    authUser: { id: 'auth-admin', email: 'admin@example.com' },
    request: { headers: { 'x-hospital-client-id': 'client-b' }, query: {}, body: {} },
  });
  assert.equal(actor, null);
  assert.equal(writes.length, 0);
});

test('Admin can use scoped ticket list, detail, dashboard and privileged actions', async () => {
  const actor = {
    user: { ...activeUser('admin', 'admin-user'), profile_type: 'internal' },
    scopes: [{ client_id: 'client-a', scope_type: 'client', can_view: true, can_update: true }],
  };
  const tickets = [
    { id: 'ticket-a', ticket_no: 'QPMS-HK-1', client_id: 'client-a', block_id: 'block-a', location_id: 'loc-a', status_code: 'escalated_operations_executive', priority: 'medium', raised_at: '2026-08-07T01:00:00Z' },
    { id: 'ticket-b', ticket_no: 'QPMS-HK-2', client_id: 'client-b', block_id: 'block-b', location_id: 'loc-b', status_code: 'open', priority: 'low', raised_at: '2026-08-07T02:00:00Z' },
  ];
  const client = {
    from(table) {
      if (table === 'hospital_tickets') return query(tickets);
      if (table === 'hospital_ticket_events') return query([]);
      if (table === 'hospital_ticket_comments') return query([]);
      if (table === 'hospital_ticket_attachments') return query([]);
      return query([]);
    },
  };
  const rows = await listHospitalTickets(client, actor, {});
  assert.deepEqual(rows.map((row) => row.id), ['ticket-a']);
  const detail = await getHospitalTicket(client, actor, 'QPMS-HK-1');
  assert.equal(detail.ticket.id, 'ticket-a');
  assert.ok(detail.allowed_actions.includes('take_over'));
  assert.ok(detail.allowed_actions.includes('resolve'));
  const dashboard = await hospitalDashboard(client, actor);
  assert.equal(dashboard.counts.escalated, 1);
});

test('client cancellation metadata is exposed safely and final statuses cannot cancel', () => {
  const actor = { user: { ...activeUser('doctor'), profile_type: 'client' } };
  const view = hospitalTicketForActor(actor, {
    id: 'ticket-cancel',
    ticket_no: 'QPMS-HK-9',
    metadata: {
      cancellation: {
        reason_code: 'duplicate_complaint',
        reason_text: 'Duplicate complaint',
        cancelled_at: '2026-08-10T10:00:00Z',
      },
    },
  });
  assert.equal(view.cancellation_reason_code, 'duplicate_complaint');
  assert.equal(view.cancellation_reason_text, 'Duplicate complaint');
  assert.equal(view.cancelled_at, '2026-08-10T10:00:00Z');
  assert.equal('metadata' in view, false);
  assert.ok(validateHospitalAction({ role: 'doctor', status: 'closed', action: 'cancel', payload: { reason_code: 'raised_by_mistake' } }).length > 0);
  assert.ok(validateHospitalAction({ role: 'doctor', status: 'cancelled', action: 'cancel', payload: { reason_code: 'raised_by_mistake' } }).length > 0);
});

test('service keeps resolve owner and completion evidence checks before RPC', () => {
  const source = readFileSync(
    new URL('../services/hospitalTicketService.js', import.meta.url),
    'utf8',
  );
  assert.match(source, /if \(effectiveAction === 'resolve'\) \{/);
  assert.match(source, /await requireCurrentOperationalOwner\(client, actor, current\.ticket\);/);
  assert.match(source, /await requireCompletionEvidence\(client, current\.ticket\.id\);/);
  assert.match(source, /Only the current operational owner can resolve this ticket\./);
  assert.match(source, /Upload completion evidence before resolving this ticket\./);
});

test('client cancellation service is soft and auditable', () => {
  const source = readFileSync(
    new URL('../services/hospitalTicketService.js', import.meta.url),
    'utf8',
  );
  const helper = source.slice(
    source.indexOf('async function performClientTicketCancellation'),
    source.indexOf('async function performManualHospitalReassignment'),
  );
  assert.match(helper, /status_code: 'cancelled'/);
  assert.match(helper, /event_type: 'ticket_cancelled_by_client'/);
  assert.match(helper, /notification_type: 'ticket_cancelled'/);
  assert.match(helper, /superseded_reason: 'ticket_cancelled_by_client'/);
  assert.doesNotMatch(helper, /\.delete\(/);
});

test('manual reassignment service preserves existing SLA deadline fields', () => {
  const source = readFileSync(
    new URL('../services/hospitalTicketService.js', import.meta.url),
    'utf8',
  );
  const helper = source.slice(
    source.indexOf('async function performManualHospitalReassignment'),
    source.indexOf('export function hospitalSlaState'),
  );
  const updateBlock = helper.slice(
    helper.indexOf('const update = {'),
    helper.indexOf("const updated = await client.from('hospital_tickets')"),
  );
  assert.match(helper, /assignment_type: 'manual_reassignment'/);
  assert.match(helper, /preserves_sla_deadline: true/);
  assert.match(updateBlock, /current_assignee_user_id: assignee\.id/);
  assert.doesNotMatch(updateBlock, /current_escalation_level_no\s*:/);
  assert.doesNotMatch(updateBlock, /current_escalation_level\s*:/);
  assert.doesNotMatch(updateBlock, /escalation_due_at\s*:/);
  assert.doesNotMatch(updateBlock, /supervisor_sla_due_at\s*:/);
  assert.doesNotMatch(updateBlock, /operations_sla_due_at\s*:/);
  assert.doesNotMatch(updateBlock, /project_head_sla_due_at\s*:/);
  assert.doesNotMatch(updateBlock, /assigned_at\s*:/);
});

test('manual reassignment actions are not treated as automatic SLA escalation', () => {
  assert.deepEqual(validateHospitalAction({
    role: 'operations_executive',
    status: 'escalated_operations_executive',
    action: 'reassign_supervisor',
  }), []);
  assert.deepEqual(validateHospitalAction({
    role: 'facility_manager',
    status: 'escalated_facility_manager',
    action: 'reassign_supervisor',
  }), []);
  assert.deepEqual(validateHospitalAction({
    role: 'housekeeping_supervisor',
    status: 'in_progress',
    action: 'reassign_supervisor',
  }), []);
});
