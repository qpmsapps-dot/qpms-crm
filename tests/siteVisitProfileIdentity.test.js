import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(new URL('../supabase/migrations_2_0/037_bd_site_visit_foundation.sql', import.meta.url), 'utf8');
const mapper = await readFile(new URL('../src/services/siteAssessmentWorkbookMapping.js', import.meta.url), 'utf8');

test('production profile identity contract excludes profiles.name', () => {
  assert.doesNotMatch(migration, /public\.profiles\.name|p\.name/i);
  assert.match(migration, /where p\.auth_user_id = auth\.uid\(\)/i);
  assert.match(migration, /p\.is_active is true/i);
  assert.match(migration, /p\.web_access_enabled is true/i);
});

test('Site Visit display mappings use full_name and safe fallbacks', () => {
  assert.doesNotMatch(mapper, /profile\.name/);
  assert.match(mapper, /profile\.full_name/);
  assert.match(mapper, /profile\.employee_code/);
  assert.match(mapper, /profile\.email/);
  assert.match(mapper, /profile\.id/);
});

test('client actor fields are not authoritative', () => {
  assert.match(migration, /Authenticated identity must resolve to exactly one active profile/i);
  assert.match(migration, /where p\.auth_user_id = auth\.uid\(\)/i);
  assert.doesNotMatch(migration, /v_actor\.(?:role_key|profile_id)\s*:=\s*p_actor/i);
});
