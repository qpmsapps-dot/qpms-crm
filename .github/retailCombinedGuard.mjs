import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const manifestPath = '.github/retail-combined-ui-pins.json';
export const workflowPath = '.github/workflows/retail-ui-visual-checks.yml';
export function verifyCombinedPayload(paths, pins, readHash) {
  const expected = new Set([...Object.keys(pins), manifestPath, workflowPath]);
  const actual = new Set(paths);
  const unexpected = [...actual].filter(p => !expected.has(p));
  const missing = [...expected].filter(p => !actual.has(p));
  const mismatched = Object.entries(pins).filter(([p, hash]) => actual.has(p) && readHash(p) !== hash).map(([p]) => p);
  return { ok: !unexpected.length && !missing.length && !mismatched.length, unexpected, missing, mismatched };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const git = args => execFileSync('git', args, { encoding: 'utf8' }).trim();
  const working = process.argv.includes('--working-tree');
  const base = process.argv.find(a => /^[a-f0-9]{40}$/.test(a));
  if (!base) throw Error('Explicit base SHA required.');
  const paths = git(['diff', '--name-only', base, ...(working ? [] : ['HEAD'])]).split('\n').filter(Boolean);
  if (working) paths.push(...git(['ls-files', '--others', '--exclude-standard', 'src', 'tests', '.github']).split('\n').filter(Boolean));
  const pins = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const result = verifyCombinedPayload(paths, pins, path => git(working ? ['hash-object', path] : ['rev-parse', `HEAD:${path}`]));
  console.log(JSON.stringify(result));
  if (!result.ok) process.exitCode = 1;
}
