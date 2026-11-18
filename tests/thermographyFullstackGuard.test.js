import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {approvedBase,manifestPath,workflowPath,guardPath,payloadPaths,reviewedWorkflow,verifyThermographyPayload} from '../.github/thermographyV2Guard.mjs';
import {priorWorkflowForChecks} from '../.github/thermographyV2Guard.mjs';

test('main dependency versions and existing operational/HK/leadership workflows are preserved',()=>{
 const show=p=>execFileSync('git',['show',`${approvedBase}:${p}`],{encoding:'utf8'});
 const before=JSON.parse(show('package.json')),after=JSON.parse(readFileSync('package.json','utf8'));
 assert.deepEqual(after.dependencies,before.dependencies);
 assert.deepEqual(after.devDependencies,{...before.devDependencies,'@electric-sql/pglite':'0.3.14','tus-js-client':'4.3.1'});
 const oldLock=JSON.parse(show('package-lock.json')),newLock=JSON.parse(readFileSync('package-lock.json','utf8'));
 for(const [path,node] of Object.entries(oldLock.packages))if(path)assert.equal(newLock.packages[path].version,node.version,path);
 for(const path of Object.keys(newLock.packages).filter(p=>p&&!oldLock.packages[p]))assert.equal(newLock.packages[path].dev,true,path);
 for(const path of ['.github/workflows/reliance-retail-operational-changes.yml','.github/workflows/retail-mis-mounted-auth.yml','.github/workflows/km-recalculation-tests.yml','.github/workflows/october-km-admin-approval.yml'])assert.equal(readFileSync(path,'utf8').replaceAll('\r\n','\n'),show(path).replaceAll('\r\n','\n'),path);
});

function fixture(){
 const files=Object.fromEntries(payloadPaths.map(p=>[p,'a'.repeat(40)]));
 const manifest={schema:'thermography-v2.v1',base_sha:approvedBase,files};
 const paths=[...payloadPaths,manifestPath,workflowPath],hash=()=> 'a'.repeat(40);
 const baseWorkflow="      # BEGIN DEEP CLEANING EXPORT TRIGGERS\n          # BEGIN DEEP CLEANING EXPORT EXACT PAYLOAD\nprotected subsequent checks\n";
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
test('historical Thermography integration stays exact and the current workflow preserves every existing check',()=>{
 const git=args=>execFileSync('git',['-c',`safe.directory=${process.cwd()}`,...args],{encoding:'utf8'}).trim();
 const historical='3453b06aee160611a62755a9feaba8123a617886';
 const hash=p=>git(['rev-parse',`${historical}:${p}`]);
 const workflow=readFileSync(workflowPath,'utf8'),baseWorkflow=git(['show',`${approvedBase}:${workflowPath}`])+'\n';
 assert.equal(priorWorkflowForChecks(workflow),baseWorkflow.replaceAll('\r\n','\n'));
 assert.throws(()=>priorWorkflowForChecks(workflow+'unreviewed change\n'),/Unreviewed workflow alteration/);
 const paths=git(['diff','--name-only',approvedBase,historical]).split('\n').filter(Boolean);
 const historicalWorkflow=git(['show',`${historical}:${workflowPath}`])+'\n';
 assert.deepEqual(verifyThermographyPayload({paths,manifest:JSON.parse(git(['show',`${historical}:${manifestPath}`])),hash,base:approvedBase,workflow:historicalWorkflow,baseWorkflow}),
  {ok:true,validManifest:true,workflowMatches:true,missing:[],unexpected:[],mismatched:[]});
 const dedicated=readFileSync('.github/workflows/thermography-fullstack.yml','utf8');
 for(const required of ['contents: read','RUN_THERMOGRAPHY_NATIVE_POSTGRES_TESTS: true','thermographyReports.concurrent.test.js','thermographyReports.browser.test.js','retailMisMountedAuth.test.js','npm run build'])assert.ok(dedicated.includes(required),required);
 assert.equal(/continue-on-error|pull_request_target|secrets\.|railway|supabase (?:db|migration)/i.test(dedicated),false);
});
