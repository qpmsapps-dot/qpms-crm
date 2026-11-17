import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const approvedBase='46707ec63c440d015c21339b00c423b461089ff1';
export const manifestPath='.github/retail-reporting-repair-pins.json';
export const workflowPath='.github/workflows/retail-ui-visual-checks.yml';
export const guardPath='.github/retailReportingRepairGuard.mjs';
// This is an exact one-release payload, not a general backend/SQL allowlist.
export const payloadPaths=Object.freeze([
 ".github/retailReportingRepairGuard.mjs",
 ".github/workflows/retail-reporting-repair.yml",
 "backend/routes/relianceRetailManagementRoutes.js",
 "backend/routes/retailMisRoutes.js",
 "backend/services/retailHkMisOperationsService.js",
 "backend/services/retailModuleReportService.js",
 "backend/shared/retailMisAccess.js",
 "backend/tests/fixtures/retailReportingSnapshotBaseline.json",
 "backend/tests/helpers/nativeRetailReportingPostgres.js",
 "backend/tests/retailHkMisOperationsService.test.js",
 "backend/tests/retailModuleReportService.test.js",
 "backend/tests/retailReportPerformance.test.js",
 "backend/tests/retailReportingRepairPostgres.test.js",
 "docs/RETAIL_REPORTING_REPAIR_20261117.md",
 "src/components/Sidebar.jsx",
 "src/pages/reliance-retail/RetailFieldOperations.jsx",
 "src/pages/reliance-retail/RetailHkMisWorkspace.jsx",
 "src/routes/AppRoutes.jsx",
 "supabase/proposals/20261117_retail_reporting_repair_REVIEW.sql",
 "supabase/proposals/20261117_retail_reporting_repair_ROLLBACK_REVIEW.sql",
 "tests/browser/hkMisWorkspace.spec.js",
 "tests/browser/retailSouthHeadOperations.spec.js",
 "tests/deepCleaningExportGuard.test.js",
 "tests/retailReportingRepairGuard.test.js",
 "tests/trainingExportGuard.test.js"
]);
const normalize=text=>text.replaceAll('\r\n','\n');
export function reviewedWorkflow(baseWorkflow,manifestHash,guardHash){
 const triggers=`      # BEGIN RETAIL REPORTING REPAIR FULLSTACK TRIGGERS\n      - '${manifestPath}'\n      - '${guardPath}'\n      - '.github/workflows/retail-reporting-repair.yml'\n      - 'tests/retailReportingRepairGuard.test.js'\n      # END RETAIL REPORTING REPAIR FULLSTACK TRIGGERS\n`;
 const authorization=`          # BEGIN RETAIL REPORTING REPAIR FULLSTACK EXACT PAYLOAD\n          thermo_manifest = "${manifestPath}"\n          if thermo_manifest in files:\n            if subprocess.check_output(["git","rev-parse",f"HEAD:{thermo_manifest}"],text=True).strip() != "${manifestHash}":\n              sys.exit("Retail reporting repair manifest changed; renew full-stack review")\n            if subprocess.check_output(["git","rev-parse","HEAD:${guardPath}"],text=True).strip() != "${guardHash}":\n              sys.exit("Retail reporting repair guard changed; renew full-stack review")\n            subprocess.run(["node", "${guardPath}", base],check=True)\n            print("PASS: exact Retail reporting repair payload; all following UI checks and dedicated full-stack checks remain mandatory.")\n            sys.exit(0)\n          # END RETAIL REPORTING REPAIR FULLSTACK EXACT PAYLOAD\n`;
 const source=normalize(baseWorkflow);
 const triggerAnchor="      - 'src/hooks/useModalFocus.js'\n";
 const authAnchor='          # BEGIN DEEP CLEANING EXPORT EXACT PAYLOAD\n';
 if(source.split(triggerAnchor).length!==2||source.split(authAnchor).length!==2)throw Error('Existing workflow anchors changed');
 return source.replace(triggerAnchor,triggerAnchor+triggers).replace(authAnchor,authorization+authAnchor);
}
export function verifyRepairPayload({paths,manifest,hash,base,workflow,baseWorkflow}){
 const expected=new Set([...payloadPaths,manifestPath,workflowPath]),actual=new Set(paths);
 const missing=[...expected].filter(p=>!actual.has(p)),unexpected=[...actual].filter(p=>!expected.has(p));
 const pins=manifest.files||{};
 const validManifest=manifest.schema==='retail-reporting-repair.v1'&&manifest.base_sha===approvedBase&&base===approvedBase
  &&Object.keys(pins).length===payloadPaths.length&&payloadPaths.every(p=>/^[a-f0-9]{40}$/.test(pins[p]||''));
 const mismatched=payloadPaths.filter(p=>actual.has(p)&&hash(p)!==pins[p]);
 let workflowMatches=false;
 try{workflowMatches=normalize(workflow)===reviewedWorkflow(baseWorkflow,hash(manifestPath),hash(guardPath));}catch{/* fail closed */}
 return {ok:validManifest&&workflowMatches&&!missing.length&&!unexpected.length&&!mismatched.length,
  validManifest,workflowMatches,missing,unexpected,mismatched};
}
// Existing export guard tests still compare their exact historical workflows.
// Remove no arbitrary text: first require this release's entire workflow to match.
export function priorWorkflowForChecks(workflow){
 const git=args=>execFileSync('git',['-c',`safe.directory=${process.cwd()}`,...args],{encoding:'utf8'});
 const base=git(['show',`${approvedBase}:${workflowPath}`]);
 const hash=p=>git(['hash-object',`--path=${p}`,p]).trim();
 if(normalize(workflow)!==reviewedWorkflow(base,hash(manifestPath),hash(guardPath)))throw Error('Unreviewed workflow alteration');
 return normalize(base);
}
if(process.argv[1]&&fs.existsSync(process.argv[1])&&fileURLToPath(import.meta.url)===fs.realpathSync(process.argv[1])){
 const git=args=>execFileSync('git',['-c',`safe.directory=${process.cwd()}`,...args],{encoding:'utf8'}).trim();
 const working=process.argv.includes('--working-tree'),base=process.argv.find(a=>/^[a-f0-9]{40}$/.test(a));
 if(!base)throw Error('Explicit reviewed base SHA required');
 const paths=git(['diff','--name-only',base,...(working?[]:['HEAD'])]).split('\n').filter(Boolean);
 if(working)paths.push(...git(['ls-files','--others','--exclude-standard']).split('\n').filter(Boolean));
 const read=p=>working?fs.readFileSync(p,'utf8'):git(['show',`HEAD:${p}`])+'\n';
 const hash=p=>git(working?['hash-object',`--path=${p}`,p]:['rev-parse',`HEAD:${p}`]);
 const result=verifyRepairPayload({paths,manifest:JSON.parse(read(manifestPath)),hash,base,
  workflow:read(workflowPath),baseWorkflow:git(['show',`${approvedBase}:${workflowPath}`])+'\n'});
 console.log(JSON.stringify(result));if(!result.ok)process.exitCode=1;
}
