import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(
  new URL('../../supabase/migrations_2_0/048_fix_public_cleanliness_complaint_unassigned_actor.sql', import.meta.url),
  'utf8',
);

test('migration 048 replaces the live RPC without changing its backend-facing signature', () => {
  assert.match(sql, /create or replace function public\.rpc_submit_public_cleanliness_complaint\(/i);
  for (const arg of [
    'p_qr_code_id uuid',
    'p_location_id uuid',
    'p_submission_key uuid',
    'p_language text',
    'p_respondent_name text',
    'p_respondent_mobile text',
    'p_comments text',
    "p_answers jsonb default '{}'::jsonb",
    'p_submitted_at timestamptz default now()',
  ]) {
    assert.match(sql, new RegExp(arg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  }
  assert.match(sql, /returns jsonb language plpgsql security definer set search_path=public/i);
  assert.match(sql, /grant execute on function public\.rpc_submit_public_cleanliness_complaint\(uuid,uuid,uuid,text,text,text,text,jsonb,timestamptz\) to service_role/i);
});

test('migration 048 provisions a controlled RGGH public feedback actor', () => {
  assert.match(sql, /v_actor_email text := 'public-qr-feedback\+rggh@myqpms\.local'/i);
  assert.match(sql, /insert into auth\.users/i);
  assert.match(sql, /insert into public\.hospital_ticket_users/i);
  assert.match(sql, /'client'/i);
  assert.match(sql, /'hospital_management'/i);
  assert.match(sql, /'Public QR Feedback'/i);
  assert.match(sql, /'public_feedback_system',true/i);
  assert.match(sql, /can_view,\s*can_create,\s*can_update[\s\S]*false,\s*true,\s*false/i);
});

test('migration 048 preserves idempotency, QR hierarchy validation, ticket linkage and nullable complaint rating', () => {
  assert.match(sql, /idempotency_key/i);
  assert.match(sql, /pg_advisory_xact_lock/i);
  assert.match(sql, /where submission_key = p_submission_key[\s\S]*for update/i);
  assert.match(sql, /hospital_feedback_qr_codes[\s\S]*status = 'active'/i);
  assert.match(sql, /p_respondent_mobile, null, p_language/i);
  assert.match(sql, /linked_public_feedback_submission_id/i);
  assert.match(sql, /linked_ticket_id = v_ticket\.id/i);
});

test('migration 048 creates unassigned public complaint tickets without fake supervisor assignment', () => {
  assert.match(sql, /if v_supervisor_count = 0 then[\s\S]*status_code = 'open'/i);
  assert.match(sql, /if v_supervisor_count = 0 then[\s\S]*current_escalation_level = 'supervisor'/i);
  assert.match(sql, /if v_supervisor_count = 0 then[\s\S]*current_escalation_level_no = 1/i);
  assert.match(sql, /if v_supervisor_count = 0 then[\s\S]*acceptance_status = 'not_required'/i);
  assert.match(sql, /if v_supervisor_count = 0 then[\s\S]*current_assignee_user_id = null/i);
  assert.match(sql, /if v_supervisor_count = 0 then[\s\S]*current_assignee_role = null/i);
  assert.match(sql, /if v_supervisor_count = 0 then[\s\S]*'assignment_state','assignment_required'/i);
  assert.match(sql, /if v_supervisor_count = 0 then[\s\S]*'assignment_required',true/i);
  assert.match(sql, /if v_supervisor_count = 0 then[\s\S]*'role_based_escalation','under_configuration'/i);
  assert.match(sql, /if v_supervisor_count = 0 then[\s\S]*'sla_started',false/i);
  assert.doesNotMatch(sql, /perform public\.hospital_ticket_direct_to_operations\(v_ticket\.id, 'no_on_duty_supervisor'/i);
  assert.doesNotMatch(sql, /current_escalation_level = null/i);
  assert.doesNotMatch(sql, /current_escalation_level_no = null/i);
  assert.doesNotMatch(sql, /acceptance_status = null/i);
});

test('migration 048 does not start SLA escalation for unassigned demo tickets', () => {
  assert.match(sql, /if v_supervisor_count = 0 then[\s\S]*supervisor_sla_due_at = null/i);
  assert.match(sql, /if v_supervisor_count = 0 then[\s\S]*operations_sla_due_at = null/i);
  assert.match(sql, /if v_supervisor_count = 0 then[\s\S]*project_head_sla_due_at = null/i);
  assert.match(sql, /if v_supervisor_count = 0 then[\s\S]*dean_sla_due_at = null/i);
  assert.match(sql, /if v_supervisor_count = 0 then[\s\S]*escalation_due_at = null/i);
  assert.match(sql, /if v_supervisor_count = 0 then[\s\S]*acceptance_due_at = null/i);
  assert.match(sql, /if v_supervisor_count = 0 then[\s\S]*sla_status = 'not_applicable'/i);
  assert.match(sql, /if v_supervisor_count = 0 then[\s\S]*escalation_status = 'not_started'/i);
});

test('migration 048 keeps mapped supervisor notification workflow compatible', () => {
  assert.match(sql, /from public\.hospital_ticket_on_duty_supervisors\(v_location\.client_id, v_location\.block_id, v_location\.id\) u/i);
  assert.match(sql, /notification_type[\s\S]*'incoming_supervisor_ticket'/i);
  assert.match(sql, /else[\s\S]*'supervisor_broadcast_created'/i);
  assert.match(sql, /jsonb_build_object\('broadcast_count',v_supervisor_count,'acceptance_due_at',v_acceptance_due_at,'supervisor_sla_due_at',v_supervisor_due_at\)/i);
});

test('migration 048 reports a controlled error when no compatible public actor exists', () => {
  assert.match(sql, /Complaint could not be created because the public feedback ticket actor is not mapped\./i);
  assert.match(sql, /using errcode='55000'/i);
});
