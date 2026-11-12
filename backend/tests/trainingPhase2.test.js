import test from 'node:test';import assert from 'node:assert/strict';import express from 'express';
import {retailMisCan,RETAIL_MIS_MODULES} from '../shared/retailMisAccess.js';
import {retailMisReport,signMisTrainingEvidence} from '../services/retailMisService.js';
import {completedTrainingReport} from '../shared/retailModuleReports.js';
import {operationalTrainingRows,summarizeTrainingByClass} from '../../src/utils/retailStatePerformance.js';
import {createRetailMisRouter} from '../routes/retailMisRoutes.js';
const profile={id:'mis',auth_user_id:'auth',role:'MIS_MEPC'},access={active:true,role:'MIS_MEPC',states:['KA']};
test('MEPC MIS gains only module visibility; explicit active/state assignment still required',()=>{
 assert.ok(RETAIL_MIS_MODULES.MIS_MEPC.includes('training-mepc'));assert.equal(retailMisCan(access,'training-mepc','KA'),true);
 for(const a of [{...access,active:false},{...access,states:['TN']},{...access,role:'MIS_HK'}])assert.equal(retailMisCan(a,'training-mepc','KA'),false);
 assert.equal(retailMisCan(access,'training-hk','KA'),false);assert.equal(retailMisCan({...access,role:'MIS_HK'},'training-hk','KA'),true);
});
test('MIS report binds actor/Auth identity and canonical category to new database verification',async()=>{
 let call;const client={rpc:async(name,args)=>{call={name,args};return {data:{rows:[],counts:{completed_sessions:0},read_only:true}};}};
 const r=await retailMisReport(client,profile,access,'training-mepc',{from:'2026-11-01',to:'2026-11-30',state:'KA'});assert.equal(r.read_only,true);assert.equal(call.name,'rpc_retail_mis_training_v4');assert.equal(call.args.p_actor,'mis');assert.equal(call.args.p_auth,'auth');assert.equal(call.args.p_category,'technical_mep');
});
test('Expired/stale database assignment fails closed even when JS role/map allows module',async()=>{
 await assert.rejects(retailMisReport({rpc:async()=>({error:{code:'42501',message:'Assignment revoked'}})},profile,access,'training-mepc',{}),e=>e.statusCode===403);
});
test('Central dashboard replaces draft-inclusive legacy total with independent verified parent counts',async()=>{
 const calls=[];const client={rpc:async(name,args)=>{calls.push({name,args});return {data:name==='rpc_retail_mis_report'?{rows:[{existing_training_sessions:999}]}:{counts:{completed_sessions:args.p_category==='hk'?1:2}}};}};
 const r=await retailMisReport(client,profile,{active:true,role:'CENTRAL_MIS',states:[]},'dashboard',{});assert.equal(r.rows[0].existing_training_sessions,3);assert.equal(r.rows[0].hk_training_completed,1);assert.equal(r.rows[0].mepc_training_completed,2);assert.equal(calls.filter(c=>c.name==='rpc_retail_mis_training_v4').length,2);
});
test('Foreign evidence and wrong category are rejected before any Storage signing',async()=>{
 const client={rpc:async()=>({error:{code:'42501',message:'Outside scope'}}),storage:{from(){throw Error('Must never sign');}}};
 await assert.rejects(signMisTrainingEvidence(client,profile,access,'training-mepc','session','photo'),e=>e.statusCode===403);
 await assert.rejects(signMisTrainingEvidence(client,profile,access,'training-hk','session','photo'),e=>e.statusCode===403);
});
test('Private evidence URL is refreshed with 120s TTL and exact authorized parent/path',async()=>{
 let signed=0;const client={rpc:async()=>({data:{bucket:'training-evidence',path:'training/session/photo/p.png'}}),storage:{from:bucket=>({createSignedUrl:async(path,ttl)=>{assert.equal(bucket,'training-evidence');assert.equal(path,'training/session/photo/p.png');assert.equal(ttl,120);signed++;return {data:{signedUrl:'https://synthetic.invalid/'+signed}};}})}};
 const a=await signMisTrainingEvidence(client,profile,access,'training-mepc','session','photo'),b=await signMisTrainingEvidence(client,profile,access,'training-mepc','session','photo');assert.notEqual(a.url,b.url);assert.equal(b.expires_in,120);
});
test('Untrusted or cross-parent metadata cannot choose another bucket/object',async()=>{
 for(const meta of [{bucket:'public',path:'training/session/photo/p.png'},{bucket:'training-evidence',path:'training/foreign/photo/p.png'},{bucket:'training-evidence',path:'training/session/photo/../../foreign'}]){
  await assert.rejects(signMisTrainingEvidence({rpc:async()=>({data:meta}),storage:{from(){throw Error('Must never sign');}}},profile,access,'training-mepc','session','photo'),e=>e.statusCode===403);
 }
});
const stores=[{id:'s',store_code:'S1',state:'KA'},{id:'t',store_code:'S2',state:'TN'}];
const session=(id,code='hk',status='submitted')=>({id,retail_store_id:'s',store_code_snapshot:'S1',state_snapshot:'KA',category:{code},training_date:'2026-11-07',status});
test('Each HK/MEPC completed parent counts once despite duplicate topic/evidence-shaped rows',()=>{
 const hk=session('hk'),mep=session('mep','technical_mep');const r=completedTrainingReport([hk,{...hk,evidence_id:'e'},mep,{...mep,attendee_id:'a'},session('d','hk','draft'),session('c','technical_mep','cancelled')],stores);assert.deepEqual(r.total,{hk:1,mepc:1});assert.equal(r.rows.length,2);
});
test('KPI state/month filters reject other periods and geography',()=>{
 const rows=[session('old'),{...session('new'),training_date:'2026-12-01'}];assert.equal(completedTrainingReport(rows,stores,{from:'2026-12-01',to:'2026-12-31'}).total.hk,1);assert.equal(completedTrainingReport(rows,stores,{state:'TN'}).total.hk,0);
});
test('Historical Excel and drafts cannot replace verified operational session summary',()=>{
 const rows=[{id:'a',state:'KA',status:'submitted',training_class:'HK'},{id:'b',state:'KA',status:'completed',training_class:'MEPC'},{id:'a',state:'KA',status:'submitted',training_class:'HK'},{id:'x',state:'KA',status:'completed',training_class:'HK',source_kind:'IFMS_EXCEL'},{id:'draft',state:'KA',status:'draft',training_class:'HK'}];
 const ops=operationalTrainingRows(rows);assert.equal(ops.length,2);const r=summarizeTrainingByClass(ops);assert.equal(r.total.completed,2);assert.equal(r.total.hk_completed,1);assert.equal(r.total.mepc_completed,1);
});
test('Actual MIS router exposes scoped read report/evidence and propagates database denials',async()=>{
 const calls=[];const client={rpc:async(name,args)=>{calls.push({name,args});if(name==='rpc_retail_mis_access')return {data:access};if(name==='rpc_retail_mis_training_v4')return args.p_state==='TN'?{error:{code:'42501',message:'Outside state'}}:{data:{rows:[],read_only:true,counts:{completed_sessions:0}}};if(name==='rpc_retail_mis_training_evidence_v4')return {error:{code:'42501',message:'Foreign evidence'}};return {error:{code:'42501',message:'No new write privilege'}};},storage:{from(){throw Error('Must not sign');}}};
 const app=express();app.use((r,s,next)=>{r.profile=profile;r.authUser={id:'auth'};next();});app.use(createRetailMisRouter({getClient:()=>client}));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{const url='http://127.0.0.1:'+server.address().port;assert.equal((await fetch(url+'/report/training-mepc?state=KA')).status,200);assert.equal((await fetch(url+'/report/training-mepc?state=TN')).status,403);assert.equal((await fetch(url+'/report/training-hk')).status,403);assert.equal((await fetch(url+'/existing-evidence/training-mepc/session/photo')).status,403);
  for(const path of ['/command/training-mepc','/evidence/prepare'])assert.equal((await fetch(url+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({module:'training-mepc',action:'CREATE'})})).status,403);
  assert.ok(calls.every(c=>!['rpc_retail_mis_command','rpc_retail_mis_evidence_prepare'].includes(c.name)));assert.ok(calls.every(c=>!c.name.includes('submit')));
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
