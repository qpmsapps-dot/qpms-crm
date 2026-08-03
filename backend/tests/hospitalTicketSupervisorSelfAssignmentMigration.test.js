import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(new URL('../../supabase/migrations_2_0/042_hospital_ticket_supervisor_self_assignment.sql', import.meta.url), 'utf8');

test('Day 3 migration adds CUG identity and duty status to hospital ticket users', () => {
  assert.match(sql, /add column if not exists cug_number text/);
  assert.match(sql, /ux_hospital_ticket_users_cug_number/);
  assert.match(sql, /duty_status text not null default 'off_duty'/);
  assert.match(sql, /check \(duty_status in \('on_duty','off_duty'\)\)/);
  assert.match(sql, /rpc_set_hospital_supervisor_duty/);
  assert.match(sql, /role_code <> 'housekeeping_supervisor'/);
});

test('Day 3 migration adds awaiting acceptance status and two-minute deadline', () => {
  assert.match(sql, /'awaiting_supervisor_acceptance'/);
  assert.match(sql, /acceptance_status text not null default 'not_required'/);
  assert.match(sql, /acceptance_due_at timestamptz/);
  assert.match(sql, /v_acceptance_due_at := now\(\) \+ interval '2 minutes'/);
  assert.match(sql, /supervisor_sla_due_at[\s\S]*public\.hospital_ticket_sla_minutes\(p_priority, 1\)/);
  assert.match(sql, /new\.status_code='awaiting_supervisor_acceptance'[\s\S]*new\.supervisor_sla_due_at := coalesce/);
});

test('Day 3 ticket creation broadcasts to On-Duty Supervisors without assigning owner', () => {
  assert.match(sql, /hospital_ticket_on_duty_supervisors/);
  assert.match(sql, /notification_type, title, body[\s\S]*'incoming_supervisor_ticket'/);
  assert.match(sql, /current_owner_role[\s\S]*'housekeeping_supervisor'/);
  assert.match(sql, /current_assignee_user_id/);
  assert.match(sql, /status_code[\s\S]*'awaiting_supervisor_acceptance'/);
  assert.doesNotMatch(sql, /hospital_select_ticket_supervisor\(v_actor\.client_id/);
});

test('Day 3 no-On-Duty and timeout paths route to Operations with fresh priority SLA', () => {
  assert.match(sql, /hospital_ticket_direct_to_operations/);
  assert.match(sql, /no_on_duty_supervisor/);
  assert.match(sql, /supervisor_acceptance_timeout/);
  assert.match(sql, /operations_sla_due_at = case when v_oe\.id is null then null else v_due end/);
  assert.match(sql, /v_due := p_now \+ make_interval\(mins => public\.hospital_ticket_sla_minutes\(v_ticket\.priority, 2\)\)/);
});

test('Day 3 supervisor acceptance is transaction-safe and single-owner', () => {
  assert.match(sql, /rpc_accept_hospital_supervisor_ticket/);
  assert.match(sql, /where id=p_ticket_id[\s\S]*for update/);
  assert.match(sql, /and current_assignee_user_id is null/);
  assert.match(sql, /This ticket has already been accepted by/);
  assert.match(sql, /p_confirmed_location is not true/);
  assert.match(sql, /v_actor\.duty_status <> 'on_duty'/);
  assert.match(sql, /supervisor_self_accepted/);
  assert.match(sql, /accepted_by_user_id=v_actor\.id/);
  assert.match(sql, /old\.status_code = 'awaiting_supervisor_acceptance'[\s\S]*new\.acceptance_status = 'accepted'[\s\S]*new\.escalation_due_at := coalesce\(new\.escalation_due_at, new\.supervisor_sla_due_at\)/);
});

test('Day 3 preserves Day 2 matrix escalation and avoids unrelated modules', () => {
  assert.match(sql, /rpc_process_hospital_ticket_sla_day2_only/);
  assert.match(sql, /where status_code not in \('awaiting_supervisor_acceptance','resolved_awaiting_confirmation','closed','cancelled'\)/);
  assert.match(sql, /v_next_level := v_level \+ 1/);
  assert.doesNotMatch(sql, /public\.fo_/i);
  assert.doesNotMatch(sql, /fault_tracker/i);
  assert.doesNotMatch(sql, /deep_cleaning/i);
  assert.doesNotMatch(sql, /reliance/i);
});
