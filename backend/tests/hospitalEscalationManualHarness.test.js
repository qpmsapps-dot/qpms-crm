import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  ESCALATION_ROLE_BY_LEVEL,
  ESCALATION_STATUS_BY_LEVEL,
  NON_ESCALATING_STATUS_SCENARIOS,
  isClearlyTestTicket,
  levelForTicket,
  parseArgs,
} from '../scripts/test-hospital-escalation.js';

const harness = readFileSync(
  new URL('../scripts/test-hospital-escalation.js', import.meta.url),
  'utf8',
);
const slaService = readFileSync(
  new URL('../services/hospitalTicketSlaService.js', import.meta.url),
  'utf8',
);
const migration061 = readFileSync(
  new URL('../../supabase/migrations_2_0/061_hospital_escalation_acceptance_sla_2_minutes.sql', import.meta.url),
  'utf8',
);
const migration051 = readFileSync(
  new URL('../../supabase/migrations_2_0/051_hospital_notification_reliability_hardening.sql', import.meta.url),
  'utf8',
);
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('manual escalation harness parses requested terminal options', () => {
  assert.deepEqual(parseArgs(['--ticket=abc', '--age=21']), {
    ticket: 'abc',
    age: 21,
    full: false,
    restore: true,
    allowLiveTicket: false,
    skipPush: false,
  });
  assert.equal(parseArgs(['--ticket=abc', '--full', '--no-restore', '--skip-push']).full, true);
  assert.equal(parseArgs(['--ticket=abc', '--allow-live-ticket']).allowLiveTicket, true);
});

test('manual escalation harness accepts ticket numbers as well as UUIDs', () => {
  assert.match(harness, /isUuid\(ticketId\) \? query\.eq\('id', ticketId\) : query\.eq\('ticket_no', ticketId\)/);
});

test('manual escalation harness is backend-only and reuses production SLA worker', () => {
  assert.equal(packageJson.scripts['hospital:test-escalation'], 'node scripts/test-hospital-escalation.js');
  assert.match(harness, /runHospitalSlaWorker\(client,\s*\{\s*now\s*\}\)/);
  assert.match(slaService, /client\.rpc\('rpc_process_hospital_ticket_sla'/);
  assert.match(harness, /client\.rpc\('hospital_ticket_sla_minutes'/);
  assert.match(harness, /dispatchHospitalNotificationPushes\(client/);
  assert.doesNotMatch(harness, /express\(\)/);
  assert.doesNotMatch(harness, /app\.(get|post|put|delete|patch)\(/);
});

test('manual escalation harness refuses production and ambiguous live tickets by default', () => {
  assert.match(harness, /NODE_ENV=production/);
  assert.match(harness, /Refusing to run hospital escalation test harness/);
  assert.equal(isClearlyTestTicket({ ticket_no: 'QPMS-HK-2026-000123', title: 'Real complaint' }), false);
  assert.equal(isClearlyTestTicket({ ticket_no: 'TEST-HK-1', title: 'Escalation UAT' }), true);
  assert.equal(isClearlyTestTicket({ client: { client_code: 'QPMS_HOSPITAL_PILOT' } }), true);
});

test('manual harness snapshots and restores mutable ticket state without weakening auth', () => {
  for (const column of [
    'raised_at',
    'accepted_at',
    'work_started_at',
    'supervisor_sla_due_at',
    'operations_sla_due_at',
    'project_head_sla_due_at',
    'acceptance_due_at',
    'current_escalation_level_no',
    'current_assignee_user_id',
    'reopen_count',
  ]) {
    assert.match(harness, new RegExp(`'${column}'`));
  }
  assert.match(harness, /restoreTicket/);
  assert.match(harness, /hospital_ticket_events is append-only/);
  assert.match(harness, /isNodeTestRunner/);
  assert.doesNotMatch(harness, /SUPABASE_ANON_KEY/);
  assert.doesNotMatch(harness, /requireSupabaseJwt\s*=/);
});

test('manual harness covers requested pass/fail verification surfaces', () => {
  for (const phrase of [
    'Correct recipient resolved',
    'Database notification created',
    'Notification dedupe key generated',
    'Escalation timestamp stored',
    'No duplicate escalation generated',
    'No duplicate notification generated',
    'Escalation Engine: PASS',
    'Physical Device Delivery: NOT TESTED',
  ]) {
    assert.match(harness, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('manual harness stop scenarios match current eligible status behavior', () => {
  assert.deepEqual(NON_ESCALATING_STATUS_SCENARIOS.map((scenario) => scenario.status_code), [
    'accepted',
    'in_progress',
    'resolved_awaiting_confirmation',
    'closed',
    'cancelled',
  ]);
  assert.match(migration061, /where status_code not in \('awaiting_supervisor_acceptance','resolved_awaiting_confirmation','closed','cancelled'\)/);
  assert.match(migration061, /coalesce\(acceptance_status,'not_required'\) <> 'awaiting'/);
  assert.match(migration061, /status_code='awaiting_supervisor_acceptance'[\s\S]*acceptance_status='awaiting'/);
});

test('current matrix levels, recipients, notifications, and dedupe are contractually present', () => {
  assert.deepEqual(ESCALATION_ROLE_BY_LEVEL, {
    1: 'housekeeping_supervisor',
    2: 'operations_executive',
    3: 'facility_manager',
    4: 'project_head',
  });
  assert.deepEqual(ESCALATION_STATUS_BY_LEVEL, {
    1: 'awaiting_supervisor_acceptance',
    2: 'escalated_operations_executive',
    3: 'escalated_facility_manager',
    4: 'escalated_project_head',
  });
  assert.equal(levelForTicket({ current_assignee_role: 'facility_manager' }), 3);
  assert.match(migration061, /hospital_ticket_role_for_level\(v_next_level\)/);
  assert.match(migration061, /public\.hospital_pick_ticket_owner\(v_ticket\.client_id, v_next_role\)/);
  assert.match(migration061, /notification_type[\s\S]*'sla_escalation'/);
  assert.match(migration061, /'supervisor_acceptance_timeout'/);
  assert.match(migration051, /hospital_ticket_notifications_dedupe_key_unique unique \(dedupe_key\)/);
  assert.match(migration051, /notification_type = 'sla_escalation'[\s\S]*escalation_level/);
  assert.match(migration051, /'supervisor_acceptance_timeout'/);
});

test('reopen lifecycle/version dedupe remains covered by production notification function', () => {
  const service = readFileSync(
    new URL('../services/hospitalTicketService.js', import.meta.url),
    'utf8',
  );
  assert.match(service, /reopen_count/);
  assert.match(service, /hospitalLifecycleNotificationDedupeKey/);
  assert.match(service, /String\(Number\(cycle\) \|\| 0\)/);
  assert.match(migration051, /p_row\.metadata->>'reopen_count'/);
});
