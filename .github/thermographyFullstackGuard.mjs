import {priorV2WorkflowForChecks} from './thermographyV2Guard.mjs';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const approvedBase='f23bb8ac03afcba3222b9738369a01043ede2d11';
export const manifestPath='.github/thermography-fullstack-pins.json';
export const workflowPath='.github/workflows/retail-ui-visual-checks.yml';
export const guardPath='.github/thermographyFullstackGuard.mjs';
// This is an exact one-release payload, not a general backend/SQL allowlist.
export const payloadPaths=Object.freeze([
 guardPath,'.github/workflows/thermography-fullstack.yml','tests/thermographyFullstackGuard.test.js',
 'tests/trainingExportGuard.test.js','tests/deepCleaningExportGuard.test.js',
 'backend/routes/relianceRetailManagementRoutes.js','backend/routes/thermographyReportsRoutes.js',
 'backend/services/retailModuleReportService.js','backend/services/thermographyReportsService.js','backend/services/thermographyWorkbook.js',
 'backend/shared/retailOperations.js','backend/tests/helpers/nativeThermographyPostgres.js',
 'backend/tests/helpers/thermographyFixture.js','backend/tests/helpers/thermographyServiceFixture.js',
 'backend/tests/thermographyReports.concurrent.test.js','backend/tests/thermographyReports.database.test.js',
 'backend/tests/thermographyReports.limits.test.js','backend/tests/thermographyReports.test.js',
 'docs/THERMOGRAPHY_REPORTS_RELEASE.md','package.json','package-lock.json',
 'src/components/reliance-retail/ThermographyReports.jsx','src/components/reliance-retail/thermographyReports.css',
 'src/pages/reliance-retail/RetailDashboard.jsx','src/pages/reliance-retail/RetailMisWorkspace.jsx',
 'src/pages/reliance-retail/RetailOperations.jsx','src/utils/retailExecutiveReport.js','src/utils/thermographyReports.js',
 'supabase/migrations/20261115140000_retail_thermography_reports.sql',
 'supabase/verification/retail_thermography_reports_postinstall_read_only.sql',
 'supabase/verification/retail_thermography_reports_preflight_read_only.sql',
 'tests/browser/retailReportVisualSmoke.spec.js','tests/browser/ifmsDashboard.spec.js','tests/retailOperationsShapeBrowser.test.js',
 'tests/thermographyReports.browser.test.js','tests/thermographyReports.test.js',
 'src/utils/thermographyTusUpload.js','tests/thermographyTusUpload.test.js',
]);
const normalize=text=>text.replaceAll('\r\n','\n');
export function reviewedWorkflow(baseWorkflow,manifestHash,guardHash){
 const triggers=`      # BEGIN THERMOGRAPHY FULLSTACK TRIGGERS\n      - '${manifestPath}'\n      - '${guardPath}'\n      - '.github/workflows/thermography-fullstack.yml'\n      - 'tests/thermographyFullstackGuard.test.js'\n      # END THERMOGRAPHY FULLSTACK TRIGGERS\n`;
 const authorization=`          # BEGIN THERMOGRAPHY FULLSTACK EXACT PAYLOAD\n          thermo_manifest = "${manifestPath}"\n          if thermo_manifest in files:\n            if subprocess.check_output(["git","rev-parse",f"HEAD:{thermo_manifest}"],text=True).strip() != "${manifestHash}":\n              sys.exit("Thermography manifest changed; renew full-stack review")\n            if subprocess.check_output(["git","rev-parse","HEAD:${guardPath}"],text=True).strip() != "${guardHash}":\n              sys.exit("Thermography guard changed; renew full-stack review")\n            subprocess.run(["node", "${guardPath}", base],check=True)\n            print("PASS: exact Thermography payload; all following UI checks and dedicated full-stack checks remain mandatory.")\n            sys.exit(0)\n          # END THERMOGRAPHY FULLSTACK EXACT PAYLOAD\n`;
 const source=normalize(baseWorkflow);
 const triggerAnchor="      - 'src/hooks/useModalFocus.js'\n";
 const authAnchor='          # BEGIN DEEP CLEANING EXPORT EXACT PAYLOAD\n';
 if(source.split(triggerAnchor).length!==2||source.split(authAnchor).length!==2)throw Error('Existing workflow anchors changed');
 return source.replace(triggerAnchor,triggerAnchor+triggers).replace(authAnchor,authorization+authAnchor);
}
export function verifyThermographyPayload({paths,manifest,hash,base,workflow,baseWorkflow}){
 const expected=new Set([...payloadPaths,manifestPath,workflowPath]),actual=new Set(paths);
 const missing=[...expected].filter(p=>!actual.has(p)),unexpected=[...actual].filter(p=>!expected.has(p));
 const pins=manifest.files||{};
 const validManifest=manifest.schema==='thermography-fullstack.v1'&&manifest.base_sha===approvedBase&&base===approvedBase
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
 if(workflow.includes('# BEGIN THERMOGRAPHY V2 EXACT PAYLOAD'))return priorV2WorkflowForChecks(workflow);
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
 const result=verifyThermographyPayload({paths,manifest:JSON.parse(read(manifestPath)),hash,base,
  workflow:read(workflowPath),baseWorkflow:git(['show',`${approvedBase}:${workflowPath}`])+'\n'});
 console.log(JSON.stringify(result));if(!result.ok)process.exitCode=1;
}
