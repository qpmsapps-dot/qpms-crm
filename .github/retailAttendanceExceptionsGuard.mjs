import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
export const approvedBase = '80fe06d842a0efc79c18124dbe16d05ca1bdf34c';
export const manifestPath = '.github/retail-attendance-exceptions-pins.json';
export const guardPath = '.github/retailAttendanceExceptionsGuard.mjs';
export const workflowPath = '.github/workflows/retail-ui-visual-checks.yml';
export const payloadPaths = Object.freeze([
  guardPath, '.github/deepCleaningV2Guard.mjs', '.github/thermographyV2Guard.mjs',
  '.github/workflows/retail-attendance-exceptions.yml',
  'backend/routes/retailAttendanceRoutes.js', 'backend/services/retailAttendanceService.js',
  'backend/services/retailAttendanceXlsx.js', 'backend/shared/retailAttendanceExceptions.js',
  'backend/services/retailAttendanceExceptionSource.js',
  'backend/tests/retailAttendanceExceptions.test.js', 'backend/tests/retailAttendanceExceptionsPostgres.test.js',
  'backend/tests/fixtures/retailAttendanceTimesNov21.json',
  'src/pages/reliance-retail/RetailAttendance.jsx', 'src/components/reliance-retail/RetailAttendanceExceptions.jsx',
  'src/services/retailAttendanceApi.js', 'src/utils/retailAttendanceExceptionsExport.js',
  'supabase/proposals/retail_attendance_exceptions_20261123.sql',
  'tests/browser/retailAttendanceExceptions.spec.js', 'tests/browser/retailAttendance.spec.js', 'tests/retailAttendanceExceptionsGuard.test.js', 'tests/thermographyFullstackGuard.test.js',
  'docs/RETAIL_ATTENDANCE_EXCEPTIONS.md',
]);
const git = args => execFileSync('git', ['-c', `safe.directory=${process.cwd()}`, ...args], { encoding: 'utf8' });
const normalize = s => s.replaceAll('\r\n', '\n');
export function reviewedWorkflow(base, manifestHash, guardHash) {
  const anchor = '          # BEGIN DEEP CLEANING COMPLETION PERCENTAGE EXACT PAYLOAD\n';
  if (normalize(base).split(anchor).length !== 2) throw Error('Attendance authorization anchor drift');
  const block = `          # BEGIN RETAIL ATTENDANCE EXCEPTIONS EXACT PAYLOAD
          attendance_manifest = "${manifestPath}"
          if attendance_manifest in files:
            if subprocess.check_output(["git","rev-parse",f"HEAD:{attendance_manifest}"],text=True).strip() != "${manifestHash}":
              sys.exit("Attendance exception manifest changed; renew review")
            if subprocess.check_output(["git","rev-parse","HEAD:${guardPath}"],text=True).strip() != "${guardHash}":
              sys.exit("Attendance exception guard changed; renew review")
            subprocess.run(["node","${guardPath}",base],check=True)
            print("PASS: exact attendance exception payload; all subsequent checks remain mandatory.")
            sys.exit(0)
          # END RETAIL ATTENDANCE EXCEPTIONS EXACT PAYLOAD
`;
  return normalize(base).replace(anchor, block + anchor);
}
export function verifyPayload({ base, paths, manifest, hash, workflow, baseWorkflow }) {
  const expected = [...payloadPaths, manifestPath, workflowPath];
  const validManifest = base === approvedBase && manifest?.base_sha === approvedBase && manifest.schema === 'retail-attendance-exceptions.v1'
    && Object.keys(manifest.files || {}).length === payloadPaths.length && payloadPaths.every(p => /^[a-f0-9]{40}$/.test(manifest.files[p] || ''));
  const missing = expected.filter(p => !paths.includes(p)), unexpected = paths.filter(p => !expected.includes(p));
  const mismatched = payloadPaths.filter(p => hash(p) !== manifest?.files?.[p]);
  let workflowMatches = false;
  try { workflowMatches = normalize(workflow) === reviewedWorkflow(baseWorkflow, hash(manifestPath), hash(guardPath)); } catch { /* Fail closed. */ }
  return { ok: validManifest && workflowMatches && !missing.length && !unexpected.length && !mismatched.length, validManifest, workflowMatches, missing, unexpected, mismatched };
}
export function verifyCurrent(base, working = false) {
  const paths = git(['diff', '--name-only', base, ...(working ? [] : ['HEAD'])]).trim().split('\n').filter(Boolean);
  if (working) paths.push(...git(['ls-files', '--others', '--exclude-standard']).trim().split('\n').filter(Boolean));
  const read = p => working ? fs.readFileSync(p, 'utf8') : git(['show', `HEAD:${p}`]);
  const hash = p => git(working ? ['hash-object', `--path=${p}`, p] : ['rev-parse', `HEAD:${p}`]).trim();
  return verifyPayload({ base, paths, manifest: JSON.parse(read(manifestPath)), hash, workflow: read(workflowPath), baseWorkflow: git(['show', `${approvedBase}:${workflowPath}`]) });
}
export function priorWorkflow(workflow) {
  const base = git(['show', `${approvedBase}:${workflowPath}`]), hash = p => git(['hash-object', `--path=${p}`, p]).trim();
  if (normalize(workflow) !== reviewedWorkflow(base, hash(manifestPath), hash(guardPath))) throw Error('Unreviewed workflow alteration: attendance exceptions');
  return base;
}
if (process.argv[1] && fs.existsSync(process.argv[1]) && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const base = process.argv.find(a => /^[a-f0-9]{40}$/.test(a));
  if (!base) throw Error('Explicit reviewed base SHA required');
  const result = verifyCurrent(base, process.argv.includes('--working-tree')); console.log(JSON.stringify(result)); if (!result.ok) process.exitCode = 1;
}
