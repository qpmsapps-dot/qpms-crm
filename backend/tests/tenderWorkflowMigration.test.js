import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../../supabase/migrations_2_0/112_tender_workflow.sql', import.meta.url), 'utf8');

test('Migration 112 adds only the canonical Tender role and preserves the existing role vocabulary', () => {
  assert.match(sql, /'Pre-Sales','Pre-Sales Executive','Pre-Sales Manager','Tender'/);
  assert.doesNotMatch(sql, /Tender Head|Tender Executive|Tender Manager/);
  for (const role of ['Admin', 'COO', 'Branch Head', 'Operations Manager', 'BD Executive', 'Business Development Executive', 'HR', 'Commercial', 'Finance', 'CFO', 'DEMO_VIEWER']) {
    assert.match(sql, new RegExp(`'${role}'`), role);
  }
});

test('Migration 112 creates private, service-role-only versioned Tender storage and workflow tables', () => {
  for (const table of ['tender_packages', 'tender_versions', 'tender_reviews', 'tender_events', 'tender_idempotency']) {
    assert.match(sql, new RegExp(`create table public\\.${table}`));
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(sql, /values\('tender-workbooks','tender-workbooks',false/);
  assert.match(sql, /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/);
  assert.match(sql, /revoke all on public\.tender_packages[\s\S]*from anon,authenticated/);
  assert.match(sql, /grant all on public\.tender_packages[\s\S]*to service_role/);
});

test('survey submission creates an unassigned queue item without requiring a Tender user', () => {
  assert.match(sql, /create constraint trigger trg_create_tender_package after update[\s\S]*deferrable initially deferred/);
  assert.match(sql, /assigned_tender_profile_id uuid references/);
  assert.match(sql, /Waiting for Tender Assignment/);
  assert.match(sql, /for v_r in select id from public\.profiles where role='Tender'/);
  assert.doesNotMatch(sql, /raise exception 'tender_user/);
});

test('claim, immutable versions, parallel approvals, rework, CFO, COO, and proposal return are enforced', () => {
  for (const rpc of ['rpc_claim_tender_task', 'rpc_reserve_tender_version', 'rpc_submit_tender_version', 'rpc_decide_tender_review']) {
    assert.match(sql, new RegExp(`create or replace function public\\.${rpc}`));
  }
  assert.match(sql, /array\['HR','Commercial','Finance'\]/);
  assert.match(sql, /rework_remarks_required/);
  assert.match(sql, /status='CFO Approval'/);
  assert.match(sql, /status='COO Approval'/);
  assert.match(sql, /status='Proposal Ready'/);
  assert.match(sql, /assigned_bd_profile_id/);
  assert.match(sql, /current_stage_code='proposal'/);
  assert.match(sql, /create trigger trg_complete_tender_package after update of status on public\.leads/);
});

test('Tender RPCs retain actor, stage, audit, idempotency, and service-role boundaries', () => {
  assert.match(sql, /tender_owner_required/);
  assert.match(sql, /tender_reviewer_denied/);
  assert.match(sql, /invalid_tender_stage/);
  assert.match(sql, /idempotency_key_required/);
  assert.match(sql, /admin_override/);
  assert.match(sql, /security definer set search_path=pg_catalog,public/);
  assert.match(sql, /revoke all on function[\s\S]*from public,anon,authenticated/);
  assert.match(sql, /grant execute on function[\s\S]*to service_role/);
  assert.doesNotMatch(sql, /disable row level security/i);
  assert.doesNotMatch(sql, /update\s+public\.profiles/i);
  assert.doesNotMatch(sql, /update\s+public\.employee_hierarchy/i);
});
