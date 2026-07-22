import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(new URL('../../supabase/migrations_2_0/026_hospital_ticket_landmark_path_dedupe.sql', import.meta.url), 'utf8');

test('migration 026 deduplicates landmark-only location paths', () => {
  assert.match(sql, /create or replace function public\.set_hospital_ticket_location_snapshots\(\)/);
  assert.match(sql, /v_location_text is not distinct from new\.exact_landmark_snapshot/);
  assert.match(sql, /v_location_text := null/);
  assert.match(sql, /new\.location_path_snapshot := coalesce\(new\.location_path_snapshot, v_path\)/);
});

test('migration 026 is limited to snapshot trigger behavior', () => {
  assert.doesNotMatch(sql, /alter table public\./i);
  assert.doesNotMatch(sql, /drop table public\./i);
  assert.doesNotMatch(sql, /delete from public\./i);
  assert.doesNotMatch(sql, /rpc_create_hospital_ticket/i);
});
