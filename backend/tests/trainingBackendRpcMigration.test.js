import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(new URL('../../supabase/migrations_2_0/116_reliance_training_backend_rpcs.sql', import.meta.url), 'utf8');
const adminSql = readFileSync(new URL('../../supabase/migrations_2_0/117_reliance_training_admin_test_access.sql', import.meta.url), 'utf8');

const requiredFunctions = [
  'training_assert_draft_editor',
  'rpc_create_reliance_training_session',
  'rpc_update_reliance_training_draft',
  'rpc_add_reliance_training_attendee',
  'rpc_remove_reliance_training_attendee',
  'rpc_set_reliance_training_topics',
  'rpc_update_reliance_training_topic',
  'rpc_complete_reliance_training_evidence',
  'rpc_delete_reliance_training_evidence',
  'rpc_submit_reliance_training_session',
  'rpc_cancel_reliance_training_session',
];

test('Migration 116 is one transaction with all atomic Training RPCs', () => {
  assert.match(sql, /^begin;/i);
  assert.match(sql, /commit;\s*$/i);
  for (const name of requiredFunctions) assert.match(sql, new RegExp(`create or replace function public\\.${name}\\b`, 'i'));
});
test('Training RPCs are backend-only service-role functions', () => {
  for (const name of requiredFunctions) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${name}[^;]+from public, anon, authenticated`, 'i'));
    assert.match(sql, new RegExp(`grant execute on function public\\.${name}[^;]+to service_role`, 'i'));
  }
});

test('atomic create uses one UUID for generic envelope and structured session', () => {
  assert.match(sql, /v_session_id uuid := gen_random_uuid\(\)/i);
  assert.match(sql, /insert into public\.fo_activity_submissions[\s\S]+?v_session_id/i);
  assert.match(sql, /insert into public\.training_sessions[\s\S]+?v_session_id/i);
  assert.match(sql, /'training_schema', 'structured_v1'/i);
  assert.match(sql, /'training_source', 'reliance_structured'/i);
  assert.match(sql, /'session_created'/i);
});

test('RPC independently defends actor, current context, Reliance, and canonical client', () => {
  assert.match(sql, /not in \('FO', 'OPERATIONSMANAGER'\)/i);
  assert.match(sql, /v_attendance\.logout_time is not null/i);
  assert.match(sql, /v_visit\.check_out_time is not null or v_visit\.checkout_time is not null/i);
  assert.match(sql, /v_visit\.attendance_id is distinct from v_attendance\.id/i);
  assert.match(sql, /in \('RELIANCE', 'RELIANCERETAIL'\)/i);
  assert.match(sql, /369d2d5f-396f-49f9-a47d-bfbc8f7cb922/i);
  assert.match(sql, /reliance_retail/i);
});

test('draft editor permits historical-context resume but requires creator and draft', () => {
  const helper = sql.slice(sql.indexOf('training_assert_draft_editor'), sql.indexOf('rpc_create_reliance_training_session'));
  assert.match(helper, /v_session\.status <> 'draft'/i);
  assert.match(helper, /training_not_session_creator/i);
  assert.doesNotMatch(helper, /logout_time|check_out_time|checkout_time/i);
});

test('topic replacement refuses evidence-bearing removal and preserves retained rows', () => {
  assert.match(sql, /training_topic_has_evidence/i);
  assert.match(sql, /on conflict \(training_session_id, topic_id\) do nothing/i);
});

test('submit validates requirements and updates both statuses atomically', () => {
  for (const marker of [
    'training_attendee_required', 'training_topic_required', 'training_topic_evidence_required',
    'training_group_photo_required', 'training_attendance_sheet_required', 'training_document_required',
  ]) assert.match(sql, new RegExp(marker));
  assert.match(sql, /update public\.training_sessions[\s\S]+status = 'submitted'/i);
  assert.match(sql, /update public\.fo_activity_submissions[\s\S]+status = 'submitted'/i);
  assert.match(sql, /'submitted'/i);
});

test('cancel preserves compatible generic draft status and records cancellation metadata', () => {
  const cancel = sql.slice(sql.indexOf('rpc_cancel_reliance_training_session'));
  assert.match(cancel, /set status = 'cancelled'/i);
  assert.match(cancel, /'structured_status', 'cancelled'/i);
  assert.match(cancel, /'training_cancelled', true/i);
  assert.doesNotMatch(cancel, /fo_activity_submissions[\s\S]{0,200}set status = 'cancelled'/i);
});

test('Migration 116 contains no destructive schema or legacy data operations', () => {
  assert.doesNotMatch(sql, /\bdrop\s+(table|column|policy)\b/i);
  assert.doesNotMatch(sql, /\btruncate\b/i);
  assert.doesNotMatch(sql, /delete from public\.(fo_activity_submissions|fo_activity_uploads|fo_attendance|fo_site_visits)\b/i);
  assert.doesNotMatch(sql, /alter table public\.(fo_activity_submissions|fo_activity_uploads|fo_attendance|fo_site_visits)\b/i);
});

test('Migration 117 narrowly adds Admin to backend-only Reliance Training RPC guards', () => {
  assert.match(adminSql, /^begin;/i);
  assert.match(adminSql, /commit;\s*$/i);
  assert.match(adminSql, /not in \('FO', 'OPERATIONSMANAGER', 'ADMIN'\)/i);
  assert.match(adminSql, /v_actor_role <> 'ADMIN'[\s\S]+training_actor_business_forbidden/i);
  assert.match(adminSql, /training_attendance_forbidden/i);
  assert.match(adminSql, /training_site_visit_forbidden/i);
  assert.match(adminSql, /training_non_reliance_store/i);
  assert.match(adminSql, /training_cross_state_forbidden/i);
  assert.match(adminSql, /training_not_session_creator/i);
});

test('Migration 117 preserves SECURITY DEFINER and service-role-only execution', () => {
  for (const name of ['training_assert_draft_editor', 'rpc_create_reliance_training_session']) {
    assert.match(adminSql, new RegExp(`create or replace function public\\.${name}[\\s\\S]+?security definer`, 'i'));
    assert.match(adminSql, new RegExp(`revoke all on function public\\.${name}[^;]+from public, anon, authenticated`, 'i'));
    assert.match(adminSql, new RegExp(`grant execute on function public\\.${name}[^;]+to service_role`, 'i'));
  }
});

test('Migration 117 does not change schema, legacy data, masters, or existing sessions', () => {
  assert.doesNotMatch(adminSql, /\b(drop|alter|truncate)\b/i);
  assert.doesNotMatch(adminSql, /\b(delete|update|insert)\s+(from|into)?\s*public\.(training_categories|training_topics|training_types|profiles|fo_attendance|fo_site_visits)\b/i);
  assert.doesNotMatch(adminSql, /update\s+public\.training_sessions\b/i);
});
