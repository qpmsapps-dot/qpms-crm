import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const migration = readFileSync(
  'supabase/migrations_2_0/054_fix_hospital_contact_ticket_rpc.sql',
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

test('migration 054 preserves the contact RPC signature and grants', () => {
  assert.match(migration, /create or replace function public\.rpc_create_hospital_contact_ticket/);
  assert.match(migration, /p_contact_id uuid/);
  assert.match(migration, /p_block_id uuid/);
  assert.match(migration, /p_location_id uuid/);
  assert.match(migration, /p_category_id uuid/);
  assert.match(migration, /p_priority text/);
  assert.match(migration, /p_title text/);
  assert.match(migration, /p_description text/);
  assert.match(migration, /p_idempotency_key text/);
  assert.match(migration, /p_supervisor_sla_minutes integer default 20/);
  assert.match(migration, /p_floor_id uuid default null/);
  assert.match(migration, /p_department_id uuid default null/);
  assert.match(migration, /p_exact_landmark text default null/);
  assert.match(migration, /returns jsonb language plpgsql security definer set search_path = public/);
  assert.match(migration, /revoke all on function public\.rpc_create_hospital_contact_ticket/);
  assert.match(migration, /grant execute on function public\.rpc_create_hospital_contact_ticket[\s\S]*to service_role/);
});

test('migration 054 keeps floor and department parameters for validation only', () => {
  assert.match(
    migration,
    /if p_floor_id is not null and v_location\.floor_id is distinct from p_floor_id then/,
  );
  assert.match(
    migration,
    /if p_department_id is not null and v_location\.department_id is distinct from p_department_id then/,
  );

  const columns = hospitalTicketsInsertColumns(migration);
  assert.ok(columns.includes('location_id'));
  assert.ok(columns.includes('floor_name'));
  assert.ok(columns.includes('department_name'));
  assert.ok(columns.includes('location_text'));
  assert.ok(!columns.includes('floor_id'));
  assert.ok(!columns.includes('department_id'));

  const valuesBlock = migration.match(/\)\s*values\s*\(([\s\S]*?)\)\s*returning \* into v_ticket/i)?.[1] || '';
  assert.match(valuesBlock, /p_location_id/);
  assert.match(valuesBlock, /v_location\.floor_name/);
  assert.match(valuesBlock, /v_location\.department_name/);
  assert.doesNotMatch(valuesBlock, /p_floor_id/);
  assert.doesNotMatch(valuesBlock, /p_department_id/);
});

test('migration 054 preserves the existing Housekeeping-specific contact routing markers', () => {
  assert.match(migration, /QPMS-HK-/);
  assert.match(migration, /housekeeping_supervisor/);
  assert.match(migration, /Housekeeping complaint created by registered NIMS contact/);
  assert.match(migration, /New housekeeping complaint/);
});
