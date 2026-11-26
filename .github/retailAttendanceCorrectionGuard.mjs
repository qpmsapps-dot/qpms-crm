import {priorSharedWorkflow,verifyCheckout as verifySharedCheckout} from './sharedIntegrity.mjs';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
export const approvedBase='6db290b91612663c2b66c1b7ce2d7a1fb7ce817d';
export const manifestPath='.github/retail-attendance-correction-pins.json';
export const guardPath='.github/retailAttendanceCorrectionGuard.mjs';
export const workflowPath='.github/workflows/retail-ui-visual-checks.yml';
export const payloadPaths=Object.freeze([
 guardPath,'.github/retailAttendanceExceptionsGuard.mjs','.github/deepCleaningV2Guard.mjs','.github/thermographyV2Guard.mjs',
 '.github/workflows/retail-attendance-exceptions.yml',
 'backend/routes/retailMisRoutes.js','backend/services/retailAttendanceService.js','backend/services/retailAttendanceCommitService.js',
 'backend/tests/helpers/retailAttendanceCorrectionFixture.js','backend/tests/retailAttendanceCorrection.test.js','backend/tests/retailAttendanceCorrectionPostgres.test.js',
 'backend/tests/retailAttendancePreviewAudit.test.js','backend/tests/retailAttendanceUploadSize.test.js','backend/tests/retailAttendancePostgres.test.js',
 'src/pages/reliance-retail/RetailMisWorkspace.jsx','src/components/reliance-retail/RetailMisAttendanceUpload.jsx','src/utils/retailAttendanceCommit.js',
 'supabase/proposals/retail_attendance_correction_commit_20261124.sql',
 'tests/retailAttendanceCommit.test.js','tests/browser/retailAttendanceCorrection.spec.js','tests/browser/retailAttendanceCorrection.config.js','tests/retailAttendanceCorrectionGuard.test.js','tests/thermographyReports.test.js',
 'docs/RETAIL_ATTENDANCE_CORRECTION_REPAIR.md',
]);
const git=args=>execFileSync('git',['-c',`safe.directory=${process.cwd()}`,...args],{encoding:'utf8'});
const normalize=s=>s.replaceAll('\r\n','\n');
export function reviewedWorkflow(base,manifestHash,guardHash){
 const anchor='          # BEGIN RETAIL ATTENDANCE EXCEPTIONS EXACT PAYLOAD\n';
 if(normalize(base).split(anchor).length!==2)throw Error('Attendance correction authorization anchor drift');
 const block=`          # BEGIN RETAIL ATTENDANCE CORRECTION EXACT PAYLOAD
          correction_manifest = "${manifestPath}"
          if correction_manifest in files:
            if subprocess.check_output(["git","rev-parse",f"HEAD:{correction_manifest}"],text=True).strip() != "${manifestHash}":
              sys.exit("Attendance correction manifest changed; renew review")
            if subprocess.check_output(["git","rev-parse","HEAD:${guardPath}"],text=True).strip() != "${guardHash}":
              sys.exit("Attendance correction guard changed; renew review")
            subprocess.run(["node","${guardPath}",base],check=True)
            print("PASS: exact attendance correction payload; all subsequent checks remain mandatory.")
            sys.exit(0)
          # END RETAIL ATTENDANCE CORRECTION EXACT PAYLOAD
`;
 return normalize(base).replace(anchor,block+anchor);
}
export function verifyPayload({base,paths,manifest,hash,workflow,baseWorkflow}){
 const expected=[...payloadPaths,manifestPath,workflowPath];
 const validManifest=base===approvedBase&&manifest?.base_sha===approvedBase&&manifest.schema==='retail-attendance-correction.v1'&&Object.keys(manifest.files||{}).length===payloadPaths.length&&payloadPaths.every(p=>/^[a-f0-9]{40}$/.test(manifest.files[p]||''));
 const missing=expected.filter(p=>!paths.includes(p)),unexpected=paths.filter(p=>!expected.includes(p));
 const mismatched=payloadPaths.filter(p=>hash(p)!==manifest?.files?.[p]);let workflowMatches=false;
 try{workflowMatches=normalize(workflow)===reviewedWorkflow(baseWorkflow,hash(manifestPath),hash(guardPath));}catch{/* Fail closed. */}
 return {ok:validManifest&&workflowMatches&&!missing.length&&!unexpected.length&&!mismatched.length,validManifest,workflowMatches,missing,unexpected,mismatched};
}
export function verifyCurrent(base,working=false){
 if(fs.existsSync('.github/shared-integrity-pins.json'))return verifySharedCheckout(base,working);
 const paths=git(['diff','--name-only',base,...(working?[]:['HEAD'])]).trim().split('\n').filter(Boolean);
 if(working)paths.push(...git(['ls-files','--others','--exclude-standard']).trim().split('\n').filter(Boolean));
 const read=p=>working?fs.readFileSync(p,'utf8'):git(['show',`HEAD:${p}`]);
 const hash=p=>git(working?['hash-object',`--path=${p}`,p]:['rev-parse',`HEAD:${p}`]).trim();
 return verifyPayload({base,paths,manifest:JSON.parse(read(manifestPath)),hash,workflow:read(workflowPath),baseWorkflow:git(['show',`${approvedBase}:${workflowPath}`])});
}
export function priorWorkflow(workflow){
 workflow=priorSharedWorkflow(workflow);
 const base=git(['show',`${approvedBase}:${workflowPath}`]),hash=p=>git(['rev-parse',`eff30bf06e8d9c66c9fc03be8e5b7b9866b0bab4:${p}`]).trim();
 if(normalize(workflow)!==reviewedWorkflow(base,hash(manifestPath),hash(guardPath)))throw Error('Unreviewed workflow alteration: attendance correction');
 return base;
}
if(process.argv[1]&&fs.existsSync(process.argv[1])&&fileURLToPath(import.meta.url)===fs.realpathSync(process.argv[1])){
 const base=process.argv.find(a=>/^[a-f0-9]{40}$/.test(a));if(!base)throw Error('Explicit reviewed base SHA required');
 const result=verifyCurrent(base,process.argv.includes('--working-tree'));console.log(JSON.stringify(result));if(!result.ok)process.exitCode=1;
}
