import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const migration = readFileSync(
  'supabase/migrations_2_0/055_contact_ticket_on_duty_supervisor_routing.sql',
  'utf8',
);

function hospitalTicketsInsertColumns(sql) {
  const match = sql.match(
    /insert\s+into\s+public\.hospital_tickets\s*\(([\s\S]*?)\)\s*values/i,
  );
  assert.ok(match, 'hospital_tickets insert column list should exist');
  return match[1]
    .split(',')
    .map((column) => column.trim())
    .filter(Boolean);
}

test('migration 055 keeps the contact RPC signature and permissions', () => {
  assert.match(migration, /create or replace function public\.rpc_create_hospital_contact_ticket/);
  assert.match(migration, /p_contact_id uuid/);
  assert.match(migration, /p_supervisor_sla_minutes integer default 20/);
  assert.match(migration, /p_floor_id uuid default null/);
  assert.match(migration, /p_department_id uuid default null/);
  assert.match(migration, /security definer set search_path = public/i);
  assert.match(migration, /revoke all on function public\.rpc_create_hospital_contact_ticket/);
  assert.match(migration, /grant execute on function public\.rpc_create_hospital_contact_ticket[\s\S]*to service_role/);
});

test('migration 055 uses the existing on-duty scoped supervisor helper', () => {
  assert.match(
    migration,
    /from public\.hospital_ticket_on_duty_supervisors\(v_contact\.client_id, p_block_id, p_location_id\) u/i,
  );
  assert.doesNotMatch(
    migration,
    /join public\.hospital_ticket_user_scopes s on s\.hospital_ticket_user_id = u\.id[\s\S]*u\.role_code = 'housekeeping_supervisor'[\s\S]*u\.is_active/i,
  );
  assert.match(migration, /'assignment_failure_reason'[\s\S]*'no_on_duty_supervisor'/);
});

test('migration 055 keeps hierarchy IDs out of hospital_tickets insert', () => {
  const columns = hospitalTicketsInsertColumns(migration);
  assert.ok(columns.includes('location_id'));
  assert.ok(columns.includes('floor_name'));
  assert.ok(columns.includes('department_name'));
  assert.ok(!columns.includes('floor_id'));
  assert.ok(!columns.includes('department_id'));
  assert.match(migration, /v_location\.floor_id is distinct from p_floor_id/);
  assert.match(migration, /v_location\.department_id is distinct from p_department_id/);
});

test('migration 055 notifies the selected internal supervisor only when assigned', () => {
  assert.match(migration, /case when v_supervisor\.id is null then 'open' else 'assigned' end/);
  assert.match(migration, /case when v_supervisor\.id is null then null else 'housekeeping_supervisor' end/);
  assert.match(migration, /if v_supervisor\.id is not null then/);
  assert.match(migration, /'ticket_assigned_internal'/);
  assert.match(migration, /New housekeeping complaint/);
});
