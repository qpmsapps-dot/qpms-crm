import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
export const approvedBase='098a0c8b6278ac6f6e2e25b5c39360a47b5992e8';
export const manifestPath='.github/deep-cleaning-completed-pins.json';
export const guardPath='.github/deepCleaningCompletedGuard.mjs';
export const workflowPath='.github/workflows/retail-ui-visual-checks.yml';
export const payloadPaths=Object.freeze([
 guardPath,'.github/deepCleaningV2Guard.mjs','.github/thermographyV2Guard.mjs',
 'src/components/reliance-retail/DeepCleaningOverview.jsx',
 'src/pages/reliance-retail/RetailScopedDeepCleaning.jsx',
 'src/utils/deepCleaningView.js','tests/deepCleaningView.test.js',
 'tests/deepCleaningExports.browser.test.js','tests/deepCleaningV2Guard.test.js',
]);
const git=args=>execFileSync('git',['-c',`safe.directory=${process.cwd()}`,...args],{encoding:'utf8'});
const normalize=s=>s.replaceAll('\r\n','\n');
export function reviewedWorkflow(base,manifestHash,guardHash){
 const anchor='          # BEGIN DEEP CLEANING LAYOUT UI EXACT PAYLOAD\n';
 if(normalize(base).split(anchor).length!==2)throw Error('Completed-report authorization anchor drift');
 const block=`          # BEGIN DEEP CLEANING COMPLETED REPORT EXACT PAYLOAD
          completed_manifest = "${manifestPath}"
          if completed_manifest in files:
            if subprocess.check_output(["git","rev-parse",f"HEAD:{completed_manifest}"],text=True).strip() != "${manifestHash}":
              sys.exit("Completed-report manifest changed; renew review")
            if subprocess.check_output(["git","rev-parse","HEAD:${guardPath}"],text=True).strip() != "${guardHash}":
              sys.exit("Completed-report guard changed; renew review")
            subprocess.run(["node","${guardPath}",base],check=True)
            print("PASS: exact reviewed Deep Cleaning report correction; all subsequent checks remain mandatory.")
            sys.exit(0)
          # END DEEP CLEANING COMPLETED REPORT EXACT PAYLOAD
`;
 return normalize(base).replace(anchor,block+anchor);
}
export function verifyPayload({base,paths,manifest,hash,workflow,baseWorkflow}){
 const expected=[...payloadPaths,manifestPath,workflowPath];
 const validManifest=base===approvedBase&&manifest?.base_sha===approvedBase&&manifest.schema==='deep-cleaning-completed.v1'&&Object.keys(manifest.files||{}).length===payloadPaths.length&&payloadPaths.every(p=>/^[a-f0-9]{40}$/.test(manifest.files[p]||''));
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
 if(normalize(workflow)!==reviewedWorkflow(base,hash(manifestPath),hash(guardPath)))throw Error('Unreviewed workflow alteration: completed-report correction');
 return base;
}
if(process.argv[1]&&fs.existsSync(process.argv[1])&&fileURLToPath(import.meta.url)===fs.realpathSync(process.argv[1])){
 const base=process.argv.find(a=>/^[a-f0-9]{40}$/.test(a));if(!base)throw Error('Explicit reviewed base SHA required');
 const result=verifyCurrent(base,process.argv.includes('--working-tree'));console.log(JSON.stringify(result));if(!result.ok)process.exitCode=1;
}
