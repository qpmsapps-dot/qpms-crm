import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {cleaningPayloadPaths,readCleaningExportPins,verifyCleaningExportPayload} from '../.github/deepCleaningExportGuard.mjs';
import {exportPayloadPaths as trainingPaths,workflowPath} from '../.github/trainingExportGuard.mjs';
import {priorWorkflowForChecks} from '../.github/thermographyFullstackGuard.mjs';
const pins=Object.fromEntries(cleaningPayloadPaths.map(p=>[p,'1'.repeat(40)])),training=Object.fromEntries(trainingPaths.map(p=>[p,'1'.repeat(40)]));
for(const combined of [false,true]){
  const paths=[...new Set([...cleaningPayloadPaths,...(combined?trainingPaths:[]),workflowPath])];
  test(`exact export guard accepts ${combined?'combined':'stacked'} payload`,()=>assert.equal(verifyCleaningExportPayload(paths,pins,training,()=> '1'.repeat(40)).ok,true));
  for(const p of paths)test(`guard rejects missing ${combined} ${p}`,()=>assert.equal(verifyCleaningExportPayload(paths.filter(x=>x!==p),pins,training,()=> '1'.repeat(40)).ok,false));
  for(const p of ['backend/server.js','backend/services/clientDeepCleaningService.js','src/pages/DeepCleaning.jsx','src/services/api.js','Mobile_FO_V2/lib/main.dart','supabase/migrations/unsafe.sql','.env','src/pages/reliance-retail/RetailAttendance.jsx','generated.xlsx'])test(`guard rejects protected/extra ${combined} ${p}`,()=>assert.equal(verifyCleaningExportPayload([...paths,p],pins,training,()=> '1'.repeat(40)).ok,false));
  for(const p of paths.filter(p=>p!==workflowPath))test(`guard rejects changed content ${combined} ${p}`,()=>assert.equal(verifyCleaningExportPayload(paths,pins,training,x=>x===p?'2'.repeat(40):'1'.repeat(40)).ok,false));
}
test('malformed/broadened maps fail closed',()=>{
  const paths=[...cleaningPayloadPaths,workflowPath];for(const p of [{},{...pins,'backend/server.js':'1'.repeat(40)},{...pins,[cleaningPayloadPaths[0]]:'invalid'}])assert.equal(verifyCleaningExportPayload(paths,p,training,()=> '1'.repeat(40)).ok,false);assert.throws(()=>readCleaningExportPins('none'),/missing/);
});
test('all existing Training and application workflow safeguards remain byte-for-byte intact',()=>{
  const original=execFileSync('git',['-c',`safe.directory=${process.cwd()}`,'show',`56d5be2434d0f994305d76057da5e3f1cbb17cfb:${workflowPath}`],{encoding:'utf8'}).replaceAll('\r\n','\n');
  const current=priorWorkflowForChecks(readFileSync(workflowPath,'utf8'));readCleaningExportPins(current);
  assert.equal(current.replace(/^( *)# BEGIN DEEP CLEANING EXPORT [^\n]+\n[\s\S]*?^\1# END DEEP CLEANING EXPORT [^\n]+\n/gm,''),original);
});
