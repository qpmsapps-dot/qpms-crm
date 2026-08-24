import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { dispatchHospitalNotificationPushes } from '../services/hospitalTicketPushService.js';
import { runHospitalSlaWorker } from '../services/hospitalTicketSlaService.js';

const scriptDir = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(scriptDir, '../../.env') });
dotenv.config({ path: resolve(scriptDir, '../.env') });

export const ESCALATION_STATUS_BY_LEVEL = {
  1: 'awaiting_supervisor_acceptance',
  2: 'escalated_operations_executive',
  3: 'escalated_facility_manager',
  4: 'escalated_project_head',
};

export const ESCALATION_ROLE_BY_LEVEL = {
  1: 'housekeeping_supervisor',
  2: 'operations_executive',
  3: 'facility_manager',
  4: 'project_head',
};

export const NON_ESCALATING_STATUS_SCENARIOS = [
  { name: 'Accepted before SLA expiry', status_code: 'accepted', acceptance_status: 'accepted', due: 'future' },
  { name: 'In Progress before configured work SLA expiry', status_code: 'in_progress', acceptance_status: 'accepted', due: 'future' },
  { name: 'Awaiting Client Confirmation', status_code: 'resolved_awaiting_confirmation', acceptance_status: 'not_required', due: 'past' },
  { name: 'Closed', status_code: 'closed', acceptance_status: 'not_required', due: 'past' },
  { name: 'Cancelled', status_code: 'cancelled', acceptance_status: 'not_required', due: 'past' },
];

const TICKET_RESTORE_COLUMNS = [
  'status_code',
  'current_escalation_level',
  'current_escalation_level_no',
  'current_assignee_user_id',
  'current_assignee_role',
  'supervisor_user_id',
  'operations_executive_user_id',
  'facility_manager_user_id',
  'project_head_user_id',
  'raised_at',
  'assigned_at',
  'accepted_at',
  'accepted_by_user_id',
  'work_started_at',
  'supervisor_sla_due_at',
  'supervisor_escalated_at',
  'operations_sla_due_at',
  'operations_escalated_at',
  'facility_manager_escalated_at',
  'project_head_sla_due_at',
  'project_head_escalated_at',
  'escalation_due_at',
  'last_escalated_at',
  'escalation_count',
  'final_escalation',
  'sla_status',
  'acceptance_status',
  'acceptance_due_at',
  'acceptance_timeout_at',
  'reopen_count',
  'version',
  'metadata',
  'updated_at',
];

export function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    ticket: '',
    age: null,
    full: false,
    restore: true,
    allowLiveTicket: false,
    skipPush: false,
  };
  for (const item of argv) {
    if (item.startsWith('--ticket=')) args.ticket = item.slice('--ticket='.length).trim();
    else if (item.startsWith('--age=')) args.age = Number(item.slice('--age='.length));
    else if (item === '--full') args.full = true;
    else if (item === '--restore') args.restore = true;
    else if (item === '--no-restore') args.restore = false;
    else if (item === '--allow-live-ticket') args.allowLiveTicket = true;
    else if (item === '--skip-push') args.skipPush = true;
    else if (item === '--help' || item === '-h') args.help = true;
  }
  return args;
}

export function isClearlyTestTicket(ticket = {}) {
  const haystack = [
    ticket.ticket_no,
    ticket.title,
    ticket.description,
    ticket.idempotency_key,
    ticket.client?.client_code,
    ticket.client?.client_name,
    JSON.stringify(ticket.metadata || {}),
  ].join(' ').toLowerCase();
  return /(^|[^a-z0-9])(test|uat|pilot|demo|sandbox)([^a-z0-9]|$)/.test(haystack);
}

export function levelForTicket(ticket = {}) {
  const level = Number(ticket.current_escalation_level_no);
  if (Number.isInteger(level) && level >= 1 && level <= 4) return level;
  return Number(Object.entries(ESCALATION_ROLE_BY_LEVEL).find(([, role]) => role === ticket.current_assignee_role)?.[0] || 1);
}

function printUsage() {
  console.log(`Hospital Ticket Escalation Test
--------------------------------
Usage:
  node scripts/test-hospital-escalation.js --ticket=<TICKET_ID> --age=<minutes>
  node scripts/test-hospital-escalation.js --ticket=<TICKET_ID> --full

Safety:
  Refuses NODE_ENV=production.
  Refuses tickets that are not clearly TEST/UAT/PILOT/DEMO/SANDBOX unless --allow-live-ticket is provided.
  Restores mutable ticket fields by default. Audit events are append-only and are not deleted.

Options:
  --restore             Restore mutable ticket state after testing (default)
  --no-restore          Keep simulated state and generated records
  --skip-push           Do not run push dispatch after DB notification checks
  --allow-live-ticket   Override the test-ticket safety guard`);
}

function requireNonProduction(environment = process.env) {
  if (String(environment.NODE_ENV || '').trim().toLowerCase() === 'production') {
    throw new Error('Refusing to run hospital escalation test harness with NODE_ENV=production.');
  }
}

function createServiceClient(environment = process.env) {
  const url = String(environment.SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
  const serviceKey = String(environment.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !serviceKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { enabled: false },
  });
}

async function must(result, context) {
  const resolved = await result;
  if (resolved.error) {
    resolved.error.message = `${context}: ${resolved.error.message}`;
    throw resolved.error;
  }
  return resolved.data;
}

async function loadTicket(client, ticketId) {
  let query = client.from('hospital_tickets').select('*');
  query = isUuid(ticketId) ? query.eq('id', ticketId) : query.eq('ticket_no', ticketId);
  const ticket = await must(
    query.maybeSingle(),
    'load ticket',
  );
  if (!ticket) throw new Error(`Ticket not found: ${ticketId}`);
  const [hospital, assignee] = await Promise.all([
    ticket.client_id
      ? must(client.from('hospital_clients').select('id,client_code,client_name').eq('id', ticket.client_id).maybeSingle(), 'load hospital')
      : null,
    ticket.current_assignee_user_id
      ? must(client.from('hospital_ticket_users').select('id,display_name,role_code,profile_type,is_active').eq('id', ticket.current_assignee_user_id).maybeSingle(), 'load assignee')
      : null,
  ]);
  ticket.client = hospital || null;
  ticket.assignee = assignee || null;
  return ticket;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());
}

async function loadSlaMatrix(client, priority) {
  const result = await client
    .from('hospital_ticket_sla_matrix')
    .select('priority,escalation_level,owner_role,owner_label,sla_minutes,is_final_level,is_active')
    .eq('priority', effectivePriority(priority))
    .eq('is_active', true)
    .order('escalation_level');
  if (result.error && result.error.code !== '42501') {
    result.error.message = `load SLA matrix: ${result.error.message}`;
    throw result.error;
  }
  if (result.error?.code === '42501') {
    return loadSlaMatrixFromRpc(client, priority);
  }
  const rows = result.data;
  if (!rows?.length) throw new Error(`No SLA matrix found for priority ${effectivePriority(priority)}.`);
  return rows;
}

async function loadSlaMatrixFromRpc(client, priority) {
  const rows = [];
  for (const level of [1, 2, 3, 4]) {
    const minutes = await must(
      client.rpc('hospital_ticket_sla_minutes', {
        p_priority: priority,
        p_level: level,
      }),
      `load SLA minutes for level ${level}`,
    );
    rows.push({
      priority: effectivePriority(priority),
      escalation_level: level,
      owner_role: ESCALATION_ROLE_BY_LEVEL[level],
      owner_label: roleLabel(ESCALATION_ROLE_BY_LEVEL[level]),
      sla_minutes: Number(minutes),
      is_final_level: level === 4,
      is_active: true,
      source: 'hospital_ticket_sla_minutes_rpc',
    });
  }
  return rows;
}

function roleLabel(role) {
  return {
    housekeeping_supervisor: 'Supervisor',
    operations_executive: 'Operations Executive',
    facility_manager: 'Facility Manager',
    project_head: 'Project Head',
  }[role] || role;
}

async function loadRecipients(client, clientId) {
  const rows = await must(
    client
      .from('hospital_ticket_users')
      .select('id,display_name,role_code,profile_type,is_active,created_at')
      .eq('client_id', clientId)
      .eq('profile_type', 'internal')
      .in('role_code', Object.values(ESCALATION_ROLE_BY_LEVEL))
      .eq('is_active', true)
      .order('created_at'),
    'load escalation recipients',
  );
  return rows || [];
}

async function loadVerification(client, ticketId, sinceIso) {
  const [ticket, notifications, history, deliveries, events] = await Promise.all([
    loadTicket(client, ticketId),
    must(
      client
        .from('hospital_ticket_notifications')
        .select('id,notification_type,ticket_id,recipient_user_id,recipient_client_contact_id,dedupe_key,created_at,read_at,read_status,delivery_status,action_status,action_expires_at,current_owner_role,escalation_level,metadata')
        .eq('ticket_id', ticketId)
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false }),
      'load notifications',
    ),
    must(
      client
        .from('hospital_ticket_assignment_history')
        .select('id,ticket_id,from_user_id,to_user_id,assignment_type,reason,source,previous_status,resulting_status,assigned_at,metadata')
        .eq('ticket_id', ticketId)
        .gte('created_at', sinceIso)
        .order('assigned_at', { ascending: false }),
      'load assignment history',
    ),
    must(
      client
        .from('hospital_ticket_push_deliveries')
        .select('id,notification_id,ticket_id,device_id,app_scope,status,attempt_count,sent_at,error_code,created_at')
        .eq('ticket_id', ticketId)
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false }),
      'load push deliveries',
    ),
    must(
      client
        .from('hospital_ticket_events')
        .select('id,ticket_id,event_type,from_status,to_status,actor_role,remarks,event_data,created_at')
        .eq('ticket_id', ticketId)
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false }),
      'load events',
    ),
  ]);
  return { ticket, notifications: notifications || [], history: history || [], deliveries: deliveries || [], events: events || [] };
}

function snapshotTicket(ticket) {
  return Object.fromEntries(TICKET_RESTORE_COLUMNS.map((column) => [column, ticket[column] ?? null]));
}

function effectivePriority(priority) {
  const value = String(priority || 'medium').toLowerCase();
  if (value === 'high') return 'critical';
  if (['critical', 'medium', 'low'].includes(value)) return value;
  return 'medium';
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60000).toISOString();
}

function ownerForLevel(recipients, level) {
  const role = ESCALATION_ROLE_BY_LEVEL[level];
  return recipients.find((recipient) => recipient.role_code === role) || null;
}

function matrixMinutes(matrix, level) {
  return Number(matrix.find((row) => Number(row.escalation_level) === Number(level))?.sla_minutes || 0);
}

function acceptanceWindowMinutes() {
  return 2;
}

function pass(message) {
  console.log(`PASS - ${message}`);
}

function fail(message, expected, actual, reason = '') {
  console.log(`FAIL - ${message}`);
  console.log(`Expected: ${expected}`);
  console.log(`Actual: ${actual}`);
  if (reason) console.log(`Reason: ${reason}`);
}

function assertCheck(condition, message, expected, actual, reason) {
  if (condition) {
    pass(message);
    return true;
  }
  fail(message, expected, actual, reason);
  return false;
}

function printTicketSummary(ticket, matrix) {
  const now = Date.now();
  const age = ticket.raised_at ? Math.max(0, Math.round((now - new Date(ticket.raised_at).getTime()) / 60000)) : null;
  console.log('Hospital Ticket Escalation Test');
  console.log('--------------------------------');
  console.log(`Ticket ID: ${ticket.id}`);
  console.log(`Ticket No: ${ticket.ticket_no}`);
  console.log(`Hospital: ${ticket.client?.client_name || ticket.client_id}`);
  console.log(`Current Status: ${ticket.status_code}`);
  console.log(`Created At: ${ticket.raised_at}`);
  console.log(`Current Age: ${age === null ? 'unknown' : `${age} minutes`}`);
  console.log(`Current Escalation Level: ${ticket.current_escalation_level_no} (${ticket.current_escalation_level})`);
  console.log(`Current Assigned User: ${ticket.current_assignee_user_id || 'unassigned'}`);
  console.log(`Current Assigned Role: ${ticket.current_assignee_role || 'unassigned'}`);
  console.log('');
  console.log('Configured SLA Matrix:');
  for (const row of matrix) {
    console.log(`Level ${row.escalation_level}: ${row.owner_label} (${row.owner_role}) - ${row.sla_minutes} minutes${row.is_final_level ? ' FINAL' : ''}`);
  }
  console.log(`Acceptance Window: ${acceptanceWindowMinutes()} minutes per escalation owner`);
  console.log('');
}

function printRecords(verification) {
  const ticket = verification.ticket;
  console.log('Ticket');
  console.table([{
    ticket_id: ticket.id,
    ticket_no: ticket.ticket_no,
    status: ticket.status_code,
    escalation_level: ticket.current_escalation_level_no,
    assigned_to: ticket.current_assignee_user_id,
    assigned_role: ticket.current_assignee_role,
    updated_at: ticket.updated_at,
    reopen_count: ticket.reopen_count,
    acceptance_status: ticket.acceptance_status,
    acceptance_due_at: ticket.acceptance_due_at,
    escalation_due_at: ticket.escalation_due_at,
  }]);
  console.log('Notifications');
  console.table(verification.notifications.map((row) => ({
    notification_type: row.notification_type,
    ticket_id: row.ticket_id,
    recipient_user_id: row.recipient_user_id || row.recipient_client_contact_id,
    dedupe_key: row.dedupe_key,
    created_at: row.created_at,
    read_status: row.read_status === true || row.read_at ? 'read' : 'unread',
    action_status: row.action_status,
  })));
  console.log('Escalation History');
  console.table(verification.history.map((row) => ({
    assignment_type: row.assignment_type,
    from_user_id: row.from_user_id,
    to_user_id: row.to_user_id,
    source: row.source,
    reason: row.reason,
    assigned_at: row.assigned_at,
  })));
  console.log('Audit Events');
  console.table(verification.events.map((row) => ({
    event_type: row.event_type,
    from_status: row.from_status,
    to_status: row.to_status,
    actor_role: row.actor_role,
    created_at: row.created_at,
  })));
  console.log('Push Deliveries');
  console.table(verification.deliveries.map((row) => ({
    notification_id: row.notification_id,
    app_scope: row.app_scope,
    status: row.status,
    attempt_count: row.attempt_count,
    sent_at: row.sent_at,
    error_code: row.error_code,
  })));
}

async function simulateAge(client, ticket, matrix, ageMinutes, now) {
  const level = levelForTicket(ticket);
  const raisedAt = new Date(now.getTime() - ageMinutes * 60000);
  const isAwaitingAcceptance = ticket.acceptance_status === 'awaiting'
    || ticket.status_code === 'awaiting_supervisor_acceptance'
    || ticket.status_code.startsWith('escalated_');
  const dueAt = isAwaitingAcceptance
    ? addMinutes(raisedAt, acceptanceWindowMinutes())
    : addMinutes(raisedAt, matrixMinutes(matrix, level) || acceptanceWindowMinutes());
  const patch = {
    raised_at: raisedAt.toISOString(),
    assigned_at: raisedAt.toISOString(),
    updated_at: now.toISOString(),
    metadata: {
      ...(ticket.metadata || {}),
      hospital_escalation_test: {
        simulated_age_minutes: ageMinutes,
        simulated_at: now.toISOString(),
        original_status: ticket.status_code,
      },
    },
  };
  if (isAwaitingAcceptance) {
    patch.acceptance_status = 'awaiting';
    patch.acceptance_due_at = dueAt;
    patch.escalation_due_at = dueAt;
  } else {
    if (level === 1) patch.supervisor_sla_due_at = dueAt;
    if (level === 2) patch.operations_sla_due_at = dueAt;
    if (level === 4) patch.project_head_sla_due_at = dueAt;
    patch.escalation_due_at = dueAt;
  }
  await must(client.from('hospital_tickets').update(patch).eq('id', ticket.id), 'simulate ticket age');
  return dueAt;
}

async function setTicketForAcceptanceLevel(client, originalTicket, level, now, matrix) {
  const dueAt = addMinutes(now, -1);
  const status = ESCALATION_STATUS_BY_LEVEL[level];
  const role = level === 1 ? null : ESCALATION_ROLE_BY_LEVEL[level];
  const slaDue = addMinutes(now, -(matrixMinutes(matrix, level) || acceptanceWindowMinutes()));
  const patch = {
    status_code: status,
    current_escalation_level: level === 1 ? 'supervisor' : role,
    current_escalation_level_no: level,
    current_assignee_user_id: level === 1 ? null : originalTicket.current_assignee_user_id,
    current_assignee_role: role,
    acceptance_status: 'awaiting',
    acceptance_due_at: dueAt,
    acceptance_timeout_at: null,
    escalation_due_at: dueAt,
    final_escalation: false,
    sla_status: 'running',
    raised_at: slaDue,
    assigned_at: slaDue,
    updated_at: now.toISOString(),
    metadata: {
      ...(originalTicket.metadata || {}),
      hospital_escalation_test: {
        level,
        simulated_at: now.toISOString(),
      },
    },
  };
  await must(client.from('hospital_tickets').update(patch).eq('id', originalTicket.id), `prepare level ${level}`);
}

async function runWorkerAndPush(client, args, now) {
  const result = await runHospitalSlaWorker(client, { now });
  let push = { skipped: true };
  if (!args.skipPush) push = await dispatchHospitalNotificationPushes(client, { now });
  return { result, push };
}

async function testOneLevel(client, args, ticketId, level, matrix, recipients, sinceIso) {
  const now = new Date();
  const expectedLevel = level + 1;
  const expectedOwner = ownerForLevel(recipients, expectedLevel);
  console.log('');
  console.log(`LEVEL ${level} TEST`);
  console.log(`Simulated ${ESCALATION_ROLE_BY_LEVEL[level]} acceptance overdue at: ${addMinutes(now, -1)}`);
  if (!expectedOwner) {
    fail(`Level ${expectedLevel} recipient resolved`, ESCALATION_ROLE_BY_LEVEL[expectedLevel], 'missing active user');
    return false;
  }
  const before = await loadVerification(client, ticketId, sinceIso);
  const { result, push } = await runWorkerAndPush(client, args, now);
  const after = await loadVerification(client, ticketId, sinceIso);
  const notification = after.notifications.find((row) =>
    Number(row.escalation_level) === expectedLevel &&
    row.recipient_user_id === expectedOwner.id &&
    ['sla_escalation', 'supervisor_acceptance_timeout'].includes(row.notification_type)
  );
  const history = after.history.find((row) => row.to_user_id === expectedOwner.id);
  let ok = true;
  ok = assertCheck((result?.acceptance_timeouts || result?.supervisor_acceptance_timeouts || 0) >= 1, 'Escalation condition detected', 'worker timeout count >= 1', JSON.stringify(result)) && ok;
  ok = assertCheck(after.ticket.current_escalation_level_no === expectedLevel, `Escalated to Level ${expectedLevel}`, expectedLevel, after.ticket.current_escalation_level_no) && ok;
  ok = assertCheck(after.ticket.current_assignee_user_id === expectedOwner.id, 'Correct recipient resolved', expectedOwner.id, after.ticket.current_assignee_user_id) && ok;
  ok = assertCheck(Boolean(notification), 'Database notification created', `notification for ${expectedOwner.id}`, 'missing') && ok;
  ok = assertCheck(Boolean(notification?.dedupe_key), 'Notification dedupe key generated', 'non-empty dedupe_key', notification?.dedupe_key || 'empty') && ok;
  ok = assertCheck(Boolean(after.ticket.last_escalated_at), 'Escalation timestamp stored', 'last_escalated_at set', after.ticket.last_escalated_at || 'null') && ok;
  ok = assertCheck(Boolean(history), 'Escalation history stored', `history to ${expectedOwner.id}`, 'missing') && ok;
  console.log('Running same escalation processor again without changing simulated time...');
  const duplicateBefore = await loadVerification(client, ticketId, sinceIso);
  await runWorkerAndPush(client, args, now);
  const duplicateAfter = await loadVerification(client, ticketId, sinceIso);
  const sameLevelNotificationsBefore = duplicateBefore.notifications.filter((row) => row.dedupe_key === notification?.dedupe_key).length;
  const sameLevelNotificationsAfter = duplicateAfter.notifications.filter((row) => row.dedupe_key === notification?.dedupe_key).length;
  ok = assertCheck(duplicateAfter.ticket.current_escalation_level_no === after.ticket.current_escalation_level_no, 'No duplicate escalation generated', after.ticket.current_escalation_level_no, duplicateAfter.ticket.current_escalation_level_no) && ok;
  ok = assertCheck(sameLevelNotificationsAfter === sameLevelNotificationsBefore, 'No duplicate notification generated', sameLevelNotificationsBefore, sameLevelNotificationsAfter) && ok;
  console.log('Escalation Engine: PASS');
  console.log(`Database Notification: ${notification ? 'PASS' : 'FAIL'}`);
  console.log(`Push Dispatch: ${push?.failed ? 'FAIL' : args.skipPush ? 'SKIPPED' : 'PASS'}`);
  console.log('Physical Device Delivery: NOT TESTED');
  printRecords(after);
  return ok;
}

async function runStopScenario(client, args, originalTicket, scenario, sinceIso) {
  const now = new Date();
  const dueAt = scenario.due === 'future' ? addMinutes(now, 10) : addMinutes(now, -10);
  await must(client.from('hospital_tickets').update({
    status_code: scenario.status_code,
    acceptance_status: scenario.acceptance_status,
    acceptance_due_at: dueAt,
    escalation_due_at: dueAt,
    supervisor_sla_due_at: dueAt,
    operations_sla_due_at: dueAt,
    project_head_sla_due_at: dueAt,
    final_escalation: false,
    current_escalation_level_no: 1,
    current_escalation_level: 'supervisor',
    current_assignee_user_id: originalTicket.supervisor_user_id || originalTicket.current_assignee_user_id,
    current_assignee_role: 'housekeeping_supervisor',
    updated_at: now.toISOString(),
  }).eq('id', originalTicket.id), `prepare stop scenario ${scenario.name}`);
  const before = await loadTicket(client, originalTicket.id);
  await runWorkerAndPush(client, args, now);
  const after = await loadVerification(client, originalTicket.id, sinceIso);
  const unchanged = after.ticket.status_code === before.status_code
    && after.ticket.current_escalation_level_no === before.current_escalation_level_no;
  assertCheck(unchanged, `${scenario.name} ignored by escalation engine`, `${before.status_code} level ${before.current_escalation_level_no}`, `${after.ticket.status_code} level ${after.ticket.current_escalation_level_no}`);
  return unchanged;
}

async function restoreSideEffects(client, ticketId, sinceIso) {
  const notifications = await must(
    client.from('hospital_ticket_notifications').select('id').eq('ticket_id', ticketId).gte('created_at', sinceIso),
    'load generated notifications for cleanup',
  );
  const notificationIds = (notifications || []).map((row) => row.id);
  if (notificationIds.length) {
    await must(client.from('hospital_ticket_push_deliveries').delete().in('notification_id', notificationIds), 'delete generated push deliveries');
    await must(client.from('hospital_ticket_notifications').delete().in('id', notificationIds), 'delete generated notifications');
  }
  await must(
    client.from('hospital_ticket_assignment_history').delete().eq('ticket_id', ticketId).gte('created_at', sinceIso),
    'delete generated assignment history',
  );
}

async function restoreTicket(client, ticketId, snapshot, sinceIso, restoreSideEffectRows) {
  if (restoreSideEffectRows) await restoreSideEffects(client, ticketId, sinceIso);
  await must(client.from('hospital_tickets').update(snapshot).eq('id', ticketId), 'restore ticket snapshot');
}

async function runSingleAge(client, args, ticket, matrix, sinceIso) {
  const now = new Date();
  const dueAt = await simulateAge(client, ticket, matrix, args.age, now);
  console.log(`Simulated ticket age: ${args.age} minutes`);
  console.log(`Simulated due at: ${dueAt}`);
  const before = await loadVerification(client, ticket.id, sinceIso);
  const { result, push } = await runWorkerAndPush(client, args, now);
  const after = await loadVerification(client, ticket.id, sinceIso);
  const escalated = after.ticket.current_escalation_level_no > before.ticket.current_escalation_level_no
    || after.ticket.status_code !== before.ticket.status_code;
  assertCheck(escalated, 'Escalation processor outcome changed ticket when eligible', 'ticket escalated/updated', `${before.ticket.status_code}/${before.ticket.current_escalation_level_no} -> ${after.ticket.status_code}/${after.ticket.current_escalation_level_no}`);
  console.log(`Worker result: ${JSON.stringify(result)}`);
  console.log(`Push Dispatch: ${push?.failed ? 'FAIL' : args.skipPush ? 'SKIPPED' : 'PASS'}`);
  console.log('Physical Device Delivery: NOT TESTED');
  printRecords(after);
}

async function main() {
  const args = parseArgs();
  if (args.help || !args.ticket || (!args.full && !Number.isFinite(args.age))) {
    printUsage();
    process.exit(args.help ? 0 : 1);
  }
  requireNonProduction();
  const client = createServiceClient();
  const startedAt = new Date(Date.now() - 1000).toISOString();
  const ticket = await loadTicket(client, args.ticket);
  if (!isClearlyTestTicket(ticket) && !args.allowLiveTicket) {
    throw new Error(`Refusing to mutate ticket ${ticket.ticket_no || ticket.id} because it is not clearly marked TEST/UAT/PILOT/DEMO/SANDBOX. Use a test ticket or pass --allow-live-ticket deliberately.`);
  }
  const snapshot = snapshotTicket(ticket);
  const matrix = await loadSlaMatrix(client, ticket.priority);
  const recipients = await loadRecipients(client, ticket.client_id);
  printTicketSummary(ticket, matrix);

  let passed = 0;
  let total = 0;
  try {
    if (args.full) {
      console.log('=================================================');
      console.log('HOSPITAL TICKET ESCALATION MATRIX TEST');
      console.log('=================================================');
      pass('Ticket found');
      pass(`Ticket status inspected: ${ticket.status_code}`);
      pass('SLA configuration found');
      for (const level of [1, 2, 3]) {
        await setTicketForAcceptanceLevel(client, ticket, level, new Date(), matrix);
        total += 1;
        if (await testOneLevel(client, args, ticket.id, level, matrix, recipients, startedAt)) passed += 1;
      }
      console.log('');
      console.log('STOP-ESCALATION TESTS');
      for (const scenario of NON_ESCALATING_STATUS_SCENARIOS) {
        total += 1;
        if (await runStopScenario(client, args, ticket, scenario, startedAt)) passed += 1;
      }
      console.log('=================================================');
      console.log(`FINAL RESULT: ${passed === total ? 'PASS' : 'FAIL'}`);
      console.log(`${passed} / ${total} scenarios working`);
      console.log('=================================================');
    } else {
      await runSingleAge(client, args, ticket, matrix, startedAt);
    }
  } finally {
    if (args.restore) {
      await restoreTicket(client, ticket.id, snapshot, startedAt, true);
      console.log('');
      console.log('Restore: mutable ticket fields, generated notifications, push deliveries, and assignment history restored/removed.');
      console.log('Audit note: hospital_ticket_events is append-only by design, so generated audit events remain.');
    } else {
      console.log('Restore skipped because --no-restore was provided.');
    }
  }
}

function isNodeTestRunner() {
  return process.execArgv.includes('--test') || Boolean(process.env.NODE_TEST_CONTEXT);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href && !isNodeTestRunner()) {
  main().catch((error) => {
    console.error('FAIL');
    console.error(error);
    process.exitCode = 1;
  });
}
