import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = new URL('../../supabase/migrations_2_0/106_pre_sales_bd_handoff_decision.sql', import.meta.url);

test('handoff decision migration is atomic, service-role-only, and preserves Pre-Sales association', async () => {
  const sql = await readFile(migration, 'utf8');
  assert.match(sql, /^begin;/m);
  assert.match(sql, /^commit;/m);
  assert.match(sql, /for update/i);
  assert.match(sql, /handoff_status <> 'pending'/);
  assert.match(sql, /if v_handoff\.to_profile_id <> p_actor_profile_id then/);
  assert.match(sql, /pre_sales_stage = 'bd_accepted'/);
  assert.match(sql, /insert into public\.activity_logs/);
  assert.match(sql, /revoke all on function public\.rpc_decide_pre_sales_handoff[^;]+authenticated/);
  assert.match(sql, /grant execute on function public\.rpc_decide_pre_sales_handoff[^;]+service_role/);
  assert.doesNotMatch(sql, /pre_sales_owner_profile_id\s*=/i);
  assert.doesNotMatch(sql, /created_by_user_id\s*=/i);
  assert.doesNotMatch(sql, /delete from|truncate|drop table|alter table/i);
});
