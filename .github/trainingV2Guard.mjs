import {verifyCheckout as verifySharedCheckout} from './sharedIntegrity.mjs';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
export const approvedBase='eff30bf06e8d9c66c9fc03be8e5b7b9866b0bab4';
export const manifestPath='.github/training-v2-pins.json',guardPath='.github/trainingV2Guard.mjs',priorGuardPath='.github/thermographyV2Guard.mjs';
export const payloadPaths=Object.freeze([
  ".github/trainingV2Guard.mjs",
  ".github/workflows/reliance-training-v2.yml",
  ".gitignore",
  "backend/routes/trainingRoutes.js",
  "backend/services/relianceRetailManagementService.js",
  "backend/services/retailModuleReportService.js",
  "backend/services/trainingAccessService.js",
  "backend/services/trainingEntitlementService.js",
  "backend/services/trainingEvidenceService.js",
  "backend/services/trainingService.js",
  "backend/services/trainingWebService.js",
  "backend/shared/retailMisAccess.js",
  "backend/tests/fixtures/training_v2_installed_baseline.sql",
  "backend/tests/retailDashboardTrainingCount.test.js",
  "backend/tests/retailHkTrainingReadScope.test.js",
  "backend/tests/retailMisAccess.test.js",
  "backend/tests/retailModuleReportService.test.js",
  "backend/tests/trainingMobileV4.test.js",
  "backend/tests/trainingReleaseCompatibility.test.js",
  "backend/tests/trainingV2Database.test.js",
  "backend/tests/trainingV2Services.test.js",
  "docs/retail/TRAINING_V2_PHASE2.md",
  "docs/retail/screenshots/training-v2/training-categories-desktop.png",
  "docs/retail/screenshots/training-v2/training-categories-mobile.png",
  "src/components/user-management/EmployeeDetailsDrawer.jsx",
  "src/components/user-management/TrainingCategoriesPanel.jsx",
  "supabase/migrations/20261126064945_reliance_training_v2_entitlements_web_contract.sql",
  "supabase/proposals/training_v2_phase2_rollback.sql",
  "tests/thermographyFullstackGuard.test.js",
  "tests/trainingCategories.browser.test.js",
  "tests/trainingV2Guard.test.js"
]); // populated before review pins are generated
const normalize=s=>s.replaceAll('\r\n','\n');
export function reviewedPriorGuard(source,manifestHash,guardHash) {
 const anchor=' if(base===correctionBase&&fs.existsSync(correctionManifest)){';
 if(normalize(source).split(anchor).length!==2)throw Error('Prior guard anchor drift');
 const adapter=` // BEGIN TRAINING V2 EXACT PAYLOAD\n if(base==='${approvedBase}'&&fs.existsSync('${manifestPath}')){\n  const readHash=p=>git(working?['hash-object',\`--path=\${p}\`,p]:['rev-parse',\`HEAD:\${p}\`]).trim();\n  if(readHash('${manifestPath}')!=='${manifestHash}'||readHash('${guardPath}')!=='${guardHash}')throw Error('Training V2 review pins changed');\n  const {verifyCurrent}=await import('./trainingV2Guard.mjs');\n  const result=verifyCurrent(base,working);console.log(JSON.stringify(result));process.exit(result.ok?0:1);\n }\n // END TRAINING V2 EXACT PAYLOAD\n`;
 return normalize(source).replace(anchor,adapter+anchor);
}
export function verifyPayload({paths,manifest,hash,base,priorGuard,basePriorGuard}) {
 const expected=[...payloadPaths,manifestPath,priorGuardPath],missing=expected.filter(p=>!paths.includes(p)),unexpected=paths.filter(p=>!expected.includes(p));
 const pins=manifest.files||{},validManifest=base===approvedBase&&manifest.base_sha===approvedBase&&manifest.schema==='training-v2.phase2.v1'&&Object.keys(pins).length===payloadPaths.length&&payloadPaths.every(p=>/^[a-f0-9]{40}$/.test(pins[p]||''));
 const mismatched=payloadPaths.filter(p=>paths.includes(p)&&hash(p)!==pins[p]);
 const priorGuardMatches=normalize(priorGuard).trimEnd()===reviewedPriorGuard(basePriorGuard,hash(manifestPath),hash(guardPath)).trimEnd();
 return {ok:validManifest&&priorGuardMatches&&!missing.length&&!unexpected.length&&!mismatched.length,validManifest,priorGuardMatches,missing,unexpected,mismatched};
}
export function verifyCurrent(base,working=false) {
 if(fs.existsSync('.github/shared-integrity-pins.json'))return verifySharedCheckout(base,working);
 const git=args=>execFileSync('git',['-c',`safe.directory=${process.cwd()}`,...args],{encoding:'utf8'}).trim();
 const paths=git(['diff','--name-only',base,...(working?[]:['HEAD'])]).split('\n').filter(Boolean);
 if(working)paths.push(...git(['ls-files','--others','--exclude-standard']).split('\n').filter(Boolean));
 const read=p=>working?fs.readFileSync(p,'utf8'):git(['show',`HEAD:${p}`]);
 const hash=p=>git(working?['hash-object',`--path=${p}`,p]:['rev-parse',`HEAD:${p}`]);
 return verifyPayload({paths,base,manifest:JSON.parse(read(manifestPath)),hash,priorGuard:read(priorGuardPath),basePriorGuard:git(['show',`${approvedBase}:${priorGuardPath}`])});
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===fs.realpathSync(process.argv[1])) {
 const result=verifyCurrent(process.argv.find(a=>/^[a-f0-9]{40}$/.test(a)),process.argv.includes('--working-tree'));
 console.log(JSON.stringify(result));if(!result.ok)process.exitCode=1;
}
