import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(
  new URL('../supabase/migrations_2_0/046_demo_viewer_read_only_rls.sql', import.meta.url),
  'utf8',
);

test('DEMO_VIEWER migration creates stable role lookup functions', () => {
  assert.match(migration, /create or replace function public\.is_demo_viewer_user\(\)/);
  assert.match(migration, /create or replace function public\.is_not_demo_viewer_user\(\)/);
  assert.match(migration, /= 'DEMOVIEWER'/);
});

test('DEMO_VIEWER migration adds restrictive no-write policies', () => {
  assert.match(migration, /as restrictive for insert to authenticated/);
  assert.match(migration, /as restrictive for update to authenticated/);
  assert.match(migration, /as restrictive for delete to authenticated/);
  assert.match(migration, /public\.is_not_demo_viewer_user\(\)/);
});

test('DEMO_VIEWER migration covers protected application tables', () => {
  [
    'profiles',
    'leads',
    'site_visits',
    'approval_requests',
    'store_master',
    'fo_attendance',
    'fo_location_logs',
    'fault_tracker_tickets',
    'hospital_tickets',
    'hospital_feedback_qr_codes',
    'hospital_feedback_submissions',
  ].forEach((tableName) => assert.match(migration, new RegExp(`'${tableName}'`), tableName));
});

test('DEMO_VIEWER migration preserves service-role backend access', () => {
  assert.match(migration, /grant select, insert, update, delete on public\.%I to service_role/);
});
