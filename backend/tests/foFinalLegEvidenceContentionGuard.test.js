import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sql = await readFile(
  new URL('../../supabase/migrations_2_0/206_fo_final_leg_evidence_contention_guard.sql', import.meta.url),
  'utf8',
);
const recoverySql = await readFile(
  new URL('../../supabase/recovery/206_fo_final_leg_evidence_contention_guard_recovery.sql', import.meta.url),
  'utf8',
);

test('contention migration fails closed against an unexpected installed RPC definition', () => {
  assert.match(sql, /md5\(v_definition\) <> '5902c207e2d6dd777be1f3d6dfefaea4'/);
  assert.match(sql, /Unexpected evidence RPC definition; refusing an unverified replacement/);
  assert.match(sql, /Evidence RPC advisory-lock fragment is missing or ambiguous/);
});

test('evidence RPC uses a fail-fast advisory lock and bounded server timeouts', () => {
  assert.match(sql, /pg_try_advisory_xact_lock/);
  assert.match(sql, /errcode = ''55P03''/);
  assert.match(sql, /final_leg_evidence_already_running/);
  assert.match(sql, /set lock_timeout = '2s'/);
  assert.match(sql, /set statement_timeout = '15s'/);
});

test('contention migration preserves the service-role-only execution boundary', () => {
  assert.match(sql, /revoke all on function[\s\S]+from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function[\s\S]+to service_role/i);
  assert.doesNotMatch(sql, /grant execute[\s\S]+to authenticated/i);
});

test('contention migration contains no financial, attendance, leg or visit writes', () => {
  assert.doesNotMatch(sql, /update\s+public\.fo_attendance/i);
  assert.doesNotMatch(sql, /update\s+public\.fo_travel_legs/i);
  assert.doesNotMatch(sql, /update\s+public\.fo_site_visits/i);
  assert.doesNotMatch(sql, /insert\s+into\s+public\./i);
});

test('recovery is definition-bound and preserves evidence and financial records', () => {
  assert.match(recoverySql, /b21d2a6088f9e1a66ec523296ab6ed2d/);
  assert.match(recoverySql, /5902c207e2d6dd777be1f3d6dfefaea4/);
  assert.match(recoverySql, /reset lock_timeout/);
  assert.match(recoverySql, /reset statement_timeout/);
  assert.doesNotMatch(recoverySql, /delete\s+from/i);
  assert.doesNotMatch(recoverySql, /truncate/i);
  assert.doesNotMatch(recoverySql, /update\s+public\./i);
});
