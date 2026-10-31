import test from 'node:test';import assert from 'node:assert/strict';import express from 'express';
import {normalizedFaultStoreCode,scopeFaultTickets,filterScopedFaultTickets,scopedFaultTrackerReport} from '../services/faultTrackerStoreScope.js';
import {reportingState} from '../shared/retailAttendance.js';
import {scopedFaultExportRows} from '../../src/utils/faultTrackerExport.js';
const stateCode=v=>reportingState(v).replace(/^AP-/,'AP');
const master=[{id:'a',store_code:'SL81',state:'TN',status:'Active'},{id:'b',store_code:'K001',state:'KA',status:'Active'},{id:'c',store_code:'IN0',state:'TN',status:'Inactive'},{id:'d',store_code:'P001',state:'PY',status:'Active'}];
const source=[['t1',' sl81 ','KN'],['t2','SL81','TN'],['t3','K001','KN'],['t4','IN0','TN'],['t5','UNKNOWN','TN'],['t6','','TN'],['t7','SL81','TN'],['t8','P001','PY']].map(([id,store_code,state_code],i)=>({id,store_code,state_code,store_name:'Same imported name',ticket_no:id==='t5'?'EXCLUDED-TICKET':id,is_active:id!=='t7',stage:i%2?'Completed':'Pending',ageing_days:i+1,supervisor_name:i%2?'Second':'First',created_at_source:`2026-10-${String(i+1).padStart(2,'0')}T00:00:00Z`,import_batch_id:'batch'}));
const admin={id:'admin',role:'Admin',state:'TN',is_active:true,status:'Active'};
const authorization={readAll:true,isAdmin:true,stateCode};
function fixture(stores=master,tickets=source){const tables={reliance_retail_store_master:stores,fault_tracker_tickets:tickets,fault_tracker_import_batches:[{id:'batch',original_file_name:'Source.xlsx',imported_at:'2026-10-31',ticket_count:tickets.length,metadata:{excluded_private_detail:'must not leak'}}],access_modules:[]};return {from(table){let values=[...(tables[table]||[])],start=0,end=Infinity;const q={select(){return q;},eq(k,v){values=values.filter(r=>r[k]===v);return q;},order(){return q;},limit(n){end=n-1;return q;},range(a,b){start=a;end=b;return q;},maybeSingle(){return Promise.resolve({data:values[0]||null});},then(resolve,reject){return Promise.resolve({data:values.slice(start,end+1)}).then(resolve,reject);}};return q;}};}
test('strict normalized Store Code eligibility ignores names and imported states and preserves every source row',()=>{
 const before=JSON.stringify(source),result=scopeFaultTickets(source,master,authorization);
 assert.equal(normalizedFaultStoreCode(' sl81 '),'SL81');assert.notEqual(normalizedFaultStoreCode('0012'),normalizedFaultStoreCode('12'));
 assert.deepEqual(result.tickets.map(t=>t.id),['t1','t2','t3','t8']);
 assert.equal(result.tickets[0].operational_state_code,'TN','Canonical state determines reporting; source state does not determine eligibility');
 assert.deepEqual(result.reconciliation,{imported_tickets:8,matched_in_scope_tickets:4,excluded_tickets:4,unmatched_store_codes:['UNKNOWN','[MISSING STORE CODE]']});
 assert.equal(JSON.stringify(source),before);
 assert.equal(scopeFaultTickets(source,[...master,{...master[0],id:'duplicate',store_code:' sl81 '}],authorization).tickets.some(t=>t.canonical_store_code==='SL81'),false);
});
test('state and explicit store scopes intersect without broadening TN into source PY or mixing grants',()=>{
 const result=scopeFaultTickets(source,master,{readAll:false,profileState:'TN',stateCode});
 assert.deepEqual(result.tickets.map(t=>t.id),['t1','t2']);assert.equal(Object.hasOwn(result,'reconciliation'),false);
 assert.deepEqual(scopeFaultTickets(source,master,{...authorization,grants:[{states:['TN'],stores:['b'],all:false}]}).tickets,[]);
 assert.deepEqual(scopeFaultTickets(source,master,{...authorization,grants:[{states:['KA'],stores:['b'],all:false}]}).tickets.map(t=>t.id),['t3']);
 assert.throws(()=>scopeFaultTickets(source,master,{readAll:false,profileState:'',stateCode}),e=>e.statusCode===403);
});
test('search, state, store, supervisor, date, detail and pagination never recover excluded tickets',async()=>{
 const client=fixture(),mis={...admin,role:'MIS'};
 const read=input=>scopedFaultTrackerReport(client,mis,input,{readAll:false,isAdmin:false,stateCode});
 for(const input of [{ticket_id:'t5'},{id:'t3'},{ticket_no:'EXCLUDED-TICKET'}])await assert.rejects(()=>read(input),e=>e.statusCode===404);
 for(const input of [{search:'EXCLUDED-TICKET'},{store_code:'UNKNOWN'},{state:'KN'}])assert.deepEqual((await read(input)).tickets,[]);
 const page=await read({page:'2',limit:'1',isAdmin:'true'});assert.equal(page.total,2);assert.equal(page.tickets.length,1);assert.equal(Object.hasOwn(page,'reconciliation'),false);assert.equal(Object.hasOwn(page.import_batch,'metadata'),false);assert.equal(page.import_batch.ticket_count,2);
 assert.deepEqual((await read({supervisor:'Second',date_from:'2026-10-02',date_to:'2026-10-02'})).tickets.map(t=>t.id),['t2']);
 const eligible=scopeFaultTickets(source,master,authorization).tickets;
 assert.equal(filterScopedFaultTickets(eligible,{store_code:'sl81'},stateCode).length,2);
 const exportRows=scopedFaultExportRows(eligible.map(t=>({ticketNumber:t.ticket_no,storeId:t.canonical_store_code,storeName:t.store_name,groupedState:t.operational_state_code,ifmsStage:t.stage,ageingDays:t.ageing_days})));
 assert.equal(exportRows.length,5);assert.equal(JSON.stringify(exportRows).includes('EXCLUDED-TICKET'),false);
});
test('Master pagination includes eligible stores beyond 500 and 1000 rows without oversized ID URLs',async()=>{
 const stores=Array.from({length:1201},(_,i)=>({id:`store-${i}`,store_code:`CODE${i}`,state:'TN',status:'Active'}));
 const client=fixture(stores,[{...source[0],id:'last',store_code:'code1200'}]);
 const result=await scopedFaultTrackerReport(client,admin,{},authorization);assert.equal(result.tickets.length,1);assert.equal(result.tickets[0].canonical_store_id,'store-1200');
});
test('HTTP boundary requires an authenticated profile and excluded direct URLs/details disclose no rows',async()=>{
 const app=express();app.get('/tickets',async(req,res)=>{if(req.get('authorization')!=='Bearer local-fixture')return res.status(401).json({});try{res.json(await scopedFaultTrackerReport(fixture(),{...admin,role:'MIS'},req.query,{readAll:false,isAdmin:false,stateCode}));}catch(e){res.status(e.statusCode||500).json({message:e.message});}});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{const base=`http://127.0.0.1:${server.address().port}`;assert.equal((await fetch(base+'/tickets')).status,401);assert.equal((await fetch(base+'/tickets?ticket_id=t5',{headers:{authorization:'Bearer local-fixture'}})).status,404);assert.equal((await fetch(base+'/tickets/t5',{headers:{authorization:'Bearer local-fixture'}})).status,404);const r=await(await fetch(base+'/tickets?search=EXCLUDED-TICKET',{headers:{authorization:'Bearer local-fixture'}})).json();assert.equal(r.total,0);assert.equal(Object.hasOwn(r,'reconciliation'),false);}
 finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
