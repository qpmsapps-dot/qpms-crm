import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  'supabase/migrations_2_0/049_fo_missing_km_reviews.sql',
  'utf8',
);

test('fo_missing_km_reviews migration creates canonical review table', () => {
  assert.match(migration, /create table if not exists public\.fo_missing_km_reviews/i);
  assert.match(migration, /attendance_id uuid not null references public\.fo_attendance\(id\)/i);
  assert.match(migration, /site_visit_id uuid not null references public\.fo_site_visits\(id\)/i);
  assert.match(migration, /review_type text not null/i);
  assert.match(migration, /suggested_missing_km numeric not null default 0/i);
  assert.match(migration, /approved_missing_km numeric not null default 0/i);
});

test('fo_missing_km_reviews migration prevents duplicate checkout reviews', () => {
  assert.match(
    migration,
    /fo_missing_km_reviews_attendance_visit_type_uidx[\s\S]*attendance_id,\s*site_visit_id,\s*review_type/i,
  );
});

test('fo_missing_km_reviews migration keeps review status and km safe', () => {
  assert.match(migration, /status in \('pending', 'approved', 'rejected', 'clarification_required'\)/i);
  assert.match(migration, /review_type in \('checkout_exception'\)/i);
  assert.match(migration, /coalesce\(suggested_missing_km, 0\) >= 0/i);
  assert.match(migration, /coalesce\(approved_missing_km, 0\) >= 0/i);
});

test('fo_missing_km_reviews migration uses service-role-only RLS policy', () => {
  assert.match(migration, /alter table public\.fo_missing_km_reviews enable row level security/i);
  assert.match(migration, /auth\.role\(\) = 'service_role'/i);
  assert.doesNotMatch(migration, /auth\.role\(\) = 'anon'/i);
});
