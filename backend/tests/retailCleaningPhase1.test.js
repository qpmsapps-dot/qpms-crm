import test from 'node:test';
import assert from 'node:assert/strict';
import XLSX from 'xlsx';
import express from 'express';
import {parseCleaningPlan,cleaningPlanCommand} from '../services/retailCleaningPlanService.js';
import {linkFoCleaning} from '../services/retailCleaningFoLinkService.js';
import {cleaningReport} from '../shared/retailModuleReports.js';
import {createRetailMisRouter} from '../routes/retailMisRoutes.js';
import {summarizeVerifiedCleaningSchedules} from '../../src/utils/retailStatePerformance.js';
const workbook=(rows,headers=['FO_EMPLOYEE_CODE','SCHEDULE_DATE','STATE','STORE_CODE','REMARKS'])=>{
 const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([headers,...rows]),'Monthly');return XLSX.write(book,{type:'buffer',bookType:'xlsx'});
};
test('Excel named fields resolve explicit FO and dates independently of column position',()=>{
 const rows=parseCleaningPlan(workbook([['FO1','2026-12-01','KA','STORE1','notes']]),'plan.xlsx');
 assert.deepEqual(rows,[{FO_EMPLOYEE_CODE:'FO1',SCHEDULE_DATE:'2026-12-01',STATE:'KA',STORE_CODE:'STORE1',REMARKS:'notes'}]);
});
test('Excel accepts store-only monthly schedule without FO assignment',()=>{
 const rows=parseCleaningPlan(workbook([['TN','2629','2026-12-05','Monthly cleaning']],['STATE','STORE_CODE','SCHEDULE_DATE','REMARKS']),'plan.xlsx');
 assert.deepEqual(rows,[{STATE:'TN',STORE_CODE:'2629',SCHEDULE_DATE:'2026-12-05',REMARKS:'Monthly cleaning'}]);
});
test('Excel keeps formatted leading-zero Store Codes and rejects formulas and oversized workbooks',()=>{
 const book=XLSX.utils.book_new(),sheet=XLSX.utils.aoa_to_sheet([['STATE','STORE_CODE','SCHEDULE_DATE'],['TN',12,'2026-12-05']]);
 sheet.B2.z='0000';XLSX.utils.book_append_sheet(book,sheet,'Schedules');
 const bytes=()=>XLSX.write(book,{type:'buffer',bookType:'xlsx'});
 assert.equal(parseCleaningPlan(bytes(),'any-name.xlsx')[0].STORE_CODE,'0012');
 sheet.B2.f='10+2';assert.throws(()=>parseCleaningPlan(bytes(),'plan.xlsx'),/Formula cells/);
 assert.throws(()=>parseCleaningPlan(workbook(Array.from({length:501},()=>['FO','2026-12-05','TN','0012',''])),'plan.xlsx'),/1-500/);
});
test('Excel rejects missing/duplicate/unknown headers and invalid containers',()=>{
 for(const h of [['STATE','STORE_CODE'],['STATE','STORE_CODE','SCHEDULE_DATE','STATE'],['STATE','STORE_CODE','SCHEDULE_DATE','UNKNOWN']])assert.throws(()=>parseCleaningPlan(workbook([['x']],h),'plan.xlsx'));
 assert.throws(()=>parseCleaningPlan(Buffer.from('bad'),'plan.xlsx'));
});
test('Excel retains invalid/empty rows and blank FO for authoritative row-level validation',()=>{
 const rows=parseCleaningPlan(workbook([['','not-a-date','KA','UNKNOWN',''],['','','','','']]),'plan.xlsx');assert.equal(rows.length,2);assert.equal(rows[0].FO_EMPLOYEE_CODE,'');
});
test('Excel date serial is translated, not treated as arbitrary row position',()=>{
 const rows=parseCleaningPlan(workbook([['FO',46357,'KA','S','']]),'plan.xlsx');assert.match(rows[0].SCHEDULE_DATE,/^\d{4}-\d{2}-\d{2}$/);
});
test('RPC always binds actor and auth from server profile',async()=>{
 let actual;await cleaningPlanCommand({rpc:async(n,args)=>{actual={n,args};return {data:{}};}},{id:'actor',auth_user_id:'auth'},'import',{actor:'forged'});
 assert.equal(actual.n,'rpc_retail_cleaning_plan_v1');assert.equal(actual.args.p_actor,'actor');assert.equal(actual.args.p_auth,'auth');
});
test('Historical client links bind Admin identity and preserve the legacy source path',async()=>{
 const calls=[],client={rpc:async(name,args)=>{calls.push({name,args});return {data:{saved:true,id:'legacy-source'}};}};
 const admin={id:'admin',auth_user_id:'admin-auth',role:'Admin',is_active:true};
 const source='00000000-0000-4000-8000-000000000040';
 await linkFoCleaning(client,admin,'plan',{source_kind:'client',action:'preview',source_id:source,actor:'forged',auth:'forged'});
 assert.equal(calls[0].name,'rpc_retail_cleaning_manual_link_v2');assert.equal(calls[0].args.p_actor,admin.id);assert.equal(calls[0].args.p_auth,admin.auth_user_id);
 await linkFoCleaning(client,admin,'plan',{source_id:source});assert.equal(calls[1].name,'rpc_retail_cleaning_link_fo');
 await assert.rejects(linkFoCleaning(client,{...admin,role:'Branch Head'},'plan',{source_kind:'client',source_id:source}),e=>e.statusCode===403);
 await assert.rejects(linkFoCleaning(client,admin,'plan',{source_kind:'unknown',source_id:source}),e=>e.statusCode===400);
 assert.equal(calls.length,2);
});
const store={id:'s',store_code:'S',state:'KA'},base={stores:[store],images:[],schedules:[{id:'a',retail_store_id:'s',scheduled_date:'2026-12-01',status:'Scheduled'},{id:'b',retail_store_id:'s',scheduled_date:'2026-12-01',status:'Scheduled'}]};
test('Two same-store/day schedules require exact linked completion and duplicate retry counts once',()=>{
 const submission={id:'d',retail_store_id:'s',schedule_id:'a',deep_cleaning_date:'2026-12-01',status:'submitted',final_outcome:'Completed'};
 const r=cleaningReport({...base,deep_cleaning:[submission,submission]});assert.equal(r.totals.completed,1);assert.equal(r.totals.pending,1);assert.equal(r.schedules[0].submission_ids.length,1);
});
test('Historical Excel/unlinked work and unverified Completed status do not prove completion',()=>{
 const r=cleaningReport({...base,schedules:[{...base.schedules[0],status:'Completed'}],deep_cleaning:[{id:'legacy',retail_store_id:'s',deep_cleaning_date:'2026-12-01',status:'submitted'}]});assert.equal(r.summary.total.scheduled_completed,0);assert.equal(r.submissions.length,1);
});
test('Verified automatic metadata link preserves independent report identity and exact date matching',()=>{
 const submission={id:'independent',retail_store_id:'s',deep_cleaning_date:'2026-12-01',status:'submitted',final_outcome:'Completed',metadata:{contract_version:'cleaning-independent.phase1b.v1'}};
 const plan={...base.schedules[0],status:'Completed',metadata:{verified_link_contract:'cleaning-match.v2',verified_submission_id:submission.id}};
 const report=cleaningReport({...base,schedules:[plan],deep_cleaning:[submission,submission]});
 assert.equal(report.summary.total.scheduled_completed,1);assert.deepEqual(report.schedules[0].submission_ids,[submission.id]);
 for(const change of [{deep_cleaning_date:'2026-12-02'},{status:'draft'},{metadata:{}},{retail_store_id:'other'}])assert.equal(cleaningReport({...base,schedules:[plan],deep_cleaning:[{...submission,...change}]}).summary.total.scheduled_completed,0);
});
test('Cancelled, Not Done, rescheduled and cross-state jobs do not inflate completion',()=>{
 const d={id:'d',retail_store_id:'s',schedule_id:'a',deep_cleaning_date:'2026-12-01',status:'submitted',final_outcome:'Not Done'};
 assert.equal(cleaningReport({...base,deep_cleaning:[d]}).summary.total.scheduled_completed,0);
 for(const change of [{status:'Cancelled'},{scheduled_date:'2026-12-02'}])assert.equal(cleaningReport({...base,schedules:[{...base.schedules[0],...change}],deep_cleaning:[{...d,final_outcome:'Completed'}]}).summary.total.scheduled_completed,0);
 assert.equal(cleaningReport({...base,deep_cleaning:[]},{state:'TN'}).schedules.length,0);
});
test('Web operational state/month summary excludes historical Excel and cancelled denominator',()=>{
 const r=summarizeVerifiedCleaningSchedules([
  {state:'KA',display_status:'Completed',submission_ids:['d']},
  {state:'KA',display_status:'Completed',source_kind:'IFMS_EXCEL'},
  {state:'KA',display_status:'Cancelled'},
  {state:'KA',display_status:'Completed',submission_ids:[]},
 ]);assert.equal(r.total.scheduled,2);assert.equal(r.total.completed,1);assert.equal(r.total.percentage,50);
});
async function request(path,{frozen=true,module='cleaning',method='POST',role='CENTRAL_MIS'}={}){
 const calls=[];const profile={id:'actor',auth_user_id:'auth',role};
 const client={rpc:async(name,args)=>{calls.push({name,args});if(name==='rpc_retail_mis_access')return {data:{active:true,role,states:['KA']}};if(frozen&&(name==='rpc_retail_cleaning_schedule_direct'||name==='rpc_retail_mis_command'||name==='rpc_retail_cleaning_plan_v1'&&!['list','history','preview'].includes(args.p_action)))return {error:{code:'55000'}};return {data:name==='rpc_retail_cleaning_plan_v1'?{schedules:[]}: {saved:true}};}};
 const app=express();app.use((r,s,next)=>{r.profile=profile;r.authUser={id:'auth'};next();});app.use(createRetailMisRouter({getClient:()=>client}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{const r=await fetch(`http://127.0.0.1:${server.address().port}${path.replace(':module',module)}`,{method,headers:{'content-type':'application/json'},...(method==='GET'?{}:{body:JSON.stringify({store_id:'s',scheduled_date:'2026-12-01',request_id:'r'})})});return {status:r.status,body:await r.json(),calls};}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
}
for(const path of ['/cleaning/schedule','/cleaning/plans/import','/cleaning/plans/id/correct','/command/:module'])test('Frozen MIS mutation cannot write '+path,async()=>{
 const r=await request(path);assert.equal(r.status,503);assert.ok(r.calls.some(c=>c.name!=='rpc_retail_mis_access'));assert.equal(r.body.ok,false);
});
test('Open MIS schedule preserves authenticated identity and gate end',async()=>{
 const r=await request('/cleaning/schedule',{frozen:false});assert.equal(r.status,200);assert.equal(r.calls.find(c=>c.name==='rpc_retail_cleaning_schedule_direct').args.p_actor,'actor');assert.equal(r.calls.at(-1).name,'rpc_retail_cleaning_schedule_direct');
});
test('Frozen plan listing stays read-only and accessible',async()=>{
 const r=await request('/cleaning/plans?month=2026-12',{method:'GET'});assert.equal(r.status,200);assert.ok(!r.calls.some(c=>c.name==='rpc_combined_release_begin'));
});

for(const path of ['/cleaning/plans/import','/cleaning/plans/id/correct','/cleaning/schedule'])test('HK MIS remains read-only '+path,async()=>{
 const r=await request(path,{frozen:false,role:'MIS_HK'});assert.equal(r.status,403);assert.deepEqual(r.calls.map(c=>c.name),['rpc_retail_mis_access']);
});
test('Mounted monthly import uses server identity and RPC rather than direct database writes',async()=>{
 const r=await request('/cleaning/plans/import',{frozen:false});assert.equal(r.status,200);
 const call=r.calls.find(c=>c.name==='rpc_retail_cleaning_plan_v1');assert.equal(call.args.p_actor,'actor');assert.equal(call.args.p_auth,'auth');assert.equal(call.args.p_action,'import');
});
