import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const migration = readFileSync(
  'supabase/migrations_2_0/056_contact_ticket_supervisor_broadcast.sql',
  'utf8',
);

function hospitalTicketsInsertColumns(sql) {
  const match = sql.match(
    /insert\s+into\s+public\.hospital_tickets\s*\(([\s\S]*?)\)\s*values/i,
  );
  assert.ok(match, 'hospital_tickets insert column list should exist');
  return match[1].split(',').map((column) => column.trim()).filter(Boolean);
}

test('migration 056 keeps contact RPC signature and service-role grants', () => {
  assert.match(migration, /create or replace function public\.rpc_create_hospital_contact_ticket/);
  assert.match(migration, /p_contact_id uuid/);
  assert.match(migration, /p_supervisor_sla_minutes integer default 20/);
  assert.match(migration, /p_floor_id uuid default null/);
  assert.match(migration, /p_department_id uuid default null/);
  assert.match(migration, /security definer set search_path = public/i);
  assert.match(migration, /revoke all on function public\.rpc_create_hospital_contact_ticket/);
  assert.match(migration, /grant execute on function public\.rpc_create_hospital_contact_ticket[\s\S]*to service_role/);
});

test('contact ticket is created unassigned and awaiting supervisor acceptance', () => {
  const columns = hospitalTicketsInsertColumns(migration);
  assert.ok(columns.includes('current_assignee_user_id'));
  assert.ok(columns.includes('current_assignee_role'));
  assert.ok(columns.includes('supervisor_user_id'));
  assert.ok(columns.includes('acceptance_status'));
  assert.ok(columns.includes('acceptance_due_at'));
  assert.ok(!columns.includes('floor_id'));
  assert.ok(!columns.includes('department_id'));

  assert.match(migration, /'awaiting_supervisor_acceptance', null, null,\s*null, null, v_supervisor_due_at,/i);
  assert.match(migration, /'awaiting', v_acceptance_due_at, now\(\)/i);
  assert.doesNotMatch(migration, /ticket_assigned_internal/);
  assert.doesNotMatch(migration, /current_assignee_user_id,\s*current_assignee_role,[\s\S]*v_supervisor\.id/i);
});

test('migration 056 broadcasts to all eligible on-duty supervisors', () => {
  assert.match(
    migration,
    /from public\.hospital_ticket_on_duty_supervisors\(v_contact\.client_id, p_block_id, p_location_id\) u/i,
  );
  assert.match(migration, /insert into public\.hospital_ticket_notifications/);
  assert.match(migration, /'incoming_supervisor_ticket'/);
  assert.match(migration, /get diagnostics v_supervisor_count = row_count/);
  assert.match(migration, /broadcast_count/);
  assert.doesNotMatch(migration, /limit 1/i);
});

test('notification copy and metadata include prominent location context', () => {
  assert.match(migration, /upper\(coalesce\(v_block\.block_name/);
  assert.match(migration, /nullif\(v_location\.floor_name, ''\)/);
  assert.match(migration, /nullif\(v_location\.location_name, ''\)/);
  assert.match(migration, /'block', v_block\.block_name/);
  assert.match(migration, /'floor', v_location\.floor_name/);
  assert.match(migration, /'area', v_location\.location_name/);
  assert.match(migration, /'target_screen', 'incoming_ticket'/);
});

test('contact RPC remains Housekeeping-specific for now', () => {
  assert.match(migration, /upper\(coalesce\(v_category\.category_code, ''\)\) <> 'HOUSEKEEPING'/);
  assert.match(migration, /Registered contact routing is currently configured for Housekeeping tickets only/);
});
