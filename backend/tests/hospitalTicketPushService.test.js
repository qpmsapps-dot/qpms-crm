import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  appScopeForHospitalUser,
  appScopeForNotification,
  buildHospitalPushData,
  buildHospitalPushMessage,
  disableSupersededHospitalPushDevices,
  hashFcmToken,
  isPushActionableNotification,
  processHospitalPushDeliveries,
  queueHospitalPushDeliveries,
  registerHospitalPushDevice,
  validateRequestedAppScope,
} from '../services/hospitalTicketPushService.js';

const actor = (role, profileType = 'internal') => ({
  user: {
    id: `${role}-user`,
    auth_user_id: `${role}-auth`,
    client_id: 'client-a',
    profile_type: profileType,
    role_code: role,
    is_active: true,
  },
});

test('push app scope is derived from authenticated hospital user role', () => {
  assert.equal(appScopeForHospitalUser(actor('housekeeping_supervisor').user), 'myqpms_internal');
  assert.equal(appScopeForHospitalUser(actor('operations_executive').user), 'myqpms_internal');
  assert.equal(appScopeForHospitalUser(actor('admin').user), 'myqpms_internal');
  assert.equal(appScopeForHospitalUser(actor('doctor', 'client').user), 'qpms_client');
  assert.equal(appScopeForHospitalUser({ role_code: 'doctor', profile_type: 'internal' }), null);
});

test('user cannot register a token for the wrong app scope', () => {
  assert.equal(validateRequestedAppScope(actor('doctor', 'client'), 'qpms_client'), 'qpms_client');
  assert.throws(
    () => validateRequestedAppScope(actor('doctor', 'client'), 'myqpms_internal'),
    /not allowed/,
  );
  assert.throws(
    () => validateRequestedAppScope(actor('housekeeping_supervisor'), 'qpms_client'),
    /not allowed/,
  );
});

test('device registration uses signed-in user identity and stores only safe metadata', async () => {
  const writes = [];
  const fakeClient = {
    from(table) {
      assert.equal(table, 'hospital_ticket_push_devices');
      return {
        select() {
          return {
            eq() { return this; },
            then(resolve) {
              return Promise.resolve({ data: [], error: null }).then(resolve);
            },
          };
        },
        upsert(row, options) {
          writes.push({ row, options });
          return {
            select() {
              return {
                maybeSingle: async () => ({
                  data: {
                    id: 'device-row',
                    app_scope: row.app_scope,
                    device_id: row.device_id,
                    enabled: row.enabled,
                  },
                }),
              };
            },
          };
        },
      };
    },
  };
  const device = await registerHospitalPushDevice(fakeClient, actor('housekeeping_supervisor'), {
    app_scope: 'myqpms_internal',
    platform: 'android',
    device_id: 'phone-1',
    fcm_token: 'fcm-secret-token',
    notification_permission: 'granted',
  });
  assert.equal(device.id, 'device-row');
  assert.equal(writes[0].row.hospital_ticket_user_id, 'housekeeping_supervisor-user');
  assert.equal(writes[0].row.auth_user_id, 'housekeeping_supervisor-auth');
  assert.equal(writes[0].row.fcm_token, 'fcm-secret-token');
  assert.equal(writes[0].row.metadata.token_hash_prefix, hashFcmToken('fcm-secret-token').slice(0, 12));
  assert.equal(writes[0].options.onConflict, 'hospital_ticket_user_id,app_scope,device_id');
});

test('same active FCM token registration supersedes stale ownership on the same app scope', async () => {
  const state = {
    devices: [
      {
        id: 'device-old-user',
        hospital_ticket_user_id: 'doctor-a-user',
        app_scope: 'qpms_client',
        device_id: 'phone-old',
        token_hash: hashFcmToken('shared-token'),
        enabled: true,
      },
      {
        id: 'device-current',
        hospital_ticket_user_id: 'doctor-b-user',
        app_scope: 'qpms_client',
        device_id: 'phone-current',
        token_hash: hashFcmToken('shared-token'),
        enabled: true,
      },
      {
        id: 'device-other-phone',
        hospital_ticket_user_id: 'doctor-a-user',
        app_scope: 'qpms_client',
        device_id: 'phone-2',
        token_hash: hashFcmToken('different-token'),
        enabled: true,
      },
    ],
  };
  const count = await disableSupersededHospitalPushDevices(fakeDeviceClient(state), {
    actor: actor('doctor-b', 'client'),
    appScope: 'qpms_client',
    deviceId: 'phone-current',
    tokenHash: hashFcmToken('shared-token'),
    now: '2026-08-13T12:00:00Z',
  });

  assert.equal(count, 1);
  assert.equal(state.devices.find((row) => row.id === 'device-old-user').enabled, false);
  assert.equal(state.devices.find((row) => row.id === 'device-current').enabled, true);
  assert.equal(state.devices.find((row) => row.id === 'device-other-phone').enabled, true);
  assert.equal(
    state.devices.find((row) => row.id === 'device-old-user').disable_reason,
    'superseded_by_token_registration',
  );
});

test('same user keeps multiple phones when FCM tokens differ', async () => {
  const state = {
    devices: [
      {
        id: 'device-phone-1',
        hospital_ticket_user_id: 'doctor-user',
        app_scope: 'qpms_client',
        device_id: 'phone-1',
        token_hash: hashFcmToken('token-1'),
        enabled: true,
      },
      {
        id: 'device-phone-2',
        hospital_ticket_user_id: 'doctor-user',
        app_scope: 'qpms_client',
        device_id: 'phone-2',
        token_hash: hashFcmToken('token-2'),
        enabled: true,
      },
    ],
  };
  const count = await disableSupersededHospitalPushDevices(fakeDeviceClient(state), {
    actor: actor('doctor', 'client'),
    appScope: 'qpms_client',
    deviceId: 'phone-1',
    tokenHash: hashFcmToken('token-1'),
    now: '2026-08-13T12:00:00Z',
  });

  assert.equal(count, 0);
  assert.equal(state.devices.every((row) => row.enabled), true);
});

test('incoming supervisor push is actionable only before supersede or timeout', () => {
  const base = {
    id: 'notification-1',
    recipient_user_id: 'supervisor-1',
    notification_type: 'incoming_supervisor_ticket',
    action_status: 'active',
    action_expires_at: new Date(Date.now() + 120000).toISOString(),
  };
  assert.equal(isPushActionableNotification(base), true);
  assert.equal(isPushActionableNotification({ ...base, action_status: 'superseded' }), false);
  assert.equal(isPushActionableNotification({ ...base, action_expires_at: new Date(Date.now() - 1000).toISOString() }), false);
});

test('push payload contains safe ticket routing metadata only', () => {
  const message = buildHospitalPushMessage({
    id: 'notification-1',
    ticket_id: 'ticket-1',
    notification_type: 'awaiting_confirmation',
    title: 'Your Complaint Has Been Resolved',
    body: 'Ticket QPMS-HK-1025 has been completed.',
    priority: 'critical',
    metadata: { ticket_no: 'QPMS-HK-1025' },
    ticket: {
      id: 'ticket-1',
      ticket_no: 'QPMS-HK-1025',
      priority: 'critical',
      description: 'Do not include long complaint detail in data payload',
    },
  }, {
    fcm_token: 'device-token',
    app_scope: 'qpms_client',
  });
  assert.equal(message.token, 'device-token');
  assert.equal(message.data.app_scope, 'qpms_client');
  assert.equal(message.data.target_screen, 'ticket_feedback');
  assert.equal(message.data.ticket_number, 'QPMS-HK-1025');
  assert.equal('description' in message.data, false);
});

test('push data maps escalation to ticket detail in the internal app', () => {
  const data = buildHospitalPushData({
    id: 'notification-2',
    ticket_id: 'ticket-2',
    notification_type: 'sla_escalation',
    priority: 'medium',
    current_owner_role: 'operations_executive',
    ticket: { ticket_no: 'QPMS-HK-1026' },
  }, 'myqpms_internal');
  assert.equal(data.app_scope, 'myqpms_internal');
  assert.equal(data.target_screen, 'ticket_detail');
  assert.equal(data.current_owner_role, 'operations_executive');
});

test('incoming supervisor push carries notification fallback and server acceptance deadline', () => {
  const message = buildHospitalPushMessage({
    id: 'notification-incoming',
    ticket_id: 'ticket-incoming',
    notification_type: 'incoming_supervisor_ticket',
    title: 'New Housekeeping Complaint',
    body: 'Block A needs acceptance.',
    priority: 'high',
    action_expires_at: '2026-08-11T09:02:00Z',
    ticket: {
      id: 'ticket-incoming',
      ticket_no: 'QPMS-HK-2026-000036',
      version: 7,
      priority: 'high',
      acceptance_due_at: '2026-08-11T09:02:00Z',
      block: { block_name: 'Block A' },
      floor_name: '3rd Floor',
      category: { category_name: 'General Housekeeping' },
    },
  }, {
    fcm_token: 'device-token',
    app_scope: 'myqpms_internal',
  });

  assert.equal(message.notification.title, 'New Housekeeping Complaint');
  assert.equal(message.notification.body, 'Block A needs acceptance.');
  assert.equal(message.android.notification.channelId, 'hospital_tickets');
  assert.equal(message.android.notification.clickAction, 'FLUTTER_NOTIFICATION_CLICK');
  assert.equal(message.data.target_screen, 'incoming_ticket');
  assert.equal(message.data.acceptance_due_at, '2026-08-11T09:02:00Z');
  assert.equal(message.data.ticket_version, '7');
  assert.equal(message.data.block_name, 'Block A');
  assert.equal(message.data.floor_name, '3rd Floor');
  assert.equal(message.data.category_name, 'General Housekeeping');
});

test('client resolution push keeps notification body and exact ticket route', () => {
  const message = buildHospitalPushMessage({
    id: 'notification-client',
    ticket_id: 'ticket-client',
    notification_type: 'awaiting_confirmation',
    title: 'Housekeeping Work Completed',
    body: 'QPMS-HK-2026-000036 is ready for your confirmation.',
    ticket: { ticket_no: 'QPMS-HK-2026-000036' },
  }, {
    fcm_token: 'device-token',
    app_scope: 'qpms_client',
  });

  assert.equal(message.notification.title, 'Housekeeping Work Completed');
  assert.equal(message.data.target_screen, 'ticket_feedback');
  assert.equal(message.data.ticket_number, 'QPMS-HK-2026-000036');
});

test('client cancellation push is routed to myQPMS internal devices', () => {
  const data = buildHospitalPushData({
    id: 'notification-3',
    ticket_id: 'ticket-3',
    notification_type: 'ticket_cancelled',
    priority: 'medium',
    current_owner_role: 'housekeeping_supervisor',
    ticket: { ticket_no: 'QPMS-HK-1027' },
  }, 'myqpms_internal');
  assert.equal(data.app_scope, 'myqpms_internal');
  assert.equal(data.target_screen, 'ticket_detail');
});

test('phase 3 lifecycle notification types route to the intended app scopes', () => {
  assert.equal(appScopeForNotification({ notification_type: 'ticket_created' }), 'qpms_client');
  assert.equal(appScopeForNotification({ notification_type: 'ticket_accepted' }), 'qpms_client');
  assert.equal(appScopeForNotification({ notification_type: 'work_started' }), 'qpms_client');
  assert.equal(appScopeForNotification({ notification_type: 'ticket_reopened_client' }), 'qpms_client');
  assert.equal(appScopeForNotification({ notification_type: 'ticket_assigned_internal' }), 'myqpms_internal');
});

test('dispatcher queues one supervisor delivery and processes pending row without Firebase Admin shape crash', async () => {
  const now = new Date('2026-08-11T00:10:28Z');
  const notification = {
    id: 'notification-supervisor',
    ticket_id: 'ticket-1',
    recipient_user_id: 'supervisor-user',
    notification_type: 'incoming_supervisor_ticket',
    title: 'New Critical Ticket',
    body: 'QPMS-HK-2026-0001 needs acceptance.',
    priority: 'critical',
    current_owner_role: 'housekeeping_supervisor',
    escalation_level: 1,
    action_status: 'active',
    action_expires_at: '2099-08-11T00:12:28Z',
    metadata: { ticket_no: 'QPMS-HK-2026-0001' },
    recipient: {
      id: 'supervisor-user',
      profile_type: 'internal',
      role_code: 'housekeeping_supervisor',
      is_active: true,
      client_id: 'client-a',
    },
  };
  const device = {
    id: 'device-1',
    hospital_ticket_user_id: 'supervisor-user',
    fcm_token: 'fcm-token-redacted',
    app_scope: 'myqpms_internal',
    enabled: true,
    notification_permission: 'granted',
  };
  const state = {
    notifications: [notification],
    devices: [device],
    deliveries: [],
    updates: [],
  };
  const client = fakePushClient(state);

  const queuedFirst = await queueHospitalPushDeliveries(client, { now });
  const queuedAgain = await queueHospitalPushDeliveries(client, { now });
  assert.equal(queuedFirst, 1);
  assert.equal(queuedAgain, 1);
  assert.equal(state.deliveries.length, 1);
  assert.equal(state.deliveries[0].status, 'pending');

  const processed = await processHospitalPushDeliveries(client, {
    now,
    firebaseSender: async (message) => {
      assert.equal(message.token, 'fcm-token-redacted');
      assert.equal(message.data.target_screen, 'incoming_ticket');
      return { ok: true, messageId: 'projects/demo/messages/1' };
    },
  });

  assert.deepEqual(processed, { sent: 1, failed: 0, skipped: 0, invalid_token: 0 });
  assert.equal(state.deliveries[0].status, 'sent');
  assert.equal(state.deliveries[0].attempt_count, 1);
  assert.equal(state.deliveries[0].last_attempt_at, now.toISOString());
  assert.equal(state.deliveries[0].sent_at, now.toISOString());
});

test('temporary Firebase failure keeps delivery retryable with backoff', async () => {
  const now = new Date('2026-08-11T00:10:28Z');
  const state = {
    notifications: [pushNotificationFixture()],
    devices: [pushDeviceFixture()],
    deliveries: [{
      id: 'delivery-temporary-failure',
      notification_id: 'notification-supervisor',
      device_id: 'device-1',
      ticket_id: 'ticket-1',
      app_scope: 'myqpms_internal',
      status: 'pending',
      attempt_count: 0,
      max_attempts: 5,
      next_attempt_at: '2026-08-11T00:00:00Z',
      retryable: true,
      notification: pushNotificationFixture(),
      device: pushDeviceFixture(),
    }],
  };

  const processed = await processHospitalPushDeliveries(fakePushClient(state), {
    now,
    firebaseSender: async () => ({
      ok: false,
      code: 'messaging/server-unavailable',
      message: 'temporary outage',
      retryable: true,
    }),
  });

  assert.deepEqual(processed, { sent: 0, failed: 1, skipped: 0, invalid_token: 0 });
  assert.equal(state.deliveries[0].status, 'failed');
  assert.equal(state.deliveries[0].attempt_count, 1);
  assert.equal(state.deliveries[0].retryable, true);
  assert.equal(state.deliveries[0].next_attempt_at, '2026-08-11T00:11:28.000Z');
});

test('permanent invalid Firebase token disables only that device', async () => {
  const now = new Date('2026-08-11T00:10:28Z');
  const device = pushDeviceFixture();
  const state = {
    notifications: [pushNotificationFixture()],
    devices: [device],
    deliveries: [{
      id: 'delivery-invalid-token',
      notification_id: 'notification-supervisor',
      device_id: 'device-1',
      ticket_id: 'ticket-1',
      app_scope: 'myqpms_internal',
      status: 'pending',
      attempt_count: 0,
      max_attempts: 5,
      next_attempt_at: '2026-08-11T00:00:00Z',
      retryable: true,
      notification: pushNotificationFixture(),
      device,
    }],
  };

  const processed = await processHospitalPushDeliveries(fakePushClient(state), {
    now,
    firebaseSender: async () => ({
      ok: false,
      code: 'messaging/registration-token-not-registered',
      message: 'gone',
      retryable: false,
    }),
  });

  assert.deepEqual(processed, { sent: 0, failed: 0, skipped: 0, invalid_token: 1 });
  assert.equal(state.deliveries[0].status, 'invalid_token');
  assert.equal(state.deliveries[0].retryable, false);
  assert.equal(state.devices[0].enabled, false);
  assert.equal(state.devices[0].disable_reason, 'messaging/registration-token-not-registered');
});

test('Firebase Admin initialization uses modular getApps instead of undefined admin.apps', () => {
  const source = readFileSync(
    new URL('../services/firebaseAdminService.js', import.meta.url),
    'utf8',
  );
  assert.match(source, /getApps\(\)\.find\(\(app\) => app\.name === 'hospital-ticketing'\)/);
  assert.doesNotMatch(source, /admin\.apps\.find/);
  assert.doesNotMatch(source, /admin\.credential\.cert/);
  assert.doesNotMatch(source, /admin\.messaging/);
});

test('notification reliability migration adds database dedupe key without replacing source table', () => {
  const source = readFileSync(
    new URL('../../supabase/migrations_2_0/051_hospital_notification_reliability_hardening.sql', import.meta.url),
    'utf8',
  );
  assert.match(source, /add column if not exists dedupe_key text/i);
  assert.match(source, /hospital_ticket_notifications_dedupe_key_unique unique \(dedupe_key\)/i);
  assert.match(source, /hospital_ticket_notification_dedupe_key/i);
  assert.match(source, /sla_escalation/i);
  assert.match(source, /incoming_supervisor_ticket/i);
  assert.match(source, /drop index if exists public\.ux_hospital_incoming_supervisor_ticket_notification/i);
  assert.doesNotMatch(source, /create table .*notifications/i);
});

test('notification event coverage migration extends lifecycle dedupe types only', () => {
  const source = readFileSync(
    new URL('../../supabase/migrations_2_0/052_hospital_notification_event_coverage.sql', import.meta.url),
    'utf8',
  );
  assert.match(source, /create or replace function public\.hospital_ticket_notification_dedupe_key/i);
  assert.match(source, /ticket_created/i);
  assert.match(source, /ticket_accepted/i);
  assert.match(source, /work_started/i);
  assert.match(source, /ticket_reopened_client/i);
  assert.match(source, /ticket_assigned_internal/i);
  assert.match(source, /awaiting_confirmation/i);
  assert.doesNotMatch(source, /create table/i);
  assert.doesNotMatch(source, /alter table .*hospital_ticket_notifications/i);
});

function fakePushClient(state) {
  return {
    from(table) {
      return new FakePushQuery(state, table);
    },
  };
}

function pushNotificationFixture() {
  return {
    id: 'notification-supervisor',
    ticket_id: 'ticket-1',
    recipient_user_id: 'supervisor-user',
    notification_type: 'incoming_supervisor_ticket',
    title: 'New Critical Ticket',
    body: 'QPMS-HK-2026-0001 needs acceptance.',
    priority: 'critical',
    current_owner_role: 'housekeeping_supervisor',
    escalation_level: 1,
    action_status: 'active',
    action_expires_at: '2099-08-11T00:12:28Z',
    metadata: { ticket_no: 'QPMS-HK-2026-0001' },
    recipient: {
      id: 'supervisor-user',
      profile_type: 'internal',
      role_code: 'housekeeping_supervisor',
      is_active: true,
      client_id: 'client-a',
    },
  };
}

function pushDeviceFixture() {
  return {
    id: 'device-1',
    hospital_ticket_user_id: 'supervisor-user',
    fcm_token: 'fcm-token-redacted',
    app_scope: 'myqpms_internal',
    enabled: true,
    notification_permission: 'granted',
  };
}

class FakePushQuery {
  constructor(state, table) {
    this.state = state;
    this.table = table;
    this.filters = [];
    this.patch = null;
    this.insertRows = null;
  }

  select() { return this; }
  order() { return this; }
  limit() { return this; }
  lte(column, value) {
    this.filters.push(['lte', column, value]);
    return this;
  }
  eq(column, value) {
    this.filters.push(['eq', column, value]);
    return this;
  }
  neq(column, value) {
    this.filters.push(['neq', column, value]);
    return this;
  }
  in(column, values) {
    this.filters.push(['in', column, values]);
    return this;
  }
  upsert(rows) {
    const items = Array.isArray(rows) ? rows : [rows];
    for (const row of items) {
      if (!this.state.deliveries.some((existing) =>
        existing.notification_id === row.notification_id && existing.device_id === row.device_id
      )) {
        this.state.deliveries.push({
          id: `delivery-${this.state.deliveries.length + 1}`,
          attempt_count: 0,
          max_attempts: 5,
          next_attempt_at: '2026-08-11T00:00:00Z',
          ...row,
          notification: this.state.notifications.find((item) => item.id === row.notification_id),
          device: this.state.devices.find((item) => item.id === row.device_id),
        });
      }
    }
    return Promise.resolve({ data: null, error: null });
  }
  update(patch) {
    this.patch = patch;
    return this;
  }
  maybeSingle() {
    const rows = this._rows();
    const row = rows[0] || null;
    if (this.patch && row) Object.assign(row, this.patch);
    return Promise.resolve({ data: row ? { id: row.id } : null, error: null });
  }
  then(resolve, reject) {
    const rows = this._rows();
    if (this.patch) {
      for (const row of rows) Object.assign(row, this.patch);
    }
    return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
  }

  _rows() {
    const source = this.table === 'hospital_ticket_notifications'
      ? this.state.notifications
      : this.table === 'hospital_ticket_push_devices'
        ? this.state.devices
        : this.state.deliveries;
    return source.filter((row) => this.filters.every(([op, column, value]) => {
      if (op === 'eq') return row[column] === value;
      if (op === 'neq') return row[column] !== value;
      if (op === 'in') return value.includes(row[column]);
      if (op === 'lte') return !row[column] || new Date(row[column]) <= new Date(value);
      return true;
    }));
  }
}

function fakeDeviceClient(state) {
  return {
    from(table) {
      assert.equal(table, 'hospital_ticket_push_devices');
      return new FakeDeviceQuery(state);
    },
  };
}

class FakeDeviceQuery {
  constructor(state) {
    this.state = state;
    this.filters = [];
    this.patch = null;
  }

  select() { return this; }
  eq(column, value) {
    this.filters.push(['eq', column, value]);
    return this;
  }
  in(column, values) {
    this.filters.push(['in', column, values]);
    return this;
  }
  update(patch) {
    this.patch = patch;
    return this;
  }
  then(resolve, reject) {
    const rows = this._rows();
    if (this.patch) {
      for (const row of rows) Object.assign(row, this.patch);
    }
    return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
  }
  _rows() {
    return this.state.devices.filter((row) => this.filters.every(([op, column, value]) => {
      if (op === 'eq') return row[column] === value;
      if (op === 'in') return value.includes(row[column]);
      return true;
    }));
  }
}
