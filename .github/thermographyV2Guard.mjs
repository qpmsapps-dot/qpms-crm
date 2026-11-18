import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
export const approvedBase='b1a927387bef88aa416a6ee3c60a05dbdcd08426';
export const manifestPath='.github/thermography-v2-pins.json';
export const guardPath='.github/thermographyV2Guard.mjs';
export const workflowPath='.github/workflows/retail-ui-visual-checks.yml';
export const payloadPaths=Object.freeze([
 guardPath,'.github/thermographyFullstackGuard.mjs','.github/workflows/thermography-fullstack.yml','tests/thermographyFullstackGuard.test.js',
 'backend/routes/thermographyReportsRoutes.js','backend/services/thermographyReportsService.js','backend/services/thermographyPdf.js','backend/services/thermographySchedule.js','backend/services/thermographyScheduleWorker.js','backend/services/thermographyDashboard.js',
 'backend/tests/helpers/thermographyFixture.js','backend/tests/helpers/thermographyServiceFixture.js','backend/tests/thermographyReports.concurrent.test.js','backend/tests/thermographyReports.database.test.js','backend/tests/thermographyReports.limits.test.js','backend/tests/thermographyReports.test.js','backend/tests/thermographySchedule.test.js','backend/tests/thermographyDashboard.test.js',
 'src/components/reliance-retail/ThermographyReports.jsx','src/components/reliance-retail/thermographyReports.css','src/utils/thermographyV2.js',
 'supabase/migrations/20261115140000_retail_thermography_reports.sql','supabase/migrations/20261118010000_retail_thermography_schedule_v2.sql',
 'tests/retailOperationsShapeBrowser.test.js','tests/thermographyReports.browser.test.js','tests/thermographyReports.test.js','docs/THERMOGRAPHY_V2_RELEASE.md',
]);
const normalize=s=>s.replaceAll('\r\n','\n');
export function reviewedWorkflow(base,manifestHash,guardHash){
 const triggers=`      # BEGIN THERMOGRAPHY V2 TRIGGERS\n      - '${manifestPath}'\n      - '${guardPath}'\n      # END THERMOGRAPHY V2 TRIGGERS\n`;
 const authorization=`          # BEGIN THERMOGRAPHY V2 EXACT PAYLOAD\n          v2_manifest = "${manifestPath}"\n          if v2_manifest in files:\n            if subprocess.check_output(["git","rev-parse",f"HEAD:{v2_manifest}"],text=True).strip() != "${manifestHash}":\n              sys.exit("Thermography V2 manifest changed; renew independent review")\n            if subprocess.check_output(["git","rev-parse","HEAD:${guardPath}"],text=True).strip() != "${guardHash}":\n              sys.exit("Thermography V2 guard changed; renew independent review")\n            subprocess.run(["node","${guardPath}",base],check=True)\n            print("PASS: exact reviewed Thermography V2 payload; every subsequent check remains mandatory.")\n            sys.exit(0)\n          # END THERMOGRAPHY V2 EXACT PAYLOAD\n`;
 const source=normalize(base),triggerAnchor='      # BEGIN THERMOGRAPHY FULLSTACK TRIGGERS\n',authAnchor='          # BEGIN THERMOGRAPHY FULLSTACK EXACT PAYLOAD\n';
 if(source.split(triggerAnchor).length!==2||source.split(authAnchor).length!==2)throw Error('Reviewed integration workflow anchors changed');
 return source.replace(triggerAnchor,triggers+triggerAnchor).replace(authAnchor,authorization+authAnchor);
}
export function verifyThermographyPayload({paths,manifest,hash,base,workflow,baseWorkflow}){
 const expected=new Set([...payloadPaths,manifestPath,workflowPath]),actual=new Set(paths),pins=manifest.files||{};
 const missing=[...expected].filter(p=>!actual.has(p)),unexpected=[...actual].filter(p=>!expected.has(p));
 const validManifest=base===approvedBase&&manifest.base_sha===approvedBase&&manifest.schema==='thermography-v2.v1'&&Object.keys(pins).length===payloadPaths.length&&payloadPaths.every(p=>/^[a-f0-9]{40}$/.test(pins[p]||''));
 const mismatched=payloadPaths.filter(p=>actual.has(p)&&hash(p)!==pins[p]);let workflowMatches=false;
 try{workflowMatches=normalize(workflow)===reviewedWorkflow(baseWorkflow,hash(manifestPath),hash(guardPath));}catch{/* fail closed */}
 return {ok:validManifest&&workflowMatches&&!missing.length&&!unexpected.length&&!mismatched.length,validManifest,workflowMatches,missing,unexpected,mismatched};
}
const git=args=>execFileSync('git',['-c',`safe.directory=${process.cwd()}`,...args],{encoding:'utf8'});
export function priorV2WorkflowForChecks(workflow){
 const base=git(['show',`${approvedBase}:${workflowPath}`]),hash=p=>git(['hash-object',`--path=${p}`,p]).trim();
 if(normalize(workflow)!==reviewedWorkflow(base,hash(manifestPath),hash(guardPath)))throw Error('Unreviewed workflow alteration');
 return git(['show',`f23bb8ac03afcba3222b9738369a01043ede2d11:${workflowPath}`]).replaceAll('\r\n','\n');
}
if(process.argv[1]&&fs.existsSync(process.argv[1])&&fileURLToPath(import.meta.url)===fs.realpathSync(process.argv[1])){
 const working=process.argv.includes('--working-tree'),base=process.argv.find(a=>/^[a-f0-9]{40}$/.test(a));
 if(!base)throw Error('Explicit reviewed base SHA required');
 const paths=git(['diff','--name-only',base,...(working?[]:['HEAD'])]).trim().split('\n').filter(Boolean);
 if(working)paths.push(...git(['ls-files','--others','--exclude-standard']).trim().split('\n').filter(Boolean));
 const read=p=>working?fs.readFileSync(p,'utf8'):git(['show',`HEAD:${p}`]);
 const hash=p=>git(working?['hash-object',`--path=${p}`,p]:['rev-parse',`HEAD:${p}`]).trim();
 const result=verifyThermographyPayload({paths,manifest:JSON.parse(read(manifestPath)),hash,base,workflow:read(workflowPath),baseWorkflow:git(['show',`${approvedBase}:${workflowPath}`])});
 console.log(JSON.stringify(result));if(!result.ok)process.exitCode=1;
}
