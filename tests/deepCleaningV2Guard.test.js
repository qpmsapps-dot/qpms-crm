import test from 'node:test';
import assert from 'node:assert/strict';
import {approvedBase,payloadPaths,manifestPath,guardPath,workflowPath,reviewedWorkflow,verifyPayload,git} from '../.github/deepCleaningV2Guard.mjs';
import {readFileSync} from 'node:fs';
import yaml from 'js-yaml';
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
test('dedicated workflow uses runner context only after a runner exists and keeps every gate mandatory',()=>{
 const workflow=yaml.load(readFileSync('.github/workflows/deep-cleaning-pr102-browser-validation.yml','utf8'));
 assert.equal(workflow.permissions.contents,'read');
 for(const job of Object.values(workflow.jobs)){
  assert.equal(job['runs-on'],'ubuntu-24.04','Native PG17 noble packages require the matching Ubuntu release');
  assert.equal(JSON.stringify(job.env||{}).includes('runner.'),false,'runner context is unavailable in jobs.<job_id>.env');
  assert.ok(job.steps.some(step=>step.run?.includes('deepCleaningStoreOnlyPostgres.test.js')));
  assert.equal(job.steps.some(step=>step['continue-on-error']),false);
 }
});

// The follow-up repair has its own fixed base and content pins; the historical
// V2 authorization above is unchanged.
import * as monthly from '../.github/deepCleaningMonthlyAdminGuard.mjs';
test('monthly administrator repair rejects every missing, changed and unrelated file',()=>{
 const paths=[...monthly.payloadPaths,monthly.manifestPath,monthly.workflowPath],hash=()=> '3'.repeat(40);
 const baseWorkflow='          # BEGIN DEEP CLEANING V2 EXACT PAYLOAD\nexisting checks\n';
 const f={base:monthly.approvedBase,paths,manifest:{schema:'cleaning-superadmin-import.v1',base_sha:monthly.approvedBase,files:Object.fromEntries(monthly.payloadPaths.map(p=>[p,hash()]))},hash,baseWorkflow,workflow:monthly.reviewedWorkflow(baseWorkflow,hash(),hash())};
 assert.equal(monthly.verifyPayload(f).ok,true);
 for(const path of paths)assert.equal(monthly.verifyPayload({...f,paths:paths.filter(p=>p!==path)}).ok,false,path);
 for(const path of monthly.payloadPaths)assert.equal(monthly.verifyPayload({...f,hash:p=>p===path?'4'.repeat(40):hash()}).ok,false,path);
 for(const path of ['backend/server.js','Mobile_FO_V2/lib/main.dart','src/pages/FOActivities.jsx','supabase/migrations/unreviewed.sql','.env'])assert.equal(monthly.verifyPayload({...f,paths:[...paths,path]}).ok,false,path);
 assert.equal(monthly.verifyPayload({...f,base:'0'.repeat(40)}).ok,false);
 assert.equal(monthly.verifyPayload({...f,workflow:f.workflow+'unreviewed'}).ok,false);
 assert.equal(monthly.verifyPayload({...f,manifest:{...f.manifest,files:{...f.manifest.files,extra:hash()}}}).ok,false);
});

import * as layout from '../.github/deepCleaningLayoutGuard.mjs';
import * as completedReports from '../.github/deepCleaningCompletedGuard.mjs';

test('completed-report correction requires exact base, every blob, and only the reviewed workflow insertion',()=>{
 const g=completedReports,paths=[...g.payloadPaths,g.manifestPath,g.workflowPath],hash=()=> '7'.repeat(40);
 const baseWorkflow='          # BEGIN DEEP CLEANING LAYOUT UI EXACT PAYLOAD\nall existing steps remain\n';
 const f={base:g.approvedBase,paths,hash,manifest:{schema:'deep-cleaning-completed.v1',base_sha:g.approvedBase,files:Object.fromEntries(g.payloadPaths.map(p=>[p,hash()]))},baseWorkflow,workflow:g.reviewedWorkflow(baseWorkflow,hash(),hash())};
 assert.equal(g.verifyPayload(f).ok,true);
 for(const p of paths)assert.equal(g.verifyPayload({...f,paths:paths.filter(x=>x!==p)}).ok,false,p);
 for(const p of g.payloadPaths)assert.equal(g.verifyPayload({...f,hash:x=>x===p?'8'.repeat(40):hash()}).ok,false,p);
 for(const p of ['backend/server.js','backend/shared/retailModuleReports.js','supabase/proposals/unreviewed.sql','Mobile_FO_V2/lib/main.dart','src/pages/FOActivities.jsx','src/components/reliance-retail/ThermographyReports.jsx','src/pages/reliance-retail/RetailTraining.jsx','src/utils/retailStatePerformance.js','package.json','.env'])assert.equal(g.verifyPayload({...f,paths:[...paths,p]}).ok,false,p);
 assert.equal(g.verifyPayload({...f,base:'0'.repeat(40)}).ok,false);
 assert.equal(g.verifyPayload({...f,manifest:{...f.manifest,files:{...f.manifest.files,extra:hash()}}}).ok,false);
 assert.equal(g.verifyPayload({...f,workflow:f.workflow+'unreviewed'}).ok,false);
 assert.equal(g.verifyPayload({...f,workflow:f.workflow.replace('all existing steps remain','skip checks')}).ok,false);
 assert.throws(()=>g.reviewedWorkflow('anchor missing',hash(),hash()));
});
test('frontend-only Deep Cleaning layout requires every exact blob and preserves all workflow checks',()=>{
 const paths=[...layout.payloadPaths,layout.manifestPath,layout.workflowPath],hash=()=> '5'.repeat(40);
 const baseWorkflow='          # BEGIN DEEP CLEANING MONTHLY ADMIN EXACT PAYLOAD\nexisting checks\n';
 const f={base:layout.approvedBase,paths,manifest:{schema:'deep-cleaning-layout-ui.v1',base_sha:layout.approvedBase,files:Object.fromEntries(layout.payloadPaths.map(p=>[p,hash()]))},hash,baseWorkflow,workflow:layout.reviewedWorkflow(baseWorkflow,hash(),hash())};
 assert.equal(layout.verifyPayload(f).ok,true);
 assert.equal(layout.payloadPaths.some(p=>/^(backend|supabase|Mobile_FO_V2)\//.test(p)),false);
 for(const path of paths)assert.equal(layout.verifyPayload({...f,paths:paths.filter(p=>p!==path)}).ok,false,path);
 for(const path of layout.payloadPaths)assert.equal(layout.verifyPayload({...f,hash:p=>p===path?'6'.repeat(40):hash()}).ok,false,path);
 for(const path of ['backend/routes/retailMisRoutes.js','backend/server.js','supabase/proposals/unreviewed.sql','Mobile_FO_V2/lib/main.dart','src/pages/FOActivities.jsx','src/components/reliance-retail/ThermographyReports.jsx','src/utils/deepCleaningView.js'])assert.equal(layout.verifyPayload({...f,paths:[...paths,path]}).ok,false,path);
 assert.equal(layout.verifyPayload({...f,base:'0'.repeat(40)}).ok,false);
 assert.equal(layout.verifyPayload({...f,workflow:f.workflow+'unreviewed'}).ok,false);
 assert.equal(layout.verifyPayload({...f,manifest:{...f.manifest,files:{...f.manifest.files,extra:hash()}}}).ok,false);
});
