import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(new URL('../../supabase/migrations_2_0/025_hospital_ticket_optional_location.sql', import.meta.url), 'utf8');

test('migration 025 makes ticket location optional without weakening ticket identity', () => {
  assert.match(sql, /alter table public\.hospital_tickets[\s\S]*alter column location_id drop not null/i);
  assert.match(sql, /hospital_tickets_meaningful_location_check/);
  assert.match(sql, /location_id is not null[\s\S]*exact_landmark_snapshot/i);
  assert.doesNotMatch(sql, /drop table public\./i);
  assert.doesNotMatch(sql, /delete from public\.hospital_tickets/i);
});

test('migration 025 updates create RPC with nullable hierarchy inputs', () => {
  assert.match(sql, /drop function if exists public\.rpc_create_hospital_ticket\(uuid,uuid,uuid,uuid,text,text,text,text,integer\)/);
  assert.match(sql, /p_location_id uuid/);
  assert.match(sql, /p_floor_id uuid default null/);
  assert.match(sql, /p_department_id uuid default null/);
  assert.match(sql, /p_exact_landmark text default null/);
  assert.match(sql, /Select a room\/area or provide an exact location landmark\./);
  assert.match(sql, /Select a department\/unit for landmark-only tickets\./);
  assert.match(sql, /elsif v_landmark is null/);
});

test('migration 025 preserves ticket number, assignment, SLA and event behavior', () => {
  assert.match(sql, /nextval\('public\.hospital_ticket_number_seq'\)/);
  assert.match(sql, /role_code = 'housekeeping_supervisor'/);
  assert.match(sql, /supervisor_sla_due_at/);
  assert.match(sql, /ticket_created/);
  assert.match(sql, /ticket_assigned/);
  assert.match(sql, /idempotent_replay/);
});

test('migration 025 validates hierarchy ownership before insert', () => {
  assert.match(sql, /Floor is outside the selected block\./);
  assert.match(sql, /Department is outside the selected block\./);
  assert.match(sql, /Department is outside the selected floor\./);
  assert.match(sql, /Location is outside the selected department\./);
  assert.match(sql, /Ticket creation is outside the actor scope\./);
});
