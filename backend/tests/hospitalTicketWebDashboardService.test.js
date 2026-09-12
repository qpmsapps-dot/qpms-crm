import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyAccessScope,
  assignmentAllowsInternalView,
  getWebHospitalTicketDetail,
  hospitalWebAccessAllowsClient,
  listWebHospitalClientContacts,
  listWebHospitalTickets,
  resolveHospitalWebAccess,
  resolveWebHospitalClientFilter,
  scopedAccessFromAssignments,
  summarizeWebHospitalTickets,
} from '../services/hospitalTicketWebDashboardService.js';

function queryResult(data, error = null, count = null) {
  return {
    select() { return this; },
    eq() { return this; },
    order() { return this; },
    limit() { return this; },
    in() { return this; },
    or() { return this; },
    range() { return this; },
    maybeSingle() { return Promise.resolve({ data, error }); },
    then(resolve) { return Promise.resolve({ data, error, count }).then(resolve); },
  };
}

function mockClientForDetail() {
  const ticket = {
    id: 'ticket-1',
    ticket_no: 'QPMS-HK-2026-000001',
    client_id: 'client-1',
    block_id: 'block-1',
    category_id: 'category-1',
    title: 'INTERNAL UAT - SAFE TO CANCEL',
    description: 'Wet floor near Room 503',
    priority: 'high',
    status_code: 'assigned',
    current_escalation_level: 'supervisor',
    current_assignee_user_id: null,
    floor_name: 'Fifth Floor',
    department_name: 'Surgical Gastroenterology',
    location_text: 'Room 503',
    exact_landmark_snapshot: 'Corridor outside Room 503',
    raised_by_name: 'UAT RMO',
    raised_by_role: 'hospital_management',
    raised_at: '2026-07-23T10:00:00.000Z',
    updated_at: '2026-07-23T10:02:00.000Z',
    supervisor_sla_due_at: '2026-07-23T10:20:00.000Z',
    operations_sla_due_at: null,
    client_rating: 5,
    client_satisfaction_status: 'satisfied',
    reopen_count: 0,
    metadata: { is_test: true },
    client: { id: 'client-1', client_name: 'NIMS Hyderabad', client_code: 'NIMS' },
    block: { id: 'block-1', block_name: 'Speciality Block', block_code: 'SPECIALITY' },
    category: { id: 'category-1', category_name: 'General Housekeeping', category_code: 'HOUSEKEEPING' },
    assignee: null,
    supervisor: null,
    resolved_by: null,
  };
  const tables = {
    hospital_tickets: queryResult(ticket),
    hospital_ticket_events: queryResult([
      { id: 'event-1', event_type: 'ticket_created', actor_name: 'UAT RMO', actor_role: 'hospital_management', remarks: 'Created', created_at: '2026-07-23T10:00:00.000Z' },
    ]),
    hospital_ticket_comments: queryResult([
      { id: 'comment-1', author_name: 'Supervisor', author_role: 'housekeeping_supervisor', comment_type: 'internal_update', comment_text: 'Checked', is_client_visible: true, created_at: '2026-07-23T10:05:00.000Z' },
    ]),
    hospital_ticket_attachments: queryResult([
      {
        id: 'attachment-1',
        ticket_id: 'ticket-1',
        attachment_type: 'complaint_photo',
        storage_bucket: 'private-bucket',
        storage_path: 'private/path/photo.jpg',
        original_filename: 'photo.jpg',
        mime_type: 'image/jpeg',
        size_bytes: 100,
        is_client_visible: true,
        created_at: '2026-07-23T10:01:00.000Z',
      },
    ]),
    hospital_ticket_assignment_history: queryResult([]),
  };
  return {
    from(table) {
      return tables[table] || queryResult([]);
    },
    storage: {
      from(bucket) {
        assert.equal(bucket, 'private-bucket');
        return {
          createSignedUrl(path, seconds) {
            assert.equal(path, 'private/path/photo.jpg');
            assert.equal(seconds, 300);
            return Promise.resolve({ data: { signedUrl: 'https://signed.example/photo.jpg' }, error: null });
          },
        };
      },
    },
  };
}

function mockClientForAccess() {
  return {
    from(table) {
      if (table === 'access_user_assignments') {
        return {
          select() { return this; },
          or() { return Promise.reject({ code: '42P01', message: 'missing access tables' }); },
        };
      }
      if (table === 'hospital_ticket_users') return queryResult(null);
      return queryResult([]);
    },
  };
}

function mockClientForScopedOperationalAccess({ authUserId = 'auth-om', profileId = 'profile-om' } = {}) {
  const rows = {
    access_user_assignments: [{
      id: 'assignment-1', auth_user_id: authUserId, profile_id: profileId,
      role_id: 'role-om', module_id: 'module-hospital', client_id: 'client-nims',
      business_vertical_id: 'vertical-hospital', verification_status: 'verified', active: true,
    }],
    access_user_scopes: [],
    access_roles: [{ id: 'role-om', code: 'operations_manager', name: 'Operations Manager', user_type: 'internal', active: true }],
    access_modules: [{ id: 'module-hospital', code: 'hospital_operations', name: 'Hospital Operations', application_target: 'web', active: true }],
    access_clients: [{ id: 'client-nims', code: 'NIMS_HYDERABAD', name: 'NIMS', active: true }],
    access_business_verticals: [{ id: 'vertical-hospital', code: 'hospital', name: 'Hospital', active: true }],
    access_business_vertical_modules: [{ business_vertical_id: 'vertical-hospital', module_id: 'module-hospital', enabled: true }],
    access_client_modules: [{ client_id: 'client-nims', module_id: 'module-hospital', enabled: true }],
    access_role_permissions: [{ role_id: 'role-om', permission_id: 'permission-view' }],
    access_permissions: [{ id: 'permission-view', code: 'hospital_ticket.view' }],
  };
  return {
    from(table) {
      if (table === 'hospital_ticket_users') return queryResult(null);
      return queryResult(rows[table] || []);
    },
  };
}

test('web management profile can use compatibility access without a hospital actor', async () => {
  const access = await resolveHospitalWebAccess({
    client: mockClientForAccess(),
    authUser: { id: 'auth-1', email: 'admin@example.com' },
    profile: { id: 'profile-1', auth_user_id: 'auth-1', role: 'Admin', is_active: true, web_access_enabled: true, status: 'Active' },
  });
  assert.equal(access.allowed, true);
  assert.equal(access.source, 'global_web_management');
  assert.equal(access.broad, true);
});

test('Admin global access does not depend on unified Hospital Ticket assignments', async () => {
  const access = await resolveHospitalWebAccess({
    client: {
      from() {
        assert.fail('Global Admin access must be resolved before assignment queries.');
      },
    },
    authUser: { id: 'auth-admin-no-ticket-assignment', email: 'admin@example.com' },
    profile: {
      id: 'profile-admin-no-ticket-assignment',
      auth_user_id: 'auth-admin-no-ticket-assignment',
      role: 'Admin',
      is_active: true,
      web_access_enabled: true,
      status: 'Active',
    },
  });
  assert.deepEqual({
    allowed: access.allowed,
    source: access.source,
    broad: access.broad,
    qpms: access.qpmsViewAllowed,
    client: access.clientViewAllowed,
  }, {
    allowed: true,
    source: 'global_web_management',
    broad: true,
    qpms: true,
    client: true,
  });
});

test('Operations Manager is denied without an assignment and allowed only for an assigned NIMS client', async () => {
  const profile = {
    id: 'profile-om', auth_user_id: 'auth-om', role: 'Operations Manager',
    is_active: true, web_access_enabled: true, status: 'Active',
  };
  const denied = await resolveHospitalWebAccess({
    client: mockClientForAccess(), authUser: { id: 'auth-om' }, profile,
  });
  assert.equal(denied.allowed, false);

  const allowed = await resolveHospitalWebAccess({
    client: mockClientForScopedOperationalAccess(), authUser: { id: 'auth-om' }, profile,
  });
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.broad, false);
  assert.deepEqual(allowed.clientIds, ['client-nims']);
  assert.equal(allowed.qpmsViewAllowed, true);
  assert.equal(hospitalWebAccessAllowsClient(allowed, 'client-other'), false);
});

test('only approved active web management roles receive global compatibility access', async () => {
  for (const role of [
    'Admin', 'ADMIN', 'admin', 'QPMS Admin', 'IT Admin', 'Management (IT Admin)',
    'GM', 'COO', 'MD', 'Executive Assistant', 'Executive Assistant to COO',
  ]) {
    const access = await resolveHospitalWebAccess({
      client: mockClientForAccess(),
      authUser: { id: `auth-${role}` },
      profile: { id: `profile-${role}`, role, is_active: true, web_access_enabled: true, status: 'Active' },
    });
    assert.equal(access.allowed, true, role);
    assert.equal(access.broad, true, role);
  }

  for (const role of ['South Head', 'Business Head', 'Branch Head', 'Operations Manager', 'KAM', 'FO']) {
    const access = await resolveHospitalWebAccess({
      client: mockClientForAccess(),
      authUser: { id: `auth-${role}` },
      profile: { id: `profile-${role}`, role, is_active: true, web_access_enabled: true, status: 'Active' },
    });
    assert.equal(access.allowed, false, role);
  }
});

test('inactive and web-disabled profiles are denied before ticket scope resolution', async () => {
  for (const profile of [
    { role: 'Admin', is_active: false, web_access_enabled: true, status: 'Inactive' },
    { role: 'Admin', is_active: true, web_access_enabled: false, status: 'Active' },
  ]) {
    const access = await resolveHospitalWebAccess({
      client: mockClientForAccess(), authUser: { id: 'auth-disabled' }, profile,
    });
    assert.equal(access.allowed, false);
    assert.equal(access.code, 'hospital_web_profile_inactive');
  }
});

test('unified Hospital Ticket assignments preserve client, block and location scope', () => {
  const clientWide = scopedAccessFromAssignments([{
    client: { id: 'client-nims' }, permissions: ['hospital_ticket.view'], scopes: [],
  }]);
  assert.deepEqual(clientWide.clientIds, ['client-nims']);
  assert.equal(hospitalWebAccessAllowsClient(clientWide, 'client-nims'), true);
  assert.equal(hospitalWebAccessAllowsClient(clientWide, 'client-other'), false);

  const narrow = scopedAccessFromAssignments([{
    client: { id: 'client-nims' },
    scopes: [
      { scope_type: 'hospital_block', scope_id: 'block-a' },
      { scope_type: 'location', scope_id: 'location-a' },
    ],
  }]);
  assert.deepEqual(narrow.clientIds, []);
  assert.deepEqual(narrow.blockIds, ['block-a']);
  assert.deepEqual(narrow.locationIds, ['location-a']);
  assert.equal(hospitalWebAccessAllowsClient(narrow, 'client-nims'), true);
  assert.equal(hospitalWebAccessAllowsClient(narrow, 'client-other'), false);
});

test('client hospital assignments cannot open the internal QPMS presentation', async () => {
  const clientAssignment = {
    role: { user_type: 'client' },
    module: { application_target: 'client_mobile' },
  };
  const internalAssignment = {
    role: { user_type: 'internal' },
    module: { application_target: 'web' },
  };
  assert.equal(assignmentAllowsInternalView(clientAssignment), false);
  assert.equal(assignmentAllowsInternalView(internalAssignment), true);

  await assert.rejects(
    () => resolveWebHospitalClientFilter({}, {
      qpmsViewAllowed: false,
      clientViewAllowed: true,
      broad: false,
      authorizedClientIds: ['client-nims'],
    }, { presentation: 'qpms', client_id: 'client-nims' }),
    (error) => error.statusCode === 403 && error.code === 'hospital_qpms_view_access_denied',
  );
  const filters = await resolveWebHospitalClientFilter({}, {
    qpmsViewAllowed: false,
    clientViewAllowed: true,
    broad: false,
    authorizedClientIds: ['client-nims'],
  }, { presentation: 'client', client_id: 'client-nims' });
  assert.equal(filters.client_id, 'client-nims');
});

test('an assignment with no usable client or resource scope remains fail-closed', () => {
  const access = scopedAccessFromAssignments([{
    client: null,
    scopes: [{ scope_type: 'state', scope_id: 'TN' }],
  }]);
  assert.equal(access.broad, false);
  assert.deepEqual(access.clientIds, []);
  assert.deepEqual(access.blockIds, []);
  assert.deepEqual(access.locationIds, []);
});

test('client contacts are scoped to the requested hospital and return only display fields', async () => {
  const calls = [];
  const client = {
    from(table) {
      if (table === 'hospital_clients') return queryResult({ id: 'client-nims', client_code: 'NIMS_HYDERABAD', client_name: 'NIMS', is_active: true });
      assert.equal(table, 'hospital_client_contacts');
      return {
        select(columns) { calls.push(['select', columns]); return this; },
        eq(column, value) { calls.push(['eq', column, value]); return this; },
        order(column, options) {
          calls.push(['order', column, options]);
          return Promise.resolve({
            data: [{ full_name: 'Runtime Contact', designation: 'RMO', mobile: '9876543210', id: 'hidden', normalized_mobile: 'hidden' }],
            error: null,
          });
        },
      };
    },
  };
  const result = await listWebHospitalClientContacts(client, {
    broad: true, clientViewAllowed: true, qpmsViewAllowed: true,
  }, { client_code: 'NIMS_HYDERABAD' });
  assert.deepEqual(result.contacts, [{ full_name: 'Runtime Contact', designation: 'RMO', mobile: '9876543210' }]);
  assert.equal(result.total, 1);
  assert.deepEqual(calls, [
    ['select', 'full_name,designation,mobile'],
    ['eq', 'client_id', 'client-nims'],
    ['eq', 'is_active', true],
    ['order', 'full_name', { ascending: true }],
  ]);
});

test('an authorized NIMS-scoped user can retrieve NIMS client contacts', async () => {
  const client = {
    from(table) {
      if (table === 'hospital_clients') return queryResult({ id: 'client-nims', client_code: 'NIMS_HYDERABAD', is_active: true });
      if (table === 'hospital_client_contacts') return queryResult([
        { full_name: 'Scoped Contact', designation: 'RMO', mobile: '9000000000' },
      ]);
      assert.fail(`Unexpected table query: ${table}`);
    },
  };
  const result = await listWebHospitalClientContacts(client, {
    broad: false,
    clientViewAllowed: true,
    qpmsViewAllowed: false,
    authorizedClientIds: ['client-nims'],
    clientIds: ['client-nims'],
  }, { client_code: 'NIMS_HYDERABAD' });
  assert.equal(result.total, 1);
  assert.equal(result.contacts[0].full_name, 'Scoped Contact');
});

test('client contacts reject cross-client access and internal-only client view access', async () => {
  const client = {
    from(table) {
      if (table === 'hospital_clients') return queryResult({ id: 'client-other', client_code: 'OTHER_HOSPITAL', is_active: true });
      assert.fail(`Unexpected table query: ${table}`);
    },
  };
  await assert.rejects(
    () => listWebHospitalClientContacts(client, {
      broad: false, clientViewAllowed: true, qpmsViewAllowed: true,
      authorizedClientIds: ['client-nims'],
    }, { client_code: 'OTHER_HOSPITAL' }),
    (error) => error.statusCode === 403 && error.code === 'hospital_client_access_denied',
  );
  await assert.rejects(
    () => listWebHospitalClientContacts({}, {
      broad: true, clientViewAllowed: false, qpmsViewAllowed: true,
    }, { client_id: 'client-nims' }),
    (error) => error.statusCode === 403 && error.code === 'hospital_client_view_access_denied',
  );
});

test('ticket queries apply narrow block and location scope without widening to client access', () => {
  const calls = [];
  const query = {
    in(column, values) { calls.push(['in', column, values]); return this; },
    or(value) { calls.push(['or', value]); return this; },
  };
  applyAccessScope(query, { broad: false, clientIds: [], blockIds: ['block-a'], locationIds: [] });
  assert.deepEqual(calls, [['in', 'block_id', ['block-a']]]);
  calls.length = 0;
  applyAccessScope(query, { broad: false, clientIds: [], blockIds: ['block-a'], locationIds: ['location-a'] });
  assert.deepEqual(calls, [['or', 'block_id.in.(block-a),location_id.in.(location-a)']]);
  assert.throws(
    () => applyAccessScope(query, { broad: false, clientIds: [], blockIds: [], locationIds: [] }),
    (error) => error.statusCode === 403 && error.code === 'hospital_web_scope_required',
  );
});

test('summary groups canonical active, escalation, confirmation, closed and cancelled states', async () => {
  const rows = [
    { id: '1', status_code: 'open', raised_at: new Date().toISOString() },
    { id: '2', status_code: 'assigned', current_assignee_user_id: 'user-1', raised_at: new Date().toISOString() },
    { id: '3', status_code: 'accepted', current_assignee_user_id: 'user-1', raised_at: new Date().toISOString() },
    { id: '4', status_code: 'in_progress', current_assignee_user_id: 'user-1', raised_at: new Date().toISOString() },
    { id: '5', status_code: 'escalated_hospital_dean', current_assignee_user_id: 'user-2', raised_at: new Date().toISOString() },
    { id: '6', status_code: 'resolved_awaiting_confirmation', raised_at: new Date().toISOString() },
    { id: '7', status_code: 'closed', raised_at: new Date().toISOString(), closed_at: new Date().toISOString() },
    { id: '8', status_code: 'cancelled', raised_at: new Date().toISOString() },
  ];
  const client = {
    from(table) {
      if (table === 'hospital_tickets') return queryResult(rows, null, rows.length);
      if (table === 'hospital_ticket_users') return queryResult([], null, 2);
      return queryResult([]);
    },
  };
  const result = await summarizeWebHospitalTickets(client, {
    broad: true, qpmsViewAllowed: true, clientViewAllowed: true,
  });
  assert.equal(result.counts.total, 8);
  assert.equal(result.counts.active, 6);
  assert.equal(result.counts.under_process, 3);
  assert.equal(result.counts.escalated, 1);
  assert.equal(result.counts.awaiting_client_confirmation, 1);
  assert.equal(result.counts.closed, 1);
  assert.equal(result.counts.cancelled, 1);
});

test('client ticket list exposes only the canonical requester name and keeps QPMS list unchanged', async () => {
  const rows = [
    { id: 'ticket-with-name', ticket_no: 'QPMS-HK-2026-000076', raised_by_name: 'DR. ANANDA KRISHNA', status_code: 'open' },
    { id: 'ticket-without-name', ticket_no: 'QPMS-HK-2026-000077', raised_by_name: null, status_code: 'open' },
  ];
  const client = {
    from(table) {
      if (table === 'hospital_tickets') return queryResult(rows, null, rows.length);
      if (table === 'hospital_ticket_attachments') return queryResult([]);
      return queryResult([]);
    },
  };
  const access = { broad: true, qpmsViewAllowed: true, clientViewAllowed: true };
  const clientResult = await listWebHospitalTickets(client, access, {
    client_id: 'client-nims', presentation: 'client',
  });
  assert.deepEqual(clientResult.tickets[0].raised_by, { name: 'DR. ANANDA KRISHNA' });
  assert.deepEqual(clientResult.tickets[1].raised_by, { name: null });
  for (const ticket of clientResult.tickets) {
    assert.equal('raised_by_name' in ticket, false);
    assert.equal('raised_by_client_contact_id' in ticket, false);
    assert.deepEqual(Object.keys(ticket.raised_by), ['name']);
  }

  const qpmsResult = await listWebHospitalTickets(client, access, {
    client_id: 'client-nims', presentation: 'qpms',
  });
  assert.equal('raised_by' in qpmsResult.tickets[0], false);
});

test('client doctor profile is not promoted into web management access', async () => {
  const access = await resolveHospitalWebAccess({
    client: mockClientForAccess(),
    authUser: { id: 'auth-2', email: 'doctor@example.com' },
    profile: { id: 'profile-2', auth_user_id: 'auth-2', role: 'Doctor', is_active: true, web_access_enabled: true, status: 'Active' },
  });
  assert.equal(access.allowed, false);
  assert.equal(access.status, 403);
});

test('ticket detail returns signed URLs without private storage paths', async () => {
  const detail = await getWebHospitalTicketDetail(mockClientForDetail(), {
    broad: true, qpmsViewAllowed: true, clientViewAllowed: true,
  }, 'QPMS-HK-2026-000001');
  assert.equal(detail.ticket.ticket_no, 'QPMS-HK-2026-000001');
  assert.equal(detail.ticket.unassigned, true);
  assert.equal(detail.ticket.uat, true);
  assert.equal(detail.attachments[0].signed_url, 'https://signed.example/photo.jpg');
  assert.equal('storage_path' in detail.attachments[0], false);
  assert.equal('storage_bucket' in detail.attachments[0], false);
});

test('client ticket detail excludes internal operational fields and non-visible records', async () => {
  const client = mockClientForDetail();
  const detail = await getWebHospitalTicketDetail(
    client,
    { broad: true, qpmsViewAllowed: true, clientViewAllowed: true },
    'QPMS-HK-2026-000001',
    { presentation: 'client' },
  );

  for (const field of [
    'current_assignee', 'accepted_by', 'supervisor', 'current_escalation_level',
    'supervisor_sla_due_at', 'escalation_due_at', 'sla', 'unassigned', 'overdue',
    'uat', 'assignment_failure_reason',
  ]) {
    assert.equal(field in detail.ticket, false, field);
  }
  assert.equal(detail.ticket.raised_by.role, null);
  assert.equal(detail.ticket.resolved_by, null);
  assert.deepEqual(detail.assignment_history, []);
  assert.equal('actor_name' in detail.timeline[0], false);
  assert.equal('actor_role' in detail.timeline[0], false);
  assert.equal(detail.comments[0].comment_text, 'Checked');
  assert.equal('author_name' in detail.comments[0], false);
  assert.equal('author_role' in detail.comments[0], false);
});
