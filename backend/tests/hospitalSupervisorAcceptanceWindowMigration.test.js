import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const migration057 = readFileSync(
  new URL('../../supabase/migrations_2_0/057_hospital_supervisor_acceptance_20_minutes.sql', import.meta.url),
  'utf8',
);
const migration061 = readFileSync(
  new URL('../../supabase/migrations_2_0/061_hospital_escalation_acceptance_sla_2_minutes.sql', import.meta.url),
  'utf8',
);
const migration042 = readFileSync(
  new URL('../../supabase/migrations_2_0/042_hospital_ticket_supervisor_self_assignment.sql', import.meta.url),
  'utf8',
);
const mobileModels = readFileSync(
  new URL('../../Mobile_FO_V2/lib/hospital_housekeeping/hospital_models.dart', import.meta.url),
  'utf8',
);
const mobilePush = readFileSync(
  new URL('../../Mobile_FO_V2/lib/hospital_housekeeping/hospital_push_service.dart', import.meta.url),
  'utf8',
);

test('migration 057 previously changed contact-created supervisor acceptance window to 20 minutes', () => {
  assert.match(migration057, /create or replace function public\.rpc_create_hospital_contact_ticket/);
  assert.match(migration057, /v_acceptance_due_at := now\(\) \+ public\.hospital_supervisor_acceptance_window\(\)/);
  assert.match(migration057, /select interval '20 minutes'/);
  assert.match(migration057, /'acceptance_window_seconds', 1200/);
  assert.doesNotMatch(migration057, /interval '2 minutes'/);
  assert.doesNotMatch(migration057, /'acceptance_window_seconds',\s*120\b/);
});

test('migration 061 is the current two-minute acceptance override for every escalation level', () => {
  assert.match(migration061, /create or replace function public\.hospital_supervisor_acceptance_window\(\)/);
  assert.match(migration061, /create or replace function public\.hospital_escalation_acceptance_window\(\)/);
  assert.match(migration061, /select interval '2 minutes'/);
  assert.match(migration061, /acceptance_sla_minutes',2/);
  assert.match(migration061, /rpc_accept_hospital_escalation_ticket/);
  assert.match(migration061, /project_head_acceptance_overdue/);
  assert.doesNotMatch(migration061, /select interval '20 minutes'/);
});

test('migration 057 keeps broadcast semantics and notification expiry aligned', () => {
  assert.match(migration057, /'awaiting_supervisor_acceptance', null, null,\s*null, null, v_supervisor_due_at/);
  assert.match(migration057, /'awaiting', v_acceptance_due_at, now\(\)/);
  assert.match(migration057, /from public\.hospital_ticket_on_duty_supervisors\(v_contact\.client_id, p_block_id, p_location_id\) u/i);
  assert.match(migration057, /'incoming_supervisor_ticket'/);
  assert.match(migration057, /'active',\s*v_acceptance_due_at/);
  assert.match(migration057, /'acceptance_due_at', v_acceptance_due_at/);
  assert.match(migration057, /get diagnostics v_supervisor_count = row_count/);
});

test('scheduler timeout processing remains deadline driven', () => {
  const slaFunction = migration042.slice(
    migration042.indexOf('create or replace function public.rpc_process_hospital_ticket_sla'),
    migration042.indexOf('-- Preserve Day 2 worker body'),
  );
  assert.match(slaFunction, /acceptance_due_at <= p_now/);
  assert.match(slaFunction, /perform public\.hospital_ticket_direct_to_operations\(v_ticket\.id, 'supervisor_acceptance_timeout', p_now\)/);
  assert.doesNotMatch(slaFunction, /created_at\s*\+\s*interval '2 minutes'/);
});

test('latest timeout copy and default awaiting trigger reference 2 minutes', () => {
  assert.match(migration057, /new\.acceptance_due_at := coalesce\(new\.acceptance_due_at, now\(\)\+public\.hospital_supervisor_acceptance_window\(\)\)/);
  assert.match(migration061, /requires ' \|\| public\.hospital_ticket_role_label\(v_next_role\) \|\| ' acceptance within 2 minutes\./);
  assert.match(migration061, /Escalated to ' \|\| public\.hospital_ticket_role_label\(v_next_role\) \|\| ' for 2-minute acceptance\./);
});

test('mobile acceptance countdown uses backend deadline fields', () => {
  assert.match(mobileModels, /row\['acceptance_due_at'\]/);
  assert.match(mobilePush, /data\['acceptance_due_at'\]/);
  assert.match(mobilePush, /acceptanceDueAt/);
  assert.match(mobilePush, /timeoutAfter: incoming \? _remainingMs\(push\) : null/);
  assert.doesNotMatch(mobileModels, /Duration\(seconds:\s*120\)/);
  assert.doesNotMatch(mobilePush, /Duration\(seconds:\s*120\)/);
  assert.doesNotMatch(mobilePush, /Accept within 2 minutes/);
});
