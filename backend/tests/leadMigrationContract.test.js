import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL('../../database/migrations/026_bd_lead_creation_security.sql', import.meta.url);
const preflightUrl = new URL('../../database/backup/026_bd_lead_pre_migration_inspection.sql', import.meta.url);
const verificationUrl = new URL('../../database/backup/026_bd_lead_post_migration_verification.sql', import.meta.url);

test('lead migration is a self-contained Phase 1 bootstrap with atomic persistence', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /begin;[\s\S]*commit;/i);
  assert.match(sql, /create table if not exists public\.leads/i);
  assert.match(sql, /create table if not exists public\.lead_contacts/i);
  assert.match(sql, /create table if not exists public\.activity_logs/i);
  assert.match(sql, /create table if not exists public\.lead_mom/i);
  assert.match(sql, /create unique index if not exists ux_bd_leads_creator_idempotency/i);
  assert.match(sql, /created_by_user_id, idempotency_key/i);
  assert.match(sql, /pg_advisory_xact_lock/i);
  assert.match(sql, /Exactly one primary contact is required/i);
  assert.match(sql, /create or replace function public\.rpc_create_bd_lead_atomic/i);
  assert.match(sql, /insert into public\.lead_contacts/i);
  assert.match(sql, /insert into public\.activity_logs/i);
  assert.match(sql, /rpc_update_bd_lead_atomic/i);
  assert.match(sql, /grant execute on function public\.rpc_create_bd_lead_atomic[\s\S]*to service_role/i);
  assert.doesNotMatch(sql, /grant execute on function public\.rpc_create_bd_lead_atomic\([^;]+to authenticated/i);
  assert.doesNotMatch(sql, /create table if not exists public\.site_visits/i);
  assert.doesNotMatch(sql, /alter table public\.fo_/i);
  assert.doesNotMatch(sql, /alter table public\.fault_tracker_/i);
});

test('lead migration replaces legacy policies and denies browser mutations', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /from pg_policies[\s\S]*drop policy if exists/i);
  assert.match(sql, /revoke all on public\.leads[\s\S]*from anon/i);
  assert.match(sql, /revoke all on public\.leads[\s\S]*from authenticated/i);
  assert.match(sql, /grant select on public\.leads[\s\S]*to authenticated/i);
  assert.match(sql, /bd_leads_visible_select/i);
  assert.match(sql, /can_current_user_view_bd_lead/i);
  assert.doesNotMatch(sql, /create policy[\s\S]{0,120}for all to anon/i);
  assert.doesNotMatch(sql, /using\s*\(\s*true\s*\)/i);
  assert.doesNotMatch(sql, /with check\s*\(\s*true\s*\)/i);
});

test('operator scripts inspect security and fingerprint protected schemas without client rows', async () => {
  const [preflight, verification] = await Promise.all([
    readFile(preflightUrl, 'utf8'),
    readFile(verificationUrl, 'utf8'),
  ]);
  for (const sql of [preflight, verification]) {
    assert.match(sql, /pg_policies/i);
    assert.match(sql, /role_table_grants/i);
    assert.match(sql, /pg_constraint/i);
    assert.match(sql, /pg_indexes/i);
    assert.match(sql, /pg_proc/i);
    assert.match(sql, /protected_schema_fingerprint/i);
    assert.doesNotMatch(sql, /select\s+\*\s+from\s+public\.leads/i);
    assert.doesNotMatch(sql, /^\s*(?:insert\s+into|update\s+public\.|delete\s+from|alter\s+table|create\s+table|drop\s+table|grant\s+|revoke\s+)/im);
  }
});
