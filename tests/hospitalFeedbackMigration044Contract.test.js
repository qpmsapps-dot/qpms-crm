import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(
  new URL('../supabase/migrations_2_0/044_dme_hospital_feedback_hierarchy_submissions.sql', import.meta.url),
  'utf8',
);

test('migration 044 contract repairs DME floor and location hierarchy conflicts', () => {
  assert.match(migration, /on conflict \(client_id, floor_code\) do update[\s\S]*set block_id = excluded\.block_id/i);
  assert.match(migration, /floor_name = excluded\.floor_name/i);
  assert.match(migration, /verification_status = excluded\.verification_status/i);
  assert.match(migration, /metadata = public\.hospital_floors\.metadata \|\| excluded\.metadata/i);

  assert.match(migration, /on conflict \(client_id, location_code\) do update[\s\S]*set block_id = excluded\.block_id/i);
  assert.match(migration, /floor_id = excluded\.floor_id/i);
  assert.match(migration, /floor_name = excluded\.floor_name/i);
  assert.match(migration, /location_type = excluded\.location_type/i);
  assert.match(migration, /metadata = public\.hospital_locations\.metadata \|\| excluded\.metadata/i);
});

test('migration 044 contract validates expected DME and RGGH hierarchy counts', () => {
  assert.match(migration, /client_code = 'DME'/);
  assert.match(migration, /client_code = 'RGGH'/);
  assert.match(migration, /parent_client_id = v_dme_parent_id/);
  assert.match(migration, /RGGH_BLOCK_1/);
  assert.match(migration, /RGGH_BLOCK_2/);
  assert.match(migration, /RGGH_BLOCK_3/);
  assert.match(migration, /v_block_count <> 3/);
  assert.match(migration, /v_floor_count <> 30/);
  assert.match(migration, /v_location_count <> 180/);
  assert.match(migration, /v_distinct_location_code_count <> 180/);
});

test('migration 044 contract validates per-block and per-floor distribution', () => {
  assert.match(migration, /having count\(\*\) <> 10[\s\S]*every RGGH block must have exactly 10 active floors/i);
  assert.match(migration, /having count\(\*\) <> 60[\s\S]*every RGGH block must have exactly 60 active toilets/i);
  assert.match(migration, /having count\(\*\) <> 6[\s\S]*every RGGH floor must have exactly 6 active toilets/i);
  assert.match(migration, /cross join generate_series\(1, 10\)/i);
  assert.match(migration, /cross join generate_series\(1, 6\)/i);
});

test('migration 044 contract detects wrong floor-to-block and location-to-floor linkage', () => {
  assert.match(migration, /hf\.block_id is null/i);
  assert.match(migration, /hf\.block_id <> hb\.id/i);
  assert.match(migration, /hl\.block_id is null/i);
  assert.match(migration, /hl\.floor_id is null/i);
  assert.match(migration, /hl\.block_id <> hb\.id/i);
  assert.match(migration, /hl\.floor_id <> hf\.id/i);
  assert.match(migration, /hf\.block_id <> hb\.id/i);
  assert.match(migration, /expected floor codes are missing or linked to the wrong block/i);
  assert.match(migration, /expected toilet codes are missing or linked to the wrong block\/floor/i);
});

test('migration 044 contract documents static-only SQL validation scope', () => {
  assert.match(migration, /RGGH_B', eb\.block_number, '_F'/);
  assert.match(migration, /'_TOILET_', lpad\(toilet_number::text, 2, '0'\)/);
  assert.match(migration, /location_type = 'Toilet'/);
});
