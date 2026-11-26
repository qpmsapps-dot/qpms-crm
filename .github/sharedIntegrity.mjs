// Current-delta authorization is independent of frozen release assertions.
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
export const mainBase='eff30bf06e8d9c66c9fc03be8e5b7b9866b0bab4';
export const trainingHead='5119816a45536d9c1c36ce862f5221051496001c';
export const manifestPath='.github/shared-integrity-pins.json';
export const guardPath='.github/sharedIntegrity.mjs';
export const workflowPath='.github/workflows/retail-ui-visual-checks.yml';
export const normalize=s=>s.replaceAll('\r\n','\n');
export const git=args=>execFileSync('git',['-c',`safe.directory=${process.cwd()}`,...args],{encoding:'utf8'});
export const show=(ref,p)=>git(['show',`${ref}:${p}`]);
export function trainingGuardSource(source){
 const anchor='export function verifyCurrent(base,working=false) {\n';
 if(normalize(source).split(anchor).length!==2)throw Error('Training verifier anchor drift');
 return normalize(source).replace(anchor,anchor+" if(fs.existsSync('.github/shared-integrity-pins.json'))return verifySharedCheckout(base,working);\n").replace("import fs from 'node:fs';","import {verifyCheckout as verifySharedCheckout} from './sharedIntegrity.mjs';\nimport fs from 'node:fs';");
}
export function reviewedWorkflow(source,manifestHash,guardHash){
 let s=normalize(source);
 // Existing independent self-tests now precede every authorization path.
 const start=s.indexOf('          approved_phase6_ui = {'),end=s.indexOf('          phase6_changed =',start);
 if(start<0||end<0)throw Error('UI self-test anchors drift');
 const selfTests=s.slice(start,end);s=s.slice(0,start)+s.slice(end);
 const anchor='          # BEGIN RETAIL ATTENDANCE CORRECTION EXACT PAYLOAD\n';
 if(s.split(anchor).length!==2)throw Error('UI authorization anchor drift');
 const block=`          # BEGIN SHARED INTEGRITY EXACT PAYLOAD\n          authorized = False\n${selfTests}          shared_manifest = "${manifestPath}"\n          if shared_manifest in files or ".github/training-v2-pins.json" in files:\n            if subprocess.check_output(["git","rev-parse",f"HEAD:{shared_manifest}"],text=True).strip() != "${manifestHash}":\n              sys.exit("Shared integrity manifest changed; renew review")\n            if subprocess.check_output(["git","rev-parse","HEAD:${guardPath}"],text=True).strip() != "${guardHash}":\n              sys.exit("Shared integrity verifier changed; renew review")\n            subprocess.run(["node","${guardPath}",base],check=True)\n            authorized = True\n          # END SHARED INTEGRITY EXACT PAYLOAD\n`;
 s=s.replace(anchor,block+anchor);
 // Successful authorization selects an exact-content contract; it must not exit
 // before independent self-tests, OOS action checks or subsequent CI steps.
 const protectionStart=s.indexOf(anchor),protectionEnd=s.indexOf('          allowed = {',protectionStart);
 let legacy=s.slice(protectionStart,protectionEnd);
 legacy=legacy.replace(/^          if (.+):$/gm,'          if not authorized and ($1):').replaceAll('            sys.exit(0)','            authorized = True');
 s=s.slice(0,protectionStart)+legacy+s.slice(protectionEnd);
 // The fallback classifies only unclassified deltas. Exact authorization above
 // has already checked every path and byte; OOS checks below always execute.
 s=s.replace('          unexpected = [p for p in files if p not in allowed]','          fallback_files = [] if authorized else files\n          unexpected = [p for p in fallback_files if p not in allowed]');
 s=s.replace('jsx = [p for p in files if','jsx = [p for p in fallback_files if');
 s=s.replace('            if path in files:\n','            if path in fallback_files:\n');
 return s;
}
// Pure verifier: negative tests inject bytes/paths without touching any source.
export function verifyPayload({base,paths,pins,hash,workflow,baseWorkflow,manifestHash,trainingFiles={},baseMatchesShared=false}){
 const validBase=[mainBase,...(pins.integrationBases||[])].includes(base)||baseMatchesShared;
 const validManifest=pins.schema==='shared-integrity.v1'&&pins.base_sha===mainBase;
 const training=Object.keys(trainingFiles).some(p=>paths.includes(p)&&!Object.hasOwn(pins.files||{},p));
 const files={...(training?trainingFiles:{}),...pins.files};
 const expected=[...Object.keys(files),manifestPath,workflowPath];
 const missing=expected.filter(p=>!paths.includes(p));
 const unexpected=paths.filter(p=>!expected.includes(p));
 const mismatched=Object.keys(files).filter(p=>hash(p)!==files[p]);
 let workflowMatches=false;
 try{workflowMatches=normalize(workflow)===reviewedWorkflow(baseWorkflow,manifestHash,hash(guardPath));}catch{/* fail closed */}
 return {ok:validBase&&validManifest&&workflowMatches&&!missing.length&&!unexpected.length&&!mismatched.length,validBase,validManifest,workflowMatches,training,missing,unexpected,mismatched};
}
export function verifyCheckout(base=mainBase,working=true){
 const paths=git(['diff','--name-only',mainBase,...(working?[]:['HEAD'])]).trim().split('\n').filter(Boolean);
 if(working)paths.push(...git(['ls-files','--others','--exclude-standard']).trim().split('\n').filter(Boolean));
 const read=p=>working?fs.readFileSync(p,'utf8'):show('HEAD',p);
 const hash=p=>git(working?['hash-object',`--path=${p}`,p]:['rev-parse',`HEAD:${p}`]).trim();
 // Materialized immutable review pins avoid depending on a feature branch
 // remaining fetchable after squash-merge or branch deletion.
 const trainingFiles=JSON.parse(read('.github/shared-training-pins.json')).files;
 const pins=JSON.parse(read(manifestPath));
 let baseMatchesShared=false;
 if(base&&![mainBase,...(pins.integrationBases||[])].includes(base)){
  const delta=git(['diff','--name-only',mainBase,base]).trim().split('\n').filter(Boolean);
  const expected=[...Object.keys(pins.files),manifestPath,workflowPath];
  baseMatchesShared=delta.length===expected.length&&expected.every(p=>delta.includes(p)&&git(['rev-parse',`${base}:${p}`]).trim()===hash(p));
 }
 return verifyPayload({base,paths:[...new Set(paths)],pins,hash,workflow:read(workflowPath),baseWorkflow:show(mainBase,workflowPath),manifestHash:hash(manifestPath),trainingFiles,baseMatchesShared});
}
export function assertCheckout(){const r=verifyCheckout();if(!r.ok)throw Error('Unreviewed shared integrity checkout: '+JSON.stringify(r));return r;}
export function priorSharedWorkflow(workflow){
 if(!workflow.includes('# BEGIN SHARED INTEGRITY EXACT PAYLOAD'))return workflow;
 assertCheckout();
 if(normalize(workflow)!==normalize(fs.readFileSync(workflowPath,'utf8')))throw Error('Unreviewed workflow alteration: shared integrity');
 return show(mainBase,workflowPath);
}
// Frozen assertions keep comparing immutable releases. This view is only
// available after the entire current checkout passes the independent pins.
export function historicalSource(ref,p){assertCheckout();return show(ref,p);}
export function currentSource(p){assertCheckout();return fs.readFileSync(p,'utf8');}
if(process.argv[1]&&fs.existsSync(process.argv[1])&&fileURLToPath(import.meta.url)===fs.realpathSync(process.argv[1])){
 const r=verifyCheckout(process.argv.find(a=>/^[a-f0-9]{40}$/.test(a)),process.argv.includes('--working-tree'));
 console.log(JSON.stringify(r));if(!r.ok)process.exitCode=1;
}
