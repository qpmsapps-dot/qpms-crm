import test from 'node:test';
import assert from 'node:assert/strict';
import {approvedBase,payloadPaths,manifestPath,guardPath,workflowPath,reviewedWorkflow,verifyPayload,git} from '../.github/deepCleaningV2Guard.mjs';
const baseWorkflow=git(['show',`${approvedBase}:${workflowPath}`]);
const hash=()=> '1'.repeat(40),paths=[...payloadPaths,manifestPath,workflowPath];
const manifest={schema:'deep-cleaning-v2.v1',base_sha:approvedBase,files:Object.fromEntries(payloadPaths.map(p=>[p,hash()]))};
const fixture=()=>({paths,manifest,hash,base:approvedBase,baseWorkflow,workflow:reviewedWorkflow(baseWorkflow,hash(manifestPath),hash(guardPath))});
test('only the complete content-pinned Deep Cleaning delta on reviewed current main passes',()=>assert.equal(verifyPayload(fixture()).ok,true));
for(const path of paths)test('missing file fails closed: '+path,()=>assert.equal(verifyPayload({...fixture(),paths:paths.filter(p=>p!==path)}).ok,false));
for(const path of payloadPaths)test('changed blob fails closed: '+path,()=>assert.equal(verifyPayload({...fixture(),hash:p=>p===path?'2'.repeat(40):hash()}).ok,false));
for(const path of ['backend/server.js','Mobile_FO_V2/lib/main.dart','backend/services/trainingAccessService.js','supabase/migrations/unreviewed.sql','.env','src/pages/FOActivities.jsx'])test('protected/extra file denied: '+path,()=>assert.equal(verifyPayload({...fixture(),paths:[...paths,path]}).ok,false));
test('wrong base, broadened manifest and modified workflow assertions remain denied',()=>{
 assert.equal(verifyPayload({...fixture(),base:'0'.repeat(40)}).ok,false);
 assert.equal(verifyPayload({...fixture(),manifest:{...manifest,files:{...manifest.files,'unrelated':'1'.repeat(40)}}}).ok,false);
 assert.equal(verifyPayload({...fixture(),workflow:fixture().workflow.replace('Protect business logic','Bypass business logic')}).ok,false);
});
