import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(new URL('../../supabase/migrations_2_0/029_tender_demo_read_only_foundation.sql', import.meta.url), 'utf8');

test('tender demo migration defines demo helper functions', () => {
  assert.match(sql, /create or replace function public\.is_tender_demo_user\(\)/i);
  assert.match(sql, /create or replace function public\.is_not_tender_demo_user\(\)/i);
  assert.match(sql, /DEMOADMIN/);
  assert.match(sql, /TENDERDEMO/);
});

test('tender demo migration uses restrictive mutation policies only', () => {
  assert.match(sql, /as restrictive for insert to authenticated/i);
  assert.match(sql, /as restrictive for update to authenticated/i);
  assert.match(sql, /as restrictive for delete to authenticated/i);
  assert.match(sql, /grant select, insert, update, delete on public\.%I to service_role/i);
  assert.doesNotMatch(sql, /for select/i);
  assert.doesNotMatch(sql, /alter table public\.%I enable row level security/i);
  assert.match(sql, /relrowsecurity/i);
});

test('tender demo migration avoids unsafe boolean metadata casts', () => {
  assert.doesNotMatch(sql, /::boolean/i);
  assert.match(sql, /lower\(coalesce\(p\.metadata ->> 'is_demo', 'false'\)\) in \('true', '1', 'yes'\)/i);
});

test('tender demo migration covers core demo modules', () => {
  for (const table of [
    'fo_attendance',
    'fo_site_visits',
    'fo_activity_submissions',
    'fo_activity_uploads',
    'fault_tracker_tickets',
    'store_master',
    'hospital_tickets',
  ]) {
    assert.match(sql, new RegExp(`'${table}'`));
  }
});
