import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {approvedBase,manifestPath,workflowPath,guardPath,payloadPaths,reviewedWorkflow,verifyThermographyPayload,priorWorkflowForChecks} from '../.github/thermographyFullstackGuard.mjs';

function fixture(){
 const files=Object.fromEntries(payloadPaths.map(p=>[p,'a'.repeat(40)]));
 const manifest={schema:'thermography-fullstack.v1',base_sha:approvedBase,files};
 const paths=[...payloadPaths,manifestPath,workflowPath],hash=()=> 'a'.repeat(40);
 const baseWorkflow="      - 'src/hooks/useModalFocus.js'\n          # BEGIN DEEP CLEANING EXPORT EXACT PAYLOAD\nprotected subsequent checks\n";
 return {paths,manifest,hash,base:approvedBase,baseWorkflow,workflow:reviewedWorkflow(baseWorkflow,hash(),hash())};
}
test('exact Thermography full-stack payload passes only the pinned base and workflow addition',()=>{
 assert.equal(verifyThermographyPayload(fixture()).ok,true);
 assert.equal(new Set(payloadPaths).size,payloadPaths.length);
});
test('every omitted file, extra protected path and changed file fails closed',()=>{
 const f=fixture();
 for(const path of f.paths)assert.equal(verifyThermographyPayload({...f,paths:f.paths.filter(p=>p!==path)}).ok,false,path);
 for(const path of ['backend/server.js','Mobile_FO_V2/lib/main.dart','backend/services/trainingService.js','backend/services/clientDeepCleaningService.js','supabase/migrations/unreviewed.sql','.github/workflows/other.yml'])
  assert.equal(verifyThermographyPayload({...f,paths:[...f.paths,path]}).ok,false,path);
 for(const path of payloadPaths)assert.equal(verifyThermographyPayload({...f,hash:p=>p===path?'b'.repeat(40):f.hash(p)}).ok,false,path);
});
test('base, manifest/pins, authorization pins and unrelated workflow edits cannot self-authorize',()=>{
 const f=fixture();
 for(const manifest of [{...f.manifest,schema:'other'},{...f.manifest,base_sha:'0'.repeat(40)},{...f.manifest,files:{}},{...f.manifest,files:{...f.manifest.files,unexpected:'a'.repeat(40)}}])
  assert.equal(verifyThermographyPayload({...f,manifest}).ok,false);
 assert.equal(verifyThermographyPayload({...f,base:'0'.repeat(40)}).ok,false);
 for(const path of [manifestPath,guardPath])assert.equal(verifyThermographyPayload({...f,hash:p=>p===path?'b'.repeat(40):f.hash(p)}).ok,false);
 for(const workflow of [f.baseWorkflow,f.workflow+'unreviewed change\n',f.workflow.replace('protected subsequent checks','removed checks')])
  assert.equal(verifyThermographyPayload({...f,workflow}).ok,false);
});
test('actual integration manifest preserves all existing UI guard checks and pins the dedicated native/browser checks',()=>{
 const git=args=>execFileSync('git',['-c',`safe.directory=${process.cwd()}`,...args],{encoding:'utf8'}).trim();
 const hash=p=>git(['hash-object',`--path=${p}`,p]);
 const workflow=readFileSync(workflowPath,'utf8'),baseWorkflow=git(['show',`${approvedBase}:${workflowPath}`])+'\n';
 assert.equal(priorWorkflowForChecks(workflow),baseWorkflow.replaceAll('\r\n','\n'));
 assert.throws(()=>priorWorkflowForChecks(workflow+'unreviewed change\n'),/Unreviewed workflow alteration/);
 const paths=git(['diff','--name-only',approvedBase]).split('\n').filter(Boolean).concat(git(['ls-files','--others','--exclude-standard']).split('\n').filter(Boolean));
 assert.deepEqual(verifyThermographyPayload({paths,manifest:JSON.parse(readFileSync(manifestPath,'utf8')),hash,base:approvedBase,workflow,baseWorkflow}),
  {ok:true,validManifest:true,workflowMatches:true,missing:[],unexpected:[],mismatched:[]});
 const dedicated=readFileSync('.github/workflows/thermography-fullstack.yml','utf8');
 for(const required of ['contents: read','RUN_THERMOGRAPHY_NATIVE_POSTGRES_TESTS: true','thermographyReports.concurrent.test.js','thermographyReports.browser.test.js','retailMisMountedAuth.test.js','npm run build'])assert.ok(dedicated.includes(required),required);
 assert.equal(/continue-on-error|pull_request_target|secrets\.|railway|supabase (?:db|migration)/i.test(dedicated),false);
});
