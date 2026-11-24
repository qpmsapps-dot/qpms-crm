import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import * as g from '../.github/retailAttendanceCorrectionGuard.mjs';
test('correction authorization rejects every changed pin, missing path, extra module, base drift and workflow weakening',()=>{
 const paths=[...g.payloadPaths,g.manifestPath,g.workflowPath],hash=()=> '1'.repeat(40),baseWorkflow='          # BEGIN RETAIL ATTENDANCE EXCEPTIONS EXACT PAYLOAD\nall existing checks\n';
 const f={base:g.approvedBase,paths,hash,manifest:{schema:'retail-attendance-correction.v1',base_sha:g.approvedBase,files:Object.fromEntries(g.payloadPaths.map(p=>[p,hash()]))},baseWorkflow,workflow:g.reviewedWorkflow(baseWorkflow,hash(),hash())};
 assert.equal(g.verifyPayload(f).ok,true);
 for(const p of paths)assert.equal(g.verifyPayload({...f,paths:paths.filter(x=>x!==p)}).ok,false,p);
 for(const p of g.payloadPaths)assert.equal(g.verifyPayload({...f,hash:x=>x===p?'2'.repeat(40):hash()}).ok,false,p);
 for(const p of ['backend/server.js','Mobile_FO_V2/lib/main.dart','src/pages/FOActivities.jsx','backend/shared/retailAttendance.js','supabase/migrations/unapproved.sql','src/utils/authRoles.js','package-lock.json'])assert.equal(g.verifyPayload({...f,paths:[...paths,p]}).ok,false,p);
 assert.equal(g.verifyPayload({...f,base:'0'.repeat(40)}).ok,false);
 assert.equal(g.verifyPayload({...f,workflow:f.workflow+'skip checks'}).ok,false);
 assert.equal(g.verifyPayload({...f,workflow:f.workflow.replace('all existing checks','weakened checks')}).ok,false);
 assert.equal(g.verifyPayload({...f,manifest:{...f.manifest,files:{...f.manifest.files,extra:hash()}}}).ok,false);
});
test('protected credit/AOP/FO logic, original migrations, auth helpers and operational workflows stay byte-equivalent',()=>{
 const show=p=>execFileSync('git',['show',`${g.approvedBase}:${p}`],{encoding:'utf8'}).replaceAll('\r\n','\n');
 for(const p of ['backend/shared/retailAttendance.js','backend/shared/retailAttendanceNov2026.js','backend/shared/retailMisAccess.js','backend/services/retailAttendancePreviewAudit.js','backend/server.js','src/pages/FOActivities.jsx','package.json','package-lock.json','supabase/migrations_2_0/232_reliance_retail_uploaded_attendance.sql','supabase/migrations/20261102071258_retail_mis_four_roles.sql','.github/workflows/reliance-retail-operational-changes.yml','.github/workflows/retail-mis-mounted-auth.yml'])assert.equal(readFileSync(p,'utf8').replaceAll('\r\n','\n'),show(p),p);
 assert.equal(g.priorWorkflow(readFileSync(g.workflowPath,'utf8')).replaceAll('\r\n','\n'),show(g.workflowPath));
});
