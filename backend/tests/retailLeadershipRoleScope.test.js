import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {retailLeadershipRole,isRetailLeadership,isRetailBranchHead} from '../shared/retailSouthHeadAccess.js';
import {retailAccess} from '../services/relianceRetailManagementService.js';
import {attendanceAccess} from '../services/retailAttendanceService.js';
import {createRelianceRetailManagementRouter} from '../routes/relianceRetailManagementRoutes.js';

const id='11111111-1111-4111-8111-111111111111';
const auth='22222222-2222-4222-8222-222222222222';
const base={id,auth_user_id:auth,employee_code:'RR-BH',
  role:'Branch Head',business:'Reliance Retail',state:'TN',status:'Active',
  is_active:true,web_access_enabled:true};
const scoped={...base,_retailRoleStates:['TN','PY']};
const south={...scoped,role:'South Head',_retailRoleStates:['TN','PY','KA','KL','TG','AP-1','AP-2']};

test('Retail leadership recognizes roles and business, not specific people',()=>{
  assert.equal(retailLeadershipRole(base),'Branch Head');
  assert.equal(retailLeadershipRole({...base,role:'South Head'}),'South Head');
  assert.equal(isRetailLeadership(base),true);
  assert.equal(isRetailBranchHead(base),true);
  assert.equal(isRetailLeadership({...base,business:'Other Business'}),false);
  assert.equal(isRetailLeadership({...base,role:'Operations Manager'}),false);
  assert.equal(isRetailLeadership({...base,is_active:false}),false);
  assert.equal(isRetailLeadership({...base,web_access_enabled:false}),false);
  assert.equal(isRetailLeadership({...base,auth_user_id:null}),false);
});

test('Retail screens require effective server DB state grants, not role alone',()=>{
  assert.equal(retailAccess(base).allowed,false);
  assert.equal(retailAccess({...base,_retailRoleStates:[]}).dashboard,false);
  for(const actor of [scoped,south]){
    const access=retailAccess(actor);
    for(const section of ['dashboard','stores','zones','deepCleaning','training','faultTracker','oos','cmpm','thermography','manpower']){
      assert.equal(access[section],true,section);
    }
  }
  assert.equal(retailAccess({...scoped,business:'Other Business'}).allowed,false);
  assert.equal(retailAccess({...scoped,role:'Operations Manager'}).allowed,false);
});

test('Attendance remains read-only for state-scoped leadership even when South-wide',()=>{
  for(const actor of [scoped,south]){
    const access=attendanceAccess(actor);
    assert.equal(access.admin,false);
    assert.deepEqual(access.states,actor._retailRoleStates);
    assert.equal(access.state,null);
    assert.throws(()=>attendanceAccess(actor,true),e=>e.statusCode===403);
  }
  assert.throws(()=>attendanceAccess(base),e=>e.statusCode===403);
});

async function request(profile,dbStates,path='/access',method='GET',authId=auth){
  const app=express();
  app.use('/retail',createRelianceRetailManagementRouter({
    requireAuth(req,res,next){req.profile=profile;req.authUser={id:authId};next();},
    getClient(){return {rpc:async(name,args)=>{
      assert.equal(name,'retail_role_states');
      assert.equal(args.p_actor,profile.id);
      return {data:dbStates,error:null};
    }};},
  }));
  const server=await new Promise((resolve,reject)=>{
    const listener=app.listen(0,'127.0.0.1',()=>resolve(listener));
    listener.once('error',reject);
  });
  try{
    const {port}=server.address();
    const response=await fetch(`http://127.0.0.1:${port}/retail${path}`,{method});
    return {status:response.status,body:await response.json()};
  }finally{
    if(server.listening){
      server.closeAllConnections();
      await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    }
  }
}

test('Retail backend applies DB states and rejects mutation for Branch Head',async()=>{
  const visible=await request(base,['TN','PY']);
  assert.equal(visible.status,200);
  assert.equal(visible.body.access.dashboard,true);
  assert.equal(visible.body.access.training,true);
  assert.equal((await request(base,['TN','PY'],'/stores','POST')).status,403);
  assert.equal((await request(base,[])).status,403);
  assert.equal((await request(base,['TN','PY'],'/access','GET','other-auth')).status,403);
});

test('South Head retains full Retail module access using same effective-role gate',async()=>{
  const visible=await request({...base,role:'South Head'},south._retailRoleStates);
  assert.equal(visible.status,200);
  assert.equal(visible.body.access.thermography,true);
});
