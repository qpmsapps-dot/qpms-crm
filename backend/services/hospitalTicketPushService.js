import { createHash, randomUUID } from 'node:crypto';

import { isInvalidFirebaseTokenError, sendFirebaseMessage } from './firebaseAdminService.js';
import { normalizeHospitalRole } from './hospitalTicketAuthService.js';
import { cleanHospitalText } from './hospitalTicketWorkflowService.js';

export const HOSPITAL_PUSH_APP_SCOPES = new Set(['myqpms_internal', 'qpms_client']);
const INTERNAL_PUSH_ROLES = new Set(['housekeeping_supervisor', 'operations_executive', 'facility_manager', 'project_head', 'admin']);
const CLIENT_PUSH_ROLES = new Set(['doctor', 'hospital_management']);

export function appScopeForHospitalUser(user) {
  const role = normalizeHospitalRole(user?.role_code);
  if (user?.profile_type === 'internal' && INTERNAL_PUSH_ROLES.has(role)) return 'myqpms_internal';
  if (user?.profile_type === 'client' && CLIENT_PUSH_ROLES.has(role)) return 'qpms_client';
  return null;
}

export function validateRequestedAppScope(actor, requestedScope) {
  const expected = appScopeForHospitalUser(actor?.user);
  const scope = cleanHospitalText(requestedScope, 40);
  if (!scope || !HOSPITAL_PUSH_APP_SCOPES.has(scope)) {
    const error = new Error('A valid hospital ticket push app scope is required.');
    error.code = '22023';
    throw error;
  }
  if (scope !== expected) {
    const error = new Error('This app scope is not allowed for the signed-in hospital user.');
    error.code = '42501';
    throw error;
  }
  return scope;
}

export function hashFcmToken(token) {
  return createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
}

export async function registerHospitalPushDevice(client, actor, body = {}) {
  const appScope = validateRequestedAppScope(actor, body.app_scope || body.appScope);
  const fcmToken = cleanHospitalText(body.fcm_token || body.fcmToken, 4096);
  const deviceId = cleanHospitalText(body.device_id || body.deviceId, 160);
  if (!fcmToken || !deviceId) {
    const error = new Error('Device ID and FCM token are required.');
    error.code = '22023';
    throw error;
  }
  const platform = normalizePlatform(body.platform);
  const notificationPermission = normalizePermission(body.notification_permission || body.notificationPermission);
  const row = {
    auth_user_id: actor.user.auth_user_id,
    hospital_ticket_user_id: actor.user.id,
    client_id: actor.user.client_id,
    app_scope: appScope,
    platform,
    device_id: deviceId,
    fcm_token: fcmToken,
    token_hash: hashFcmToken(fcmToken),
    app_version: cleanHospitalText(body.app_version || body.appVersion, 80) || null,
    enabled: true,
    notification_permission: notificationPermission,
    last_registered_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
    disabled_at: null,
    disable_reason: null,
    metadata: {
      registered_by: actor.user.id,
      token_hash_prefix: hashFcmToken(fcmToken).slice(0, 12),
    },
  };
  const superseded = await disableSupersededHospitalPushDevices(client, {
    actor,
    appScope,
    deviceId,
    tokenHash: row.token_hash,
  });
  const result = await client
    .from('hospital_ticket_push_devices')
    .upsert(row, { onConflict: 'hospital_ticket_user_id,app_scope,device_id' })
    .select('id,app_scope,platform,device_id,app_version,enabled,notification_permission,last_registered_at,last_seen_at')
    .maybeSingle();
  if (result.error) throw result.error;
  console.info('[Hospital Push] Device registered', {
    userId: actor.user.id,
    appScope,
    platform,
    permission: notificationPermission,
    tokenPresent: true,
    superseded,
  });
  return result.data;
}

export async function disableSupersededHospitalPushDevices(client, {
  actor,
  appScope,
  deviceId,
  tokenHash,
  now = new Date().toISOString(),
} = {}) {
  if (!actor?.user?.id || !appScope || !deviceId || !tokenHash) return 0;
  const existing = await client
    .from('hospital_ticket_push_devices')
    .select('id,hospital_ticket_user_id,device_id')
    .eq('app_scope', appScope)
    .eq('token_hash', tokenHash)
    .eq('enabled', true);
  if (existing.error) throw existing.error;
  const staleIds = (existing.data || [])
    .filter((device) =>
      device.hospital_ticket_user_id !== actor.user.id ||
      device.device_id !== deviceId)
    .map((device) => device.id);
  if (!staleIds.length) return 0;
  const disabled = await client
    .from('hospital_ticket_push_devices')
    .update({
      enabled: false,
      disabled_at: now,
      disable_reason: 'superseded_by_token_registration',
      updated_at: now,
    })
    .in('id', staleIds);
  if (disabled.error) throw disabled.error;
  return staleIds.length;
}

export async function listHospitalPushDevices(client, actor) {
  const result = await client
    .from('hospital_ticket_push_devices')
    .select('id,app_scope,platform,device_id,app_version,enabled,notification_permission,last_registered_at,last_seen_at,disabled_at,disable_reason')
    .eq('hospital_ticket_user_id', actor.user.id)
    .order('last_seen_at', { ascending: false });
  if (result.error) throw result.error;
  return result.data || [];
}

export async function disableHospitalPushDevice(client, actor, deviceId) {
  const identifier = cleanHospitalText(deviceId, 160);
  if (!identifier) {
    const error = new Error('Device ID is required.');
    error.code = '22023';
    throw error;
  }
  const result = await client
    .from('hospital_ticket_push_devices')
    .update({
      enabled: false,
      disabled_at: new Date().toISOString(),
      disable_reason: 'logout_or_user_request',
      updated_at: new Date().toISOString(),
    })
    .eq('hospital_ticket_user_id', actor.user.id)
    .eq('device_id', identifier)
    .select('id,device_id,enabled,disabled_at')
    .maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) {
    const error = new Error('Registered device was not found.');
    error.code = 'P0002';
    throw error;
  }
  return result.data;
}

export async function dispatchHospitalNotificationPushes(client, options = {}) {
  try {
    const queued = await queueHospitalPushDeliveries(client, options);
    const processed = await processHospitalPushDeliveries(client, options);
    return { queued, processed };
  } catch (error) {
    console.warn('[Hospital Push] dispatch failed', {
      code: error?.code || null,
      message: error?.message || 'unknown',
    });
    return { queued: 0, processed: { sent: 0, failed: 0, skipped: 0 }, failed: true };
  }
}

export async function queueHospitalPushDeliveries(client, { notificationIds = null, limit = 200 } = {}) {
  let query = client
    .from('hospital_ticket_notifications')
    .select('id,ticket_id,recipient_user_id,notification_type,title,body,priority,current_owner_role,escalation_level,action_status,action_expires_at,metadata,created_at,recipient:hospital_ticket_users!hospital_ticket_notifications_recipient_user_id_fkey(id,profile_type,role_code,is_active,client_id)')
    .order('created_at', { ascending: true })
    .limit(Math.min(Math.max(Number(limit) || 200, 1), 500));
  if (Array.isArray(notificationIds) && notificationIds.length) query = query.in('id', notificationIds);
  const notifications = await query;
  if (notifications.error) throw notifications.error;

  let queued = 0;
  for (const notification of notifications.data || []) {
    if (!isPushActionableNotification(notification)) continue;
    const appScope = appScopeForNotification(notification);
    if (!appScope) continue;
    const devices = await client
      .from('hospital_ticket_push_devices')
      .select('id')
      .eq('hospital_ticket_user_id', notification.recipient_user_id)
      .eq('app_scope', appScope)
      .eq('enabled', true)
      .neq('notification_permission', 'denied');
    if (devices.error) throw devices.error;
    const rows = (devices.data || []).map((device) => ({
      notification_id: notification.id,
      device_id: device.id,
      ticket_id: notification.ticket_id,
      app_scope: appScope,
      status: 'pending',
      retryable: true,
      payload_metadata: {
        notification_type: notification.notification_type,
        ticket_id: notification.ticket_id,
        app_scope: appScope,
      },
    }));
    if (!rows.length) continue;
    const inserted = await client
      .from('hospital_ticket_push_deliveries')
      .upsert(rows, { onConflict: 'notification_id,device_id', ignoreDuplicates: true });
    if (inserted.error) throw inserted.error;
    console.info('[Hospital Push] Delivery created', {
      notificationId: notification.id,
      appScope,
      deviceCount: rows.length,
    });
    queued += rows.length;
  }
  return queued;
}

export async function processHospitalPushDeliveries(client, { limit = 100, firebaseSender = sendFirebaseMessage, now = new Date() } = {}) {
  const due = now.toISOString();
  const pending = await client
    .from('hospital_ticket_push_deliveries')
    .select('*,notification:hospital_ticket_notifications(*,ticket:hospital_tickets(id,ticket_no,version,priority,floor_name,department_name,location_text,description,current_assignee_role,acceptance_due_at,status_code,category:hospital_ticket_categories(category_name),block:hospital_blocks(block_name))),device:hospital_ticket_push_devices(id,fcm_token,token_hash,app_scope,enabled,notification_permission)')
    .in('status', ['pending', 'failed'])
    .eq('retryable', true)
    .lte('next_attempt_at', due)
    .order('created_at', { ascending: true })
    .limit(Math.min(Math.max(Number(limit) || 100, 1), 500));
  if (pending.error) throw pending.error;

  const stats = { sent: 0, failed: 0, skipped: 0, invalid_token: 0 };
  for (const delivery of pending.data || []) {
    const claimToken = randomUUID();
    const claimed = await client
      .from('hospital_ticket_push_deliveries')
      .update({ status: 'processing', claimed_at: due, claim_token: claimToken, updated_at: due })
      .eq('id', delivery.id)
      .in('status', ['pending', 'failed'])
      .select('id')
      .maybeSingle();
    if (claimed.error) throw claimed.error;
    if (!claimed.data) continue;

    const skipReason = deliverySkipReason(delivery);
    if (skipReason) {
      await markDelivery(client, delivery.id, {
        status: 'skipped',
        retryable: false,
        error_code: skipReason,
        updated_at: due,
      });
      stats.skipped += 1;
      continue;
    }

    const message = buildHospitalPushMessage(delivery.notification, delivery.device);
    const sent = await firebaseSender(message);
    const attemptCount = Number(delivery.attempt_count || 0) + 1;
    if (sent.ok) {
      await markDelivery(client, delivery.id, {
        status: 'sent',
        attempt_count: attemptCount,
        last_attempt_at: due,
        sent_at: due,
        fcm_message_id: sent.messageId || null,
        retryable: false,
        error_code: null,
        error_message: null,
        updated_at: due,
      });
      console.info('[Hospital Push] FCM send result', {
        deliveryId: delivery.id,
        appScope: delivery.device?.app_scope || null,
        status: 'sent',
        errorCode: null,
      });
      stats.sent += 1;
    } else {
      const invalidToken = isInvalidFirebaseTokenError(sent.code);
      if (invalidToken) {
        await client.from('hospital_ticket_push_devices').update({
          enabled: false,
          disabled_at: due,
          disable_reason: sent.code || 'invalid_token',
          updated_at: due,
        }).eq('id', delivery.device_id);
      }
      const canRetry = Boolean(sent.retryable) && attemptCount < Number(delivery.max_attempts || 5) && !invalidToken;
      await markDelivery(client, delivery.id, {
        status: invalidToken ? 'invalid_token' : 'failed',
        attempt_count: attemptCount,
        last_attempt_at: due,
        next_attempt_at: canRetry ? new Date(now.getTime() + retryDelayMs(attemptCount)).toISOString() : null,
        retryable: canRetry,
        error_code: sent.code || 'firebase_send_failed',
        error_message: cleanHospitalText(sent.message, 500) || null,
        updated_at: due,
      });
      console.info('[Hospital Push] FCM send result', {
        deliveryId: delivery.id,
        appScope: delivery.device?.app_scope || null,
        status: invalidToken ? 'invalid_token' : 'failed',
        errorCode: sent.code || 'firebase_send_failed',
      });
      stats[invalidToken ? 'invalid_token' : 'failed'] += 1;
    }
  }
  return stats;
}

function markDelivery(client, id, patch) {
  return client.from('hospital_ticket_push_deliveries').update(patch).eq('id', id);
}

export function isPushActionableNotification(notification) {
  if (!notification?.id || !notification.recipient_user_id) return false;
  if (notification.recipient?.is_active === false) return false;
  if (notification.notification_type === 'incoming_supervisor_ticket') {
    if (notification.action_status !== 'active') return false;
    if (notification.action_expires_at && new Date(notification.action_expires_at) <= new Date()) return false;
  }
  return Boolean(appScopeForNotification(notification));
}

export function appScopeForNotification(notification) {
  const type = String(notification?.notification_type || '');
  if ([
    'awaiting_confirmation',
    'ticket_created',
    'ticket_accepted',
    'work_started',
    'ticket_reopened_client',
    'ticket_closed',
  ].includes(type)) return 'qpms_client';
  if ([
    'incoming_supervisor_ticket',
    'supervisor_acceptance_timeout',
    'sla_escalation',
    'assignment_alert',
    'ticket_reopened',
    'ticket_cancelled',
    'ticket_assigned_internal',
  ].includes(type)) return 'myqpms_internal';
  return appScopeForHospitalUser(notification?.recipient);
}

export function buildHospitalPushMessage(notification, device) {
  const data = buildHospitalPushData(notification, device?.app_scope);
  const type = String(notification?.notification_type || '');
  const actionableSupervisorInvite = type === 'incoming_supervisor_ticket';
  const title = cleanHospitalText(notification.title, 120) || fallbackTitle(type);
  const body = cleanHospitalText(notification.body, 300) || fallbackBody(notification);
  return {
    token: device.fcm_token,
    ...(actionableSupervisorInvite ? {} : { notification: { title, body } }),
    data,
    android: {
      priority: 'high',
      ...(actionableSupervisorInvite
        ? {}
        : {
            notification: {
              channelId: 'hospital_tickets',
              clickAction: 'FLUTTER_NOTIFICATION_CLICK',
            },
          }),
    },
    apns: {
      payload: { aps: { sound: 'default' } },
    },
  };
}

export function buildHospitalPushData(notification, appScope) {
  const ticket = notification.ticket || {};
  const metadata = notification.metadata || {};
  const ticketId = String(notification.ticket_id || ticket.id || metadata.ticket_id || '');
  const ticketNumber = String(ticket.ticket_no || metadata.ticket_no || '');
  const eventType = String(notification.notification_type || 'hospital_ticket_update');
  const blockName = String(ticket.block?.block_name || metadata.block_name || '').trim();
  const floorName = String(ticket.floor_name || metadata.floor_name || '').trim();
  const categoryName = String(ticket.category?.category_name || metadata.category_name || '').trim();
  return compactStringMap({
    notification_id: notification.id,
    ticket_id: ticketId,
    ticket_number: ticketNumber,
    ticket_version: String(ticket.version || metadata.ticket_version || ''),
    event_type: eventType,
    priority: String(notification.priority || ticket.priority || metadata.priority || ''),
    block_name: blockName,
    floor_name: floorName,
    category_name: categoryName,
    target_screen: targetScreenForNotification(eventType),
    app_scope: appScope,
    acceptance_due_at: String(notification.action_expires_at || ticket.acceptance_due_at || metadata.acceptance_due_at || ''),
    current_owner_role: String(notification.current_owner_role || ticket.current_assignee_role || metadata.current_owner || ''),
  });
}

function deliverySkipReason(delivery) {
  if (!delivery?.device?.enabled) return 'device_disabled';
  if (delivery.device.notification_permission === 'denied') return 'permission_denied';
  if (!delivery.device.fcm_token) return 'missing_fcm_token';
  if (!isPushActionableNotification(delivery.notification)) return 'notification_not_actionable';
  return null;
}

function targetScreenForNotification(type) {
  if (type === 'incoming_supervisor_ticket') return 'incoming_ticket';
  if (type === 'awaiting_confirmation') return 'ticket_feedback';
  return 'ticket_detail';
}

function fallbackTitle(type) {
  if (type === 'awaiting_confirmation') return 'Ticket Resolved - Please Confirm';
  if (type === 'supervisor_acceptance_timeout') return 'Supervisor Acceptance Timeout';
  if (type === 'sla_escalation') return 'Ticket Escalated';
  return 'Hospital Ticket Update';
}

function fallbackBody(notification) {
  const ticketNo = notification?.ticket?.ticket_no || notification?.metadata?.ticket_no || 'This ticket';
  return `${ticketNo} needs attention.`;
}

function normalizePlatform(value) {
  const platform = cleanHospitalText(value, 20).toLowerCase();
  return ['android', 'ios', 'web'].includes(platform) ? platform : 'unknown';
}

function normalizePermission(value) {
  const permission = cleanHospitalText(value, 20).toLowerCase();
  return ['granted', 'denied', 'provisional'].includes(permission) ? permission : 'unknown';
}

function retryDelayMs(attemptCount) {
  return Math.min(15 * 60 * 1000, 60 * 1000 * Math.max(1, attemptCount));
}

function compactStringMap(values) {
  return Object.fromEntries(Object.entries(values)
    .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== '')
    .map(([key, value]) => [key, String(value)]));
}
