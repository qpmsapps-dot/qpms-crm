import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sql = (await readFile(new URL(
  '../../supabase/recovery/200_fo_canonical_km_engine_v2_post_commit_recovery.sql',
  import.meta.url,
), 'utf8')).toLowerCase();

test('post-commit recovery is transactional and restores snapshotted legacy functions and trigger state', () => {
  assert.match(sql, /^begin;/m);
  assert.match(sql, /^commit;/m);
  assert.match(sql, /fo_km_v2_recovery_snapshot/);
  assert.match(sql, /execute v_snapshot\.actual_travel_function_def/);
  assert.match(sql, /execute v_snapshot\.payable_route_function_def/);
  assert.match(sql, /enable trigger trg_fo_location_logs_actual_travel_km/);
  assert.match(sql, /disable trigger trg_fo_location_logs_actual_travel_km/);
});

test('recovery removes V2 write authority but preserves evidence and financial history', () => {
  assert.match(sql, /drop trigger if exists trg_protect_fo_canonical_km_v2_financials/);
  assert.match(sql, /drop function if exists public\.rpc_persist_fo_canonical_km_v2/);
  assert.match(sql, /deliberately retained for audit\/reconciliation/);
  assert.doesNotMatch(sql, /drop table\s+(if exists\s+)?public\.fo_km_calculation_runs/);
  assert.doesNotMatch(sql, /delete\s+from\s+public\./);
  assert.doesNotMatch(sql, /update\s+public\.fo_attendance/);
});
