import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appScopeForHospitalUser,
  buildHospitalPushData,
  buildHospitalPushMessage,
  hashFcmToken,
  isPushActionableNotification,
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
