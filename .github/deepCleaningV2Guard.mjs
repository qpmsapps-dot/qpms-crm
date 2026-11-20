import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {approvedBase as monthlyBase,manifestPath as monthlyManifest,verifyCurrent as verifyMonthly,verifyPayload as verifyMonthlyPayload,priorWorkflow as priorMonthlyWorkflow} from './deepCleaningMonthlyAdminGuard.mjs';
import {approvedBase as layoutBase,manifestPath as layoutManifest,verifyCurrent as verifyLayout,verifyPayload as verifyLayoutPayload,priorWorkflow as priorLayoutWorkflow} from './deepCleaningLayoutGuard.mjs';
import {approvedBase as completedBase,manifestPath as completedManifest,verifyCurrent as verifyCompleted,priorWorkflow as priorCompletedWorkflow} from './deepCleaningCompletedGuard.mjs';
export const approvedBase='3453b06aee160611a62755a9feaba8123a617886';
export const manifestPath='.github/deep-cleaning-v2-pins.json';
export const guardPath='.github/deepCleaningV2Guard.mjs';
export const workflowPath='.github/workflows/retail-ui-visual-checks.yml';
export const payloadPaths=Object.freeze([
 '.github/deepCleaningV2Guard.mjs',
 '.github/thermographyV2Guard.mjs',
 '.github/workflows/deep-cleaning-pr102-browser-validation.yml',
 'backend/routes/retailMisRoutes.js',
 'backend/services/retailCleaningPlanService.js',
 'backend/services/retailCleaningFoLinkService.js',
 'backend/services/retailModuleReportService.js',
 'backend/shared/retailModuleReports.js',
 'backend/tests/deepCleaningPhase1b.test.js',
 'backend/tests/deepCleaningMobileIntegration.test.js',
 'backend/tests/deepCleaningStoreOnlyPostgres.test.js',
 'backend/tests/deepCleaningWriterAccess.test.js',
 'backend/tests/fixtures/cleaningPlanValidatorBaseline.sql',
 'backend/tests/fixtures/cleaningPlanRpcBaseline.sql',
 'backend/tests/fixtures/cleaningScheduledFinalizerHistorical.sql',
 'backend/tests/fixtures/cleaningRequiredDocumentHistoricalPatch.sql',
 'backend/tests/retailCleaningPhase1.test.js',
 'backend/tests/retailModuleReportService.test.js',
 'docs/DEEP_CLEANING_V2_PRODUCTION_RELEASE.md',
 'src/components/reliance-retail/DeepCleaningEvidenceDrawer.jsx',
 'src/components/reliance-retail/DeepCleaningOverview.jsx',
 'src/components/reliance-retail/RetailCleaningMonthlyPlan.jsx',
 'src/components/reliance-retail/deepCleaningV2.css',
 'src/pages/reliance-retail/RetailScopedDeepCleaning.jsx',
 'src/utils/deepCleaningExport.js',
 'src/utils/deepCleaningExportFiles.js',
 'src/utils/deepCleaningView.js',
 'supabase/proposals/retail_cleaning_store_only_import_20261118.sql',
 'supabase/proposals/retail_cleaning_verified_matching_20261118.sql',
 'supabase/proposals/retail_cleaning_schedule_writer_20261118.sql',
 'supabase/proposals/retail_cleaning_v2_recovery_20261118.sql',
 'supabase/proposals/retail_cleaning_v2_activate_20261118.sql',
 'tests/deepCleaningExports.test.js',
 'tests/deepCleaningExports.browser.test.js',
 'tests/deepCleaningView.test.js',
 'tests/deepCleaningV2Guard.test.js',
 'tests/deepCleaningWorkflow.browser.test.js',
 'tests/thermographyFullstackGuard.test.js',
 'tests/thermographyReports.test.js',
 'tests/browser/retailExcelInline.spec.js'
]);
const normalize=s=>s.replaceAll('\r\n','\n');
export const git=args=>execFileSync('git',['-c',`safe.directory=${process.cwd()}`,...args],{encoding:'utf8'});
export function reviewedWorkflow(base,manifestHash,guardHash){
 const prefix=`          # BEGIN DEEP CLEANING V2 EXACT PAYLOAD\n          dc_manifest = "${manifestPath}"\n          if dc_manifest in files:\n            if subprocess.check_output(["git","rev-parse",f"HEAD:{dc_manifest}"],text=True).strip() != "${manifestHash}":\n              sys.exit("Deep Cleaning manifest changed; renew review")\n            if subprocess.check_output(["git","rev-parse","HEAD:${guardPath}"],text=True).strip() != "${guardHash}":\n              sys.exit("Deep Cleaning guard changed; renew review")\n            subprocess.run(["node","${guardPath}",base],check=True)\n            print("PASS: exact reviewed Deep Cleaning V2 payload; all subsequent checks remain mandatory.")\n            sys.exit(0)\n          # END DEEP CLEANING V2 EXACT PAYLOAD\n`;
 const trigger=`      # BEGIN DEEP CLEANING V2 TRIGGERS\n      - '${manifestPath}'\n      - '${guardPath}'\n      # END DEEP CLEANING V2 TRIGGERS\n`;
 const source=normalize(base),a='          # BEGIN THERMOGRAPHY V2 EXACT PAYLOAD\n',b='      # BEGIN THERMOGRAPHY V2 TRIGGERS\n';
 if(source.split(a).length!==2||source.split(b).length!==2)throw Error('Reviewed workflow anchors changed');
 return source.replace(a,prefix+a).replace(b,trigger+b);
}
export function verifyPayload({paths,manifest,hash,base,workflow,baseWorkflow}){
 const expected=new Set([...payloadPaths,manifestPath,workflowPath]),actual=new Set(paths),pins=manifest.files||{};
 const missing=[...expected].filter(p=>!actual.has(p)),unexpected=[...actual].filter(p=>!expected.has(p));
 const validManifest=base===approvedBase&&manifest.base_sha===approvedBase&&manifest.schema==='deep-cleaning-v2.v1'&&Object.keys(pins).length===payloadPaths.length&&payloadPaths.every(p=>/^[a-f0-9]{40}$/.test(pins[p]||''));
 const mismatched=payloadPaths.filter(p=>actual.has(p)&&hash(p)!==pins[p]);let workflowMatches=false;
 try{workflowMatches=normalize(workflow)===reviewedWorkflow(baseWorkflow,hash(manifestPath),hash(guardPath));}catch{/* Fail closed. */}
 return {ok:validManifest&&workflowMatches&&!missing.length&&!unexpected.length&&!mismatched.length,validManifest,workflowMatches,missing,unexpected,mismatched};
}
export function priorWorkflowForChecks(workflow){
 if(workflow.includes('# BEGIN DEEP CLEANING COMPLETED REPORT EXACT PAYLOAD'))workflow=priorCompletedWorkflow(workflow);
 if(workflow.includes('# BEGIN DEEP CLEANING LAYOUT UI EXACT PAYLOAD'))workflow=priorLayoutWorkflow(workflow);
 if(workflow.includes('# BEGIN DEEP CLEANING MONTHLY ADMIN EXACT PAYLOAD')){
  priorMonthlyWorkflow(workflow); // Validates the entire new workflow against current main.
  return git(['show',`${approvedBase}:${workflowPath}`]);
 }
 const base=git(['show',`${approvedBase}:${workflowPath}`]);
 const hash=p=>git(['hash-object',`--path=${p}`,p]).trim();
 if(normalize(workflow)!==reviewedWorkflow(base,hash(manifestPath),hash(guardPath)))throw Error('Unreviewed workflow alteration: Deep Cleaning');
 return base;
}
export function verifyCurrent(base,working=false){
 if(base===completedBase&&fs.existsSync(completedManifest))return verifyCompleted(base,working);
 if(fs.existsSync(layoutManifest)&&[layoutBase,monthlyBase,approvedBase].includes(base)){
  // Verify the new delta and the unchanged historical layout from committed blobs.
  let current;
  if(fs.existsSync(completedManifest)){
   const correction=verifyCompleted(completedBase,working),read=p=>git(['show',`${completedBase}:${p}`]);
   const layout=verifyLayoutPayload({base:layoutBase,paths:git(['diff','--name-only',layoutBase,completedBase]).trim().split('\n').filter(Boolean),manifest:JSON.parse(read(layoutManifest)),hash:p=>git(['rev-parse',`${completedBase}:${p}`]).trim(),workflow:read(workflowPath),baseWorkflow:git(['show',`${layoutBase}:${workflowPath}`])});
   current={...correction,ok:correction.ok&&layout.ok,layout};
  }else current=verifyLayout(layoutBase,working);
  if(base===layoutBase)return current;
  const read=p=>git(['show',`${layoutBase}:${p}`]);
  const monthly=verifyMonthlyPayload({base:monthlyBase,paths:git(['diff','--name-only',monthlyBase,layoutBase]).trim().split('\n').filter(Boolean),manifest:JSON.parse(read(monthlyManifest)),hash:p=>git(['rev-parse',`${layoutBase}:${p}`]).trim(),workflow:read(workflowPath),baseWorkflow:git(['show',`${monthlyBase}:${workflowPath}`])});
  if(base===monthlyBase)return {...current,ok:current.ok&&monthly.ok,monthly};
  const historicalRead=p=>git(['show',`${monthlyBase}:${p}`]);
  const historical=verifyPayload({base,paths:git(['diff','--name-only',base,monthlyBase]).trim().split('\n').filter(Boolean),manifest:JSON.parse(historicalRead(manifestPath)),hash:p=>git(['rev-parse',`${monthlyBase}:${p}`]).trim(),workflow:historicalRead(workflowPath),baseWorkflow:git(['show',`${base}:${workflowPath}`])});
  return {...current,ok:current.ok&&monthly.ok&&historical.ok,monthly,historical};
 }
 if(base===monthlyBase&&fs.existsSync(monthlyManifest))return verifyMonthly(base,working);
 if(base===approvedBase&&fs.existsSync(monthlyManifest)){
  // Historical preservation checks must verify both complete exact deltas:
  // the original V2 release, then this repair against its merged main base.
  const current=verifyMonthly(monthlyBase,working);
  const read=p=>git(['show',`${monthlyBase}:${p}`]);
  const historical=verifyPayload({base,paths:git(['diff','--name-only',base,monthlyBase]).trim().split('\n').filter(Boolean),manifest:JSON.parse(read(manifestPath)),hash:p=>git(['rev-parse',`${monthlyBase}:${p}`]).trim(),workflow:read(workflowPath),baseWorkflow:git(['show',`${base}:${workflowPath}`])});
  return {...current,ok:current.ok&&historical.ok,historical};
 }
 const paths=git(['diff','--name-only',base,...(working?[]:['HEAD'])]).trim().split('\n').filter(Boolean);
 if(working)paths.push(...git(['ls-files','--others','--exclude-standard']).trim().split('\n').filter(Boolean));
 const read=p=>working?fs.readFileSync(p,'utf8'):git(['show',`HEAD:${p}`]);
 const hash=p=>git(working?['hash-object',`--path=${p}`,p]:['rev-parse',`HEAD:${p}`]).trim();
 return verifyPayload({paths,manifest:JSON.parse(read(manifestPath)),hash,base,workflow:read(workflowPath),baseWorkflow:git(['show',`${approvedBase}:${workflowPath}`])});
}
if(process.argv[1]&&fs.existsSync(process.argv[1])&&fileURLToPath(import.meta.url)===fs.realpathSync(process.argv[1])){
 const base=process.argv.find(a=>/^[a-f0-9]{40}$/.test(a));if(!base)throw Error('Explicit reviewed base SHA required');
 const result=verifyCurrent(base,process.argv.includes('--working-tree'));console.log(JSON.stringify(result));if(!result.ok)process.exitCode=1;
}
