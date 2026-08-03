import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(new URL('../../supabase/migrations_2_0/041_hospital_ticket_priority_escalation_matrix.sql', import.meta.url), 'utf8');

test('Day 2 migration adds the configurable priority escalation matrix', () => {
  assert.match(sql, /create table if not exists public\.hospital_ticket_sla_matrix/);
  for (const row of [
    /\('critical', 1, 'housekeeping_supervisor', 'Supervisor', 10/,
    /\('critical', 2, 'operations_executive', 'Operations Executive', 10/,
    /\('critical', 3, 'facility_manager', 'Facility Manager', 10/,
    /\('critical', 4, 'project_head', 'Project Head', 10/,
    /\('medium', 1, 'housekeeping_supervisor', 'Supervisor', 15/,
    /\('low', 1, 'housekeeping_supervisor', 'Supervisor', 20/,
  ]) {
    assert.match(sql, row);
  }
});

test('Day 2 migration adds Project Head and active owner SLA fields compatibly', () => {
  assert.match(sql, /'project_head'/);
  assert.match(sql, /add column if not exists current_escalation_level_no integer/);
  assert.match(sql, /add column if not exists escalation_due_at timestamptz/);
  assert.match(sql, /add column if not exists project_head_user_id uuid/);
  assert.match(sql, /add column if not exists final_escalation boolean/);
  assert.match(sql, /drop constraint if exists hospital_tickets_status_check/);
  assert.match(sql, /'escalated_project_head'/);
  assert.doesNotMatch(sql, /drop table public\.hospital_ticket_events/i);
});

test('Day 2 worker escalates one level at a time with a fresh SLA window', () => {
  assert.match(sql, /for update skip locked/);
  assert.match(sql, /v_next_level := v_level \+ 1/);
  assert.match(sql, /v_due := p_now \+ make_interval\(mins => public\.hospital_ticket_sla_minutes\(v_ticket\.priority, v_next_level\)\)/);
  assert.match(sql, /assigned_at = p_now/);
  assert.match(sql, /current_assignee_user_id = v_assignee\.id/);
  assert.match(sql, /current_assignee_role = v_next_role/);
  assert.match(sql, /final_escalation = v_next_level = 4/);
});

test('Day 2 worker creates timeline and notification records without duplicate escalations', () => {
  assert.match(sql, /supervisor_sla_missed/);
  assert.match(sql, /operations_executive_sla_missed/);
  assert.match(sql, /facility_manager_sla_missed/);
  assert.match(sql, /ticket_escalated/);
  assert.match(sql, /project_head_assigned/);
  assert.match(sql, /ux_hospital_ticket_events_priority_sla_milestone/);
  assert.match(sql, /insert into public\.hospital_ticket_notifications\(ticket_id,recipient_user_id,notification_type,title,body,priority,current_owner_role,escalation_level\)/);
  assert.match(sql, /coalesce\(final_escalation, false\) = false/);
});

test('Day 2 migration does not alter unrelated modules', () => {
  assert.doesNotMatch(sql, /public\.fo_/i);
  assert.doesNotMatch(sql, /fault_tracker/i);
  assert.doesNotMatch(sql, /deep_cleaning/i);
  assert.doesNotMatch(sql, /reliance/i);
});
