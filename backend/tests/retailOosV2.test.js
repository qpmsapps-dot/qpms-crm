import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import XLSX from 'xlsx';
import {createRetailServiceTrackerRouter} from '../routes/retailServiceTrackerRoutes.js';
import {canOperateOos} from '../shared/retailOosAccess.js';
import {createHash} from 'node:crypto';
const store={id:'00000000-0000-4000-8000-000000000001',store_code:'TN1',state:'TN',status:'Active'};
const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Quotation Number','Store Code','Description','Quantity','Unit Rate'],['Q','TN1','Item',1,2]]),'Quotation');const bytes=XLSX.write(book,{type:'buffer',bookType:'xlsx'}),sha=createHash('sha256').update(bytes).digest('hex');
test('OOS actions require explicit OOS MIS or Admin, without granting state permissions',()=>{assert.equal(canOperateOos({role:'OOS MIS',business:'Reliance Retail'}),true);assert.equal(canOperateOos({role:'Technical MIS',business:'Reliance Retail'}),false);assert.equal(canOperateOos({role:'OOS MIS',business:'Other'}),false);assert.equal(canOperateOos({role:'Admin',is_active:false}),false);});
test('quotation preview, historic replay, automatic pre-PO rework and advanced-stage protection',async()=>{
 let status='QUOTED',seen=false,profile={id:'actor',role:'Admin'},calls=[];
 const c={rpc:async(name,args)=>{calls.push({name,args});if(name==='rpc_retail_service_rework_v2')return {error:{code:'PGRST202'}};if(name==='rpc_retail_unified_snapshot')return {data:{stores:[store]}};if(name==='rpc_retail_service_snapshot')return {data:{orders:[{id:'order',kind:'OOS',reference:'Q',status,revision:2,details:{}}],events:seen?[{order_id:'order',evidence:{quotation_file_sha256:sha}}]:[]}};return {data:{order:{status},replayed:false}};}};
 const app=express();app.use((req,res,next)=>{req.profile=profile;next();});app.use(createRetailServiceTrackerRouter({getClient:()=>c}));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const send=op=>fetch(`http://127.0.0.1:${server.address().port}/quotation/${op}`,{method:'POST',headers:{'Content-Type':'application/octet-stream','x-file-name':'q.xlsx'},body:bytes});
 try{let r=await send('preview');assert.equal((await r.json()).result.plan[0].disposition,'REWORK');r=await send('import');assert.equal(r.status,200);assert.equal(calls.at(-1).args.p_action,'REWORK');status='PAYMENT_RECORDED';calls=[];r=await send('import');assert.equal(r.status,503);assert.equal(calls.some(c=>c.name==='rpc_retail_service_command'),false);seen=true;calls=[];r=await send('import');assert.equal((await r.json()).result.replayed,true);assert.equal(calls.some(c=>c.name==='rpc_retail_service_command'),false);profile={id:'actor',role:'Technical MIS',business:'Reliance Retail'};r=await send('import');assert.equal(r.status,403);}finally{await new Promise(r=>server.close(r));}
});
