import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {mainBase,manifestPath,guardPath,workflowPath,show,normalize,reviewedWorkflow,verifyPayload,verifyCheckout,priorSharedWorkflow} from '../.github/sharedIntegrity.mjs';
import {verifyHistoricalCorrection} from '../.github/sharedHistoricalChecks.mjs';
import {priorWorkflow as attendancePrior} from '../.github/retailAttendanceCorrectionGuard.mjs';
import {priorWorkflowForChecks as thermoPrior} from '../.github/thermographyV2Guard.mjs';
let cachedFixture;
function fixture(){
 if(cachedFixture)return cachedFixture;
 const pins=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
 const trainingFiles=JSON.parse(fs.readFileSync('.github/shared-training-pins.json','utf8')).files;
 const files={...trainingFiles,...pins.files},hash=p=>files[p]||'1'.repeat(40);
 const baseWorkflow=show(mainBase,workflowPath),manifestHash='1'.repeat(40);
 return cachedFixture={base:mainBase,paths:[...Object.keys(files),manifestPath,workflowPath],pins,trainingFiles,hash,baseWorkflow,manifestHash,workflow:reviewedWorkflow(baseWorkflow,manifestHash,hash(guardPath))};
}
test('current checkout and immutable Attendance release both require complete exact payloads',()=>{
 assert.equal(verifyCheckout().ok,true);
 assert.equal(verifyHistoricalCorrection().ok,true);
 assert.equal(verifyPayload(fixture()).ok,true);
});
const probes=JSON.parse(fs.readFileSync('.github/shared-integrity-probes.json','utf8'));
assert.equal(probes.length,85);
for(const {kind,name} of probes)test(`unauthorized probe: ${kind}: ${name}`,()=>{
 const f=fixture();let changed;
 if(kind==='missing file')changed={...f,paths:f.paths.filter(p=>p!==name)};
 else if(kind==='modified pinned file')changed={...f,hash:p=>p===name?'0'.repeat(40):f.hash(p)};
 else if(kind==='unrelated future modification')changed={...f,paths:[...f.paths,name]};
 else if(kind==='baseline drift')changed={...f,base:'0'.repeat(40)};
 else if(kind==='old guard tampering')changed={...f,hash:p=>p==='.github/thermographyV2Guard.mjs'?'0'.repeat(40):f.hash(p)};
 else if(kind==='manifest tampering'){
  const files={...f.pins.files};if(name==='missing pins')delete files[guardPath];else files['backend/server.js']='0'.repeat(40);
  changed={...f,pins:{...f.pins,files}};
 }else if(kind==='workflow tampering'){
  const edits={'remove build':['npm run build',''], 'remove security step':['Protect business logic and other modules','Removed protection'], 'broaden permissions':['contents: read','contents: write'],'skip tests':['node --test','echo skipped'],'extra trigger':['  workflow_dispatch:','  push:\n  workflow_dispatch:']};
  const [from,to]=edits[name];assert.ok(f.workflow.includes(from));changed={...f,workflow:f.workflow.replace(from,to)};
 }else throw Error('Unhandled original probe '+kind);
 assert.equal(verifyPayload(changed).ok,false,`${kind}: ${name}`);
});
test('all new shared files are mandatory and byte pinned; unknown paths fail closed',()=>{
 const f=fixture();
 for(const p of Object.keys(f.pins.files)){
  assert.equal(verifyPayload({...f,paths:f.paths.filter(x=>x!==p)}).ok,false,p);
  assert.equal(verifyPayload({...f,hash:x=>x===p?'0'.repeat(40):f.hash(x)}).ok,false,p);
 }
});
test('direct Attendance and Thermography consumers unwrap only the exact shared workflow',()=>{
 const workflow=fs.readFileSync(workflowPath,'utf8');
 assert.equal(normalize(priorSharedWorkflow(workflow)),normalize(show(mainBase,workflowPath)));
 assert.doesNotThrow(()=>attendancePrior(workflow));assert.doesNotThrow(()=>thermoPrior(workflow));
 assert.throws(()=>attendancePrior(workflow+'unauthorized'),/Unreviewed/);
 assert.throws(()=>thermoPrior(workflow+'unauthorized'),/Unreviewed/);
});
test('independent UI self-tests run before dispatch; no successful early exit remains',()=>{
 const workflow=fs.readFileSync(workflowPath,'utf8');
 assert.equal(workflow.includes('sys.exit(0)'),false);
 assert.ok(workflow.indexOf('assert phase6_payload_matches')<workflow.indexOf('if shared_manifest in files'));
 for(const token of ['negative_cases += 2','negative_cases += 1','protected_region(old) != protected_region(new)','if unexpected:','controls and references preserved.'])assert.ok(workflow.includes(token),token);
 const steps=s=>s.split('\n').filter(l=>/^      - (?:name:|uses:|run:)/.test(l));
 assert.deepEqual(steps(workflow),steps(show(mainBase,workflowPath)));
 const source=fs.readFileSync('tests/thermographyReports.test.js','utf8').split("test('unrelated modules, mobile")[1];
 assert.equal(/\breturn\s*;/.test(source),false);
 assert.ok(source.includes('executed.length,11'));
});
