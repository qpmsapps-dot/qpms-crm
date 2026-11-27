import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {mainBase,manifestPath,guardPath,workflowPath,show,normalize,reviewedWorkflow,verifyPayload,verifyCheckout} from '../.github/sharedIntegrity.mjs';
const base='65b5d3ce2b7af23d270022c887c920e5f26cc503';
const training=JSON.parse(fs.readFileSync('.github/shared-training-pins.json','utf8'));
function fixture(){
 const pins=JSON.parse(fs.readFileSync(manifestPath,'utf8')),files={...training.files,...pins.files},hash=p=>files[p]||'1'.repeat(40),manifestHash='1'.repeat(40),baseWorkflow=show(mainBase,workflowPath);
 return {base,paths:[...Object.keys(files),manifestPath,workflowPath],pins,hash,manifestHash,trainingFiles:training.files,baseWorkflow,workflow:reviewedWorkflow(baseWorkflow,manifestHash,hash(guardPath))};
}
test('Phase 3 is stacked on the exact PR 126 candidate and accepts only its complete pinned payload',()=>{
 assert.equal(training.phase3_base_sha,base);
 assert.ok(training.phase3_files.includes('Mobile_FO_V2/lib/training/screens/mepc_training_screen.dart'));
 assert.ok(training.phase3_files.includes('src/pages/reliance-retail/RetailTrainingUpload.jsx'));
 assert.ok(training.phase3_files.includes('.github/workflows/reliance-training-phase3.yml'));
 assert.equal(new Set(training.phase3_files).size,training.phase3_files.length);
 assert.equal(verifyCheckout(base,true).ok,true);assert.equal(verifyPayload(fixture()).ok,true);
});
test('every reviewed Phase 3 path is mandatory and every modified byte or extra module is rejected',()=>{
 const f=fixture();
 for(const p of training.phase3_files){
  assert.equal(verifyPayload({...f,paths:f.paths.filter(x=>x!==p)}).ok,false,p);
  if(p===manifestPath)assert.equal(verifyPayload({...f,pins:{...f.pins,schema:'unreviewed'}}).ok,false,p);
  else if(p===workflowPath)assert.equal(verifyPayload({...f,workflow:f.workflow+'# unreviewed\n'}).ok,false,p);
  else assert.equal(verifyPayload({...f,hash:x=>x===p?'0'.repeat(40):f.hash(x)}).ok,false,p);
 }
 for(const p of ['backend/server.js','Mobile_FO_V2/lib/main.dart','backend/services/retailAttendanceService.js','backend/services/clientDeepCleaningService.js','supabase/migrations/unreviewed.sql'])assert.equal(verifyPayload({...f,paths:[...f.paths,p]}).ok,false,p);
});
test('HK, SQL, release gates, original 85 probes and shared verifier keep the exact candidate source',()=>{
 for(const p of ['Mobile_FO_V2/lib/training/screens/hk_training_screen.dart','supabase/migrations/20261126064945_reliance_training_v2_entitlements_web_contract.sql','supabase/proposals/training_v2_phase2_rollback.sql','.github/sharedIntegrity.mjs','.github/shared-integrity-probes.json','.github/workflows/reliance-training-v2.yml','.github/workflows/thermography-fullstack.yml','.github/workflows/shared-ci-integrity.yml'])assert.equal(normalize(fs.readFileSync(p,'utf8')),normalize(show(base,p)),p);
 assert.equal(JSON.parse(fs.readFileSync('.github/shared-integrity-probes.json','utf8')).length,85);
 const workflow=fs.readFileSync('.github/workflows/reliance-training-phase3.yml','utf8');
 for(const required of ['contents: read','trainingPhase3Guard.test.js','flutter test --no-pub test/training','trainingRegional.browser.test.js','trainingCategories.browser.test.js','npm run build'])assert.ok(workflow.includes(required),required);
 assert.equal(/continue-on-error|pull_request_target|secrets\.|flutter build|railway|supabase (?:db|migration)/i.test(workflow),false);
});
