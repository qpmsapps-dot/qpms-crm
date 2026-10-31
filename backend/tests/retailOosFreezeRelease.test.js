import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import XLSX from 'xlsx';
import {randomUUID} from 'node:crypto';
import {createRetailServiceTrackerRouter} from '../routes/retailServiceTrackerRoutes.js';

const store={id:'00000000-0000-4000-8000-000000000001',store_code:'TN1',state:'TN',status:'Active'};
const workbook=()=>{const b=XLSX.utils.book_new();XLSX.utils.book_append_sheet(b,XLSX.utils.aoa_to_sheet([['Quotation Number','Store Code','Description','Quantity','Unit Rate'],['NEW','TN1','Item',1,2]]),'Quotation');return XLSX.write(b,{type:'buffer',bookType:'xlsx'});};
async function fixture(check){
 const environment={},profile={id:'reviewer',role:'OOS MIS',business:'Reliance Retail'},order={id:'order',kind:'OOS',reference:'Q',state:'TN',status:'PO_RECORDED',revision:2,created_by:'creator',details:{}};
 const master={admin:false,permissions:[{state:'TN',permission:'reviewer'}],stores:[store]},calls=[];
 const client={rpc:async(name,args)=>{calls.push({name,args});if(name==='rpc_retail_service_snapshot')return {data:{orders:[order],events:[]}};if(name==='rpc_retail_unified_snapshot')return {data:master};return {data:{accepted:true}};}};
 const app=express();app.use(express.json());app.use((r,s,next)=>{r.profile=profile;next();});app.use(createRetailServiceTrackerRouter({getClient:()=>client,environment}));
 app.get('/unrelated',(r,s)=>s.json({ok:true}));app.post('/unrelated',(r,s)=>s.json({ok:true}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const url=`http://127.0.0.1:${server.address().port}`;
 const command=(action='COMMERCIALLY_CONFIRMED')=>fetch(url+'/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,request_id:randomUUID(),order_id:order.id,revision:order.revision,created_by:'browser-claim',data:{confirmation_ref:'REF'}})});
 try{await check({environment,profile,order,master,calls,url,command});}finally{await new Promise(r=>server.close(r));}
}

test('freeze-only release rejects all original OOS mutation routes with stable 503 before RPC access',async()=>fixture(async({environment,calls,url,command})=>{
 environment.RETAIL_OOS_MUTATIONS_FROZEN='true';
 for(const action of ['PO_RECORDED','COMMERCIALLY_CONFIRMED','FUND_RECORDED','PAYMENT_RECORDED','DELIVERED']){const r=await command(action);assert.equal(r.status,503);assert.equal((await r.json()).code,'OOS_MUTATIONS_FROZEN');}
 for(const op of ['import','rework']){const r=await fetch(url+'/quotation/'+op,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:Buffer.from('not parsed while frozen')});assert.equal(r.status,503);assert.equal((await r.json()).code,'OOS_MUTATIONS_FROZEN');}
 assert.equal(calls.length,0);
}));

test('frozen release preserves OOS snapshot/preview and Fault/unrelated routes',async()=>fixture(async({environment,calls,url,command})=>{
 environment.RETAIL_OOS_MUTATIONS_FROZEN='true';assert.equal((await fetch(url)).status,200);
 assert.equal((await fetch(url+'/quotation/preview',{method:'POST',headers:{'Content-Type':'application/octet-stream','x-file-name':'q.xlsx'},body:workbook()})).status,200);
 for(const action of ['REGISTER_FAULT','ESCALATE','ASSIGNED','IN_PROGRESS','RESOLVED','CLOSED']){assert.equal((await command(action)).status,200);assert.equal(calls.at(-1).name,'rpc_retail_service_command');}
 assert.equal((await fetch(url+'/unrelated')).status,200);assert.equal((await fetch(url+'/unrelated',{method:'POST'})).status,200);
}));

test('persisted creator self-confirmation and missing creator fail before mutation; browser cannot override',async()=>fixture(async({profile,order,calls,command})=>{
 for(const creator of [profile.id,null]){order.created_by=creator;calls.length=0;assert.equal((await command()).status,403);assert.ok(calls.every(c=>c.name==='rpc_retail_service_snapshot'));}
}));

test('independent authorized state reviewer uses original command RPC; editor and cross-state reviewer fail',async()=>fixture(async({master,calls,command})=>{
 assert.equal((await command()).status,200);assert.equal(calls.at(-1).name,'rpc_retail_service_command');
 for(const permission of [{state:'TN',permission:'editor'},{state:'KA',permission:'reviewer'}]){master.permissions=[permission];calls.length=0;assert.equal((await command()).status,403);assert.ok(calls.every(c=>['rpc_retail_service_snapshot','rpc_retail_unified_snapshot'].includes(c.name)));}
}));

test('unfrozen quotation import retains original RPC and eleven-stage actions remain unavailable',async()=>fixture(async({url,calls,command})=>{
 assert.equal((await fetch(url+'/quotation/import',{method:'POST',headers:{'Content-Type':'application/octet-stream','x-file-name':'q.xlsx'},body:workbook()})).status,200);
 assert.equal(calls.at(-1).name,'rpc_retail_service_import');calls.length=0;
 assert.equal((await command('OOS2_PO_CONFIRMED')).status,400);assert.equal(calls.length,0);
}));
