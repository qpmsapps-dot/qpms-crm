import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {exportPayloadPaths as trainingPaths,readTrainingExportPins,workflowPath} from './trainingExportGuard.mjs';

export const cleaningPayloadPaths=Object.freeze([
  '.github/deepCleaningExportGuard.mjs','tests/deepCleaningExportGuard.test.js','tests/trainingExportGuard.test.js',
  'src/pages/reliance-retail/RetailScopedDeepCleaning.jsx','src/components/reliance-retail/DeepCleaningExportControls.jsx',
  'src/utils/deepCleaningExport.js','src/utils/deepCleaningExportFiles.js','tests/deepCleaningExports.test.js','tests/deepCleaningExports.browser.test.js'
]);
export function readCleaningExportPins(workflow){const match=workflow.match(/approved_cleaning_exports = (\{[\s\S]*?\n {10}\})/);if(!match)throw Error('Deep Cleaning export content pins missing');return JSON.parse(match[1]);}
export function verifyCleaningExportPayload(paths,pins,trainingPins,hash){
  const combined=paths.includes('package.json'),payload=combined?[...new Set([...trainingPaths,...cleaningPayloadPaths])]:cleaningPayloadPaths;
  const expected=new Set([...payload,workflowPath]),actual=new Set(paths);
  const validPins=Object.keys(pins).length===cleaningPayloadPaths.length&&cleaningPayloadPaths.every(p=>/^[a-f0-9]{40}$/.test(pins[p]||''));
  const validTraining=!combined||(Object.keys(trainingPins).length===trainingPaths.length&&trainingPaths.every(p=>/^[a-f0-9]{40}$/.test(trainingPins[p]||'')));
  const missing=[...expected].filter(p=>!actual.has(p)),unexpected=[...actual].filter(p=>!expected.has(p));
  const merged={...(combined?trainingPins:{}),...pins},mismatched=payload.filter(p=>hash(p)!==merged[p]);
  return {ok:validPins&&validTraining&&!missing.length&&!unexpected.length&&!mismatched.length,validPins,validTraining,missing,unexpected,mismatched};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===fs.realpathSync(process.argv[1])){
  const git=args=>execFileSync('git',['-c',`safe.directory=${process.cwd()}`,...args],{encoding:'utf8'}).trim();
  const base=process.argv.find(a=>/^[a-f0-9]{40}$/.test(a));if(!base)throw Error('Explicit base SHA required');
  const working=process.argv.includes('--working-tree');
  const paths=git(['diff','--name-only',base,...(working?[]:['HEAD'])]).split('\n').filter(Boolean);
  if(working)paths.push(...git(['ls-files','--others','--exclude-standard']).split('\n').filter(Boolean));
  const workflow=working?fs.readFileSync(workflowPath,'utf8'):git(['show',`HEAD:${workflowPath}`]);
  const result=verifyCleaningExportPayload(paths,readCleaningExportPins(workflow),readTrainingExportPins(workflow),p=>git(working?['hash-object',`--path=${p}`,p]:['rev-parse',`HEAD:${p}`]));
  console.log(JSON.stringify(result));if(!result.ok)process.exitCode=1;
}
