import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL('../../supabase/migrations_2_0/111_platform_admin_application_override.sql', import.meta.url);

test('Migration 111 adds a service-role-only central Platform Admin predicate', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /create or replace function public\.is_platform_admin_role\(p_role text\)/i);
  assert.match(sql, /'ADMIN', 'QPMSADMIN', 'DEVELOPER', 'DEV', 'ITADMIN', 'MANAGEMENTITADMIN'/);
  assert.doesNotMatch(sql, /'MANAGEMENT'|'GM'|'COO'|'DEMOADMIN'/);
  assert.match(sql, /revoke all on function public\.is_platform_admin_profile\(uuid\) from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.is_platform_admin_profile\(uuid\) to service_role/i);
  assert.match(sql, /normalize_site_workflow_role\(text\)/);
  for (const alias of ['DEVELOPER', 'DEV', 'ITADMIN', 'MANAGEMENTITADMIN']) {
    assert.match(sql, new RegExp(`when ''${alias}'' then ''ADMIN''`));
  }
});

test('Migration 111 overrides actor ownership but retains workflow validity checks', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  const workflowSql = await readFile(new URL('../../supabase/migrations_2_0/107_opportunity_meeting_handoff_site_survey_bridge.sql', import.meta.url), 'utf8');
  for (const rpc of [
    'rpc_schedule_pre_sales_meeting_handoff',
    'rpc_decide_pre_sales_handoff',
    'rpc_submit_bd_meeting_mom',
    'rpc_prepare_opportunity_proposal',
    'rpc_send_opportunity_proposal',
    'rpc_record_proposal_outcome',
    'rpc_assign_site_survey_operations_manager',
  ]) assert.match(sql, new RegExp(rpc));
  for (const guard of [
    'operations_manager_already_assigned',
    'operations_manager_state_scope_missing',
    'operations_manager_not_direct_report',
  ]) assert.match(sql, new RegExp(guard));
  for (const preservedGuard of [
    'future_meeting_required',
    'pre_sales_opportunity_read_only',
    'mom_requirement_required',
    'proposal_not_ready',
  ]) assert.match(workflowSql, new RegExp(preservedGuard));
  assert.match(sql, /pg_get_functiondef/);
  assert.doesNotMatch(sql, /replace\([^;]*(future_meeting_required|pre_sales_opportunity_read_only|mom_requirement_required|proposal_not_ready)/);
  assert.match(sql, /admin_override/);
  assert.doesNotMatch(sql, /disable row level security|grant .* to anon|grant .* to authenticated/i);
});

test('Migration 111 repairs the two PostgreSQL runtime blockers found by isolated validation', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /rpc_add_pre_sales_call_update\(uuid,jsonb,jsonb\)/);
  assert.match(sql, /\|\| \(p_payload->>''notes''\)/);
  assert.match(sql, /pending_with = ''Completed''/);
  assert.match(sql, /Runtime repair failed for rpc_add_pre_sales_call_update/);
});

test('Migration 111 is forward-only and does not mutate profiles or hierarchy', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.doesNotMatch(sql, /update\s+public\.profiles|delete\s+from|truncate\s+|drop\s+table|alter\s+table.*disable/i);
  assert.doesNotMatch(sql, /update\s+public\.employee_hierarchy|insert\s+into\s+public\.employee_hierarchy/i);
});
