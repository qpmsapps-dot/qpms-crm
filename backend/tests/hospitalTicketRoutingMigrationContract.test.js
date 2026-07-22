import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(new URL('../../supabase/migrations_2_0/027_nims_supervisor_routing_foundation.sql', import.meta.url), 'utf8');

test('migration 027 creates shift routing and assignment history tables only in hospital schema', () => {
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
  assert.doesNotMatch(sql, /alter table public\.fo_/i);
  assert.doesNotMatch(sql, /fault_tracker/i);
  assert.doesNotMatch(sql, /deep_clean/i);
});

test('migration 027 supports shifts, overnight matching, effective dates and verification', () => {
  assert.match(sql, /starts_at time not null/);
  assert.match(sql, /ends_at time not null/);
  assert.match(sql, /is_overnight boolean generated always as \(ends_at <= starts_at\) stored/);
  assert.match(sql, /days_of_week smallint\[\]/);
  assert.match(sql, /effective_from timestamptz/);
  assert.match(sql, /effective_to timestamptz/);
  assert.match(sql, /verification_status in \('draft','verified','rejected','inactive'\)/);
  assert.match(sql, /hospital_shift_matches/);
  assert.match(sql, /v_previous_day/);
  assert.match(sql, /v_local_time < p_ends_at/);
});

test('migration 027 uses verified active routing rules instead of first created supervisor', () => {
  assert.match(sql, /hospital_select_ticket_supervisor/);
  assert.match(sql, /a\.verification_status='verified'/);
  assert.match(sql, /u\.role_code='housekeeping_supervisor' and u\.is_active/);
  assert.match(sql, /a\.effective_from<=p_at/);
  assert.match(sql, /hospital_supervisor_availability/);
  assert.match(sql, /precedence_rank/);
  assert.match(sql, /order by\s+precedence_rank,\s+a\.routing_priority/);
  assert.doesNotMatch(sql, /order by u\.created_at limit 1;/);
});

test('migration 027 preserves idempotency, ticket number generation and SLA values', () => {
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /idempotent_replay/);
  assert.match(sql, /nextval\('public\.hospital_ticket_number_seq'\)/);
  assert.match(sql, /p_supervisor_sla_minutes integer default 20/);
  assert.match(sql, /now\(\)\+interval '20 minutes'/);
  assert.doesNotMatch(sql, /HOSPITAL_SUPERVISOR_SLA_MINUTES/);
});

test('migration 027 records assignment history and unassigned fallback without fake assignment', () => {
  assert.match(sql, /hospital_ticket_assignment_history/);
  assert.match(sql, /hospital_record_assignment_history/);
  assert.match(sql, /hospital_ticket_assignment_history_from_update/);
  assert.match(sql, /trg_hospital_ticket_assignment_history_from_update/);
  assert.match(sql, /rpc_hospital_shift_handover/);
  assert.match(sql, /ticket_unassigned/);
  assert.match(sql, /no_verified_active_shift_assignment/);
  assert.match(sql, /only_draft_mappings_exist/);
  assert.match(sql, /current_assignee_user_id,\s*current_assignee_role/);
  assert.match(sql, /case when v_supervisor\.id is null then 'open' else 'assigned' end/);
});

test('migration 027 keeps routing writes service-role controlled and hides roster import rows from clients', () => {
  assert.match(sql, /revoke insert,update,delete on public\.%I from authenticated/);
  assert.match(sql, /grant all on public\.%I to service_role/);
  assert.match(sql, /hospital_supervisor_roster_import_rows_ops_select/);
  assert.match(sql, /u\.role_code in \('operations_executive','facility_manager'\)/);
  assert.doesNotMatch(sql, /phone/i);
});
