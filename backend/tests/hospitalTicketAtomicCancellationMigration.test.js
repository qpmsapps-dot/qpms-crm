import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(
  new URL('../../supabase/migrations_2_0/070_hospital_ticket_atomic_client_cancellation.sql', import.meta.url),
  'utf8',
);

test('client cancellation uses a contact actor and one transactional RPC', () => {
  assert.match(sql, /actor_client_contact_id uuid[\s\S]*hospital_client_contacts\(id\)/i);
  assert.match(sql, /hospital_ticket_events_single_actor_check/i);
  assert.match(sql, /hospital_ticket_validate_event_actor/i);
  assert.match(sql, /Client cancellation events require the client-contact actor/i);
  assert.match(sql, /Duplicate historical client cancellation events require manual review/i);
  assert.match(sql, /create or replace function public\.rpc_cancel_hospital_contact_ticket/i);
  assert.match(sql, /from public\.hospital_tickets[\s\S]*for update/i);
  assert.match(sql, /raised_by_client_contact_id is distinct from v_contact\.id/i);
  assert.match(sql, /actor_user_id,[\s\S]*actor_client_contact_id/i);
  assert.match(sql, /'ticket_cancelled_by_client'[\s\S]*null,[\s\S]*v_contact\.id/i);
});

test('cancellation supports active states and protects terminal states', () => {
  for (const status of ['open', 'awaiting_supervisor_acceptance', 'assigned', 'accepted', 'in_progress', 'reopened']) {
    assert.match(sql, new RegExp(`'${status}'`));
  }
  assert.match(sql, /status_code = 'cancelled'[\s\S]*idempotent_replay'[\s\S]*true/i);
  assert.match(sql, /status_code in \('closed', 'resolved_awaiting_confirmation'\)/i);
  assert.match(sql, /version <> p_expected_version/i);
});

test('event and notification are durable and deduplicated inside cancellation', () => {
  assert.match(sql, /ux_hospital_ticket_client_cancellation_event/i);
  assert.match(sql, /on conflict \(ticket_id, event_type\)[\s\S]*do nothing/i);
  assert.match(sql, /coalesce\([\s\S]*current_assignee_user_id[\s\S]*accepted_by_user_id[\s\S]*supervisor_user_id/i);
  assert.match(sql, /Ticket ' \|\| v_ticket\.ticket_no \|\| ' has been cancelled by the requester\.'/i);
  assert.match(sql, /on conflict \(dedupe_key\)/i);
});

test('acceptance starts one 20-minute deadline and Start Work preserves it', () => {
  assert.match(sql, /new\.accepted_at \+ interval '20 minutes'/i);
  assert.match(sql, /resolution_due_at/i);
  assert.match(sql, /old\.accepted_at is not null and new\.accepted_at = old\.accepted_at[\s\S]*old\.supervisor_sla_due_at/i);
});

test('accepted and closed requester notifications are transaction-bound', () => {
  assert.match(sql, /after update on public\.hospital_tickets/i);
  assert.match(sql, /Your ticket has been accepted by [\s\S]*It will be resolved within 20 minutes\./i);
  assert.match(sql, /Your ticket ' \|\| new\.ticket_no \|\| ' has been resolved and closed\.'/i);
  assert.match(sql, /accepted_by_user_id/i);
});
