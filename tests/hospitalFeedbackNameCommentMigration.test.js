import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(
  new URL('../supabase/migrations_2_0/045_hospital_feedback_respondent_name_comments.sql', import.meta.url),
  'utf8',
);

test('respondent name migration is additive nullable and preserves existing submissions', () => {
  assert.match(migration, /alter table public\.hospital_feedback_submissions\s+add column if not exists respondent_name text/i);
  assert.doesNotMatch(migration, /respondent_name text not null/i);
  assert.doesNotMatch(migration, /update\s+public\.hospital_feedback_submissions[\s\S]*respondent_name/i);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.hospital_feedback_submissions/i);
});

test('respondent name and comments length constraints exist and are safe for historical rows', () => {
  assert.match(migration, /hospital_feedback_submissions_respondent_name_length/i);
  assert.match(migration, /char_length\(respondent_name\) <= 120/i);
  assert.match(migration, /hospital_feedback_submissions_comments_length/i);
  assert.match(migration, /char_length\(comments\) <= 2000/i);
  assert.match(migration, /not valid/i);
});

test('migration keeps backend mediated RLS and service-role access pattern intact', () => {
  assert.doesNotMatch(migration, /grant\s+insert[\s\S]{0,120}to anon/i);
  assert.doesNotMatch(migration, /grant\s+select[\s\S]{0,120}to anon/i);
  assert.doesNotMatch(migration, /disable row level security/i);
  assert.doesNotMatch(migration, /drop policy|drop table|alter table[\s\S]{0,120}disable trigger/i);
});
