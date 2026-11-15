import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {exportPayloadPaths,workflowPath,verifyTrainingExportPayload,readTrainingExportPins} from '../.github/trainingExportGuard.mjs';

const pins=Object.fromEntries(exportPayloadPaths.map(p=>[p,'1'.repeat(40)]));
const paths=[...exportPayloadPaths,workflowPath],hash=p=>pins[p];
test('Training export guard accepts exactly the reviewed complete payload',()=>assert.equal(verifyTrainingExportPayload(paths,pins,hash).ok,true));
for(const path of paths)test('Training export guard rejects missing file '+path,()=>assert.equal(verifyTrainingExportPayload(paths.filter(p=>p!==path),pins,hash).ok,false));
for(const path of exportPayloadPaths)test('Training export guard rejects changed content '+path,()=>assert.equal(verifyTrainingExportPayload(paths,pins,p=>p===path?'2'.repeat(40):hash(p)).ok,false));
for(const path of ['backend/server.js','backend/services/trainingService.js','src/services/api.js','src/context/AuthContext.jsx','src/utils/authRoles.js','src/pages/FOActivities.jsx','src/pages/reliance-retail/RetailScopedDeepCleaning.jsx','src/pages/reliance-retail/RetailAttendance.jsx','src/pages/reliance-retail/RetailOperations.jsx','src/pages/reliance-retail/RetailOosWorkspace.jsx','Mobile_FO_V2/lib/main.dart','supabase/migrations/unapproved.sql','.env','outputs/unreviewed.xlsx','src/unreviewed.jsx']) {
  test('Training export guard rejects extra/protected file '+path,()=>assert.equal(verifyTrainingExportPayload([...paths,path],pins,hash).ok,false));
}
test('Training export guard rejects malformed, missing, empty and broadened pin maps',()=>{
  for(const map of [{},{...pins,'backend/server.js':'1'.repeat(40)},{...pins,'package.json':'unreviewed'}])assert.equal(verifyTrainingExportPayload(paths,map,hash).ok,false);
  assert.throws(()=>readTrainingExportPins('No pins'),/missing/);
});
test('Training export CI integration preserves every pre-existing safeguard and step',()=>{
  const original=execFileSync('git',['-c',`safe.directory=${process.cwd()}`,'show',`f15f390fcab107efd480f5889454fe8ca95c08ca:${workflowPath}`],{encoding:'utf8'}).replaceAll('\r\n','\n');
  let current=readFileSync(workflowPath,'utf8').replaceAll('\r\n','\n');
  readTrainingExportPins(current);
  current=current.replace(/^( *)# BEGIN DEEP CLEANING EXPORT [^\n]+\n[\s\S]*?^\1# END DEEP CLEANING EXPORT [^\n]+\n/gm,'');
  current=current.replace(/ {6}# BEGIN TRAINING EXPORT TRIGGERS\n[\s\S]*? {6}# END TRAINING EXPORT TRIGGERS\n/,'')
    .replace(/ {10}# BEGIN TRAINING EXPORT EXACT PAYLOAD\n[\s\S]*? {10}# END TRAINING EXPORT EXACT PAYLOAD\n/,'')
    .replace(/ {6}# BEGIN TRAINING EXPORT CHECKS\n[\s\S]*? {6}# END TRAINING EXPORT CHECKS\n/,'')
    .replace(/ {6}# BEGIN TRAINING EXPORT BROWSER CHECK\n[\s\S]*? {6}# END TRAINING EXPORT BROWSER CHECK\n/,'');
  assert.equal(current,original);
});
