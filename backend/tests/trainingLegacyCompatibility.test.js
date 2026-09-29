import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const routes = readFileSync(new URL('../routes/trainingRoutes.js', import.meta.url), 'utf8');
const evidence = readFileSync(new URL('../services/trainingEvidenceService.js', import.meta.url), 'utf8');
const migration115 = readFileSync(new URL('../../supabase/migrations_2_0/115_reliance_training_foundation.sql', import.meta.url), 'utf8');
const migration116 = readFileSync(new URL('../../supabase/migrations_2_0/116_reliance_training_backend_rpcs.sql', import.meta.url), 'utf8');

test('new Training API is mounted only at /api/training', () => {
  assert.match(server, /import \{ createTrainingRouter \} from '\.\/routes\/trainingRoutes\.js'/);
  assert.match(server, /app\.use\(\s*'\/api\/training',/);
});
test('legacy Training generic tables and bucket remain in place', () => {
  assert.match(migration115, /Legacy fo_activity_submissions, fo_activity_uploads, and fo-activity-uploads[\s\S]+remain unchanged/i);
  assert.doesNotMatch(migration116, /drop\s+table/i);
  assert.doesNotMatch(migration116, /delete\s+from\s+public\.fo_activity_uploads/i);
  assert.doesNotMatch(migration116, /storage\.objects/i);
});

test('structured evidence uses its private dedicated bucket only', () => {
  assert.match(evidence, /TRAINING_EVIDENCE_BUCKET = 'training-evidence'/);
  assert.doesNotMatch(evidence, /fo-activity-uploads/);
  assert.doesNotMatch(routes, /storage_path|storage_bucket/);
});

test('signed URLs are generated on explicit authorized endpoints, not session lists', () => {
  assert.match(routes, /evidence\/upload-url/);
  assert.match(routes, /evidence\/:evidenceId\/view-url/);
  assert.doesNotMatch(routes, /signed_upload_url|signedUrl/);
});

test('Phase 2 does not register any mobile dispatcher or Flutter behavior', () => {
  assert.doesNotMatch(server, /tasks_screen\.dart|visits_screen\.dart|mobile_roles\.dart/);
});
