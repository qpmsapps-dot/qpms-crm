import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(new URL('../../supabase/migrations_2_0/119_dme_visit_mom_foundation.sql', import.meta.url), 'utf8');
const tables = ['mom_business_capabilities','visit_moms','mom_discussion_points','mom_action_items','mom_management_concerns','mom_appreciations','mom_attachments'];

test('MoM migration is additive, transactional, and API-only', () => {
  assert.match(migration, /^begin;/i); assert.match(migration, /commit;\s*$/i);
  assert.doesNotMatch(migration, /\b(?:truncate|drop table|drop column)\b/i);
  assert.doesNotMatch(migration, /\b(?:update|delete)\s+public\.(?:fo_attendance|fo_site_visits|fo_location_logs)\b/i);
  for (const table of tables) { assert.match(migration, new RegExp(`create table if not exists public\\.${table}`,'i')); assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`,'i')); }
});

test('one MoM per visit and relational integrity are enforced', () => {
  assert.match(migration, /unique\(site_visit_id\)/i);
  assert.match(migration, /attendance_id uuid not null references public\.fo_attendance\(id\) on delete restrict/i);
  assert.match(migration, /site_visit_id uuid not null references public\.fo_site_visits\(id\) on delete restrict/i);
  assert.match(migration, /site_id uuid not null references public\.store_master\(id\) on delete restrict/i);
  assert.match(migration, /foreign key\(mom_id,discussion_point_id\)[\s\S]*references public\.mom_discussion_points\(mom_id,id\)/i);
  assert.match(migration, /idx_visit_moms_attendance[\s\S]*visit_moms\(attendance_id\)/i);
});

test('transactional RPC validates ownership, eligibility, submission and immutability', () => {
  for (const marker of ['mom_not_owner','mom_visit_mismatch','mom_not_eligible','mom_immutable','mom_meeting_with_required','mom_meeting_designation_required','mom_discussion_required','mom_action_incomplete','mom_action_status_invalid','mom_priority_invalid','mom_follow_up_date_required','mom_follow_up_mode_required']) assert.match(migration, new RegExp(marker));
  assert.match(migration, /on conflict\(id\) do update/i);
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\(v_visit\.id::text, 0\)\)/i);
  assert.match(migration, /submission_payload_hash/i);
  assert.match(migration, /v_action_timestamps[\s\S]*completed_at[\s\S]*verified_at/i);
  assert.match(migration, /status in \('draft','submitted','follow_up_pending','closed'\)/i);
  assert.match(migration, /created_after_checkout/i);
});

test('capability and storage configuration are restricted to authoritative DME', () => {
  assert.match(migration, /values \('DME', true\)/i);
  assert.doesNotMatch(migration, /\('HOSPITALS', true\)/i);
  assert.match(migration, /dme-mom-private[\s\S]*false[\s\S]*10485760/i);
  assert.doesNotMatch(migration, /storage_bucket text not null default 'fo-activity-uploads'/i);
});

test('migration does not change GPS, KM, checkout, end-day or reimbursement logic', () => {
  assert.doesNotMatch(migration, /fo_location_logs|actual_km\s*=|eligible_km\s*=|petrol_amount\s*=|travel_mode\s*=/i);
});
