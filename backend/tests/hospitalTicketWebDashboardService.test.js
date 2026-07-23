import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getWebHospitalTicketDetail,
  resolveHospitalWebAccess,
} from '../services/hospitalTicketWebDashboardService.js';

function queryResult(data, error = null, count = null) {
  return {
    select() { return this; },
    eq() { return this; },
    order() { return this; },
    limit() { return this; },
    in() { return this; },
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

test('web management profile can use compatibility access without a hospital actor', async () => {
  const access = await resolveHospitalWebAccess({
    client: mockClientForAccess(),
    authUser: { id: 'auth-1', email: 'admin@example.com' },
    profile: { id: 'profile-1', auth_user_id: 'auth-1', role: 'Admin', is_active: true, web_access_enabled: true, status: 'Active' },
  });
  assert.equal(access.allowed, true);
  assert.equal(access.source, 'legacy_web_management');
  assert.equal(access.broad, true);
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
  const detail = await getWebHospitalTicketDetail(mockClientForDetail(), { broad: true }, 'QPMS-HK-2026-000001');
  assert.equal(detail.ticket.ticket_no, 'QPMS-HK-2026-000001');
  assert.equal(detail.ticket.unassigned, true);
  assert.equal(detail.ticket.uat, true);
  assert.equal(detail.attachments[0].signed_url, 'https://signed.example/photo.jpg');
  assert.equal('storage_path' in detail.attachments[0], false);
  assert.equal('storage_bucket' in detail.attachments[0], false);
});
