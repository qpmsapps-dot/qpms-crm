// Compare complete backend TAP reports. Existing failures are reported, never hidden.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const [baselineArg,headArg='.',outputArg='tmp/october-regression']=process.argv.slice(2);
if(!baselineArg)throw Error('Provide an unchanged baseline checkout.');
const baseline=path.resolve(baselineArg),head=path.resolve(headArg),output=path.resolve(outputArg);
fs.mkdirSync(output,{recursive:true});
function run(root,label){
 const files=fs.readdirSync(path.join(root,'backend/tests')).filter(f=>f.endsWith('.test.js')).map(f=>'backend/tests/'+f);
 const result=spawnSync(process.execPath,['--test','--test-reporter=tap',...files],{cwd:root,encoding:'utf8',maxBuffer:128*1024*1024,timeout:240000});
 const tap=result.stdout||'';fs.writeFileSync(path.join(output,label+'.tap'),tap+(result.stderr||''));
 if(result.error||result.signal||!/^# tests \d+/m.test(tap))throw Error(label+' backend suite did not finish; comparison cannot pass.');
 const failures=[...tap.matchAll(/^not ok \d+ - (.+)$/gm)].map(m=>m[1].replaceAll('\\','/').replace(root.replaceAll('\\','/')+'/',''));
 const stats=Object.fromEntries([...tap.matchAll(/^# (tests|pass|fail|skipped) (\d+)/gm)].map(m=>[m[1],Number(m[2])]));
 return {exit_code:result.status,stats,failures};
}
const before=run(baseline,'baseline'),after=run(head,'candidate');
const newFailures=after.failures.filter(f=>!before.failures.includes(f));
const report={baseline:before,candidate:after,new_failures:newFailures,comparison_passed:newFailures.length===0,full_backend_suite_passed:after.exit_code===0};
fs.writeFileSync(path.join(output,'comparison.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
if(after.failures.length)console.log('FULL BACKEND SUITE REMAINS FAILING. This is a baseline-comparison result, not a full regression pass.');
if(newFailures.length||after.stats.fail>before.stats.fail)process.exitCode=1;
