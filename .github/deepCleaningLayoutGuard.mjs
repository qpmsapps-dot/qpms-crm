import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
export const approvedBase='f7dfc0a24eed2affb67e8b6469c4409e060e80cd';
export const manifestPath='.github/deep-cleaning-layout-ui-pins.json';
export const guardPath='.github/deepCleaningLayoutGuard.mjs';
export const workflowPath='.github/workflows/retail-ui-visual-checks.yml';
export const payloadPaths=Object.freeze([
 guardPath,'.github/deepCleaningV2Guard.mjs','.github/thermographyV2Guard.mjs',
 'src/pages/reliance-retail/RetailScopedDeepCleaning.jsx',
 'src/components/reliance-retail/DeepCleaningOverview.jsx',
 'src/components/reliance-retail/RetailCleaningMonthlyPlan.jsx',
 'src/components/reliance-retail/deepCleaningThermographyLayout.css',
 'tests/deepCleaningExports.browser.test.js','tests/deepCleaningWorkflow.browser.test.js',
 'tests/browser/retailExcelInline.spec.js','tests/deepCleaningV2Guard.test.js',
]);
const git=args=>execFileSync('git',['-c',`safe.directory=${process.cwd()}`,...args],{encoding:'utf8'});
const normalize=s=>s.replaceAll('\r\n','\n');
export function reviewedWorkflow(base,manifestHash,guardHash){
 const anchor='          # BEGIN DEEP CLEANING MONTHLY ADMIN EXACT PAYLOAD\n';
 if(normalize(base).split(anchor).length!==2)throw Error('Deep Cleaning UI authorization anchor drift');
 const block=`          # BEGIN DEEP CLEANING LAYOUT UI EXACT PAYLOAD
          layout_manifest = "${manifestPath}"
          if layout_manifest in files:
            if subprocess.check_output(["git","rev-parse",f"HEAD:{layout_manifest}"],text=True).strip() != "${manifestHash}":
              sys.exit("Deep Cleaning UI manifest changed; renew review")
            if subprocess.check_output(["git","rev-parse","HEAD:${guardPath}"],text=True).strip() != "${guardHash}":
              sys.exit("Deep Cleaning UI guard changed; renew review")
            subprocess.run(["node","${guardPath}",base],check=True)
            print("PASS: exact frontend-only Deep Cleaning layout; all subsequent checks remain mandatory.")
            sys.exit(0)
          # END DEEP CLEANING LAYOUT UI EXACT PAYLOAD
`;
 return normalize(base).replace(anchor,block+anchor);
}
export function verifyPayload({base,paths,manifest,hash,workflow,baseWorkflow}){
 const expected=[...payloadPaths,manifestPath,workflowPath];
 const validManifest=base===approvedBase&&manifest?.base_sha===approvedBase&&manifest.schema==='deep-cleaning-layout-ui.v1'&&Object.keys(manifest.files||{}).length===payloadPaths.length&&payloadPaths.every(p=>/^[a-f0-9]{40}$/.test(manifest.files[p]||''));
 const missing=expected.filter(p=>!paths.includes(p)),unexpected=paths.filter(p=>!expected.includes(p));
 const mismatched=payloadPaths.filter(p=>hash(p)!==manifest?.files?.[p]);let workflowMatches=false;
 try{workflowMatches=normalize(workflow)===reviewedWorkflow(baseWorkflow,hash(manifestPath),hash(guardPath));}catch{/* Fail closed. */}
 return {ok:validManifest&&workflowMatches&&!missing.length&&!unexpected.length&&!mismatched.length,validManifest,workflowMatches,missing,unexpected,mismatched};
}
export function verifyCurrent(base,working=false){
 const paths=git(['diff','--name-only',base,...(working?[]:['HEAD'])]).trim().split('\n').filter(Boolean);
 if(working)paths.push(...git(['ls-files','--others','--exclude-standard']).trim().split('\n').filter(Boolean));
 const read=p=>working?fs.readFileSync(p,'utf8'):git(['show',`HEAD:${p}`]);
 const hash=p=>git(working?['hash-object',`--path=${p}`,p]:['rev-parse',`HEAD:${p}`]).trim();
 return verifyPayload({base,paths,manifest:JSON.parse(read(manifestPath)),hash,workflow:read(workflowPath),baseWorkflow:git(['show',`${approvedBase}:${workflowPath}`])});
}
export function priorWorkflow(workflow){
 const base=git(['show',`${approvedBase}:${workflowPath}`]),hash=p=>git(['hash-object',`--path=${p}`,p]).trim();
 if(normalize(workflow)!==reviewedWorkflow(base,hash(manifestPath),hash(guardPath)))throw Error('Unreviewed workflow alteration: Deep Cleaning UI');
 return base;
}
if(process.argv[1]&&fs.existsSync(process.argv[1])&&fileURLToPath(import.meta.url)===fs.realpathSync(process.argv[1])){
 const base=process.argv.find(a=>/^[a-f0-9]{40}$/.test(a));if(!base)throw Error('Explicit reviewed base SHA required');
 const result=verifyCurrent(base,process.argv.includes('--working-tree'));console.log(JSON.stringify(result));if(!result.ok)process.exitCode=1;
}
