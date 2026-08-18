import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const migration060 = readFileSync(
  new URL('../../supabase/migrations_2_0/060_hospital_no_supervisor_immediate_operations.sql', import.meta.url),
  'utf8',
);
const migration057 = readFileSync(
  new URL('../../supabase/migrations_2_0/057_hospital_supervisor_acceptance_20_minutes.sql', import.meta.url),
  'utf8',
);

test('migration 060 immediately routes zero-broadcast supervisor tickets to Operations', () => {
  assert.match(migration060, /create or replace function public\.hospital_ticket_skip_empty_supervisor_broadcast/);
  assert.match(migration060, /new\.event_type <> 'supervisor_broadcast_created'/);
  assert.match(migration060, /new\.event_data->>'broadcast_count'/);
  assert.match(migration060, /coalesce\(v_broadcast_count,\s*0\) > 0/);
  assert.match(migration060, /public\.hospital_ticket_direct_to_operations\(\s*new\.ticket_id,\s*'no_on_duty_supervisor'/);
});

test('migration 060 preserves working supervisor broadcast path', () => {
  assert.match(migration060, /when \(new\.event_type = 'supervisor_broadcast_created'\)/i);
  assert.doesNotMatch(migration060, /incoming_supervisor_ticket/);
  assert.doesNotMatch(migration060, /hospital_ticket_on_duty_supervisors/);
});

test('existing 20-minute deadline and timeout worker remain deadline driven', () => {
  assert.match(migration057, /select interval '20 minutes'/);
  assert.match(migration057, /'acceptance_window_seconds', 1200/);
  assert.match(migration057, /No Supervisor accepted within 20 minutes\./);
  assert.doesNotMatch(migration057, /created_at\s*\+\s*interval '2 minutes'/);
});
