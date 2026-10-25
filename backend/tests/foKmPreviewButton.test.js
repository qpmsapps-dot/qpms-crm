import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {createKmReconciliationRouter} from '../routes/foKmReconciliationRoutes.js';
import {reconcileSupportedKm} from '../services/foKmIncrementalReconciliationService.js';
import {runSupportedKmPeriod} from '../../src/utils/supportedKmReconciliation.js';

test('existing button helper → authenticated preview route → real V2 calculation uses no financial or queue RPC',async()=>{
 const at=n=>new Date(Date.parse('2026-10-16T03:00:00Z')+n*60000).toISOString();
 const attendance={id:'isolated',employee_code:'FO1',fo_user_id:'FO1',attendance_date:'2026-10-16',login_time:at(100),logout_time:at(120),status:'Completed',travel_mode:'bike',payable_km_allowed:true,rate_per_km:4,total_approved_km:0,petrol_amount:0,start_latitude:12,start_longitude:75,end_latitude:12,end_longitude:75.02,metadata:{}};
 const rows=Array.from({length:21},(_,i)=>({id:'isolated-gps-'+i,attendance_id:attendance.id,employee_code:'FO1',fo_user_id:'FO1',source:'mobile',latitude:12,longitude:75+i*.001,accuracy:8,is_mocked:false,captured_at:at(100+i),logged_at:at(100+i)}));
 const evidence={attendance,visits:[],snapshots:[],rows,originalRows:rows,recoveries:[],corrections:[]};let reads=0;const rpcs=[];
 const builder={select(){return this;},eq(){return this;},gte(){return this;},lte(){return this;},order(){return this;},async range(){return {data:[{id:attendance.id,attendance_date:attendance.attendance_date}]};}};
 const db={from(table){assert.equal(table,'fo_attendance');reads++;return builder;},async rpc(name){rpcs.push(name);assert.equal(name,'rpc_fo_km_reconciliation_state_v1','Posting/queue RPC forbidden');return {data:{digest:'isolated-state',credits:[]}};}};
 const environment={KM_SHARED_RECONCILIATION_PREVIEW_ENABLED:'true',KM_FINANCIAL_WRITES_EMERGENCY_PAUSE:'true',KM_FINANCIAL_WRITES_MAINTENANCE:'true'};
 const app=express();app.use(express.json());app.use('/km',createKmReconciliationRouter({environment,getClient:()=>db,requireAuth(req,res,next){const token=req.headers.authorization;if(!['Bearer isolated-admin','Bearer isolated-fo'].includes(token))return res.status(401).json({message:'Authentication required'});req.authUser={id:'isolated-admin'};req.profile={auth_user_id:'isolated-admin',employee_code:'ISOLATED_ADMIN',role:token.endsWith('-fo')?'FO':'Admin',is_active:true,status:'active',web_access_enabled:true};next();},reconcile:(client,payload,options)=>reconcileSupportedKm(client,payload,{...options,evidence,maxGoogleDirectionsCalls:0})}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const endpoint='http://127.0.0.1:'+server.address().port+'/km/reconcile-supported';
 try{
  const result=await runSupportedKmPeriod({employee:'FO1',dates:['2026-10-16'],endpoint,request:(url,init)=>fetch(url,{...init,headers:{...init.headers,authorization:'Bearer isolated-admin'}})});
  assert.equal(result.ok,true);assert.equal(result.mode,'preview');assert.match(result.message,/Preview Only — no KM credited/);assert.equal(result.results[0].status,'calculated_not_posted');assert(result.results[0].additionalKm>0);assert.equal(result.results[0].financial_posted,false);assert.equal(result.results[0].updated,false);assert.deepEqual(rpcs,['rpc_fo_km_reconciliation_state_v1']);assert.equal(reads,1);
  for(const [token,status] of [[null,401],['Bearer isolated-fo',403]]){const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:token}:{})},body:JSON.stringify({employee_code:'FO1',from_date:'2026-10-16',to_date:'2026-10-16',dry_run:true})});assert.equal(r.status,status);}
  const posting=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer isolated-admin'},body:JSON.stringify({employee_code:'FO1',from_date:'2026-10-16',to_date:'2026-10-16',dry_run:false})});assert.equal(posting.status,503);assert.equal(reads,1);assert.equal(rpcs.length,1);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
