import {mainBase,assertCheckout,show as snapshot,git as snapshotGit} from '../.github/sharedIntegrity.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as g from '../.github/retailAttendanceExceptionsGuard.mjs';
test('attendance exceptions admit only exact reviewed blobs, base and additive workflow block', () => {
  const paths = [...g.payloadPaths, g.manifestPath, g.workflowPath], hash = () => '1'.repeat(40);
  const baseWorkflow = '          # BEGIN DEEP CLEANING COMPLETION PERCENTAGE EXACT PAYLOAD\nall existing checks\n';
  const f = { base: g.approvedBase, paths, hash, manifest: { schema: 'retail-attendance-exceptions.v1', base_sha: g.approvedBase, files: Object.fromEntries(g.payloadPaths.map(p => [p, hash()])) }, baseWorkflow, workflow: g.reviewedWorkflow(baseWorkflow, hash(), hash()) };
  assert.equal(g.verifyPayload(f).ok, true);
  for (const p of paths) assert.equal(g.verifyPayload({ ...f, paths: paths.filter(x => x !== p) }).ok, false, p);
  for (const p of g.payloadPaths) assert.equal(g.verifyPayload({ ...f, hash: x => x === p ? '2'.repeat(40) : hash() }).ok, false, p);
  for (const p of ['backend/server.js', 'backend/shared/retailAttendance.js', 'backend/shared/retailAttendanceNov2026.js', 'src/utils/authRoles.js', 'Mobile_FO_V2/lib/main.dart', 'supabase/migrations/unreviewed.sql', 'package-lock.json', 'src/pages/FOActivities.jsx']) assert.equal(g.verifyPayload({ ...f, paths: [...paths, p] }).ok, false, p);
  assert.equal(g.verifyPayload({ ...f, base: '0'.repeat(40) }).ok, false);
  assert.equal(g.verifyPayload({ ...f, workflow: f.workflow + 'skip checks' }).ok, false);
  assert.equal(g.verifyPayload({ ...f, workflow: f.workflow.replace('all existing checks', 'weakened checks') }).ok, false);
  assert.equal(g.verifyPayload({ ...f, manifest: { ...f.manifest, files: { ...f.manifest.files, extra: hash() } } }).ok, false);
});
test('existing UI workflow steps, dependency pins and protected business modules are unchanged', () => {
  assertCheckout();
  const historicalShow = p => execFileSync('git', ['show', `${g.approvedBase}:${p}`], { encoding: 'utf8' });
  assert.equal(g.priorWorkflow(readFileSync(g.workflowPath, 'utf8')).replaceAll('\r\n', '\n'), historicalShow(g.workflowPath).replaceAll('\r\n', '\n'));
 const show=p=>p==='backend/shared/retailMisAccess.js'&&existsSync('.github/training-v2-pins.json')?snapshotGit(['cat-file','blob',JSON.parse(readFileSync('.github/shared-training-pins.json','utf8')).files[p]]):snapshot(mainBase,p);
  for (const p of ['package.json', 'package-lock.json', 'backend/shared/retailAttendance.js', 'backend/shared/retailAttendanceNov2026.js', 'backend/services/retailAttendancePreviewAudit.js', 'supabase/migrations_2_0/232_reliance_retail_uploaded_attendance.sql', '.github/workflows/reliance-retail-operational-changes.yml']) assert.equal(readFileSync(p, 'utf8').replaceAll('\r\n', '\n'), show(p).replaceAll('\r\n', '\n'), p);
});
