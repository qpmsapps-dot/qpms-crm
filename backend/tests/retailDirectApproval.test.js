import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {SUPER_ADMIN_IDENTITY_REASON,isDirectIdentityEvidence} from '../shared/retailDirectApproval.js';
import {directApproveSavedIdentities} from '../services/retailSavedReviewService.js';
import {createRetailUnifiedRouter} from '../routes/retailUnifiedRoutes.js';
const actor={id:'00000000-0000-4000-8000-000000000001',role:'ADMIN',is_active:true,status:'Active'},pid='00000000-0000-4000-8000-000000000002';
const input={proposal_ids:[pid],confirm_direct_approval:true,reason:SUPER_ADMIN_IDENTITY_REASON};

test('direct evidence must reference the real source, exact reason and immutable receipt',()=>{
 const p={changes:{activation_review:{source_sha256:'a'.repeat(64)}}},e={approval_mode:'SUPER_ADMIN_DIRECT',reason:SUPER_ADMIN_IDENTITY_REASON,direct_receipt_id:'123',reference:'SUPER_ADMIN_DIRECT:123',evidence_kind:'CONFIRMED_SOURCE_FILE',evidence_sha256:'a'.repeat(64),authority_grant_id:actor.id};
 assert.equal(isDirectIdentityEvidence(p,e),true);
 for(const patch of [{reason:'fabricated'},{reference:'FAKE'},{direct_receipt_id:null},{evidence_sha256:'b'.repeat(64)},{authority_grant_id:null},{evidence_kind:'MANUAL'}])assert.equal(isDirectIdentityEvidence(p,{...e,...patch}),false);
});

test('ordinary Admins fail closed; direct approval requires an explicit entitlement and confirmation',async()=>{
 const calls=[],client={rpc:async(name,args)=>{calls.push({name,args});return {data:{available:true,authorized:false}};}};
 await assert.rejects(()=>directApproveSavedIdentities(client,actor,input),/not configured/);assert.equal(calls.length,1);
 client.rpc=async()=>({error:{code:'PGRST202',message:'missing'}});
 await assert.rejects(()=>directApproveSavedIdentities(client,actor,input),/not configured/);
 client.rpc=async()=>({data:{available:true,authorized:true}});
 for(const patch of [{confirm_direct_approval:false},{reason:'other'},{proposal_ids:[pid,pid]},{proposal_ids:[]}])await assert.rejects(()=>directApproveSavedIdentities(client,actor,{...input,...patch}));
 await assert.rejects(()=>directApproveSavedIdentities(client,{...actor,role:'FO'},input));
});

test('HTTP route binds the real authenticated actor and rejects unauthenticated access',async()=>{
 const calls=[],client={rpc:async(name,args)=>{calls.push({name,args});return {data:name==='rpc_retail_identity_direct_capability'?{available:true,authorized:true}:{approved_count:1,receipt_ids:['isolated-test-receipt']}};}};
 const app=express();app.use(express.json());app.use('/api/reliance-retail/unified-master',(req,res,next)=>{if(req.get('Authorization')!=='Bearer isolated-test-session')return res.sendStatus(401);req.profile=actor;next();},createRetailUnifiedRouter({getClient:()=>client,environment:{}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const url='http://127.0.0.1:'+server.address().port+'/api/reliance-retail/unified-master/saved-review/super-admin-approve';
 try{assert.equal((await fetch(url,{method:'POST'})).status,401);const response=await fetch(url,{method:'POST',headers:{Authorization:'Bearer isolated-test-session','Content-Type':'application/json'},body:JSON.stringify({...input,p_actor:'forged',actor_id:'forged'})});assert.equal(response.status,200);assert.equal((await response.json()).result.approved_count,1);const write=calls.find(c=>c.name==='rpc_retail_identity_direct_approve');assert.equal(write.args.p_actor,actor.id);assert.equal(write.args.p_reason,SUPER_ADMIN_IDENTITY_REASON);assert.deepEqual(write.args.p_proposals,[pid]);}
 finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
