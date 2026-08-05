import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(
  new URL('../../supabase/migrations_2_0/047_public_cleanliness_feedback_ticket_workflow.sql', import.meta.url),
  'utf8',
);

test('migration 047 supports clean survey and not clean ticket linkage', () => {
  assert.match(sql, /cleanliness_status[\s\S]*in \('clean', 'not_clean'\)/i);
  assert.match(sql, /ticket_creation_status[\s\S]*in \('pending', 'not_required', 'created', 'failed'\)/i);
  assert.match(sql, /linked_ticket_id uuid references public\.hospital_tickets\(id\) on delete set null/i);
  assert.match(sql, /linked_public_feedback_submission_id uuid references public\.hospital_feedback_submissions\(id\) on delete set null/i);
  assert.match(sql, /ux_hospital_tickets_public_feedback_submission/i);
  assert.match(sql, /idempotency_key/i);
});

test('migration 047 creates unassigned public complaint tickets without fake supervisor assignment', () => {
  assert.match(sql, /if v_supervisor_count = 0 then[\s\S]*status_code = 'open'/i);
  assert.match(sql, /if v_supervisor_count = 0 then[\s\S]*current_assignee_user_id = null/i);
  assert.match(sql, /if v_supervisor_count = 0 then[\s\S]*current_assignee_role = null/i);
  assert.match(sql, /if v_supervisor_count = 0 then[\s\S]*'assignment_state','assignment_required'/i);
  assert.match(sql, /if v_supervisor_count = 0 then[\s\S]*'role_based_escalation','under_configuration'/i);
  assert.doesNotMatch(sql, /perform public\.hospital_ticket_direct_to_operations\(v_ticket\.id, 'no_on_duty_supervisor'/i);
});

test('migration 047 does not start SLA escalation for unassigned demo tickets', () => {
  assert.match(sql, /if v_supervisor_count = 0 then[\s\S]*supervisor_sla_due_at = null/i);
  assert.match(sql, /if v_supervisor_count = 0 then[\s\S]*operations_sla_due_at = null/i);
  assert.match(sql, /if v_supervisor_count = 0 then[\s\S]*project_head_sla_due_at = null/i);
  assert.match(sql, /if v_supervisor_count = 0 then[\s\S]*dean_sla_due_at = null/i);
  assert.match(sql, /if v_supervisor_count = 0 then[\s\S]*escalation_due_at = null/i);
  assert.match(sql, /if v_supervisor_count = 0 then[\s\S]*acceptance_due_at = null/i);
  assert.match(sql, /if v_supervisor_count = 0 then[\s\S]*sla_status = 'not_applicable'/i);
  assert.match(sql, /if v_supervisor_count = 0 then[\s\S]*escalation_status = 'not_started'/i);
});

test('migration 047 keeps mapped supervisor notification workflow compatible', () => {
  assert.match(sql, /from public\.hospital_ticket_on_duty_supervisors\(v_location\.client_id, v_location\.block_id, v_location\.id\) u/i);
  assert.match(sql, /notification_type[\s\S]*'incoming_supervisor_ticket'/i);
  assert.match(sql, /else[\s\S]*'supervisor_broadcast_created'/i);
  assert.match(sql, /public\.rpc_process_hospital_ticket_sla_day2_only/i);
});
