import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migrationUrl = new URL(
  '../../supabase/migrations_2_0/021_attendance_event_foundation.sql',
  import.meta.url,
);
const sql = readFileSync(migrationUrl, 'utf8');

test('attendance event migration is a trigger-based legacy compatibility layer', () => {
  assert.match(sql, /create table if not exists public\.fo_attendance_events/i);
  assert.match(sql, /after insert or update on public\.fo_attendance/i);
  assert.match(sql, /legacy_compatibility_trigger/i);
  assert.match(sql, /legacy_compatibility_path/i);
  assert.doesNotMatch(sql, /alter table public\.fo_attendance\s+add column/i);
});

test('attendance transition capture covers start, restart, end and stale auto end', () => {
  for (const eventType of ['start_day', 'restart_day', 'end_day', 'auto_end_day']) {
    assert.match(sql, new RegExp(`'${eventType}'`));
  }
  assert.match(sql, /backend_midnight_cleanup/i);
  assert.match(sql, /admin_support_source/i);
  assert.match(sql, /old\.logout_time is not null[\s\S]+new\.logout_time is null/i);
  assert.match(sql, /old\.logout_time is null[\s\S]+old\.logout_time is distinct from new\.logout_time/i);
});

test('event ledger is append-only and unavailable to anonymous mutation', () => {
  assert.match(sql, /before update or delete on public\.fo_attendance_events/i);
  assert.match(sql, /fo_attendance_events is append-only/i);
  assert.match(sql, /revoke all on public\.fo_attendance_events from anon/i);
  assert.match(sql, /revoke insert, update, delete on public\.fo_attendance_events from authenticated/i);
  assert.match(sql, /grant select on public\.fo_attendance_events to authenticated/i);
  assert.doesNotMatch(sql, /using\s*\(\s*true\s*\)/i);
  assert.doesNotMatch(sql, /with check\s*\(\s*true\s*\)/i);
});

test('legacy transition idempotency is attendance scoped and deterministic', () => {
  assert.match(sql, /unique\s*\(attendance_id, idempotency_key\)/i);
  assert.match(sql, /to_char\(v_event_at at time zone 'UTC'/i);
  assert.match(sql, /on conflict \(attendance_id, idempotency_key\) do nothing/gi);
});
