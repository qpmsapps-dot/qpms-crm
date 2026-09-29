import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../../supabase/migrations_2_0/115_reliance_training_foundation.sql', import.meta.url),
  'utf8',
);

const tableNames = [
  'training_categories',
  'training_types',
  'training_topics',
  'training_sessions',
  'training_session_attendees',
  'training_session_topics',
  'training_evidence',
  'training_events',
];

const hkTopicCodes = [
  'housekeeping_basics',
  'cleaning_chemicals',
  'floor_care',
  'washroom_cleaning',
  'glass_high_level_cleaning',
  'dusting_surface_cleaning',
  'deep_cleaning',
  'machine_operation',
  'ppe_safety',
  'waste_management',
  'pest_control_awareness',
  'store_hygiene',
  'attendance_grooming',
  'customer_interaction',
  'sop_compliance',
  'quality_inspection',
  'emergency_response',
];

const mepTopicCodes = [
  'electrical_safety',
  'electrical_systems',
  'preventive_maintenance',
  'corrective_maintenance',
  'hvac',
  'fire_life_safety',
  'dg_ups',
  'thermography',
  'energy_management',
  'tools_instruments',
  'oos_management',
  'documentation',
  'quality_standards',
  'emergency_response',
  'soft_skills',
];

function blockBetween(startMarker, endMarker) {
  const start = migration.indexOf(startMarker);
  const end = migration.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `Missing marker: ${startMarker}`);
  assert.notEqual(end, -1, `Missing marker: ${endMarker}`);
  return migration.slice(start, end);
}

test('migration 115 is transactional and defines the eight structured Training tables', () => {
  assert.match(migration, /^begin;/i);
  assert.match(migration, /commit;\s*$/i);
  assert.equal(tableNames.length, 8);
  for (const table of tableNames) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}\\s*\\(`, 'i'));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
  }
});

test('structured sessions reuse the generic Training activity ID and stable UUID context FKs', () => {
  assert.match(
    migration,
    /id uuid primary key references public\.fo_activity_submissions\(id\) on delete restrict/i,
  );
  for (const relation of [
    ['attendance_id', 'fo_attendance'],
    ['site_visit_id', 'fo_site_visits'],
    ['store_id', 'store_master'],
    ['access_client_id', 'access_clients'],
  ]) {
    assert.match(
      migration,
      new RegExp(`${relation[0]} uuid not null references public\\.${relation[1]}\\(id\\) on delete restrict`, 'i'),
    );
  }
});

test('master seeds contain exactly the approved categories, types, and topic codes', () => {
  assert.match(migration, /'hk',\s*'Housekeeping \(HK\)'/i);
  assert.match(migration, /'technical_mep',\s*'Technical \/ MEP'/i);

  for (const type of ['toolbox', 'classroom', 'practical', 'refresher']) {
    assert.match(migration, new RegExp(`'${type}'`, 'i'));
  }

  assert.equal(hkTopicCodes.length, 17);
  assert.equal(mepTopicCodes.length, 15);
  for (const topic of new Set([...hkTopicCodes, ...mepTopicCodes])) {
    assert.match(migration, new RegExp(`'${topic}'`, 'i'));
  }

  assert.equal((migration.match(/\('emergency_response',/g) || []).length, 2);
  assert.match(migration, /unique \(category_id, code\)/i);

  const topicsDefinition = blockBetween(
    'create table if not exists public.training_topics',
    'create index if not exists idx_training_topics_category',
  );
  assert.match(topicsDefinition, /code text not null,/i);
  assert.doesNotMatch(topicsDefinition, /code text not null unique/i);

  const hkSeed = blockBetween('-- Housekeeping topics (17).', '-- Technical / MEP topics (15).');
  const mepSeed = blockBetween('-- Technical / MEP topics (15).', '-- New evidence bucket.');
  assert.equal((hkSeed.match(/^\s{4}\('[a-z0-9_]+',/gm) || []).length, 17);
  assert.equal((mepSeed.match(/^\s{4}\('[a-z0-9_]+',/gm) || []).length, 15);
});

test('migration is additive and does not rewrite legacy Training rows or policies', () => {
  assert.doesNotMatch(migration, /\bdrop\s+(?:table|column)\b/i);
  assert.doesNotMatch(migration, /\btruncate\b/i);
  assert.doesNotMatch(migration, /\b(?:update|delete)\s+public\.fo_activity_(?:submissions|uploads)\b/i);
  assert.doesNotMatch(migration, /insert\s+into\s+public\.fo_activity_(?:submissions|uploads)\b/i);
  assert.doesNotMatch(migration, /(?:create|drop)\s+policy/i);
});

test('new tables are API-only and the new evidence bucket is private', () => {
  for (const table of tableNames) {
    assert.match(
      migration,
      new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`, 'i'),
    );
    assert.match(
      migration,
      new RegExp(`grant select, insert, update, delete on table public\\.${table} to service_role`, 'i'),
    );
  }
  assert.match(
    migration,
    /values \('training-evidence', 'training-evidence', false\)/i,
  );
  assert.doesNotMatch(migration, /create policy/i);
});

test('required uniqueness and value constraints are present', () => {
  assert.match(migration, /unique \(training_session_id, employee_code\)/i);
  assert.match(migration, /unique \(training_session_id, topic_id\)/i);
  assert.match(migration, /status in \('draft', 'submitted', 'cancelled'\)/i);
  for (const evidenceType of [
    'topic_photo',
    'group_photo',
    'attendance_sheet',
    'training_document',
    'additional_document',
  ]) {
    assert.match(migration, new RegExp(`'${evidenceType}'`, 'i'));
  }
});
