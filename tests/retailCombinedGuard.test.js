import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { verifyCombinedPayload, manifestPath, workflowPath } from '../.github/retailCombinedGuard.mjs';
const pins = JSON.parse(fs.readFileSync(new URL('../.github/retail-combined-ui-pins.json', import.meta.url), 'utf8'));
const paths = [...Object.keys(pins), manifestPath, workflowPath];
const hash = p => pins[p];
test('guard accepts only the entire reviewed combined payload', () => assert.equal(verifyCombinedPayload(paths, pins, hash).ok, true));
for (const path of paths) test('guard rejects missing required file: ' + path, () => assert.equal(verifyCombinedPayload(paths.filter(p => p !== path), pins, hash).ok, false));
for (const path of Object.keys(pins)) test('guard rejects modified hash: ' + path, () => assert.equal(verifyCombinedPayload(paths, pins, p => p === path ? 'modified' : hash(p)).ok, false));
for (const path of ['src/unreviewed.jsx', 'backend/server.js', 'backend/services/trainingService.js', 'src/context/AuthContext.jsx', 'src/utils/authRoles.js', 'supabase/migrations/unapproved.sql', 'Mobile_FO_V2/lib/main.dart', 'src/components/Sidebar.jsx', 'src/layouts/MainLayout.jsx', 'src/pages/FOActivities.jsx']) {
  test('guard rejects unauthorized extra path: ' + path, () => assert.equal(verifyCombinedPayload([...paths, path], pins, hash).ok, false));
}
