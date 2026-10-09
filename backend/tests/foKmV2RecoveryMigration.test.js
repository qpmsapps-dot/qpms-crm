import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const recovery200Url = new URL(
  '../../supabase/recovery/200_fo_canonical_km_engine_v2_post_commit_recovery.sql',
  import.meta.url,
);
const recovery205Url = new URL(
  '../../supabase/recovery/205_fo_final_leg_evidence_reconciliation_recovery.sql',
  import.meta.url,
);
const recovery200 = (await readFile(recovery200Url, 'utf8')).toLowerCase();
const recovery205 = (await readFile(recovery205Url, 'utf8')).toLowerCase();

for (const [name, sql] of [['200 recovery', recovery200], ['205 recovery', recovery205]]) {
  test(`${name} closes the database gate and revokes financial persistence`, () => {
    assert.match(sql, /financial_writes_enabled\s*=\s*false/);
    assert.match(sql, /revoke (?:all|execute) on function public\.rpc_persist_fo_canonical_km_v2/);
    assert.match(sql, /revoke (?:all|execute) on function public\.rpc_approve_fo_km_financial_change_v1/);
  });

  test(`${name} preserves immutable evidence and financial values`, () => {
    assert.doesNotMatch(sql, /drop\s+table/);
    assert.doesNotMatch(sql, /delete\s+from/);
    assert.doesNotMatch(sql, /update\s+public\.fo_attendance/);
    assert.doesNotMatch(sql, /update\s+public\.fo_travel_legs/);
  });
}

test('205 recovery independently revokes evidence recording and resolution', () => {
  assert.match(recovery205, /revoke (?:all|execute) on function public\.rpc_record_fo_final_leg_evidence_v1/);
  assert.match(recovery205, /revoke (?:all|execute) on function public\.rpc_resolve_fo_final_leg_evidence_v1/);
  assert.match(recovery205, /revoke (?:all|execute) on function public\.rpc_apply_fo_final_leg_financial_v1/);
});
