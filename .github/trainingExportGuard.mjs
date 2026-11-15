import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const workflowPath='.github/workflows/retail-ui-visual-checks.yml';
export const exportPayloadPaths=Object.freeze([
  'package.json','package-lock.json','src/pages/reliance-retail/RetailTraining.jsx',
  'src/components/reliance-retail/TrainingExportControls.jsx',
  'src/components/reliance-retail/trainingExports.css',
  'src/utils/trainingExport.js','src/utils/trainingExportFiles.js',
  'tests/trainingExports.test.js','tests/trainingExports.browser.test.js',
  '.github/trainingExportGuard.mjs','tests/trainingExportGuard.test.js'
]);
export function readTrainingExportPins(workflow) {
  const match=workflow.match(/approved_training_exports = (\{[\s\S]*?\n {10}\})/);
  if(!match)throw Error('Exact Training export content pins are missing.');
  return JSON.parse(match[1]);
}
export function verifyTrainingExportPayload(paths,pins,readHash) {
  const expected=new Set([...exportPayloadPaths,workflowPath]),actual=new Set(paths);
  const missing=[...expected].filter(p=>!actual.has(p));
  const unexpected=[...actual].filter(p=>!expected.has(p));
  const invalidPins=[...new Set([...Object.keys(pins).filter(p=>!exportPayloadPaths.includes(p)),...exportPayloadPaths.filter(p=>!/^[a-f0-9]{40}$/.test(pins[p]||''))])];
  const mismatched=exportPayloadPaths.filter(p=>actual.has(p)&&readHash(p)!==pins[p]);
  return {ok:!missing.length&&!unexpected.length&&!invalidPins.length&&!mismatched.length,missing,unexpected,invalidPins,mismatched};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===fs.realpathSync(process.argv[1])) {
  const git=args=>execFileSync('git',['-c',`safe.directory=${process.cwd()}`,...args],{encoding:'utf8'}).trim();
  const base=process.argv.find(a=>/^[a-f0-9]{40}$/.test(a));
  if(!base)throw Error('Explicit base SHA is required.');
  const working=process.argv.includes('--working-tree');
  const paths=git(['diff','--name-only',base,...(working?[]:['HEAD'])]).split('\n').filter(Boolean);
  if(working)paths.push(...git(['ls-files','--others','--exclude-standard']).split('\n').filter(Boolean));
  const pins=readTrainingExportPins(working?fs.readFileSync(workflowPath,'utf8'):git(['show',`HEAD:${workflowPath}`]));
  const result=verifyTrainingExportPayload(paths,pins,p=>git(working?['hash-object',`--path=${p}`,p]:['rev-parse',`HEAD:${p}`]));
  console.log(JSON.stringify(result));if(!result.ok)process.exitCode=1;
}
