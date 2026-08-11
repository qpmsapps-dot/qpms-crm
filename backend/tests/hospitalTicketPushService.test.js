import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  appScopeForHospitalUser,
  buildHospitalPushData,
  buildHospitalPushMessage,
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

function fakePushClient(state) {
  return {
    from(table) {
      return new FakePushQuery(state, table);
    },
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
