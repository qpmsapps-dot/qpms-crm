import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(new URL('../../supabase/migrations_2_0/028_complete_nims_supervisor_routing.sql', import.meta.url), 'utf8');

test('migration 028 recovers the observed partial state without rerunning 027', () => {
  assert.match(sql, /Phase 2C recovery/i);
  assert.doesNotMatch(sql, /027_nims_supervisor_routing_foundation/i);
  assert.doesNotMatch(sql, /drop table public\./i);
  assert.doesNotMatch(sql, /delete from public\.hospital_tickets/i);
  assert.doesNotMatch(sql, /alter table public\.fo_/i);
  assert.doesNotMatch(sql, /fault_tracker|deep_clean/i);
});

test('migration 028 defines all five missing routing tables', () => {
  for (const table of [
    'hospital_shifts',
    'hospital_supervisor_assignments',
    'hospital_supervisor_availability',
    'hospital_ticket_assignment_history',
    'hospital_supervisor_roster_import_rows',
  ]) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(sql, new RegExp(`alter table public\\.%I enable row level security`));
  }
});

test('migration 028 keeps days_of_week consistently smallint arrays', () => {
  assert.match(sql, /days_of_week smallint\[\] not null default array\[0,1,2,3,4,5,6\]::smallint\[\]/);
  assert.match(sql, /days_of_week <@ array\[0,1,2,3,4,5,6\]::smallint\[\]/);
  assert.doesNotMatch(sql, /days_of_week <@ array\[0,1,2,3,4,5,6\](?!::smallint\[\])/);
  assert.doesNotMatch(sql, /days_of_week::integer\[\]/);
  assert.match(sql, /p_days_of_week smallint\[\]/);
});

test('migration 028 defines required routing functions and reconciles triggers', () => {
  for (const fn of [
    'hospital_shift_matches',
    'hospital_select_ticket_supervisor',
    'hospital_record_assignment_history',
    'hospital_ticket_assignment_history_from_update',
    'rpc_hospital_shift_handover',
    'hospital_ticket_prepare_assignment',
    'hospital_ticket_assignment_events',
  ]) {
    assert.match(sql, new RegExp(`create or replace function public\\.${fn}`));
  }
  assert.match(sql, /drop trigger if exists trg_hospital_ticket_prepare_assignment on public\.hospital_tickets/);
  assert.match(sql, /create trigger trg_hospital_ticket_prepare_assignment/);
  assert.match(sql, /execute function public\.hospital_ticket_prepare_assignment\(\)/);
  assert.match(sql, /drop trigger if exists trg_hospital_ticket_assignment_history_from_update/);
});

test('migration 028 leaves one PostgREST-compatible create-ticket RPC signature', () => {
  assert.match(sql, /drop function if exists public\.rpc_create_hospital_ticket\(uuid,uuid,uuid,uuid,text,text,text,text,integer\)/);
  assert.match(sql, /create or replace function public\.rpc_create_hospital_ticket\(\s*p_actor_user_id uuid,\s*p_block_id uuid,\s*p_location_id uuid,/);
  assert.match(sql, /p_floor_id uuid default null/);
  assert.match(sql, /p_department_id uuid default null/);
  assert.match(sql, /p_exact_landmark text default null/);
  assert.match(sql, /grant execute on function public\.rpc_create_hospital_ticket\(uuid,uuid,uuid,uuid,text,text,text,text,integer,uuid,uuid,text\) to service_role/);
});

test('migration 028 prevents duplicate assignment history for create-time assignment', () => {
  assert.match(sql, /assignment_history_recorded', 'create_rpc'/);
  assert.match(sql, /coalesce\(new\.metadata->>'assignment_history_recorded',''\) = 'create_rpc'/);
  assert.match(sql, /perform public\.hospital_record_assignment_history\(/);
  assert.match(sql, /source in \('automatic','manual','escalation','handover','takeover','unassigned'\)/);
});

test('migration 028 keeps unassigned tickets without supervisor SLA and preserves ticket contracts', () => {
  assert.match(sql, /case when v_supervisor\.id is null then 'open' else 'assigned' end/);
  assert.match(sql, /case when v_supervisor\.id is null then null else now\(\) \+ make_interval/);
  assert.match(sql, /ticket_unassigned/);
  assert.match(sql, /no_verified_active_shift_assignment/);
  assert.match(sql, /Select a room\/area or provide an exact location landmark\./);
  assert.match(sql, /nextval\('public\.hospital_ticket_number_seq'\)/);
  assert.match(sql, /idempotent_replay/);
});

test('migration 028 skips draft inactive unverified unavailable and out-of-shift assignments', () => {
  assert.match(sql, /a\.verification_status='verified'/);
  assert.match(sql, /a\.is_active/);
  assert.match(sql, /u\.role_code='housekeeping_supervisor' and u\.is_active/);
  assert.match(sql, /a\.effective_from<=p_at/);
  assert.match(sql, /a\.effective_to is null or a\.effective_to>p_at/);
  assert.match(sql, /hospital_shift_matches/);
  assert.match(sql, /availability_status in \('unavailable','weekly_off','leave','temporary_unavailable'\)/);
});

test('migration 028 preserves overnight shift behavior', () => {
  assert.match(sql, /returns boolean language plpgsql stable/);
  assert.match(sql, /v_previous_day/);
  assert.match(sql, /p_ends_at <= p_starts_at/);
  assert.match(sql, /v_local_time >= p_starts_at/);
  assert.match(sql, /v_local_time < p_ends_at/);
  assert.match(sql, /'NIMS 8 PM-8 AM','20:00','08:00'/);
});
