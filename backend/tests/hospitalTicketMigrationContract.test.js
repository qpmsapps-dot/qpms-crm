import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(new URL('../../supabase/migrations_2_0/022_hospital_ticketing_foundation.sql', import.meta.url), 'utf8');

test('hospital migration creates the canonical isolated table set', () => {
  for (const table of ['hospital_clients', 'hospital_blocks', 'hospital_locations', 'hospital_ticket_users', 'hospital_ticket_user_scopes', 'hospital_ticket_categories', 'hospital_tickets', 'hospital_ticket_events', 'hospital_ticket_comments', 'hospital_ticket_attachments', 'hospital_ticket_notifications']) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(sql, new RegExp(`alter table public\\.%I enable row level security`));
  }
});

test('ticket IDs, idempotency, transactions and SLA RPCs are database-backed', () => {
  assert.match(sql, /create sequence if not exists public\.hospital_ticket_number_seq/);
  assert.match(sql, /QPMS-HK-/);
  assert.match(sql, /ux_hospital_tickets_user_idempotency/);
  assert.match(sql, /rpc_create_hospital_ticket/);
  assert.match(sql, /rpc_hospital_ticket_action/);
  assert.match(sql, /rpc_process_hospital_ticket_sla/);
  assert.match(sql, /for update skip locked/);
});

test('storage is private and mutations are service-role-only', () => {
  assert.match(sql, /'hospital-ticket-attachments','hospital-ticket-attachments',false,10485760/);
  assert.match(sql, /revoke all on public\.%I from anon/);
  assert.match(sql, /revoke insert,update,delete on public\.%I from authenticated/);
  assert.match(sql, /grant execute on function public\.rpc_create_hospital_ticket[\s\S]*to service_role/);
  assert.doesNotMatch(sql, /to anon[\s\S]{0,80}using\s*\(true\)/i);
});

test('timeline is append-only and timestamp triggers are self-contained', () => {
  assert.match(sql, /trg_hospital_ticket_events_append_only/);
  assert.match(sql, /raise exception 'Hospital ticket events are append-only\.'/);
  assert.match(sql, /function public\.set_hospital_ticket_updated_at\(\)/);
  assert.doesNotMatch(sql, /execute function public\.set_updated_at\(\)/);
});

test('migration does not alter FO or Fault Tracker tables', () => {
  assert.doesNotMatch(sql, /alter table public\.fo_/i);
  assert.doesNotMatch(sql, /fault_tracker/i);
});
